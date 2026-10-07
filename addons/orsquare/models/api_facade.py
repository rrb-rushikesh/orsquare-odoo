# -*- coding: utf-8 -*-
"""ID-based wrappers for the operations that need record arguments, so every public API method takes
and returns plain JSON data.  Permission checks live here or in the underlying service."""
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError


class OrsquareApiFacade(models.AbstractModel):
    _name = 'orsquare.api.facade'
    _description = "ORSquare API Facade"

    # ------------------------------------------------------------------ permissions
    @api.model
    def _need(self, group):
        if not (self.env.su or self.env.user.has_group(group)):
            raise AccessError(_("You are not allowed to do that."))

    # ------------------------------------------------------------------ daybook
    @api.model
    def day_open(self, opening_float=0.0, note=None):
        self._need('orsquare.group_orsquare_cashier')
        day = self.env['orsquare.business_day'].open_day(float(opening_float or 0.0), note)
        return day.summary()

    @api.model
    def day_current(self):
        self._need('orsquare.group_orsquare_cashier')
        company = self.env.company
        day = self.env['orsquare.business_day'].sudo().search([
            ('company_id', '=', company.id), ('date', '=', company.orsquare_effective_business_date())], limit=1)
        if not day:
            return {'state': 'not_opened', 'date': str(company.orsquare_effective_business_date())}
        data = day.summary()
        if not self.env.su and not self.env.user.has_group('orsquare.group_orsquare_can_see_money'):
            data = {k: data[k] for k in ('id', 'date', 'state')}
        return data

    @api.model
    def day_seal(self, counted_cash, note=None):
        self._need('orsquare.group_orsquare_cashier')
        day = self.env['orsquare.business_day'].sudo().get_open_day()
        if not day:
            raise UserError(_("There is no open business day."))
        day.action_seal(float(counted_cash), note)
        return day.summary()

    @api.model
    def day_reaudit(self, date, reason):
        self._need('orsquare.group_orsquare_owner')
        day = self.env['orsquare.business_day'].sudo().search([
            ('company_id', '=', self.env.company.id), ('date', '=', fields.Date.to_date(date))], limit=1)
        if not day:
            raise UserError(_("No business day on %s.", date))
        return day.with_user(self.env.user).action_reaudit(reason)

    # ------------------------------------------------------------------ stock / bottles
    @api.model
    def transfer(self, direction, quantities, origin=None):
        self._need('orsquare.group_orsquare_cashier')
        wh = self.env['stock.warehouse'].sudo().orsquare_main_warehouse(self.env.company)
        picking = self.env['orsquare.stock.service'].sudo().manual_transfer(
            wh, direction, {int(k): float(v) for k, v in quantities.items()}, origin=origin)
        self.env['orsquare.event'].publish(self.env.company, 'stock_changed', {'products': [int(k) for k in quantities]})
        return {'picking': picking.name}

    @api.model
    def open_bottle(self, product_id, note=None):
        self._need('orsquare.group_orsquare_cashier')
        product = self.env['product.product'].sudo().browse(int(product_id))
        bottle = self.env['orsquare.opened_bottle'].open_bottle(product, note=note)
        return {'bottle_id': bottle.id, 'label': bottle.name, 'remaining_ml': bottle.remaining_ml}

    @api.model
    def finish_bottle(self, bottle_id, reason=None):
        self._need('orsquare.group_orsquare_cashier')
        bottle = self.env['orsquare.opened_bottle'].sudo().browse(int(bottle_id)).exists()
        if not bottle:
            raise UserError(_("Unknown bottle."))
        bottle.action_finish(reason=reason)
        return {'bottle_id': bottle.id, 'state': bottle.state}

    @api.model
    def discrepancies(self, state='open'):
        self._need('orsquare.group_orsquare_cashier')
        rows = self.env['orsquare.stock_discrepancy'].sudo().search([('state', '=', state)])
        return [{'id': d.id, 'product': d.product_id.display_name, 'location': d.location_id.display_name,
                 'qty_short': d.qty_short, 'order': d.pos_order_id.name, 'date': str(d.business_date),
                 'note': d.note or ''} for d in rows]

    # ------------------------------------------------------------------ bill finder (tier-2 server archive)
    @api.model
    def bill_lookup(self, search=None, limit=30, date_from=None, date_to=None):
        """Search counter bills, invoices and returns by number, customer or amount."""
        self._need('orsquare.group_orsquare_cashier')
        env = self.env['pos.order'].sudo()
        domain = [('company_id', '=', self.env.company.id), ('state', 'in', ('paid', 'done', 'invoiced'))]
        if date_from:
            domain.append(('orsquare_business_date', '>=', date_from))
        if date_to:
            domain.append(('orsquare_business_date', '<=', date_to))
        if search:
            term = search.strip()
            clause = ['|', '|', '|', ('name', 'ilike', term), ('pos_reference', 'ilike', term),
                      ('partner_id.name', 'ilike', term), ('account_move.name', 'ilike', term)]
            try:
                amount = float(term)
                clause = ['|'] + clause + [('amount_total', '=', amount)]
            except ValueError:
                pass
            domain += clause
        return [{
            'order_id': o.id, 'name': o.name, 'date': o.date_order.isoformat(), 'business_date': str(o.orsquare_business_date),
            'customer': o.partner_id.name or '', 'total': o.amount_total,
            'invoice': o.account_move.name or '', 'is_refund': o.amount_total < 0,
            'tax': o.amount_tax, 'partner_id': o.partner_id.id or False,
            'method': 'Split' if len(o.payment_ids.payment_method_id) > 1 else
                ('UPI' if o.payment_ids[:1].payment_method_id.orsquare_key == 'upi' else
                 'Khata' if o.payment_ids[:1].payment_method_id.orsquare_key == 'khata' else 'Cash'),
        } for o in env.search(domain, order='date_order desc, id desc', limit=int(limit))]

    @api.model
    def bill_detail(self, order_id):
        """Everything a return/reprint needs: lines with what can still be returned."""
        self._need('orsquare.group_orsquare_cashier')
        order = self.env['pos.order'].sudo().browse(int(order_id)).exists()
        if not order or order.company_id != self.env.company:
            raise UserError(_("Unknown bill."))
        return {
            'order_id': order.id, 'name': order.name, 'date': order.date_order.isoformat(),
            'business_date': str(order.orsquare_business_date),
            'customer': order.partner_id.name or '', 'partner_id': order.partner_id.id or False,
            'total': order.amount_total, 'tax': order.amount_tax,
            'invoice_id': order.account_move.id or False, 'invoice': order.account_move.name or '',
            'payments': [{'method': p.payment_method_id.orsquare_key or p.payment_method_id.name, 'amount': p.amount}
                         for p in order.payment_ids],
            'lines': [{'line_id': l.id, 'product_id': l.product_id.id, 'name': l.full_product_name, 'qty': l.qty,
                       'price_unit': l.price_unit, 'discount': l.discount, 'total': l.price_subtotal_incl,
                       'refundable_qty': l.qty - l.refunded_qty, 'is_peg': bool(l.orsquare_peg_ml)}
                      for l in order.lines],
        }
