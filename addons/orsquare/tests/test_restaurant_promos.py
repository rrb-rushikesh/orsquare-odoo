# -*- coding: utf-8 -*-
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged

from .common import OrsquareCase


@tagged('post_install', '-at_install', 'orsquare')
class TestTableTabs(OrsquareCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company.orsquare_feature_tables = True
        cls.tabs = cls.env['orsquare.tab.service']
        cat = cls.env['orsquare.catalog.service']
        floor = cat.create_floor('Garden')
        ids = cat.bulk_create_tables(floor, 1, 4, 4)
        cls.t1, cls.t2, cls.t3, _t4 = ids
        cls.dish = cls.env['product.product'].create({
            'name': 'Paneer Tikka', 'is_kitchen': True, 'list_price': 200.0, 'available_in_pos': True,
            'taxes_id': [(6, 0, [])]})
        cls.beer = cls.make_product('Tab Beer', cost=100.0, price=150.0)
        cls.stock_in(cls.beer, 20, cls.counter)

    def _line(self, key, product, qty, **extra):
        return dict({'key': key, 'product_id': product.id, 'qty': qty}, **extra)

    def test_01_open_save_and_read_a_tab(self):
        tab = self.tabs.tab_open(self.t1, covers=3)
        self.assertEqual(tab['covers'], 3)
        saved = self.tabs.tab_save(self.t1, [self._line('a', self.dish, 2), self._line('b', self.beer, 1)])
        self.assertEqual(saved['total'], 550.0)
        self.assertEqual({l['key'] for l in saved['lines']}, {'a', 'b'})
        self.assertEqual(self.tabs.tab_get(self.t1)['total'], 550.0)
        self.assertEqual(self.env['pos.order'].search_count([('table_id', '=', self.t1), ('state', '=', 'draft')]), 1)

    def test_02_a_draft_tab_moves_no_stock_and_posts_nothing(self):
        before = self.qty_at(self.beer, self.counter)
        moves = self.env['account.move'].search_count([])
        self.tabs.tab_save(self.t1, [self._line('b', self.beer, 3)])
        self.assertEqual(self.qty_at(self.beer, self.counter), before)
        self.assertEqual(self.env['account.move'].search_count([]), moves)

    def test_03_saving_again_updates_in_place_by_key(self):
        self.tabs.tab_save(self.t1, [self._line('a', self.dish, 1)])
        tab = self.tabs.tab_save(self.t1, [self._line('a', self.dish, 3), self._line('c', self.beer, 2)])
        self.assertEqual(len(tab['lines']), 2)
        self.assertEqual(tab['total'], 3 * 200.0 + 2 * 150.0)
        tab = self.tabs.tab_save(self.t1, [self._line('c', self.beer, 2)])       # 'a' removed
        self.assertEqual([l['key'] for l in tab['lines']], ['c'])

    def test_04_table_status_board(self):
        self.tabs.tab_save(self.t2, [self._line('a', self.dish, 2)], covers=2)
        board = {t['table_id']: t for f in self.tabs.table_status() for t in f['tables']}
        self.assertEqual(board[self.t2]['state'], 'occupied')
        self.assertEqual(board[self.t2]['total'], 400.0)
        self.assertEqual(board[self.t1]['state'], 'free')
        cashier = self.env['res.users'].create({'name': 'Waiter', 'login': 'waiter1', 'groups_id': [
            (6, 0, [self.env.ref('orsquare.group_orsquare_cashier').id])]})
        masked = {t['table_id']: t for f in self.tabs.with_user(cashier).table_status() for t in f['tables']}
        self.assertIsNone(masked[self.t2]['total'], "running totals are money: masked without can_see_money")

    def test_05_kot_prints_only_what_is_new_then_cancellations(self):
        self.tabs.tab_save(self.t1, [self._line('a', self.dish, 2, note='no onion'), self._line('b', self.beer, 1)])
        k1 = self.tabs.tab_kot(self.t1, 'kitchen')
        self.assertEqual([(i['name'], i['qty'], i['note']) for i in k1['items']], [('Paneer Tikka', 2.0, 'no onion')])
        with self.assertRaisesRegex(UserError, "Nothing new"):
            self.tabs.tab_kot(self.t1, 'kitchen')
        bar = self.tabs.tab_kot(self.t1, 'bar')
        self.assertEqual([i['name'] for i in bar['items']], ['Tab Beer'])
        self.tabs.tab_save(self.t1, [self._line('a', self.dish, 3, note='no onion'), self._line('b', self.beer, 1)])
        k2 = self.tabs.tab_kot(self.t1, 'kitchen')
        self.assertEqual([i['qty'] for i in k2['items']], [1.0], "only the extra portion")
        self.tabs.tab_save(self.t1, [self._line('a', self.dish, 1, note='no onion'), self._line('b', self.beer, 1)])
        k3 = self.tabs.tab_kot(self.t1, 'kitchen')
        self.assertEqual([i['qty'] for i in k3['cancelled']], [2.0])
        self.assertTrue(any('CANCEL' in l for l in k3['text']))
        self.assertTrue(all(len(l) <= 48 for l in k1['text']))

    def test_06_transfer_to_free_table_and_merge_into_busy_one(self):
        self.tabs.tab_save(self.t1, [self._line('a', self.dish, 1)], covers=2)
        moved = self.tabs.tab_transfer(self.t1, self.t3)
        self.assertEqual(moved['table_id'], self.t3)
        with self.assertRaisesRegex(UserError, "no open tab"):
            self.tabs.tab_get(self.t1)
        self.tabs.tab_save(self.t2, [self._line('a', self.beer, 2)], covers=1)    # same key 'a' on purpose
        merged = self.tabs.tab_transfer(self.t3, self.t2)
        self.assertEqual(merged['total'], 200.0 + 300.0)
        self.assertEqual(len(merged['lines']), 2, "key clash resolved, nothing lost")
        self.assertEqual(merged['covers'], 3)
        self.assertEqual(self.env['pos.order'].search_count([('state', '=', 'draft'), ('table_id', '!=', False)]), 1)

    def test_07_settle_a_tab_creates_the_paid_order_and_removes_the_draft(self):
        self.tabs.tab_save(self.t1, [self._line('a', self.dish, 2), self._line('b', self.beer, 2)], covers=4)
        res = self.sales.settle({'client_ref': self.ref(), 'table_id': self.t1,
                                 'payments': [{'method': 'cash', 'amount': 700.0}]})
        order = self.env['pos.order'].browse(res['order_id'])
        self.assertEqual(order.state, 'paid')
        self.assertEqual(order.table_id.id, self.t1)
        self.assertEqual(order.customer_count, 4)
        self.assertEqual(res['total'], 700.0)
        self.assertEqual(self.qty_at(self.beer, self.counter), 18, "stock moves only now")
        self.assertEqual(self.env['pos.order'].search_count([('table_id', '=', self.t1), ('state', '=', 'draft')]), 0)
        self.assertEqual(res['pickings'] and len(res['pickings']), 1, "kitchen dish never delivers; the beer does")

    def test_08_settle_replay_is_idempotent_for_tabs(self):
        self.tabs.tab_save(self.t1, [self._line('b', self.beer, 1)])
        payload = {'client_ref': 'TAB-IDEM', 'table_id': self.t1, 'payments': [{'method': 'cash', 'amount': 150.0}]}
        first = self.sales.settle(payload)
        second = self.sales.settle(payload)
        self.assertTrue(second['duplicate'])
        self.assertEqual(first['order_id'], second['order_id'])
        self.assertEqual(self.qty_at(self.beer, self.counter), 19)

    def test_09_cancel_needs_reason_after_kot(self):
        self.tabs.tab_save(self.t1, [self._line('a', self.dish, 1)])
        self.tabs.tab_kot(self.t1)
        with self.assertRaisesRegex(UserError, "reason"):
            self.tabs.tab_cancel(self.t1)
        self.tabs.tab_cancel(self.t1, reason='Guests left')
        self.assertFalse(self.env['pos.order'].search([('table_id', '=', self.t1), ('state', '=', 'draft')]))
        self.tabs.tab_save(self.t2, [self._line('a', self.dish, 1)])
        self.tabs.tab_cancel(self.t2)           # nothing sent: no reason needed

    def test_10_off_when_the_tables_feature_is_off_and_needs_a_role(self):
        nobody = self.env['res.users'].create({'name': 'N', 'login': 'tab_nobody',
                                               'groups_id': [(6, 0, [self.env.ref('base.group_user').id])]})
        with self.assertRaises(AccessError):
            self.tabs.with_user(nobody).tab_open(self.t1)
        self.company.orsquare_feature_tables = False
        with self.assertRaisesRegex(UserError, "switched off"):
            self.tabs.tab_open(self.t1)

    def test_11_peg_on_a_tab(self):
        whisky = self.make_product('Tab Whisky 750ml', cost=1500.0, price=2000.0, uom_xmlid='orsquare.uom_shop_750ml')
        whisky.product_tmpl_id.orsquare_peg_size_ids = [(0, 0, {'ml': 60, 'price': 120.0})]
        self.stock_in(whisky, 2, self.counter)
        bottle = self.Bottle.open_bottle(whisky)
        tab = self.tabs.tab_save(self.t1, [{'key': 'p', 'peg': {'bottle_id': bottle.id, 'ml': 60}}])
        self.assertEqual(tab['total'], 120.0)
        self.assertTrue(tab['lines'][0]['is_peg'])
        self.assertEqual(bottle.remaining_ml, 750.0, "the tab does not pour")
        self.sales.settle({'client_ref': self.ref(), 'table_id': self.t1, 'payments': [{'method': 'cash', 'amount': 120.0}]})
        bottle.invalidate_recordset()
        self.assertEqual(round(bottle.remaining_ml, 3), 690.0)


@tagged('post_install', '-at_install', 'orsquare')
class TestPromos(OrsquareCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.promos = cls.env['orsquare.promo']
        cls.item = cls.make_product('Promo Item', cost=100.0, price=1000.0)
        cls.stock_in(cls.item, 50, cls.counter)

    def test_01_percent_promo_is_a_pretax_discount(self):
        self.promos.create({'code': ' promo10 ', 'kind': 'percent', 'value': 10})
        res = self.sell([{'product_id': self.item.id, 'qty': 2}], payments=[{'method': 'cash', 'amount': 1800.0}],
                        promo_code='Promo10')
        self.assertEqual(res['total'], 1800.0)
        self.assertEqual(res['promo'], 'PROMO10')
        promo = self.promos.lookup('PROMO10')
        self.assertEqual(promo.used_count, 1)
        self.assertEqual(self.env['pos.order'].browse(res['order_id']).orsquare_promo_id, promo)

    def test_02_flat_promo_with_minimum_bill_and_percent_cap(self):
        self.promos.create({'code': 'FLAT50', 'kind': 'amount', 'value': 50, 'min_bill': 500})
        self.promos.create({'code': 'BIG20', 'kind': 'percent', 'value': 20, 'max_discount': 100})
        with self.assertRaisesRegex(UserError, "at least"):
            self.promos.check_promo('FLAT50', 400)
        self.assertEqual(self.promos.check_promo('FLAT50', 1000)['discount'], 50.0)
        self.assertEqual(self.promos.check_promo('BIG20', 1000)['discount'], 100.0, "20% would be 200: capped")

    def test_03_validity_window_usage_limit_and_inactive(self):
        today = fields.Date.context_today(self.env['res.users'])
        self.promos.create({'code': 'OLD', 'kind': 'percent', 'value': 5, 'date_to': today - timedelta(days=1)})
        self.promos.create({'code': 'ONCE', 'kind': 'percent', 'value': 5, 'max_uses': 1})
        self.promos.create({'code': 'OFF', 'kind': 'percent', 'value': 5, 'active': False})
        with self.assertRaisesRegex(UserError, "not valid today"):
            self.promos.check_promo('OLD', 1000)
        self.sell([{'product_id': self.item.id, 'qty': 1}], payments=[{'method': 'cash', 'amount': 950.0}], promo_code='ONCE')
        with self.assertRaisesRegex(UserError, "fully used"):
            self.sell([{'product_id': self.item.id, 'qty': 1}], payments=[{'method': 'cash', 'amount': 950.0}], promo_code='ONCE')
        with self.assertRaisesRegex(UserError, "not active"):
            self.promos.check_promo('OFF', 1000)
        with self.assertRaisesRegex(UserError, "Unknown promo"):
            self.promos.check_promo('NOPE', 1000)

    def test_04_promo_and_manual_discount_are_exclusive(self):
        self.promos.create({'code': 'P5', 'kind': 'percent', 'value': 5})
        with self.assertRaisesRegex(UserError, "not both"):
            self.sell([{'product_id': self.item.id, 'qty': 1}], payments=[{'method': 'cash', 'amount': 900.0}],
                      promo_code='P5', bill_discount={'kind': 'amount', 'value': 100})

    def test_05_a_failed_sale_does_not_burn_a_use(self):
        self.promos.create({'code': 'SAFE', 'kind': 'percent', 'value': 10, 'max_uses': 1})
        with self.assertRaises(UserError):
            self.sell([{'product_id': self.item.id, 'qty': 1}], payments=[{'method': 'cash', 'amount': 1.0}], promo_code='SAFE')
        self.assertEqual(self.promos.lookup('SAFE').used_count, 0, "rolled back with the failed sale")

    def test_06_validation_and_owner_only_management(self):
        with self.assertRaises(ValidationError):
            self.promos.create({'code': 'BAD', 'kind': 'percent', 'value': 150})
        cashier = self.env['res.users'].create({'name': 'C', 'login': 'promo_c', 'groups_id': [
            (6, 0, [self.env.ref('orsquare.group_orsquare_cashier').id])]})
        with self.assertRaises(AccessError):
            self.promos.with_user(cashier).create_promo('X', 'percent', 5)
        owner = self.env['res.users'].create({'name': 'O', 'login': 'promo_o', 'groups_id': [
            (6, 0, [self.env.ref('orsquare.group_orsquare_owner').id])]})
        pid = self.promos.with_user(owner).create_promo('own5', 'percent', 5, max_uses=3)
        self.assertEqual([p['code'] for p in self.promos.with_user(cashier).list_promos() if p['id'] == pid], ['OWN5'])
        self.promos.with_user(owner).set_promo_active(pid, False)
        self.assertFalse([p for p in self.promos.list_promos() if p['id'] == pid][0]['active'])


@tagged('post_install', '-at_install', 'orsquare')
class TestGstinAndWholesale(OrsquareCase):

    def test_01_valid_gstin(self):
        # 27AAPFU0939F1ZV is the sample GSTIN used in the GST law's own check-digit example.
        r = self.env['orsquare.accounts.service'].lookup_gstin('27aapfu0939f1zv')
        self.assertTrue(r['valid'], r)
        self.assertEqual(r['state_code'], '27')
        self.assertTrue(r['state'].startswith('Maharashtra'))
        self.assertEqual(r['pan'], 'AAPFU0939F')

    def test_02_bad_gstins_say_why(self):
        svc = self.env['orsquare.accounts.service']
        self.assertIn('format', svc.lookup_gstin('27AAPFU0939F1Z')['reason'])
        self.assertIn('check character', svc.lookup_gstin('27AAPFU0939F1ZA')['reason'])
        self.assertIn('state code', svc.lookup_gstin('99AAPFU0939F1Z5')['reason'])
        self.assertFalse(svc.lookup_gstin('')['valid'])

    def test_03_transport_and_credit_due_date_on_the_tax_invoice(self):
        item = self.make_product('Wholesale Item', cost=100.0, price=400.0)
        self.stock_in(item, 500, self.counter)
        hotel = self.env['res.partner'].create({'name': 'Hotel Big', 'vat': '27AAPFU0939F1ZV'})
        res = self.sell([{'product_id': item.id, 'qty': 150}], partner_id=hotel.id, to_invoice=True,
                        transport={'vehicle_no': 'MH12AB1234', 'lr_no': 'LR-77'}, due_days=15)
        inv = self.env['account.move'].browse(res['invoice_id'])
        self.assertEqual(inv.orsquare_vehicle_no, 'MH12AB1234')
        self.assertEqual(inv.orsquare_lr_no, 'LR-77')
        self.assertEqual(inv.invoice_date_due, fields.Date.add(inv.invoice_date, days=15))
        self.assertEqual(res['warnings'], ['eway_bill_required'], "consignment over INR 50,000 without an e-Way bill")
        res2 = self.sell([{'product_id': item.id, 'qty': 150}], partner_id=hotel.id, to_invoice=True,
                         transport={'eway_bill_no': '3210 0000 1234'})
        self.assertEqual(res2['warnings'], [])


@tagged('post_install', '-at_install', 'orsquare')
class TestOfflinePromoAndBoard(OrsquareCase):

    def test_01_offline_promo_is_honoured_even_if_exhausted_by_sync_time(self):
        promos = self.env['orsquare.promo']
        item = self.make_product('Off Promo Item', cost=100.0, price=1000.0)
        self.stock_in(item, 10, self.counter)
        promos.create({'code': 'LATE', 'kind': 'percent', 'value': 10, 'max_uses': 1})
        self.sell([{'product_id': item.id, 'qty': 1}], payments=[{'method': 'cash', 'amount': 900.0}], promo_code='LATE')
        res = self.sales.settle({'client_ref': 'OFFPROMO', 'offline': True, 'promo_code': 'LATE',
                                 'created_at': fields.Datetime.now().isoformat(),
                                 'lines': [{'product_id': item.id, 'qty': 1}],
                                 'payments': [{'method': 'cash', 'amount': 900.0}]})
        self.assertEqual(res['total'], 900.0, "the customer was promised the discount at the counter")

    def test_02_bootstrap_and_delta_carry_tables_and_promos(self):
        self.company.orsquare_feature_tables = True
        self.env['orsquare.promo'].create({'code': 'BOOT5', 'kind': 'percent', 'value': 5})
        floor = self.env['orsquare.catalog.service'].create_floor('Hall')
        tid = self.env['orsquare.catalog.service'].bulk_create_tables(floor, 1, 2, 2)[0]
        sync = self.env['orsquare.sync.service']
        boot = sync.bootstrap()
        self.assertIn('BOOT5', [p['code'] for p in boot['promos']])
        self.assertTrue(boot['tables'])
        item = self.make_product('Board Item', price=100.0)
        self.env['orsquare.tab.service'].tab_save(tid, [{'key': 'a', 'product_id': item.id, 'qty': 1}])
        delta = sync.delta(boot['seq'])
        self.assertIn('tab_changed', [e['type'] for e in delta['events']])
        self.assertIn('tables', delta['patches'])
