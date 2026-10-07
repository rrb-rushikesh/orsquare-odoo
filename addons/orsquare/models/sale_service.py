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
from odoo.exceptions import AccessError, RedirectWarning, UserError, ValidationError
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
    def _price_refund_line(self, env, raw, currency, partner):
        """A return is always priced at the ORIGINAL line's rate, discount and taxes."""
        orig = env['pos.order.line'].browse(int(raw['refund_of_line_id'])).exists()
        if not orig or orig.order_id.company_id != env.company \
                or orig.order_id.state not in ('paid', 'done', 'invoiced'):
            raise UserError(_("The bill line being returned was not found."))
        refundable = orig.qty - orig.refunded_qty
        qty = refundable if raw.get('full') else float(raw['qty'])
        if qty <= 0 or float_compare(qty, refundable, precision_digits=6) > 0:
            raise UserError(_("%(p)s: only %(r)s can still be returned.", p=orig.full_product_name, r=refundable))
        qty = -qty
        res = orig.tax_ids_after_fiscal_position.compute_all(
            orig.price_unit * (1 - orig.discount / 100.0), currency, qty, product=orig.product_id, partner=partner)
        return orig, qty, res

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
            elif raw.get('refund_of_line_id'):
                orig, qty, res = self._price_refund_line(env, raw, currency, partner)
                line_vals.append({
                    'product_id': orig.product_id.id, 'qty': qty, 'price_unit': orig.price_unit,
                    'discount': orig.discount, 'tax_ids': [(6, 0, orig.tax_ids.ids)],
                    'tax_ids_after_fiscal_position': [(6, 0, orig.tax_ids_after_fiscal_position.ids)],
                    'price_subtotal': res['total_excluded'], 'price_subtotal_incl': res['total_included'],
                    'full_product_name': _("%s (return)", orig.full_product_name),
                    'refunded_orderline_id': orig.id,
                })
                continue
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
        """Bill a sale, a return, or an exchange (return + sale on one request).

        Transaction-type awareness: a counter (non-invoiced) receipt nets returns and new items on one
        bill; when the returned goods were sold on a tax invoice, the backend instead issues a paired
        statutory Credit Note and a new Tax Invoice.  The caller sees one unified operation.
        """
        user = self.env.user
        if not (self.env.su or user.has_group('orsquare.group_orsquare_cashier')):
            raise AccessError(_("You are not allowed to bill at the counter."))
        lines = payload.get('lines') or []
        refund_ids = [int(l['refund_of_line_id']) for l in lines if l.get('refund_of_line_id')]
        if refund_ids:
            if not (self.env.su or user.has_group('orsquare.group_orsquare_can_manage_returns')):
                raise AccessError(_("You are not allowed to process returns."))
            originals = self.sudo().env['pos.order.line'].browse(refund_ids).exists().mapped('order_id')
            if any(o.account_move for o in originals) and any(not l.get('refund_of_line_id') for l in lines):
                return self._settle_invoiced_exchange(payload, originals)
        return self._settle_single(payload)

    @api.model
    def _settle_invoiced_exchange(self, payload, originals):
        """Paired documents: Credit Note (refund order) + new Tax Invoice (sale order)."""
        ref = payload['client_ref']
        lines = payload['lines']
        env0 = self.sudo().env
        env0.cr.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [ref])
        done = env0['pos.order'].search([('orsquare_client_ref', 'in', [ref + ':R', ref + ':S']),
                                         ('company_id', '=', self.env.company.id)])
        if len(done) == 2:   # replay of a completed exchange: answer from what was already posted
            refund_o = done.filtered(lambda o: o.orsquare_client_ref.endswith(':R'))
            sale_o = done - refund_o
            r, sl = self._result(env0, refund_o, duplicate=True), self._result(env0, sale_o, duplicate=True)
            return self._combine_exchange(r, sl, -refund_o.amount_total, 'cash')
        refund_lines = [l for l in lines if l.get('refund_of_line_id')]
        sale_lines = [l for l in lines if not l.get('refund_of_line_id')]
        partner_id = payload.get('partner_id') or originals[:1].partner_id.id
        base = {k: v for k, v in payload.items() if k not in ('lines', 'payments', 'client_ref', 'bill_discount')}
        currency = self.env.company.currency_id
        partner = self.sudo().env['res.partner'].browse(int(partner_id))
        method = (payload.get('payments') or [{'method': 'cash'}])[0]['method']
        refund_total = float_round(-sum(
            self._price_refund_line(self.sudo().env, l, currency, partner)[2]['total_included']
            for l in refund_lines), precision_rounding=currency.rounding)
        # The credit note is paid out in full and the new invoice is paid in full: the customer's
        # tender is the NET (drawer nets the two), each statutory document stays self-consistent.
        refund = self._settle_single(dict(base, client_ref=ref + ':R', partner_id=partner_id, lines=refund_lines,
                                          to_invoice=True, payments=[{'method': method, 'amount': refund_total}]))
        new_payments = [dict(p) for p in (payload.get('payments') or [])]
        if new_payments:
            new_payments[0]['amount'] = float(new_payments[0]['amount']) + refund_total
        else:
            new_payments = [{'method': method, 'amount': refund_total}]
        sale = self._settle_single(dict(base, client_ref=ref + ':S', partner_id=partner_id, lines=sale_lines,
                                        to_invoice=True, payments=new_payments,
                                        bill_discount=payload.get('bill_discount')))
        return self._combine_exchange(refund, sale, refund_total, method)

    @api.model
    def _combine_exchange(self, refund, sale, refund_total, method):
        return {
            'order_id': sale['order_id'], 'name': sale['name'], 'state': sale['state'],
            'total': sale['total'] - refund_total, 'tax': sale['tax'], 'change': sale['change'],
            'business_date': sale['business_date'], 'invoice_id': sale['invoice_id'],
            'invoice_name': sale['invoice_name'], 'pickings': refund['pickings'] + sale['pickings'],
            'auto_godown_transfer': sale['auto_godown_transfer'], 'flagged': sale['flagged'],
            'duplicate': sale['duplicate'] and refund['duplicate'],
            'credit_note_id': refund['invoice_id'], 'credit_note_name': refund['invoice_name'],
            'credit_note_total': refund_total, 'refund_payout': method,
        }

    @api.model
    def _settle_single(self, payload):
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
        business_date = company.orsquare_business_date_for(created_at) if offline \
            else company.orsquare_effective_business_date(created_at)
        rolled_forward = business_date != company.orsquare_business_date_for(created_at)
        if rolled_forward:
            env = env(context=dict(env.context, orsquare_event_dt=False))   # let documents take the effective date
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
        refund_mode = float_compare(amount_total, 0.0, precision_rounding=currency.rounding) < 0
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
        if refund_mode:
            # money goes OUT: payouts (entered positive) are recorded as negative payments
            if concession:
                raise UserError(_("A settlement concession applies to a payment, not to a refund."))
            if float_compare(paid_total, -due, precision_rounding=currency.rounding) != 0:
                raise UserError(_("The refund of %(due)s must be paid out in full (got %(got)s).",
                                  due=-due, got=paid_total))
            payments = [(k, -a) for k, a in payments]
            paid_total = due
        else:
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
            self._check_credit_limit(env, partner, sum(a for k, a in payments if k == 'khata' and a > 0), offline)
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
            try:
                order._generate_pos_order_invoice()
            except RedirectWarning as warning:
                # e.g. l10n_in needs the shop's address AND state before it can post a tax invoice
                raise UserError(_("%s\nOpen Settings > Business details to complete it.", warning.args[0]))
        bottles.refresh_if_drained()

        # ---- offline physical conflicts are accepted and flagged ---------------------------------
        flagged = self._flag_discrepancies(env, company, order, warehouse, shortages, peg_short, business_date)

        env['orsquare.event'].publish(company, 'sale_settled', {
            'order_id': order.id, 'name': order.name,
            'business_date': str(business_date), 'flagged': bool(flagged)}, money={'total': amount_total})
        result = self._result(env, order, transfer_picking=transfer_picking, flagged=flagged)
        result['rolled_forward'] = rolled_forward
        return result

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
