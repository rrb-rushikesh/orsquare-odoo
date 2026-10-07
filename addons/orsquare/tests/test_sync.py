# -*- coding: utf-8 -*-
import json
import time

from odoo import fields
from odoo.tests import tagged

from .common import OrsquareCase


@tagged('post_install', '-at_install', 'orsquare')
class TestSync(OrsquareCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sync = cls.env['orsquare.sync.service']
        cls.beer = cls.make_product('Sync Beer 650ml', cost=100.0, price=200.0, uom_xmlid='orsquare.uom_shop_650ml')
        cls.stock_in(cls.beer, 20, cls.counter)

    def _sale(self, mid, seq, device='dev-A', qty=1, **payload_extra):
        payload = {'lines': [{'product_id': self.beer.id, 'qty': qty}],
                   'payments': [{'method': 'cash', 'amount': 200.0 * qty}]}
        payload.update(payload_extra)
        return {'id': mid, 'device_id': device, 'device_seq': seq, 'kind': 'sale',
                'created_at': fields.Datetime.now().isoformat(), 'payload': payload}

    # ---- bootstrap ---------------------------------------------------------------------------
    def test_01_bootstrap_is_one_complete_bundle(self):
        b = self.sync.bootstrap()
        for key in ('seq', 'server_ts', 'me', 'products', 'units', 'stock', 'open_bottles', 'day',
                    'customers', 'payment_modes', 'brands', 'categories', 'regimes'):
            self.assertIn(key, b)
        names = [p['name'] for p in b['products']]
        self.assertIn('Sync Beer 650ml', names)
        row = [p for p in b['products'] if p['name'] == 'Sync Beer 650ml'][0]
        self.assertEqual(row['price'], 200.0)
        self.assertIn('taxes', row)
        self.assertEqual(b['day']['state'], 'open')
        json.dumps(b, default=str)   # must be serialisable
        # benchmark TARGET (not a guarantee): record size/time for visibility in the log
        t0 = time.perf_counter()
        size = len(json.dumps(self.sync.bootstrap(), default=str))
        self.env.cr.execute("SELECT 1")
        self.assertLess(size, 5_000_000)

    def test_02_bootstrap_masks_for_cashier(self):
        cashier = self.env['res.users'].create({
            'name': 'Boot Cashier', 'login': 'boot_c',
            'groups_id': [(6, 0, [self.env.ref('orsquare.group_orsquare_cashier').id])]})
        b = self.sync.with_user(cashier).bootstrap()
        row = [p for p in b['products'] if p['name'] == 'Sync Beer 650ml'][0]
        self.assertNotIn('cost', row)
        self.assertEqual(set(b['day']), {'id', 'date', 'state'})
        self.assertFalse(b['me']['flags']['can_see_money'])

    # ---- delta -------------------------------------------------------------------------------
    def test_03_delta_returns_events_and_patches(self):
        seq0 = self.sync.bootstrap()['seq']
        self.sell([{'product_id': self.beer.id, 'qty': 2}])
        d = self.sync.delta(seq0)
        self.assertEqual(d['events'][-1]['type'], 'sale_settled')
        self.assertIn('stock', d['patches'])
        self.assertIn('day', d['patches'])
        self.assertGreater(d['seq'], seq0)
        again = self.sync.delta(d['seq'])
        self.assertEqual(again['events'], [])
        self.assertEqual(again['seq'], d['seq'])

    def test_04_delta_cursor_ahead_means_reset(self):
        self.assertTrue(self.sync.delta(10 ** 9)['reset'])

    def test_05_delta_catalog_changes_since_timestamp(self):
        b = self.sync.bootstrap()
        ts = b['server_ts']
        self.env.cr.execute("SELECT now() + interval '1 second'")
        self.beer.product_tmpl_id.list_price = 250.0
        self.env.cr.execute("UPDATE product_template SET write_date = now() + interval '1 minute' WHERE id = %s",
                            [self.beer.product_tmpl_id.id])
        self.beer.product_tmpl_id.invalidate_recordset()
        d = self.sync.delta(b['seq'], since_ts=ts)
        self.assertIn('Sync Beer 650ml', [p['name'] for p in d['patches'].get('products', [])])

    # ---- flush -------------------------------------------------------------------------------
    def test_06_flush_applies_in_order_and_replay_is_idempotent(self):
        batch = [self._sale('m1', 1), self._sale('m2', 2), self._sale('m3', 3)]
        res = self.sync.flush(batch)
        self.assertEqual([r['status'] for r in res['results']], ['ok', 'ok', 'ok'])
        self.assertEqual(self.qty_at(self.beer, self.counter), 17)
        replay = self.sync.flush(batch)
        self.assertEqual([r['status'] for r in replay['results']], ['duplicate'] * 3)
        self.assertEqual(replay['results'][0]['result']['order_id'], res['results'][0]['result']['order_id'])
        self.assertEqual(self.qty_at(self.beer, self.counter), 17, "no double deduction on replay")

    def test_07_out_of_order_is_refused_and_blocks_followers(self):
        self.sync.flush([self._sale('o1', 1)])
        res = self.sync.flush([self._sale('o3', 3), self._sale('o4', 4)])
        self.assertEqual([r['status'] for r in res['results']], ['out_of_order', 'out_of_order'])
        self.assertEqual(res['results'][0]['expected_seq'], 2)
        self.assertEqual(self.qty_at(self.beer, self.counter), 19)
        # the missing one arrives, then the held ones can follow
        res = self.sync.flush([self._sale('o2', 2), self._sale('o3', 3), self._sale('o4', 4)])
        self.assertEqual([r['status'] for r in res['results']], ['ok', 'ok', 'ok'])
        self.assertEqual(self.qty_at(self.beer, self.counter), 16)

    def test_08_business_error_does_not_block_the_rest(self):
        bad = self._sale('b2', 2)
        bad['payload']['payments'] = [{'method': 'cash', 'amount': 5.0}]     # underpaid -> rejected
        res = self.sync.flush([self._sale('b1', 1), bad, self._sale('b3', 3)])
        self.assertEqual([r['status'] for r in res['results']], ['ok', 'error', 'ok'])
        self.assertEqual(res['results'][1]['error']['code'], 'rejected')
        self.assertEqual(self.qty_at(self.beer, self.counter), 18)
        # replaying the rejected mutation returns the stored rejection, not a retry
        again = self.sync.flush([bad])
        self.assertEqual(again['results'][0]['status'], 'duplicate')
        self.assertEqual(again['results'][0]['applied_status'], 'error')

    def test_09_devices_have_independent_sequences(self):
        res = self.sync.flush([self._sale('d1', 1, device='dev-A'), self._sale('d2', 1, device='dev-B')])
        self.assertEqual([r['status'] for r in res['results']], ['ok', 'ok'])

    def test_10_oversell_from_two_offline_registers_is_accepted_and_flagged(self):
        scarce = self.make_product('Last Bottle', cost=100.0, price=200.0, uom_xmlid='orsquare.uom_shop_650ml')
        self.stock_in(scarce, 1, self.counter)

        def sale(mid, device):
            return {'id': mid, 'device_id': device, 'device_seq': 1, 'kind': 'sale',
                    'created_at': fields.Datetime.now().isoformat(),
                    'payload': {'lines': [{'product_id': scarce.id, 'qty': 1}],
                                'payments': [{'method': 'cash', 'amount': 200.0}]}}
        res = self.sync.flush([sale('r1', 'reg-1'), sale('r2', 'reg-2')])
        self.assertEqual([r['status'] for r in res['results']], ['ok', 'ok'], "both checkouts stand")
        self.assertFalse(res['results'][0]['result']['flagged'])
        self.assertTrue(res['results'][1]['result']['flagged'])
        self.assertEqual(self.qty_at(scarce, self.counter), -1, "physical reality, surfaced for reconciliation")
        disc = self.env['orsquare.stock_discrepancy'].search([('product_id', '=', scarce.id)])
        self.assertEqual(len(disc), 1)

    def test_11_non_offline_kinds_are_refused(self):
        m = {'id': 'x1', 'device_id': 'dev-A', 'device_seq': 1, 'kind': 'seal_day', 'payload': {}}
        res = self.sync.flush([m])
        self.assertEqual(res['results'][0]['status'], 'error')
        self.assertEqual(res['results'][0]['error']['code'], 'not_allowed_offline')

    def test_12_other_offline_kinds_transfer_open_bottle_cash_khata(self):
        whisky = self.make_product('Sync Whisky 750ml', cost=1500.0, price=2000.0, uom_xmlid='orsquare.uom_shop_750ml')
        self.stock_in(whisky, 5, self.godown)
        cust = self.env['res.partner'].create({'name': 'Sync Payer', 'customer_rank': 1})
        batch = [
            {'id': 'k1', 'device_id': 'dev-K', 'device_seq': 1, 'kind': 'stock_transfer',
             'payload': {'direction': 'godown_to_counter', 'quantities': {str(whisky.id): 3}}},
            {'id': 'k2', 'device_id': 'dev-K', 'device_seq': 2, 'kind': 'open_bottle',
             'payload': {'product_id': whisky.id}},
            {'id': 'k3', 'device_id': 'dev-K', 'device_seq': 3, 'kind': 'cash_entry',
             'payload': {'kind': 'expense', 'amount': 50.0, 'description': 'Offline tea'}},
            {'id': 'k4', 'device_id': 'dev-K', 'device_seq': 4, 'kind': 'khata_receipt',
             'payload': {'partner_id': cust.id, 'amount': 100.0}},
        ]
        res = self.sync.flush(batch)
        self.assertEqual([r['status'] for r in res['results']], ['ok'] * 4, res)
        self.assertEqual(self.qty_at(whisky, self.godown), 2)
        self.assertEqual(res['results'][1]['result']['label'], 'SW #01')

    def test_13_unknown_user_rights_are_enforced_in_flush(self):
        nobody = self.env['res.users'].create({'name': 'Nobody', 'login': 'nobody_sync',
                                               'groups_id': [(6, 0, [self.env.ref('base.group_user').id])]})
        with self.assertRaises(Exception):
            self.sync.with_user(nobody).flush([self._sale('n1', 1)])
