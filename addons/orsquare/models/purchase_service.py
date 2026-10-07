# -*- coding: utf-8 -*-
"""Supplier bills (simple + advanced) on top of native purchase / stock / account.

Odoo does all the accounting and valuation:

* the goods arrive through a real ``purchase.order`` receipt into ``WH/Stock/Godown`` (AVCO layer);
* the vendor bill is the native bill of that order (GST input tax via ``account.tax``);
* trade discounts and freight/handling that the owner chooses to *capitalise* are posted as bill
  lines and then allocated to the receipt by Odoo's own **stock.landed.cost** (negative cost lines
  are how Odoo expresses a capitalised discount) — ORSquare has no costing engine;
* TCS is an asset line, and the supplier's printed total is matched exactly by a bounded penny
  round-off line.
"""
import logging
from datetime import datetime, time, timezone

import zoneinfo

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, RedirectWarning, UserError
from odoo.tools import float_compare, float_is_zero, float_round

_logger = logging.getLogger(__name__)


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    orsquare_client_ref = fields.Char(index=True, copy=False, readonly=True)
    orsquare_advanced = fields.Boolean(string="Advanced Bill", readonly=True, copy=False)
    orsquare_tp_no = fields.Char(string="Transport Permit No.", copy=False)
    orsquare_tp_date = fields.Date(string="TP Date", copy=False)

    _sql_constraints = [
        ('orsquare_client_ref_unique', 'unique(orsquare_client_ref, company_id)',
         "This purchase was already recorded (duplicate client reference)."),
    ]


class AccountMove(models.Model):
    _inherit = 'account.move'

    orsquare_tp_no = fields.Char(string="Transport Permit No.", copy=False)
    orsquare_tp_date = fields.Date(string="TP Date", copy=False)
    orsquare_vehicle_no = fields.Char(string="Vehicle No.", copy=False)
    orsquare_lr_no = fields.Char(string="LR/RR No.", copy=False)
    orsquare_eway_bill_no = fields.Char(string="e-Way Bill No.", copy=False)
    orsquare_stated_total = fields.Monetary(
        string="Supplier's Printed Total", copy=False, currency_field='currency_id',
        help="Total printed on the supplier's paper bill; the difference to our total is booked to Round-off.")
    orsquare_tcs_calculated = fields.Monetary(copy=False, currency_field='currency_id')


class OrsquarePurchaseService(models.AbstractModel):
    _name = 'orsquare.purchase.service'
    _description = "ORSquare Purchase Service"

    # ------------------------------------------------------------------ helpers
    @api.model
    def _check_access(self):
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_stockkeeper')):
            raise AccessError(_("You are not allowed to record purchases."))

    @api.model
    def _event_dt(self, company, bill_date):
        """Back-dated bills are attributed to their own business date (and rejected if sealed)."""
        now = fields.Datetime.now()
        if not bill_date:
            return now
        bill_date = fields.Date.to_date(bill_date)
        if bill_date == company.orsquare_current_business_date():
            return now
        tz = zoneinfo.ZoneInfo(company.orsquare_tz)
        noon = datetime.combine(bill_date, time(12, 0), tzinfo=tz)
        return noon.astimezone(timezone.utc).replace(tzinfo=None)

    @api.model
    def _prepare_lines(self, env, payload, company, supplier):
        """Normalise client lines into native PO line values (net unit price, no custom math later)."""
        Product = env['product.product']
        UoM = env['uom.uom']
        currency = company.currency_id
        out, gross_total = [], 0.0
        for raw in payload.get('lines') or []:
            product = Product.browse(int(raw['product_id'])).exists()
            if not product:
                raise UserError(_("Unknown product."))
            uom = UoM.browse(int(raw['uom_id'])) if raw.get('uom_id') else product.uom_po_id
            if uom.category_id != product.uom_id.category_id:
                raise UserError(_("%(u)s cannot be used for %(p)s.", u=uom.name, p=product.display_name))
            qty = float(raw['qty'])
            if qty <= 0:
                raise UserError(_("Quantity must be positive."))
            # bi-directional rate entry: forward (qty x rate) or reverse (qty + total -> rate)
            if raw.get('amount') is not None and raw.get('rate') is None:
                rate = float(raw['amount']) / qty
            elif raw.get('rate') is not None:
                rate = float(raw['rate'])
            else:
                raise UserError(_("Give either a rate or a total amount for %s.", product.display_name))
            basic_amount = qty * rate
            disc_pct = float(raw.get('discount_pct') or 0.0)
            disc_amt = float(raw.get('discount_amount') or 0.0)
            if disc_pct and disc_amt:
                raise UserError(_("Use a % discount or a fixed discount on a line, not both."))
            if not 0.0 <= disc_pct <= 100.0 or disc_amt < 0 or disc_amt > basic_amount + 1e-9:
                raise UserError(_("Invalid discount on %s.", product.display_name))
            unit_net = rate - (disc_amt / qty if disc_amt else 0.0)
            taxes = supplier.property_account_position_id.map_tax(
                product.supplier_taxes_id.filtered(lambda t: t.company_id == company)) \
                if supplier.property_account_position_id else \
                product.supplier_taxes_id.filtered(lambda t: t.company_id == company)
            if payload.get('tax_inclusive_rates'):
                # rate typed is tax-inclusive: reverse to the taxable base (Rate = Total / (1 + t))
                res = taxes.with_context(force_price_include=False).compute_all(
                    1.0, currency, 1.0, product=product, partner=supplier)
                factor = res['total_included']
                unit_net = unit_net / factor if factor else unit_net
            if company.orsquare_cost_include_taxes and taxes:
                # Composition / Non-GST shop: tax is part of the stock cost, no input credit.
                incl = taxes.compute_all(unit_net, currency, 1.0, product=product, partner=supplier)['total_included']
                unit_net, taxes = incl, taxes.browse()
            line_gross = qty * unit_net * (1 - disc_pct / 100.0)
            gross_total += line_gross
            out.append({
                'product_id': product.id, 'name': product.display_name, 'product_qty': qty,
                'product_uom': uom.id, 'price_unit': unit_net, 'discount': disc_pct,
                'taxes_id': [(6, 0, taxes.ids)],
                'date_planned': fields.Datetime.now(),
            })
        if not out:
            raise UserError(_("A purchase bill needs at least one line."))
        return out, float_round(gross_total, precision_rounding=currency.rounding)

    @api.model
    def _adjustments(self, payload, company):
        """Split bill adjustments into capitalised / expensed discounts and charges."""
        cap_disc, exp_disc, cap_chg, exp_chg = [], [], [], []
        for adj in payload.get('adjustments') or []:
            kind, amount = adj.get('type'), float(adj['amount'])
            if amount <= 0:
                raise UserError(_("Adjustment amounts are entered as positive numbers."))
            default = company.orsquare_cost_include_discounts if kind == 'discount' else company.orsquare_cost_include_expenses
            capitalize = adj.get('capitalize', default)
            item = {'name': adj.get('description') or kind.title(), 'amount': amount}
            if kind == 'discount':
                (cap_disc if capitalize else exp_disc).append(item)
            elif kind == 'expense':
                (cap_chg if capitalize else exp_chg).append(item)
            else:
                raise UserError(_("Unknown adjustment type '%s'.", kind))
        return cap_disc, exp_disc, cap_chg, exp_chg

    # ------------------------------------------------------------------ preview (no writes)
    @api.model
    def preview_bill(self, payload):
        """Bi-directional rate engine + TCS suggestion for the Advanced Bill drawer (read-only)."""
        self._check_access()
        company = self.env.company
        env = self.sudo().env
        supplier = env['res.partner'].browse(int(payload['supplier_id'])).exists() \
            if payload.get('supplier_id') else env['res.partner']
        lines, gross = self._prepare_lines(env, payload, company, supplier)
        cap_d, exp_d, cap_c, exp_c = self._adjustments(payload, company)
        discounts = sum(a['amount'] for a in cap_d + exp_d)
        charges = sum(a['amount'] for a in cap_c + exp_c)
        tax = 0.0
        for lv in lines:
            taxes = env['account.tax'].browse(lv['taxes_id'][0][2])
            unit = lv['price_unit'] * (1 - lv['discount'] / 100.0)
            res = taxes.compute_all(unit, company.currency_id, lv['product_qty'])
            tax += res['total_included'] - res['total_excluded']
        base = gross - discounts + charges
        tcs_rate = self._tcs_rate(payload, company, lines)
        tcs_calc = float_round(base * tcs_rate / 100.0, precision_rounding=company.currency_id.rounding)
        return {'lines': [{'product_id': lv['product_id'], 'qty': lv['product_qty'], 'rate': lv['price_unit'],
                           'amount': float_round(lv['product_qty'] * lv['price_unit'] * (1 - lv['discount'] / 100.0),
                                                 precision_rounding=company.currency_id.rounding)} for lv in lines],
                'gross': gross, 'discounts': discounts, 'charges': charges, 'tax': tax,
                'tcs_rate': tcs_rate, 'tcs_calculated': tcs_calc,
                'total': float_round(base + tax + (payload.get('tcs', {}).get('amount', tcs_calc)),
                                     precision_rounding=company.currency_id.rounding)}

    @api.model
    def _tcs_rate(self, payload, company, lines):
        tcs = payload.get('tcs')
        if tcs and tcs.get('rate') is not None:
            return float(tcs['rate'])
        # default: the highest TCS rate among the regimes of the bought products
        rates = [self.env['product.product'].browse(l['product_id']).product_tmpl_id.orsquare_tcs_rate for l in lines]
        return max(rates) if rates else 0.0

    # ------------------------------------------------------------------ main entry
    @api.model
    def record_bill(self, payload):
        self._check_access()
        ref = (payload.get('client_ref') or '').strip()
        if not ref:
            raise UserError(_("A client reference (idempotency key) is required."))
        company = self.env.company
        currency = company.currency_id
        event_dt = self._event_dt(company, payload.get('bill_date'))
        env = self.sudo().with_context(orsquare_event_dt=event_dt).env
        env.cr.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [ref])
        existing = env['purchase.order'].search([('orsquare_client_ref', '=', ref), ('company_id', '=', company.id)], limit=1)
        if existing:
            return self._result(existing, duplicate=True)

        supplier = env['res.partner'].browse(int(payload['supplier_id'])).exists()
        if not supplier:
            raise UserError(_("Choose a supplier."))
        back_dated = bool(payload.get('bill_date')) and \
            fields.Date.to_date(payload['bill_date']) != company.orsquare_current_business_date()
        business_date = company.orsquare_business_date_for(event_dt) if back_dated \
            else company.orsquare_effective_business_date(event_dt)
        if back_dated:
            env['orsquare.business_day'].check_day_not_sealed(company, business_date)
        else:
            env = env(context=dict(env.context, orsquare_event_dt=False))

        lines, gross = self._prepare_lines(env, payload, company, supplier)
        cap_d, exp_d, cap_c, exp_c = self._adjustments(payload, company)
        wh = env['stock.warehouse'].orsquare_main_warehouse(company)
        boot = env['orsquare.shop.bootstrap']

        # 1. order + receipt into the Godown (native; AVCO layer at the PO price)
        order = env['purchase.order'].create({
            'partner_id': supplier.id, 'partner_ref': payload.get('supplier_invoice_no') or False,
            'date_order': event_dt, 'company_id': company.id, 'picking_type_id': wh.in_type_id.id,
            'orsquare_client_ref': ref, 'orsquare_advanced': bool(payload.get('advanced')),
            'orsquare_tp_no': payload.get('tp_no') or False, 'orsquare_tp_date': payload.get('tp_date') or False,
            'order_line': [(0, 0, lv) for lv in lines],
        })
        order.button_confirm()
        receipts = order.picking_ids
        for picking in receipts:
            for move in picking.move_ids:
                move.quantity = move.product_uom_qty
                move.picked = True
            picking._action_done()
        if any(p.state != 'done' for p in receipts):
            raise UserError(_("The goods receipt could not be completed."))

        # 2. native vendor bill, then the commercial layers on top of it
        order.action_create_invoice()
        bill = order.invoice_ids.filtered(lambda m: m.state == 'draft')[:1]
        bill_date = fields.Date.to_date(payload.get('bill_date')) or fields.Date.context_today(self)
        bill.write({
            'invoice_date': bill_date, 'ref': payload.get('supplier_invoice_no') or False,
            'invoice_date_due': payload.get('due_date') or False,
            'orsquare_tp_no': payload.get('tp_no') or False, 'orsquare_tp_date': payload.get('tp_date') or False,
            'orsquare_stated_total': float(payload.get('stated_total') or 0.0),
        })
        extra = []
        for key, items, sign in (('discount_cap', cap_d, -1), ('discount_exp', exp_d, -1),
                                 ('charge_cap', cap_c, 1), ('charge_exp', exp_c, 1)):
            product = boot.service_product(key, company)
            for item in items:
                extra.append((0, 0, {
                    'product_id': product.id, 'name': item['name'], 'quantity': 1.0,
                    'price_unit': sign * item['amount'], 'tax_ids': [(6, 0, [])],
                    'is_landed_costs_line': product.landed_cost_ok,
                }))
        bill.write({'invoice_line_ids': extra})
        # TCS: asset line on the net taxable value (goods - discounts + charges), override allowed
        tcs = payload.get('tcs') or {}
        base = gross - sum(a['amount'] for a in cap_d + exp_d) + sum(a['amount'] for a in cap_c + exp_c)
        rate = self._tcs_rate(payload, company, lines)
        tcs_calc = float_round(base * rate / 100.0, precision_rounding=currency.rounding)
        tcs_amount = float(tcs['amount']) if tcs.get('amount') is not None else tcs_calc
        if tcs_amount:
            bill.write({'orsquare_tcs_calculated': tcs_calc, 'invoice_line_ids': [(0, 0, {
                'product_id': boot.service_product('tcs', company).id,
                'name': _("TCS A/c. %(r)s%% (Sec. 206C)", r=rate), 'quantity': 1.0,
                'price_unit': tcs_amount, 'tax_ids': [(6, 0, [])]})]})
        # 3. match the supplier's printed total (bounded penny round-off)
        stated = float(payload.get('stated_total') or 0.0)
        if stated:
            diff = float_round(stated - bill.amount_total, precision_rounding=currency.rounding)
            tolerance = company.orsquare_penny_tolerance
            if float_compare(abs(diff), tolerance, precision_rounding=currency.rounding) > 0:
                raise UserError(_(
                    "Our total %(ours)s differs from the supplier's printed total %(stated)s by %(diff)s, "
                    "more than the %(tol)s round-off tolerance. Check the lines.",
                    ours=bill.amount_total, stated=stated, diff=diff, tol=tolerance))
            if not float_is_zero(diff, precision_rounding=currency.rounding):
                account = boot.chart_account('213201' if diff > 0 else '213202')
                bill.write({'invoice_line_ids': [(0, 0, {
                    'name': _("Round-off to supplier's printed total"), 'quantity': 1.0,
                    'price_unit': diff, 'account_id': account.id, 'tax_ids': [(6, 0, [])]})]})
        try:
            bill.action_post()
        except RedirectWarning as warning:
            raise UserError(_("%s\nOpen Settings > Business details to complete it.", warning.args[0]))

        # 4. capitalised charges / discounts -> Odoo's native landed cost allocation
        landed = env['stock.landed.cost']
        if bill.line_ids.filtered('is_landed_costs_line'):
            action = bill.button_create_landed_costs()
            landed = env['stock.landed.cost'].browse(action['res_id'])
            landed.write({'picking_ids': [(6, 0, receipts.ids)]})
            landed.compute_landed_cost()
            landed.button_validate()

        # 5. optional payment made at the time of the bill
        for pay in payload.get('payments') or []:
            self._pay_bill(env, bill, pay, event_dt)

        env['orsquare.event'].publish(company, 'purchase_recorded', {
            'order_id': order.id, 'bill_id': bill.id, 'supplier': supplier.name,
            'business_date': str(business_date)}, money={'total': bill.amount_total})
        return self._result(order, bill=bill, landed=landed)

    @api.model
    def _pay_bill(self, env, bill, pay, event_dt):
        amount = float(pay['amount'])
        if amount <= 0:
            return
        method = pay.get('method', 'cash')
        if method == 'cash':
            journal = env['account.journal'].search([('company_id', '=', bill.company_id.id), ('type', '=', 'cash')], limit=1)
        elif method == 'upi':
            journal = env['orsquare.shop.bootstrap'].journal('upi', bill.company_id)
        else:
            journal = env['account.journal'].search([('company_id', '=', bill.company_id.id), ('type', '=', 'bank'),
                                                     ('code', '!=', 'UPI')], limit=1)
        wizard = env['account.payment.register'].with_context(
            active_model='account.move', active_ids=bill.ids).create({
                'amount': amount, 'journal_id': journal.id, 'payment_date': fields.Date.context_today(self)})
        wizard._create_payments()

    @api.model
    def _result(self, order, bill=None, landed=None, duplicate=False):
        bill = bill or order.invoice_ids[:1]
        return {
            'order_id': order.id, 'name': order.name, 'bill_id': bill.id or False, 'bill_name': bill.name or False,
            'bill_total': bill.amount_total if bill else 0.0, 'payment_state': bill.payment_state if bill else False,
            'receipt': order.picking_ids.mapped('name'),
            'landed_cost': landed.name if landed else False, 'duplicate': duplicate,
            'business_date': str(order.orsquare_business_date),
        }

    # ------------------------------------------------------------------ bill finder (read-only)
    @api.model
    def list_bills(self, search=None, date_from=None, date_to=None, supplier_id=None, limit=50, offset=0):
        """Posted vendor bills and credit notes, newest first (Bill Finder + purchase register)."""
        self._check_access()
        env, company = self.sudo().env, self.env.company
        domain = [('company_id', '=', company.id), ('move_type', 'in', ('in_invoice', 'in_refund')),
                  ('state', '=', 'posted')]
        if date_from:
            domain.append(('orsquare_business_date', '>=', date_from))
        if date_to:
            domain.append(('orsquare_business_date', '<=', date_to))
        if supplier_id:
            domain.append(('partner_id', '=', int(supplier_id)))
        if search:
            domain += ['|', '|', ('name', 'ilike', search), ('ref', 'ilike', search), ('partner_id.name', 'ilike', search)]
        moves = env['account.move'].search(domain, order='orsquare_business_date desc, id desc',
                                           limit=min(int(limit), 200), offset=int(offset))
        return [{
            'id': m.id, 'number': m.name, 'supplier_id': m.partner_id.id, 'supplier': m.partner_id.name,
            'supplier_invoice_no': m.ref or '', 'date': str(m.orsquare_business_date), 'type': m.move_type,
            'untaxed': m.amount_untaxed, 'tax': m.amount_tax, 'total': m.amount_total,
            'payment_state': m.payment_state, 'amount_due': m.amount_residual,
            'amount_paid': m.amount_total - m.amount_residual,
            'qty': sum(m.invoice_line_ids.filtered(lambda l: l.product_id).mapped('quantity')),
            'line_count': len(m.invoice_line_ids.filtered(lambda l: l.product_id)),
        } for m in moves]

    @api.model
    def summary(self, date_from=None, date_to=None):
        """Uncapped purchase cards from posted vendor documents."""
        self._check_access()
        domain = [('company_id', '=', self.env.company.id), ('state', '=', 'posted'),
                  ('move_type', 'in', ('in_invoice', 'in_refund'))]
        if date_from:
            domain.append(('orsquare_business_date', '>=', date_from))
        if date_to:
            domain.append(('orsquare_business_date', '<=', date_to))
        docs = self.sudo().env['account.move'].search(domain)
        bills = docs.filtered(lambda m: m.move_type == 'in_invoice')
        total = sum(bills.mapped('amount_total'))
        outstanding = sum(bills.mapped('amount_residual'))
        returned = sum(docs.filtered(lambda m: m.move_type == 'in_refund').mapped('amount_total'))
        return {'total': total, 'paid': total - outstanding, 'outstanding': outstanding,
                'bills': len(bills), 'qty': sum(bills.invoice_line_ids.filtered(lambda l: l.product_id).mapped('quantity')),
                'returnsTotal': returned, 'netIntake': total - returned}

    @api.model
    def bill_detail(self, bill_id):
        """One bill with its stock lines and how much of each can still be returned."""
        self._check_access()
        env = self.sudo().env
        bill = env['account.move'].browse(int(bill_id)).exists()
        if not bill or bill.company_id != self.env.company or bill.move_type not in ('in_invoice', 'in_refund'):
            raise UserError(_("Bill not found."))
        lines = []
        for l in bill.invoice_line_ids.filtered(lambda x: x.product_id):
            lines.append({'id': l.id, 'product_id': l.product_id.id, 'name': l.product_id.display_name, 'qty': l.quantity,
                          'uom': l.product_uom_id.name, 'rate': l.price_unit, 'discount': l.discount,
                          'total': l.price_total})
        return {'id': bill.id, 'number': bill.name, 'supplier': bill.partner_id.name, 'supplier_id': bill.partner_id.id, 'type': bill.move_type,
                'date': str(bill.orsquare_business_date), 'supplier_invoice_no': bill.ref or '',
                'total': bill.amount_total, 'amount_due': bill.amount_residual, 'amount_paid': bill.amount_total - bill.amount_residual,
                'qty': sum(l['qty'] for l in lines), 'payment_state': bill.payment_state,
                'tp_no': getattr(bill, 'orsquare_tp_no', '') or '', 'lines': lines}

    # ------------------------------------------------------------------ returns & exchanges
    @api.model
    def return_to_supplier(self, payload):
        """Vendor Credit Note + Godown->Vendor return picking; optional paired replacement bill.

        ``payload``: ``{bill_id, lines:[{product_id, qty}], reason, exchange: <record_bill payload>}``.
        With ``exchange`` the replacement goods get their own bill (own rates, own taxes) and the credit
        note is reconciled against it on the supplier ledger: equal values net to zero, unequal values
        leave exactly the difference payable.
        """
        self._check_access()
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_manage_returns')):
            raise AccessError(_("You are not allowed to process returns."))
        env = self.sudo().env
        company = self.env.company
        bill = env['account.move'].browse(int(payload['bill_id'])).exists()
        if not bill or bill.move_type != 'in_invoice' or bill.state != 'posted':
            raise UserError(_("Only a posted vendor bill can be returned."))
        wanted = {int(l['product_id']): float(l['qty']) for l in payload.get('lines') or []}
        if not wanted:
            raise UserError(_("Choose what is being returned."))
        order = bill.line_ids.purchase_line_id.order_id[:1]
        receipt = order.picking_ids.filtered(lambda p: p.state == 'done' and p.picking_type_code == 'incoming')[:1]
        if not receipt:
            raise UserError(_("The goods receipt of this bill was not found."))

        # 1. stock back out of the Godown
        wizard = env['stock.return.picking'].with_context(active_id=receipt.id, active_model='stock.picking').create({})
        for line in wizard.product_return_moves:
            qty = wanted.pop(line.product_id.id, 0.0)
            line.quantity = qty
        if wanted:
            raise UserError(_("Some returned products were not on the bill."))
        ret = wizard._create_return()
        for move in ret.move_ids:
            move.quantity = move.product_uom_qty
            move.picked = True
        ret._action_done()

        # 2. credit note for exactly the returned goods (+ proportional TCS)
        today = fields.Date.context_today(self)
        credit = bill._reverse_moves([{'ref': _("Return of %s", bill.name), 'date': today, 'invoice_date': today}])
        returned = {l.product_id.id: l.quantity for l in wizard.product_return_moves if l.quantity}
        goods_original = sum(l.price_subtotal for l in bill.invoice_line_ids if l.product_id.id in returned)
        for line in credit.invoice_line_ids:
            if line.product_id.id in returned:
                line.quantity = returned[line.product_id.id]
            elif line.product_id == env['orsquare.shop.bootstrap'].service_product('tcs', company):
                continue
            else:
                line.unlink()
        returned_value = sum(l.price_subtotal for l in credit.invoice_line_ids if l.product_id.id in returned)
        tcs_line = credit.invoice_line_ids.filtered(
            lambda l: l.product_id == env['orsquare.shop.bootstrap'].service_product('tcs', company))
        if tcs_line:
            all_goods = sum(l.price_subtotal for l in bill.invoice_line_ids if l.product_id.is_storable)
            share = returned_value / all_goods if all_goods else 0.0
            tcs_line.price_unit = float_round(abs(sum(
                l.price_subtotal for l in bill.invoice_line_ids if l.product_id == tcs_line.product_id)) * share,
                precision_rounding=company.currency_id.rounding)
        credit.action_post()
        result = {'credit_note_id': credit.id, 'credit_note': credit.name,
                  'return_picking': ret.name, 'credit_total': credit.amount_total}

        # 3. direct replacement exchange: separate bill with its own rates/taxes, ledger netting
        if payload.get('exchange'):
            replacement = self.record_bill(dict(payload['exchange'], client_ref=payload['exchange'].get(
                'client_ref') or 'EXCH-%s' % credit.id))
            new_bill = env['account.move'].browse(replacement['bill_id'])
            lines = (credit | new_bill).line_ids.filtered(
                lambda l: l.account_id.account_type == 'liability_payable' and not l.reconciled)
            lines.reconcile()
            result.update({'replacement_bill_id': new_bill.id, 'replacement_bill': new_bill.name,
                           'net_payable_change': new_bill.amount_total - credit.amount_total})
        env['orsquare.event'].publish(company, 'purchase_returned', {'bill_id': bill.id, 'credit_note_id': credit.id})
        return result
