# -*- coding: utf-8 -*-
import itertools

from odoo.tests import TransactionCase

_REF = itertools.count(1)


class OrsquareCase(TransactionCase):
    open_day_on_setup = True
    """Shared fixtures: an open daybook, a stocked bottle product, tender helpers."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = cls.env
        cls.company = env.company
        cls.company.orsquare_auto_godown_transfer = False
        cls.wh = env['stock.warehouse'].orsquare_main_warehouse(cls.company)
        cls.stock = env['orsquare.stock.service']
        cls.sales = env['orsquare.sale.service']
        cls.Bottle = env['orsquare.opened_bottle']
        cls.Day = env['orsquare.business_day']
        cls.counter = cls.wh.orsquare_counter_id
        cls.godown = cls.wh.orsquare_godown_id
        cls.day = cls.Day.open_day(1000.0) if cls.open_day_on_setup else cls.Day

    # ------------------------------------------------------------------ fixtures
    @classmethod
    def make_product(cls, name, cost=100.0, price=150.0, uom_xmlid=None, storable=True, **extra):
        vals = {
            'name': name, 'type': 'consu', 'is_storable': storable,
            'standard_price': cost, 'list_price': price, 'available_in_pos': True,
            'taxes_id': [(6, 0, [])], 'supplier_taxes_id': [(6, 0, [])],
        }
        if uom_xmlid:
            uom = cls.env.ref(uom_xmlid)
            vals.update({'uom_id': uom.id, 'uom_po_id': uom.id})
        vals.update(extra)
        return cls.env['product.product'].create(vals)

    @classmethod
    def stock_in(cls, product, qty, location=None, cost=None):
        """Receive stock through a real inventory adjustment (creates a valuation layer)."""
        location = location or cls.counter
        if cost is not None:
            product.standard_price = cost
        quant = cls.env['stock.quant'].with_context(inventory_mode=True).create({
            'product_id': product.id, 'location_id': location.id, 'inventory_quantity': qty})
        quant.action_apply_inventory()
        return quant

    def qty_at(self, product, location):
        return self.stock.location_qty(product, location)

    def ref(self):
        return 'T-%s' % next(_REF)

    def sell(self, lines, payments=None, **extra):
        """Settle a bill; by default pays exactly in cash."""
        payload = {'client_ref': self.ref(), 'lines': lines}
        payload.update(extra)
        if payments is None:
            payload['payments'] = [{'method': 'cash', 'amount': self._expected_total(lines, extra)}]
        else:
            payload['payments'] = payments
        return self.sales.settle(payload)

    def _expected_total(self, lines, extra):
        total = 0.0
        for line in lines:
            if line.get('peg'):
                total += float(line['price'])
            else:
                product = self.env['product.product'].browse(line['product_id'])
                price = line.get('price', product.lst_price)
                total += line['qty'] * price * (1 - line.get('discount', 0.0) / 100.0)
        return round(total, 2)

    def svl_value(self, product):
        return sum(self.env['stock.valuation.layer'].search([('product_id', '=', product.id)]).mapped('value'))
