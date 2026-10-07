# -*- coding: utf-8 -*-
from odoo.exceptions import UserError, ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'orsquare')
class TestTopology(TransactionCase):
    """Stage 3: Godown / Counter / Opened topology, settings and Godown -> Counter transfers."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.wh = cls.env['stock.warehouse'].orsquare_main_warehouse(cls.company)
        cls.svc = cls.env['orsquare.stock.service']
        cls.product = cls.env['product.product'].create({
            'name': 'Topology Test Whisky 750ml',
            'type': 'consu', 'is_storable': True,
            'standard_price': 1000.0, 'list_price': 1500.0,
        })

    def _put(self, loc, qty):
        self.env['stock.quant']._update_available_quantity(self.product, loc, qty)

    def _qty(self, loc):
        return self.svc.location_qty(self.product, loc)

    def test_01_locations_exist_under_stock(self):
        wh = self.wh
        for loc, name in ((wh.orsquare_godown_id, 'Godown'), (wh.orsquare_counter_id, 'Counter'),
                          (wh.orsquare_opened_id, 'Opened')):
            self.assertTrue(loc, "%s location missing" % name)
            self.assertEqual(loc.usage, 'internal')
            self.assertEqual(loc.location_id, wh.lot_stock_id)
            self.assertEqual(loc.complete_name, 'WH/Stock/%s' % name)

    def test_02_operation_types_wired_to_topology(self):
        wh = self.wh
        self.assertEqual(wh.in_type_id.default_location_dest_id, wh.orsquare_godown_id,
                         "Purchases must land in the Godown")
        self.assertEqual(wh.pos_type_id.default_location_src_id, wh.orsquare_counter_id,
                         "POS sells from the Counter only")
        self.assertEqual(wh.out_type_id.default_location_src_id, wh.orsquare_counter_id)
        self.assertEqual(wh.int_type_id.default_location_src_id, wh.orsquare_godown_id)
        self.assertEqual(wh.int_type_id.default_location_dest_id, wh.orsquare_counter_id)
        self.assertEqual(wh.orsquare_peg_type_id.default_location_src_id, wh.orsquare_opened_id)

    def test_03_topology_is_idempotent(self):
        ids = (self.wh.orsquare_godown_id.id, self.wh.orsquare_counter_id.id, self.wh.orsquare_opened_id.id)
        self.wh._orsquare_ensure_topology()
        self.assertEqual(ids, (self.wh.orsquare_godown_id.id, self.wh.orsquare_counter_id.id,
                               self.wh.orsquare_opened_id.id))

    def test_04_manual_transfer_moves_real_quants(self):
        self._put(self.wh.orsquare_godown_id, 10)
        picking = self.svc.manual_transfer(self.wh, 'godown_to_counter', {self.product.id: 4})
        self.assertEqual(picking.state, 'done')
        self.assertEqual(self._qty(self.wh.orsquare_godown_id), 6)
        self.assertEqual(self._qty(self.wh.orsquare_counter_id), 4)

    def test_05_manual_transfer_rejects_overdraw_and_leaves_nothing(self):
        self._put(self.wh.orsquare_godown_id, 2)
        before = self.env['stock.picking'].search_count([])
        with self.assertRaises(UserError):
            self.svc.manual_transfer(self.wh, 'godown_to_counter', {self.product.id: 3})
        self.assertEqual(self.env['stock.picking'].search_count([]), before)
        self.assertEqual(self._qty(self.wh.orsquare_godown_id), 2)

    def test_06_auto_godown_off_blocks_when_counter_short(self):
        self.company.orsquare_auto_godown_transfer = False
        self._put(self.wh.orsquare_counter_id, 2)
        self._put(self.wh.orsquare_godown_id, 50)
        with self.assertRaisesRegex(UserError, "Insufficient Counter stock"):
            self.svc.ensure_counter_stock(self.wh, {self.product.id: 5}, 'T1')
        self.assertEqual(self._qty(self.wh.orsquare_godown_id), 50)

    def test_07_auto_godown_on_pulls_exact_shortfall(self):
        self.company.orsquare_auto_godown_transfer = True
        self._put(self.wh.orsquare_counter_id, 2)
        self._put(self.wh.orsquare_godown_id, 50)
        picking, shortages = self.svc.ensure_counter_stock(self.wh, {self.product.id: 5}, 'T2')
        self.assertFalse(shortages)
        self.assertEqual(picking.state, 'done')
        self.assertEqual(picking.origin, 'Auto-Godown Transfer for Sale T2')
        self.assertEqual(self._qty(self.wh.orsquare_counter_id), 5, "Counter topped up to exactly the need")
        self.assertEqual(self._qty(self.wh.orsquare_godown_id), 47)

    def test_08_auto_godown_no_transfer_when_counter_sufficient(self):
        self.company.orsquare_auto_godown_transfer = True
        self._put(self.wh.orsquare_counter_id, 9)
        self._put(self.wh.orsquare_godown_id, 50)
        picking, shortages = self.svc.ensure_counter_stock(self.wh, {self.product.id: 5}, 'T3')
        self.assertFalse(picking)
        self.assertEqual(self._qty(self.wh.orsquare_godown_id), 50)

    def test_09_auto_godown_blocks_when_both_short(self):
        self.company.orsquare_auto_godown_transfer = True
        self._put(self.wh.orsquare_counter_id, 1)
        self._put(self.wh.orsquare_godown_id, 2)
        with self.assertRaisesRegex(UserError, "Insufficient Stock in Godown"):
            self.svc.ensure_counter_stock(self.wh, {self.product.id: 5}, 'T4')

    def test_10_offline_oversell_is_accepted_and_reported_as_shortage(self):
        self.company.orsquare_auto_godown_transfer = True
        self._put(self.wh.orsquare_counter_id, 1)
        self._put(self.wh.orsquare_godown_id, 2)
        picking, shortages = self.svc.ensure_counter_stock(
            self.wh, {self.product.id: 5}, 'T5', allow_oversell=True)
        self.assertEqual(shortages, {self.product.id: 2})
        self.assertEqual(self._qty(self.wh.orsquare_godown_id), 0, "Godown fully drained")
        self.assertEqual(self._qty(self.wh.orsquare_counter_id), 3)

    def test_11_non_storable_products_are_ignored(self):
        dish = self.env['product.product'].create({'name': 'Dish', 'type': 'consu', 'is_storable': False})
        picking, shortages = self.svc.ensure_counter_stock(self.wh, {dish.id: 100}, 'T6')
        self.assertFalse(picking)
        self.assertFalse(shortages)

    def test_12_settings_validation(self):
        with self.assertRaises(ValidationError):
            self.company.orsquare_cutoff_hour = 13.0
        with self.assertRaises(ValidationError):
            self.company.orsquare_tz = 'Mars/Phobos'
        with self.assertRaises(ValidationError):
            self.company.orsquare_enabled_tabs = 'sales,nonsense'
