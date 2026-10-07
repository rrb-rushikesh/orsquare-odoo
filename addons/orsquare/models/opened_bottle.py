# -*- coding: utf-8 -*-
"""Open bottles (peg / portion sales).

Single Inventory Authority invariant
------------------------------------
``orsquare.opened_bottle`` is a UI/tracking record.  It stores NO volume.  Every opened bottle owns a
dedicated child location of ``WH/Stock/Opened`` and the remaining volume is *derived* from the
authoritative ``stock.quant`` in that location::

    remaining_ml = quant.quantity (bottles) * capacity_ml

A peg sale is an ordinary Odoo stock move of ``ml / capacity_ml`` bottles (6-decimal bottle UoM)
out of that location, so Odoo's AVCO valuation layers post exact COGS.  Finishing a bottle scraps
the exact remaining quant (``stock.scrap``) which zeroes both the quant and the asset value.

Precision qualification: 6-decimal bottle precision is the validated minimum for the tested
bottle/portion combinations (see tests/test_opened_bottles.py); new combinations must pass the same
conservation tests.
"""
import re

from odoo import api, fields, models, _
from odoo.exceptions import UserError
from odoo.tools import float_compare, float_is_zero, float_round

QTY_DIGITS = 6


class OrsquareOpenedBottle(models.Model):
    _name = 'orsquare.opened_bottle'
    _description = "Opened Bottle (UI state; stock lives in Odoo quants)"
    _order = 'opened_at, id'

    name = fields.Char(string="Label", readonly=True, copy=False)
    company_id = fields.Many2one('res.company', required=True, default=lambda s: s.env.company, index=True)
    product_id = fields.Many2one('product.product', required=True, readonly=True, index=True)
    warehouse_id = fields.Many2one('stock.warehouse', required=True, readonly=True)
    location_id = fields.Many2one('stock.location', string="Bottle Location", readonly=True,
                                  ondelete='restrict', copy=False)
    number = fields.Integer(readonly=True)
    capacity_ml = fields.Float(string="Capacity (ml)", digits=(12, 3), readonly=True,
                               help="Frozen at opening so later unit edits never change history.")
    state = fields.Selection(
        [('active', 'Active'), ('empty', 'Empty'), ('wasted', 'Written Off')],
        default='active', required=True, index=True, readonly=True)
    opened_at = fields.Datetime(default=fields.Datetime.now, readonly=True)
    opened_by = fields.Many2one('res.users', default=lambda s: s.env.uid, readonly=True)
    closed_at = fields.Datetime(readonly=True)
    business_date = fields.Date(index=True, readonly=True)
    opening_picking_id = fields.Many2one('stock.picking', readonly=True, copy=False)

    # derived from the authoritative quant, never stored
    remaining_qty = fields.Float(compute='_compute_remaining', digits=(16, QTY_DIGITS))
    remaining_ml = fields.Float(compute='_compute_remaining', digits=(12, 3))
    fill_percent = fields.Float(compute='_compute_remaining', digits=(5, 1))
    fill_level = fields.Selection(
        [('green', 'Healthy'), ('amber', 'Mid'), ('red', 'Low')], compute='_compute_remaining')

    @api.depends('location_id', 'product_id', 'capacity_ml', 'state')
    def _compute_remaining(self):
        Quant = self.env['stock.quant'].sudo()
        for bottle in self:
            qty = 0.0
            if bottle.location_id and bottle.state == 'active':
                quants = Quant.search([('product_id', '=', bottle.product_id.id),
                                       ('location_id', '=', bottle.location_id.id)])
                qty = sum(quants.mapped('quantity'))
            bottle.remaining_qty = qty
            bottle.remaining_ml = qty * bottle.capacity_ml
            pct = (qty * 100.0) if bottle.state == 'active' else 0.0
            bottle.fill_percent = pct
            bottle.fill_level = 'green' if pct > 50 else ('amber' if pct >= 25 else 'red')

    # ------------------------------------------------------------------ helpers
    @api.model
    def ml_to_qty(self, ml, capacity_ml):
        """Portion volume -> bottle fraction at the validated 6-decimal precision."""
        return float_round(ml / capacity_ml, precision_digits=QTY_DIGITS)

    def qty_for_ml(self, ml):
        self.ensure_one()
        return self.ml_to_qty(ml, self.capacity_ml)

    @api.model
    def _label_prefix(self, product):
        tmpl = product.product_tmpl_id
        if tmpl.orsquare_short_code:
            return tmpl.orsquare_short_code.upper()
        words = re.findall(r"[A-Za-z0-9]+", tmpl.name or 'BTL')
        initials = ''.join(w[0] for w in [w for w in words if not w[0].isdigit()][:3]).upper()
        return initials or 'BTL'

    # ------------------------------------------------------------------ open
    @api.model
    def open_bottle(self, product, warehouse=None, note=None):
        """Uncork one sealed bottle: Counter -> its own location under Opened (1.0 unit)."""
        self = self.sudo()
        product = product.sudo()
        if not product.orsquare_can_open:
            raise UserError(_("%s cannot be opened: it needs a stock-tracked bottle in a volume unit.",
                              product.display_name))
        company = self.env.company
        warehouse = warehouse or self.env['stock.warehouse'].orsquare_main_warehouse(company)
        stock = self.env['orsquare.stock.service']
        # One serialisation point per product for numbering + stock.
        stock.lock_quants([product.id], [warehouse.orsquare_counter_id.id, warehouse.orsquare_godown_id.id])
        stock.ensure_counter_stock(warehouse, {product.id: 1.0}, _("opening a bottle of %s", product.display_name))
        prefix = self._label_prefix(product)
        last = self.with_context(active_test=False).search(
            [('product_id', '=', product.id)], order='number desc', limit=1)
        number = (last.number or 0) + 1
        label = "%s #%02d" % (prefix, number)
        location = self.env['stock.location'].with_context(active_test=False).create({
            'name': label, 'usage': 'internal', 'location_id': warehouse.orsquare_opened_id.id,
            'company_id': company.id,
        })
        picking = stock.transfer(
            warehouse.orsquare_open_type_id, warehouse.orsquare_counter_id, location,
            {product.id: 1.0}, origin=_("Open bottle %s", label))
        bottle = self.create({
            'name': label, 'company_id': company.id, 'product_id': product.id,
            'warehouse_id': warehouse.id, 'location_id': location.id, 'number': number,
            'capacity_ml': product.orsquare_capacity_ml,
            'business_date': company.orsquare_current_business_date(),
            'opening_picking_id': picking.id,
        })
        self.env['orsquare.event'].publish(company, 'bottle_opened', {'bottle_id': bottle.id, 'label': label})
        return bottle

    # ------------------------------------------------------------------ dispense checks
    def check_can_dispense(self, ml):
        """Online sales never pour more than the quant holds."""
        self.ensure_one()
        if self.state != 'active':
            raise UserError(_("Bottle %s is %s.", self.name, dict(self._fields['state'].selection)[self.state]))
        qty = self.qty_for_ml(ml)
        if float_compare(qty, self.remaining_qty, precision_digits=QTY_DIGITS) > 0:
            raise UserError(_("Bottle %(b)s has only %(left).0f ml left; cannot pour %(ml).0f ml.",
                              b=self.name, left=self.remaining_ml, ml=ml))
        return qty

    # ------------------------------------------------------------------ finish
    def _close(self, state):
        for bottle in self:
            bottle.write({'state': state, 'closed_at': fields.Datetime.now()})
            bottle.location_id.sudo().active = False
            self.env['orsquare.event'].publish(bottle.company_id, 'bottle_closed',
                                               {'bottle_id': bottle.id, 'label': bottle.name, 'state': state})

    def refresh_if_drained(self):
        """Called after a peg sale: a bottle drained to exactly zero is simply 'empty'."""
        for bottle in self.sudo().filtered(lambda b: b.state == 'active'):
            bottle.invalidate_recordset(['remaining_qty'])
            if float_is_zero(bottle.remaining_qty, precision_digits=QTY_DIGITS):
                bottle._close('empty')

    def action_finish(self, reason=None):
        """Finish Bottle / Scrap Dregs: scrap the exact remaining quant to zero the stock and its value."""
        self = self.sudo()
        results = self.env['stock.scrap']
        for bottle in self:
            if bottle.state != 'active':
                raise UserError(_("Bottle %s is already closed.", bottle.name))
            quants = self.env['stock.quant'].search([
                ('product_id', '=', bottle.product_id.id), ('location_id', '=', bottle.location_id.id)])
            remaining = sum(quants.mapped('quantity'))
            if float_is_zero(remaining, precision_digits=QTY_DIGITS):
                bottle._close('empty')
                continue
            if remaining < 0:
                raise UserError(_("Bottle %s has negative stock (%s); resolve the discrepancy first.",
                                  bottle.name, remaining))
            scrap = self.env['stock.scrap'].create({
                'product_id': bottle.product_id.id,
                'product_uom_id': bottle.product_id.uom_id.id,
                'scrap_qty': remaining,                    # the exact stored quant, never a recomputed float
                'location_id': bottle.location_id.id,
                'scrap_location_id': self.env['orsquare.shop.bootstrap'].scrap_location(bottle.company_id).id,
                'origin': _("Finish bottle %s%s", bottle.name, (": %s" % reason) if reason else ''),
                'company_id': bottle.company_id.id,
            })
            scrap.action_validate()
            results |= scrap
            bottle._close('wasted')
        return results

    # ------------------------------------------------------------------ read API
    @api.model
    def tray(self, company=None):
        """Open Bottles Tray: active bottles, oldest first (rotation), with live ml."""
        company = company or self.env.company
        bottles = self.sudo().search([('company_id', '=', company.id), ('state', '=', 'active')],
                                     order='opened_at, id')
        return [{
            'id': b.id, 'label': b.name, 'product_id': b.product_id.id,
            'product': b.product_id.display_name, 'capacity_ml': b.capacity_ml,
            'remaining_ml': round(b.remaining_ml, 1), 'percent': round(b.fill_percent, 1),
            'level': b.fill_level, 'opened_at': b.opened_at and b.opened_at.isoformat(),
        } for b in bottles]
