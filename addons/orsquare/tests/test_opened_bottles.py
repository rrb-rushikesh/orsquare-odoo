# -*- coding: utf-8 -*-
"""Permanent regression suite for the Open Bottle invariants (Alternative B: fractional UoM).

ORSquare uses 6-decimal precision for the bottle UoM as the validated minimum for the tested
bottle/portion combinations. This is an implementation requirement backed by these automated tests,
not a universal guarantee: any new supported bottle/portion configuration must pass the same
valuation/conservation tests.
"""
from odoo.exceptions import UserError
from odoo.tests import tagged
from odoo.tools import float_is_zero

from .common import OrsquareCase

# (label, uom xmlid, bottle cost, pegs in ml)
BOTTLE_CASES = [
    ('Glenfiddich 750ml', 'orsquare.uom_shop_750ml', 1500.0, [60, 60, 90, 120, 60, 90, 180, 60]),   # 720 ml + 30 ml scrap
    ('Monkey 47 700ml', 'orsquare.uom_shop_700ml', 2100.0, [60, 60, 60, 60, 60, 60, 60, 60, 90, 90]),  # non-terminating 60/700
    ('Kingfisher 650ml', 'orsquare.uom_shop_650ml', 260.0, [200, 200, 200]),                          # 200/650 = 4/13
    ('Blenders Pint 375ml', 'orsquare.uom_shop_375ml', 900.0, [30, 60, 90, 60, 90]),
    ('Absolut 1L', 'orsquare.uom_shop_1000ml', 2500.0, [60, 60, 90, 120, 150, 60, 90, 30, 180]),
]


@tagged('post_install', '-at_install', 'orsquare')
class TestOpenedBottles(OrsquareCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.whisky = cls.make_product('Peg Whisky 750ml', cost=1500.0, price=2000.0,
                                      uom_xmlid='orsquare.uom_shop_750ml', orsquare_short_code='RC')
        cls.whisky.product_tmpl_id.orsquare_peg_size_ids = [
            (0, 0, {'ml': 30, 'price': 70.0}), (0, 0, {'ml': 60, 'price': 120.0}), (0, 0, {'ml': 90, 'price': 170.0})]
        cls.stock_in(cls.whisky, 5, cls.counter)

    def test_01_capacity_is_derived_from_unit(self):
        self.assertEqual(self.whisky.orsquare_capacity_ml, 750.0)
        self.assertTrue(self.whisky.orsquare_can_open)
        plain = self.make_product('Chips Pack')
        self.assertFalse(plain.orsquare_can_open)

    def test_02_open_bottle_moves_one_unit_to_its_own_location(self):
        bottle = self.Bottle.open_bottle(self.whisky)
        self.assertEqual(bottle.name, 'RC #01')
        self.assertEqual(bottle.state, 'active')
        self.assertEqual(self.qty_at(self.whisky, self.counter), 4)
        self.assertEqual(self.qty_at(self.whisky, bottle.location_id), 1.0)
        self.assertEqual(bottle.location_id.location_id, self.wh.orsquare_opened_id)
        self.assertEqual(bottle.remaining_ml, 750.0)
        self.assertEqual(bottle.fill_level, 'green')
        second = self.Bottle.open_bottle(self.whisky)
        self.assertEqual(second.name, 'RC #02')

    def test_03_remaining_is_derived_from_quant_not_stored(self):
        bottle = self.Bottle.open_bottle(self.whisky)
        self.assertNotIn('remaining_ml', {n for n, f in bottle._fields.items() if f.store})
        self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 60}, 'price': 120.0}])
        bottle.invalidate_recordset()
        self.assertEqual(round(bottle.remaining_ml, 3), 690.0)
        self.assertEqual(self.qty_at(self.whisky, bottle.location_id), 0.92)

    def test_04_peg_price_comes_from_peg_size_table(self):
        bottle = self.Bottle.open_bottle(self.whisky)
        res = self.sales.settle({
            'client_ref': self.ref(), 'lines': [{'peg': {'bottle_id': bottle.id, 'ml': 90}}],
            'payments': [{'method': 'cash', 'amount': 170.0}]})
        self.assertEqual(res['total'], 170.0)

    def test_05_cannot_pour_more_than_remains_online(self):
        bottle = self.Bottle.open_bottle(self.whisky)
        for _i in range(4):
            self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 180}, 'price': 400.0}])  # 720 ml
        with self.assertRaisesRegex(UserError, "left"):
            self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 60}, 'price': 120.0}])

    def test_06_draining_exactly_closes_the_bottle(self):
        bottle = self.Bottle.open_bottle(self.whisky)
        for _i in range(5):
            self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 150}, 'price': 300.0}])
        self.assertEqual(bottle.state, 'empty')
        self.assertFalse(bottle.location_id.active)
        self.assertEqual(self.qty_at(self.whisky, bottle.location_id), 0.0)

    def test_07_tray_lists_active_bottles_oldest_first(self):
        a = self.Bottle.open_bottle(self.whisky)
        b = self.Bottle.open_bottle(self.whisky)
        tray = self.Bottle.tray()
        labels = [t['label'] for t in tray]
        self.assertEqual(labels[:2], [a.name, b.name])
        self.assertEqual(tray[0]['remaining_ml'], 750.0)

    def test_08_pegs_do_not_touch_sealed_counter_stock(self):
        bottle = self.Bottle.open_bottle(self.whisky)
        before = self.qty_at(self.whisky, self.counter)
        self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 60}, 'price': 120.0}])
        self.assertEqual(self.qty_at(self.whisky, self.counter), before)

    def test_09_conservation_across_five_bottle_sizes(self):
        """Quant -> 0.000000, asset -> INR 0.00 and COGS + scrap == purchase cost, for every size."""
        ledger_account = self.env['orsquare.shop.bootstrap'].account('stock_valuation', self.company)
        for label, uom_xmlid, cost, pegs in BOTTLE_CASES:
            with self.subTest(bottle=label):
                product = self.make_product(label, cost=cost, price=cost * 2, uom_xmlid=uom_xmlid)
                capacity = product.orsquare_capacity_ml
                self.assertGreater(capacity, sum(pegs), "test data must leave a residual")
                self.stock_in(product, 1, self.counter)
                svl_before = self.svl_value(product)
                self.assertEqual(svl_before, cost)
                bottle = self.Bottle.open_bottle(product)
                for ml in pegs:
                    self.sell([{'peg': {'bottle_id': bottle.id, 'ml': ml}, 'price': ml * 1.0}])
                bottle.invalidate_recordset()
                residual_ml = capacity - sum(pegs)
                self.assertAlmostEqual(bottle.remaining_ml, residual_ml, places=2)
                bottle.action_finish(reason='dregs')
                self.assertEqual(bottle.state, 'wasted')
                # stored quant exactly zero (no quant dust)
                quants = self.env['stock.quant'].with_context(active_test=False).search([
                    ('product_id', '=', product.id), ('location_id.usage', '=', 'internal')])
                self.assertTrue(all(float_is_zero(q.quantity, precision_digits=6) for q in quants),
                                "quant dust left: %s" % quants.mapped('quantity'))
                # asset value exactly zero: SVLs net to 0.00 (no stranded pennies)
                self.assertEqual(round(self.svl_value(product), 2), 0.0)
                # cumulative COGS + scrap loss == bottle purchase cost
                outs = self.env['stock.valuation.layer'].search([('product_id', '=', product.id), ('value', '<', 0)])
                self.assertEqual(round(-sum(outs.mapped('value')), 2), cost)
                # ledger agrees: the valuation account carries nothing for this product
                lines = self.env['account.move.line'].search([
                    ('product_id', '=', product.id), ('account_id', '=', ledger_account.id)])
                self.assertEqual(round(sum(lines.mapped('balance')), 2), 0.0)

    def test_10_finish_without_residual_is_empty_not_wasted(self):
        product = self.make_product('Tiny 180ml', cost=300.0, uom_xmlid='orsquare.uom_shop_180ml')
        self.stock_in(product, 1, self.counter)
        bottle = self.Bottle.open_bottle(product)
        self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 90}, 'price': 100.0}])
        self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 90}, 'price': 100.0}])
        self.assertEqual(bottle.state, 'empty')
        with self.assertRaises(UserError):
            bottle.action_finish()

    def test_11_refunded_peg_does_not_pour_liquid_back(self):
        bottle = self.Bottle.open_bottle(self.whisky)
        res = self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 60}, 'price': 120.0}])
        order = self.env['pos.order'].browse(res['order_id'])
        remaining_before = self.qty_at(self.whisky, bottle.location_id)
        # Refund lines carry negative qty and point at the original peg line.
        refund = order.refund()
        self.assertTrue(refund)
        self.assertEqual(self.qty_at(self.whisky, bottle.location_id), remaining_before)

    def test_12_offline_peg_over_pour_is_accepted_and_flagged(self):
        bottle = self.Bottle.open_bottle(self.whisky)
        for _i in range(4):
            self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 180}, 'price': 400.0}])
        res = self.sales.settle({
            'client_ref': 'OFFPEG', 'offline': True,
            'lines': [{'peg': {'bottle_id': bottle.id, 'ml': 60}, 'price': 120.0}],
            'payments': [{'method': 'cash', 'amount': 120.0}]})
        self.assertTrue(res['flagged'])
