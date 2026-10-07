# -*- coding: utf-8 -*-
"""Stock-tab services: opening stock, audited adjustments, positions, history, alerts.

All quantities are read from ``stock.quant`` / ``stock.move``; valuation figures are masked unless
the caller has ``can_see_valuation``.
"""
from collections import defaultdict

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from odoo.tools import float_compare, float_is_zero, float_round

from .security_utils import require_staff


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    orsquare_low_stock_qty = fields.Float(
        string="Low-stock Alert Level", help="Alert when Godown + Counter + opened volume falls to this level. 0 = off.")


class OrsquareStockReports(models.AbstractModel):
    _name = 'orsquare.stock.reports'
    _description = "ORSquare Stock Reports & Adjustments"

    @api.model
    def _require(self, group):
        if not (self.env.su or self.env.user.has_group(group)):
            raise AccessError(_("You are not allowed to do that."))

    @api.model
    def _can_see_valuation(self):
        return self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_valuation')

    # ------------------------------------------------------------------ opening stock (once)
    @api.model
    def set_opening_stock(self, lines, location='godown'):
        """Accept onboarding stock ONCE per product as a real inventory-adjustment move.

        A product that already has any stock history cannot be 'set' again: later changes must come
        from Purchases, Sales or an audited adjustment.
        """
        self._require('orsquare.group_orsquare_stockkeeper')
        env = self.sudo().env
        company = self.env.company
        wh = env['stock.warehouse'].orsquare_main_warehouse(company)
        loc = {'godown': wh.orsquare_godown_id, 'counter': wh.orsquare_counter_id}.get(location)
        if not loc:
            raise UserError(_("Opening stock goes to the Godown or the Counter."))
        done = []
        for raw in lines:
            product = env['product.product'].browse(int(raw['product_id'])).exists()
            qty = float(raw['qty'])
            if not product or not product.is_storable:
                raise UserError(_("Opening stock applies to stock-tracked products only."))
            if qty <= 0:
                raise UserError(_("Opening quantity must be positive."))
            has_history = env['stock.move'].search_count([('product_id', '=', product.id), ('state', '=', 'done')])
            if has_history:
                raise UserError(_(
                    "%s already has stock history. Opening stock can only be entered once; use Purchases or a "
                    "stock adjustment.", product.display_name))
            if raw.get('cost') is not None:
                product.standard_price = float(raw['cost'])
            quant = env['stock.quant'].with_context(inventory_mode=True, inventory_name=_("Opening stock")).create({
                'product_id': product.id, 'location_id': loc.id, 'inventory_quantity': qty})
            quant.action_apply_inventory()
            done.append(product.id)
        env['orsquare.event'].publish(company, 'stock_changed', {'products': done})
        return done

    # ------------------------------------------------------------------ audited adjustment
    @api.model
    def adjust_stock(self, product_id, location_key, counted_qty, reason):
        """Set a location to the physically counted quantity through a real, reasoned inventory move."""
        self._require('orsquare.group_orsquare_stockkeeper')
        if not (reason or '').strip():
            raise UserError(_("A reason is required for a stock adjustment."))
        env = self.sudo().env
        company = self.env.company
        wh = env['stock.warehouse'].orsquare_main_warehouse(company)
        loc = {'godown': wh.orsquare_godown_id, 'counter': wh.orsquare_counter_id}.get(location_key)
        if not loc:
            raise UserError(_("Adjustments apply to the Godown or the Counter."))
        product = env['product.product'].browse(int(product_id)).exists()
        env['orsquare.stock.service'].lock_quants([product.id], [loc.id])
        quant = env['stock.quant'].search([('product_id', '=', product.id), ('location_id', '=', loc.id)], limit=1)
        if not quant:
            quant = env['stock.quant'].with_context(inventory_mode=True).create({
                'product_id': product.id, 'location_id': loc.id, 'inventory_quantity': counted_qty})
        else:
            quant = quant.with_context(inventory_mode=True)
            quant.inventory_quantity = counted_qty
        quant.with_context(inventory_name=_("Adjustment: %s", reason)).action_apply_inventory()
        env['orsquare.event'].publish(company, 'stock_changed', {'products': [product.id]})
        return True

    @api.model
    def resolve_discrepancy(self, discrepancy_id, note=None, counted_qty=None):
        self._require('orsquare.group_orsquare_stockkeeper')
        disc = self.sudo().env['orsquare.stock_discrepancy'].browse(int(discrepancy_id)).exists()
        if not disc:
            raise UserError(_("Unknown discrepancy."))
        if counted_qty is not None and disc.location_id.location_id == disc.location_id.warehouse_id.orsquare_opened_id:
            raise UserError(_("Finish or write off the opened bottle instead."))
        wh = self.sudo().env['stock.warehouse'].orsquare_main_warehouse(self.env.company)
        if counted_qty is not None and disc.location_id == wh.orsquare_counter_id:
            self.adjust_stock(disc.product_id.id, 'counter', counted_qty, note or _("Offline oversell reconciliation"))
        disc.action_resolve(note)
        return True

    # ------------------------------------------------------------------ position / valuation
    @api.model
    def stock_position(self, product_ids=None):
        """Per product: Godown, Counter and opened (ml) quantities; value only with valuation rights."""
        require_staff(self.env)
        env = self.sudo().env
        company = self.env.company
        wh = env['stock.warehouse'].orsquare_main_warehouse(company)
        domain = [('company_id', '=', company.id), ('location_id', 'child_of', wh.lot_stock_id.id)]
        if product_ids:
            domain.append(('product_id', 'in', product_ids))
        # One grouped query instead of loading every quant record.
        by_prod = defaultdict(lambda: {'godown': 0.0, 'counter': 0.0, 'opened_bottles': 0.0, 'other': 0.0})
        opened = wh.orsquare_opened_id
        for product, location, qty in env['stock.quant'].with_context(active_test=False)._read_group(
                domain, ['product_id', 'location_id'], ['quantity:sum']):
            row = by_prod[product.id]
            if location == wh.orsquare_godown_id:
                row['godown'] += qty
            elif location == wh.orsquare_counter_id:
                row['counter'] += qty
            elif location.location_id == opened or location == opened:
                row['opened_bottles'] += qty
            else:
                row['other'] += qty
        see_value = self._can_see_valuation()
        out = []
        for product in env['product.product'].browse(list(by_prod)):
            row = by_prod[product.id]
            total = sum(row.values())
            item = {
                'product_id': product.id, 'name': product.display_name, 'uom': product.uom_id.name,
                'godown': round(row['godown'], 6), 'counter': round(row['counter'], 6),
                'opened_ml': round(row['opened_bottles'] * product.orsquare_capacity_ml, 3)
                if product.orsquare_capacity_ml else 0.0,
                'total': round(total, 6),
                'low': bool(product.orsquare_low_stock_qty and total <= product.orsquare_low_stock_qty),
            }
            if see_value:
                item['value'] = float_round(total * product.standard_price, precision_rounding=company.currency_id.rounding)
            out.append(item)
        return sorted(out, key=lambda r: r['name'])

    @api.model
    def stock_value_by_location(self):
        """Dashboard widget: valuation split Godown vs Counter vs Opened (None when masked)."""
        if not self._can_see_valuation():
            return None
        env = self.sudo().env
        company = self.env.company
        wh = env['stock.warehouse'].orsquare_main_warehouse(company)
        res = {'godown': 0.0, 'counter': 0.0, 'opened': 0.0}
        for q in env['stock.quant'].with_context(active_test=False).search([
                ('company_id', '=', company.id), ('location_id', 'child_of', wh.lot_stock_id.id)]):
            value = q.quantity * q.product_id.standard_price
            if q.location_id == wh.orsquare_godown_id:
                res['godown'] += value
            elif q.location_id == wh.orsquare_counter_id:
                res['counter'] += value
            elif q.location_id.location_id == wh.orsquare_opened_id:
                res['opened'] += value
        return {k: float_round(v, precision_rounding=company.currency_id.rounding) for k, v in res.items()}

    # ------------------------------------------------------------------ history
    @api.model
    def movement_history(self, product_id, limit=100):
        """Per-SKU ledger: intake, transfers, peg openings, POS deductions, scraps, adjustments."""
        require_staff(self.env)
        env = self.sudo().env
        wh = env['stock.warehouse'].orsquare_main_warehouse(self.env.company)
        moves = env['stock.move'].search([('product_id', '=', int(product_id)), ('state', '=', 'done')],
                                          order='date desc, id desc', limit=limit)
        out = []
        for m in moves:
            kind = self._classify_move(m, wh)
            out.append({
                'date': m.date.isoformat(), 'kind': kind, 'qty': m.quantity,
                'from': m.location_id.display_name, 'to': m.location_dest_id.display_name,
                'ref': m.picking_id.name or m.reference, 'origin': m.origin or m.picking_id.origin or '',
            })
        return out

    @api.model
    def _classify_move(self, move, wh):
        src, dst = move.location_id, move.location_dest_id
        opened = wh.orsquare_opened_id
        if src.usage == 'supplier':
            return 'intake'
        if dst.usage == 'supplier':
            return 'supplier_return'
        if dst.scrap_location:
            return 'scrap'
        if src.usage == 'inventory' or dst.usage == 'inventory':
            return 'adjustment'
        if dst.location_id == opened and src == wh.orsquare_counter_id:
            return 'peg_opening'
        if src.location_id == opened and dst.usage == 'customer':
            return 'peg_sale'
        if src.usage == 'internal' and dst.usage == 'internal':
            return 'transfer'
        if dst.usage == 'customer':
            return 'sale'
        if src.usage == 'customer':
            return 'customer_return'
        return 'other'

    # ------------------------------------------------------------------ opened bottle shelf (stock tab)
    @api.model
    def opened_shelf(self):
        require_staff(self.env)
        return self.env['orsquare.opened_bottle'].tray()

    @api.model
    def needs_attention_stock(self):
        return [r for r in self.stock_position() if r['low']]
