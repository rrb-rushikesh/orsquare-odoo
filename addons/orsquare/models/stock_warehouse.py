# -*- coding: utf-8 -*-
from odoo import api, fields, models, _


class StockWarehouse(models.Model):
    """Physical retail topology: ``WH/Stock/Godown``, ``WH/Stock/Counter``, ``WH/Stock/Opened``.

    These are ordinary internal ``stock.location`` records under the warehouse stock location.
    Odoo's quants, moves and valuation layers stay the only inventory authority.
    """
    _inherit = 'stock.warehouse'

    orsquare_godown_id = fields.Many2one('stock.location', string="Godown", copy=False, ondelete='restrict')
    orsquare_counter_id = fields.Many2one('stock.location', string="Counter", copy=False, ondelete='restrict')
    orsquare_opened_id = fields.Many2one('stock.location', string="Opened (OP Stock)", copy=False, ondelete='restrict')
    orsquare_peg_type_id = fields.Many2one('stock.picking.type', string="Peg Sale Operation", copy=False)
    orsquare_open_type_id = fields.Many2one('stock.picking.type', string="Open Bottle Operation", copy=False)

    # ------------------------------------------------------------------ topology
    def _orsquare_ensure_location(self, field, name):
        self.ensure_one()
        loc = self[field]
        if loc:
            if not loc.active:
                loc.active = True
            return loc
        Location = self.env['stock.location'].with_context(active_test=False)
        loc = Location.search([('location_id', '=', self.lot_stock_id.id), ('name', '=', name),
                               ('company_id', '=', self.company_id.id)], limit=1)
        if not loc:
            loc = Location.create({
                'name': name, 'usage': 'internal', 'location_id': self.lot_stock_id.id,
                'company_id': self.company_id.id,
            })
        loc.active = True
        self[field] = loc
        return loc

    def _orsquare_ensure_topology(self):
        """Idempotently build Godown / Counter / Opened and point the operation types at them."""
        PickingType = self.env['stock.picking.type']
        for wh in self:
            godown = wh._orsquare_ensure_location('orsquare_godown_id', 'Godown')
            counter = wh._orsquare_ensure_location('orsquare_counter_id', 'Counter')
            opened = wh._orsquare_ensure_location('orsquare_opened_id', 'Opened')
            customers = self.env.ref('stock.stock_location_customers')

            # Purchases land in the Godown, never directly on the sale-ready shelf.
            if wh.in_type_id:
                wh.in_type_id.default_location_dest_id = godown
            # The billing counter only ever consumes Counter stock.
            for ptype in (wh.pos_type_id, wh.out_type_id):
                if ptype:
                    ptype.default_location_src_id = counter
            # Internal transfers default to the one real movement: Godown -> Counter.
            if wh.int_type_id:
                wh.int_type_id.write({'default_location_src_id': godown.id,
                                      'default_location_dest_id': counter.id})
            if not wh.orsquare_peg_type_id:
                wh.orsquare_peg_type_id = PickingType.create({
                    'name': 'Peg Sales', 'code': 'outgoing', 'sequence_code': 'PEG',
                    'warehouse_id': wh.id, 'company_id': wh.company_id.id,
                    'default_location_src_id': opened.id, 'default_location_dest_id': customers.id,
                })
            else:
                wh.orsquare_peg_type_id.default_location_src_id = opened
            if not wh.orsquare_open_type_id:
                wh.orsquare_open_type_id = PickingType.create({
                    'name': 'Open Bottle', 'code': 'internal', 'sequence_code': 'OPEN',
                    'warehouse_id': wh.id, 'company_id': wh.company_id.id,
                    'default_location_src_id': counter.id, 'default_location_dest_id': opened.id,
                })
            else:
                wh.orsquare_open_type_id.write({'default_location_src_id': counter.id,
                                                'default_location_dest_id': opened.id})

    @api.model_create_multi
    def create(self, vals_list):
        warehouses = super().create(vals_list)
        warehouses._orsquare_ensure_topology()
        return warehouses

    def _get_picking_type_update_values(self):
        """Keep ORSquare's source/destination choices when Odoo re-syncs the operation types."""
        res = super()._get_picking_type_update_values()
        for wh in self:
            if wh.orsquare_counter_id:
                for key in ('pos_type_id', 'out_type_id'):
                    if key in res:
                        res[key] = dict(res[key], default_location_src_id=wh.orsquare_counter_id.id)
            if wh.orsquare_godown_id and 'in_type_id' in res:
                res['in_type_id'] = dict(res['in_type_id'], default_location_dest_id=wh.orsquare_godown_id.id)
        return res

    @api.model
    def orsquare_main_warehouse(self, company=None):
        company = company or self.env.company
        return self.search([('company_id', '=', company.id)], order='id', limit=1)
