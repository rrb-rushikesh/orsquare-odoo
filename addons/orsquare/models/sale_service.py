# -*- coding: utf-8 -*-
"""Atomic retail checkout.

``settle`` is the single entry point used by the React app (live checkout and the offline outbox
flush alike).  Odoo stays the authority for everything that matters: the sale is a native
``pos.order`` (taxes via ``account.tax``, delivery via ``stock.picking``/AVCO valuation layers,
payments, session closing entries, optional GST invoice).  This service only orchestrates, guards
and makes it idempotent.

Everything below runs in ONE database transaction: reservation/auto-Godown transfer, delivery,
order, payments and invoice either all succeed or all roll back.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import float_compare, float_is_zero, float_round

_logger = logging.getLogger(__name__)

TENDER_KEYS = ('cash', 'upi', 'khata')


class OrsquareSaleService(models.AbstractModel):
    _name = 'orsquare.sale.service'
    _description = "ORSquare Retail Sale Service"

    # ------------------------------------------------------------------ helpers
    @api.model
    def _parse_created_at(self, raw, offline):
        now = fields.Datetime.now()
        if not raw or not offline:
            return now
        try:
            dt = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
        except ValueError:
            raise UserError(_("Invalid bill timestamp '%s'.", raw))
        if dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        # A device clock must not post into the future.
        return min(dt, now + timedelta(minutes=5))

    @api.model
    def _payment_method(self, company, key):
        method = self.env['pos.payment.method'].search([
            ('orsquare_key', '=', key), ('company_id', '=', company.id)], limit=1)
        if not method:
            method = self.env['orsquare.shop.bootstrap'].payment_method(key, company)
        return method

    @api.model
    def _price_line(self, env, product, qty, price_unit, discount_pct, partner, fpos, currency):
        taxes = fpos.map_tax(product.taxes_id.filtered(lambda t: t.company_id == env.company)) \
            if fpos else product.taxes_id.filtered(lambda t: t.company_id == env.company)
        net_unit = price_unit * (1.0 - (discount_pct or 0.0) / 100.0)
        res = taxes.compute_all(net_unit, currency, qty, product=product, partner=partner)
        return taxes, res['total_excluded'], res['total_included']

    @api.model
    def _prepare_lines(self, env, payload, config, partner, fpos, currency, offline):
        """Turn the client's lines into ``pos.order.line`` values + stock requirements."""
        Product = env['product.product']
        Bottle = env['orsquare.opened_bottle']
        line_vals, sealed_need, peg_need = [], {}, {}
        override_ok = True
        for raw in payload.get('lines') or []:
            peg = raw.get('peg')
            discount = float(raw.get('discount') or 0.0)
            if not 0.0 <= discount <= 100.0:
                raise UserError(_("Discount must be between 0 and 100 percent."))
            if peg:
                bottle = Bottle.browse(int(peg['bottle_id'])).exists()
                if not bottle:
                    raise UserError(_("Unknown open bottle."))
                ml = float(peg['ml'])
                if ml <= 0:
                    raise UserError(_("A peg must be a positive number of ml."))
                product = bottle.product_id
                if not offline:
                    peg_need[bottle.id] = peg_need.get(bottle.id, 0.0) + ml
                else:
                    peg_need[bottle.id] = peg_need.get(bottle.id, 0.0) + ml
                qty = bottle.qty_for_ml(ml)
                rate = raw.get('price')
                if rate is None:
                    size = product.orsquare_peg_for(ml)
                    if not size:
                        raise UserError(_("%(p)s has no %(ml)g ml peg rate; enter one.",
                                          p=product.display_name, ml=ml))
                    rate = size.price
                rate = float(rate)
                price_unit = rate / qty
                name = _("%(p)s Peg %(ml)g ml (%(b)s)", p=product.product_tmpl_id.name, ml=ml, b=bottle.name)
                extra = {'orsquare_opened_bottle_id': bottle.id, 'orsquare_peg_ml': ml}
            else:
                product = Product.browse(int(raw['product_id'])).exists()
                if not product:
                    raise UserError(_("Unknown product."))
                qty = float(raw['qty'])
                if float_is_zero(qty, precision_digits=6):
                    raise UserError(_("Quantity cannot be zero."))
                price_unit = float(raw['price']) if raw.get('price') is not None and override_ok \
                    else product.lst_price
                name = product.display_name
                extra = {}
                if product.is_storable:
                    sealed_need[product.id] = sealed_need.get(product.id, 0.0) + qty
            taxes, excl, incl = self._price_line(env, product, qty, price_unit, discount, partner, fpos, currency)
            line_vals.append({
                'product_id': product.id, 'qty': qty, 'price_unit': price_unit, 'discount': discount,
                'tax_ids': [(6, 0, product.taxes_id.filtered(lambda t: t.company_id == env.company).ids)],
                'tax_ids_after_fiscal_position': [(6, 0, taxes.ids)],
                'price_subtotal': excl, 'price_subtotal_incl': incl,
                'full_product_name': name, **extra,
            })
        if not line_vals:
            raise UserError(_("A bill needs at least one line."))
        return line_vals, sealed_need, peg_need

    @api.model
    def _apply_bill_discount(self, line_vals, bill_discount, currency, env, partner, fpos):
        """Pre-tax trade discount on the whole bill, prorated across lines by gross value."""
        if not bill_discount:
            return
        kind, value = bill_discount.get('kind'), float(bill_discount.get('value') or 0.0)
        if value <= 0:
            return
        gross = [l['qty'] * l['price_unit'] * (1 - l['discount'] / 100.0) for l in line_vals]
        total_gross = sum(gross)
        if total_gross <= 0:
            return
        amount = total_gross * value / 100.0 if kind == 'percent' else value
        if amount > total_gross + 1e-9:
            raise UserError(_("The discount cannot exceed the bill value."))
        allocated, Product = 0.0, env['product.product']
        for i, lv in enumerate(line_vals):
            share = (amount - allocated) if i == len(line_vals) - 1 \
                else float_round(amount * gross[i] / total_gross, precision_rounding=currency.rounding)
            allocated += share
            base = lv['qty'] * lv['price_unit']
            lv['discount'] = (1.0 - (gross[i] - share) / base) * 100.0 if base else 0.0
            product = Product.browse(lv['product_id'])
            taxes, excl, incl = self._price_line(env, product, lv['qty'], lv['price_unit'],
                                                 lv['discount'], partner, fpos, currency)
            lv['price_subtotal'], lv['price_subtotal_incl'] = excl, incl

    # ------------------------------------------------------------------ main entry
    @api.model
    def settle(self, payload):
        user = self.env.user
        if not (self.env.su or user.has_group('orsquare.group_orsquare_cashier')):
            raise AccessError(_("You are not allowed to bill at the counter."))
        ref = (payload.get('client_ref') or '').strip()
        if not ref:
            raise UserError(_("A client reference (idempotency key) is required."))
        company = self.env.company
        offline = bool(payload.get('offline'))
        created_at = self._parse_created_at(payload.get('created_at'), offline)
        env = self.sudo().with_context(orsquare_event_dt=created_at).env

        # Serialise replays of the very same bill, then answer idempotently.
        env.cr.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [ref])
        existing = env['pos.order'].search([
            ('orsquare_client_ref', '=', ref), ('company_id', '=', company.id)], limit=1)
        if existing:
            return self._result(env, existing, duplicate=True)

        currency = company.currency_id
        business_date = company.orsquare_business_date_for(created_at)
        day = env['orsquare.business_day'].ensure_open_day(company, business_date)
        session = day.session_id
        config = session.config_id
        partner = env['res.partner'].browse(int(payload['partner_id'])).exists() \
            if payload.get('partner_id') else env['res.partner']
        fpos = partner.property_account_position_id or config.default_fiscal_position_id

        line_vals, sealed_need, peg_need = self._prepare_lines(
            env, payload, config, partner, fpos, currency, offline)
        self._apply_bill_discount(line_vals, payload.get('bill_discount'), currency, env, partner, fpos)

        amount_total = float_round(sum(l['price_subtotal_incl'] for l in line_vals), precision_rounding=currency.rounding)
        amount_tax = float_round(amount_total - sum(l['price_subtotal'] for l in line_vals),
                                 precision_rounding=currency.rounding)

        # ---- tenders -------------------------------------------------------------------------
        concession = float(payload.get('settlement_concession') or 0.0)
        if concession < 0:
            raise UserError(_("A settlement concession cannot be negative."))
        payments, paid_total, change = [], 0.0, 0.0
        due = amount_total - concession
        for pay in payload.get('payments') or []:
            key = pay.get('method')
            if key not in TENDER_KEYS:
                raise UserError(_("Unknown payment method '%s'.", key))
            amount = float(pay['amount'])
            if amount <= 0:
                continue
            payments.append((key, amount))
        for key, amount in payments:
            paid_total += amount
        rounding = config.rounding_method.rounding if config.cash_rounding else currency.rounding
        if float_compare(paid_total, due, precision_rounding=currency.rounding) > 0:
            cash_amount = sum(a for k, a in payments if k == 'cash')
            over = float_round(paid_total - due, precision_rounding=currency.rounding)
            if float_compare(over, cash_amount, precision_rounding=currency.rounding) > 0:
                raise UserError(_("Only cash can be over-tendered."))
            change = over  # change handed back; only the net cash is recorded
            payments = [(k, (a - over) if k == 'cash' else a) for k, a in payments]
            paid_total = due
        gap = float_round(due - paid_total, precision_rounding=currency.rounding)
        if abs(gap) > (config.rounding_method.rounding / 2.0 if config.cash_rounding else 0.0) \
                and not float_is_zero(gap, precision_rounding=currency.rounding):
            raise UserError(_("The bill is not fully paid: %s outstanding.", gap))
        if any(k == 'khata' for k, _a in payments):
            if not partner:
                raise UserError(_("Khata (credit) needs a customer."))
            self._check_credit_limit(env, partner, sum(a for k, a in payments if k == 'khata'), offline)
        if payload.get('to_invoice') and not partner:
            raise UserError(_("A tax invoice needs a customer."))

        # ---- stock: pegs, auto-Godown, row locks ------------------------------------------------
        warehouse = env['stock.warehouse'].orsquare_main_warehouse(company)
        bottles = env['orsquare.opened_bottle'].browse(list(peg_need))
        peg_short = {}
        if bottles:
            env['orsquare.stock.service'].lock_quants(
                bottles.mapped('product_id').ids, bottles.mapped('location_id').ids)
            for bottle in bottles:
                bottle.invalidate_recordset(['remaining_qty', 'remaining_ml'])
                need_qty = bottle.qty_for_ml(peg_need[bottle.id])
                if bottle.state != 'active':
                    raise UserError(_("Bottle %s is closed.", bottle.name))
                if float_compare(need_qty, bottle.remaining_qty, precision_digits=6) > 0:
                    if not offline:
                        raise UserError(_(
                            "Bottle %(b)s has only %(left).0f ml left; cannot pour %(ml).0f ml.",
                            b=bottle.name, left=bottle.remaining_ml, ml=peg_need[bottle.id]))
                    peg_short[bottle] = need_qty - max(bottle.remaining_qty, 0.0)
        net_need = {pid: q for pid, q in sealed_need.items() if q > 0}
        transfer_picking, shortages = env['orsquare.stock.service'].ensure_counter_stock(
            warehouse, net_need, ref, allow_oversell=offline)

        # ---- the order ---------------------------------------------------------------------------
        order = env['pos.order'].create({
            'session_id': session.id, 'config_id': config.id, 'company_id': company.id,
            'pricelist_id': config.pricelist_id.id, 'user_id': self.env.uid,
            'partner_id': partner.id or False, 'fiscal_position_id': fpos.id or False,
            'date_order': created_at,
            'amount_tax': amount_tax, 'amount_total': amount_total,
            'amount_paid': 0.0, 'amount_return': change,
            'to_invoice': bool(payload.get('to_invoice')),
            'lines': [(0, 0, lv) for lv in line_vals],
            'uuid': str(uuid.uuid4()),
            'orsquare_client_ref': ref, 'orsquare_offline': offline,
            'orsquare_concession': concession,
            'general_note': payload.get('note') or False,
        })
        for key, amount in payments:
            order.add_payment({
                'pos_order_id': order.id, 'amount': amount, 'name': key,
                'payment_method_id': self._payment_method(company, key).id,
                'payment_date': created_at,
            })
        if concession:
            order.add_payment({
                'pos_order_id': order.id, 'amount': concession, 'name': 'concession',
                'payment_method_id': self._payment_method(company, 'concession').id,
                'payment_date': created_at,
            })
        order.action_pos_order_paid()          # raises when not fully paid (unlike _process_saved_order)
        order._create_order_picking()
        order._compute_total_cost_in_real_time()
        if order.to_invoice:
            order._generate_pos_order_invoice()
        bottles.refresh_if_drained()

        # ---- offline physical conflicts are accepted and flagged ---------------------------------
        flagged = self._flag_discrepancies(env, company, order, warehouse, shortages, peg_short, business_date)

        env['orsquare.event'].publish(company, 'sale_settled', {
            'order_id': order.id, 'name': order.name, 'total': amount_total,
            'business_date': str(business_date), 'flagged': bool(flagged)})
        return self._result(env, order, transfer_picking=transfer_picking, flagged=flagged)

    # ------------------------------------------------------------------ pieces
    @api.model
    def _check_credit_limit(self, env, partner, amount, offline):
        company = env.company
        if not company.account_use_credit_limit or partner.credit_limit <= 0:
            return
        if partner.credit + amount > partner.credit_limit and not offline:
            raise UserError(_(
                "%(c)s would exceed the Khata limit of %(lim)s (outstanding %(cur)s).",
                c=partner.name, lim=partner.credit_limit, cur=partner.credit))

    @api.model
    def _flag_discrepancies(self, env, company, order, warehouse, shortages, peg_short, business_date):
        Disc = env['orsquare.stock_discrepancy']
        out = Disc
        for pid, short in (shortages or {}).items():
            out |= Disc.create({
                'company_id': company.id, 'product_id': pid, 'location_id': warehouse.orsquare_counter_id.id,
                'qty_short': short, 'pos_order_id': order.id, 'business_date': business_date,
                'note': _("Offline sale accepted with insufficient system stock.")})
        for bottle, short in (peg_short or {}).items():
            out |= Disc.create({
                'company_id': company.id, 'product_id': bottle.product_id.id,
                'location_id': bottle.location_id.id, 'qty_short': short, 'pos_order_id': order.id,
                'business_date': business_date,
                'note': _("Offline peg sale poured more than the system held for %s.", bottle.name)})
        if out:
            order.orsquare_flagged = True
        return out

    @api.model
    def _result(self, env, order, duplicate=False, transfer_picking=None, flagged=None):
        return {
            'order_id': order.id, 'name': order.name, 'state': order.state,
            'total': order.amount_total, 'tax': order.amount_tax, 'change': order.amount_return,
            'business_date': str(order.orsquare_business_date),
            'invoice_id': order.account_move.id or False,
            'invoice_name': order.account_move.name or False,
            'pickings': order.picking_ids.mapped('name'),
            'auto_godown_transfer': transfer_picking.name if transfer_picking else False,
            'flagged': bool(flagged) if flagged is not None else bool(order.orsquare_flagged),
            'duplicate': duplicate,
        }
