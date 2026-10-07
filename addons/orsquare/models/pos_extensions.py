# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import UserError


class PosPaymentMethod(models.Model):
    _inherit = 'pos.payment.method'

    orsquare_key = fields.Selection(
        [('cash', 'Cash'), ('upi', 'UPI'), ('khata', 'Khata (Customer Credit)'),
         ('concession', 'Settlement Concession')],
        string="ORSquare Tender", index=True)
    orsquare_is_concession = fields.Boolean(compute='_compute_is_concession', store=True)

    @api.depends('orsquare_key')
    def _compute_is_concession(self):
        for method in self:
            method.orsquare_is_concession = method.orsquare_key == 'concession'


class PosOrder(models.Model):
    _inherit = 'pos.order'

    orsquare_client_ref = fields.Char(
        string="Client Reference", index=True, copy=False, readonly=True,
        help="Idempotency key generated on the device. Replaying the same key never double-posts.")
    orsquare_offline = fields.Boolean(string="Rung offline", copy=False, readonly=True)
    orsquare_concession = fields.Monetary(
        string="Settlement Concession", copy=False, readonly=True, currency_field='currency_id',
        help="Post-tax short-payment written off to the Cash Settlement Difference ledger.")
    orsquare_flagged = fields.Boolean(string="Has Stock Discrepancy", copy=False, readonly=True)
    orsquare_promo_id = fields.Many2one('orsquare.promo', string="Promo Used", copy=False, readonly=True)

    _sql_constraints = [
        ('orsquare_client_ref_unique', 'unique(orsquare_client_ref, company_id)',
         "This client reference was already used (duplicate bill)."),
    ]


class PosOrderLine(models.Model):
    _inherit = 'pos.order.line'

    orsquare_opened_bottle_id = fields.Many2one(
        'orsquare.opened_bottle', string="Open Bottle", copy=False, readonly=True, ondelete='restrict',
        help="Set when this line is a portion (peg) poured from an opened bottle.")
    orsquare_peg_ml = fields.Float(string="Peg (ml)", copy=False, readonly=True, digits=(12, 3))


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    @api.model
    def _create_picking_from_pos_order_lines(self, location_dest_id, lines, picking_type, partner=False):
        """ORSquare delivery rules on top of native POS delivery.

        * Untracked products (kitchen dishes, plain consumables) never generate a delivery.
        * Pegs are poured from their own opened bottle's location, not from the Counter.
        * A refunded peg does not return liquid to a bottle (it is already consumed); revenue is
          reversed, COGS stays.
        """
        lines = lines.filtered(lambda l: l.product_id.is_storable)
        lines = lines.filtered(lambda l: not (l.qty < 0 and l.refunded_orderline_id.orsquare_peg_ml))
        peg_lines = lines.filtered(lambda l: l.orsquare_opened_bottle_id and l.qty > 0)
        normal_lines = lines - peg_lines
        pickings = super()._create_picking_from_pos_order_lines(
            location_dest_id, normal_lines, picking_type, partner)
        for bottle in peg_lines.mapped('orsquare_opened_bottle_id'):
            bottle_lines = peg_lines.filtered(lambda l: l.orsquare_opened_bottle_id == bottle)
            peg_type = bottle.warehouse_id.orsquare_peg_type_id
            picking = self.env['stock.picking'].create(
                self._prepare_picking_vals(partner, peg_type, bottle.location_id.id, location_dest_id))
            picking._create_move_from_pos_order_lines(bottle_lines)
            # Unlike the native wrapper, do not swallow failures: a peg must really leave the bottle.
            picking._action_done()
            pickings |= picking
        return pickings
