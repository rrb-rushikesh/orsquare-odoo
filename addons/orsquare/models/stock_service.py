# -*- coding: utf-8 -*-
import logging

from odoo import api, models, _
from odoo.exceptions import UserError
from odoo.tools import float_compare, float_is_zero

_logger = logging.getLogger(__name__)


class OrsquareStockService(models.AbstractModel):
    """Thin orchestration over native Odoo stock.

    Nothing here keeps a quantity of its own: every number is read from ``stock.quant`` and every
    change is a real ``stock.picking`` / ``stock.move`` validated by Odoo itself.
    """
    _name = 'orsquare.stock.service'
    _description = "ORSquare Stock Service"

    # ------------------------------------------------------------------ locking
    @api.model
    def lock_quants(self, product_ids, location_ids):
        """Serialise concurrent sellers on the quant rows of these products/locations.

        Competing transactions queue on the row lock (instead of failing) and, once they get it,
        re-read the quantities, so the second seller of the last unit sees the stock the first one
        left behind.  Ordering by id keeps lock acquisition deadlock-free.
        """
        if not product_ids or not location_ids:
            return
        self.env['stock.quant'].flush_model()
        self.env.cr.execute(
            "SELECT id FROM stock_quant WHERE product_id IN %s AND location_id IN %s "
            "ORDER BY id FOR UPDATE",
            [tuple(sorted(set(product_ids))), tuple(sorted(set(location_ids)))])
        # Quants may have been changed by the transaction we waited for.
        self.env['stock.quant'].invalidate_model()

    @api.model
    def location_qty(self, product, location):
        """Physical quantity of ``product`` in exactly ``location`` (no children), from quants."""
        quants = self.env['stock.quant'].search([
            ('product_id', '=', product.id), ('location_id', '=', location.id)])
        return sum(quants.mapped('quantity'))

    # ------------------------------------------------------------------ transfers
    @api.model
    def _storable(self, qty_by_product):
        Product = self.env['product.product']
        res = {}
        for pid, qty in qty_by_product.items():
            product = Product.browse(pid)
            if product.is_storable and not float_is_zero(qty, precision_rounding=product.uom_id.rounding):
                res[pid] = qty
        return res

    @api.model
    def transfer(self, picking_type, src, dest, qty_by_product, origin=None, allow_negative=False):
        """Create and validate an internal transfer ``src -> dest``.

        ``qty_by_product``: ``{product_id: qty_in_product_uom}``.  Fails with a clear message, and
        leaves nothing behind, when ``src`` cannot cover the quantities (unless ``allow_negative``).
        """
        qty_by_product = self._storable(qty_by_product)
        if not qty_by_product:
            return self.env['stock.picking']
        self.lock_quants(list(qty_by_product), [src.id, dest.id])
        Product = self.env['product.product']
        if not allow_negative:
            for pid, qty in qty_by_product.items():
                product = Product.browse(pid)
                have = self.location_qty(product, src)
                if float_compare(have, qty, precision_rounding=product.uom_id.rounding) < 0:
                    raise UserError(_(
                        "Insufficient stock in %(loc)s for %(product)s: need %(need)s, have %(have)s.",
                        loc=src.display_name, product=product.display_name,
                        need=qty, have=have))
        picking = self.env['stock.picking'].create({
            'picking_type_id': picking_type.id,
            'location_id': src.id,
            'location_dest_id': dest.id,
            'origin': origin or False,
            'move_ids': [(0, 0, {
                'name': Product.browse(pid).display_name,
                'product_id': pid,
                'product_uom': Product.browse(pid).uom_id.id,
                'product_uom_qty': qty,
                'location_id': src.id,
                'location_dest_id': dest.id,
            }) for pid, qty in qty_by_product.items()],
        })
        picking.action_confirm()
        picking.action_assign()
        for move in picking.move_ids:
            # Quantity is set explicitly from what we validated above (also covers allow_negative).
            move.quantity = move.product_uom_qty
            move.picked = True
        picking._action_done()
        return picking

    @api.model
    def manual_transfer(self, warehouse, direction, qty_by_product, origin=None):
        """Stock Transfer Drawer: ``godown_to_counter`` or ``counter_to_godown``."""
        if direction == 'godown_to_counter':
            src, dest = warehouse.orsquare_godown_id, warehouse.orsquare_counter_id
        elif direction == 'counter_to_godown':
            src, dest = warehouse.orsquare_counter_id, warehouse.orsquare_godown_id
        else:
            raise UserError(_("Unknown transfer direction '%s'.", direction))
        return self.transfer(warehouse.int_type_id, src, dest, qty_by_product,
                             origin=origin or _("Manual stock transfer"))

    # ------------------------------------------------------------------ sale-time stock check
    @api.model
    def ensure_counter_stock(self, warehouse, qty_by_product, origin, allow_oversell=False):
        """Make sure the Counter can cover a sale; pull the shortfall from the Godown if allowed.

        Runs inside the caller's transaction: if anything later in the checkout fails, the
        auto-transfer is rolled back with it.  Returns ``(picking, shortages)`` where ``shortages``
        is ``{product_id: qty}`` that nobody could cover (only non-empty with ``allow_oversell``,
        i.e. an already-completed offline sale that must be accepted and flagged).
        """
        company = warehouse.company_id
        counter, godown = warehouse.orsquare_counter_id, warehouse.orsquare_godown_id
        qty_by_product = self._storable(qty_by_product)
        if not qty_by_product:
            return self.env['stock.picking'], {}
        self.lock_quants(list(qty_by_product), [counter.id, godown.id])
        Product = self.env['product.product']
        pull, shortages = {}, {}
        for pid, need in qty_by_product.items():
            if need <= 0:
                continue
            product = Product.browse(pid)
            rounding = product.uom_id.rounding
            on_counter = self.location_qty(product, counter)
            missing = need - max(on_counter, 0.0)
            if float_compare(missing, 0.0, precision_rounding=rounding) <= 0:
                continue
            if company.orsquare_auto_godown_transfer:
                in_godown = max(self.location_qty(product, godown), 0.0)
                take = min(missing, in_godown)
                if float_compare(take, 0.0, precision_rounding=rounding) > 0:
                    pull[pid] = take
                missing -= take
                if float_compare(missing, 0.0, precision_rounding=rounding) > 0:
                    if not allow_oversell:
                        raise UserError(_(
                            "Insufficient Stock in Godown for %(product)s: short by %(short)s "
                            "after moving what the Godown has.",
                            product=product.display_name, short=missing))
                    shortages[pid] = missing
            else:
                if not allow_oversell:
                    raise UserError(_(
                        "Insufficient Counter stock for %(product)s: need %(need)s, have %(have)s.",
                        product=product.display_name, need=need, have=max(on_counter, 0.0)))
                shortages[pid] = missing
        picking = self.env['stock.picking']
        if pull:
            picking = self.transfer(
                warehouse.int_type_id, godown, counter, pull,
                origin=_("Auto-Godown Transfer for Sale %s", origin))
        return picking, shortages
