# -*- coding: utf-8 -*-
from datetime import datetime, timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import OrsquareCase
from ..models.business_date import business_date_for


@tagged('post_install', '-at_install', 'orsquare')
class TestBusinessDate(OrsquareCase):

    def test_cutoff_attribution(self):
        # 2026-10-06 20:30 UTC == 2026-10-07 02:00 IST: exactly at the cutoff -> new business day.
        self.assertEqual(str(business_date_for(datetime(2026, 10, 6, 20, 30), 'Asia/Kolkata', 2.0)), '2026-10-07')
        # 01:59:59 IST on the 7th (20:29:59 UTC on the 6th) still belongs to the 6th.
        self.assertEqual(str(business_date_for(datetime(2026, 10, 6, 20, 29, 59), 'Asia/Kolkata', 2.0)), '2026-10-06')
        # 01:30 IST belongs to the previous day.
        self.assertEqual(str(business_date_for(datetime(2026, 10, 6, 20, 0), 'Asia/Kolkata', 2.0)), '2026-10-06')
        # Midday is plain same-day.
        self.assertEqual(str(business_date_for(datetime(2026, 10, 7, 6, 30), 'Asia/Kolkata', 2.0)), '2026-10-07')

    def test_cutoff_zero_is_midnight(self):
        self.assertEqual(str(business_date_for(datetime(2026, 10, 6, 18, 31), 'Asia/Kolkata', 0.0)), '2026-10-07')

    def test_documents_get_business_date_and_it_is_immutable(self):
        product = self.make_product('BD Product')
        picking = self.stock_in(product, 1).move_ids if False else None
        move = self.env['account.move'].create({'move_type': 'entry'})
        self.assertEqual(move.orsquare_business_date, self.company.orsquare_current_business_date())
        with self.assertRaises(UserError):
            move.orsquare_business_date = fields.Date.today() - timedelta(days=30)

    def test_event_datetime_context_drives_date(self):
        past = datetime(2026, 10, 6, 20, 0)  # 01:30 IST on the 7th -> business date the 6th
        move = self.env['account.move'].with_context(orsquare_event_dt=past, orsquare_allow_sealed=True).create({'move_type': 'entry'})
        self.assertEqual(str(move.orsquare_business_date), '2026-10-06')

    def test_calendar_day_bounds(self):
        start, end = self.company.orsquare_business_day_bounds(datetime(2026, 10, 7).date())
        self.assertEqual(start, datetime(2026, 10, 6, 20, 30))  # 02:00 IST
        self.assertEqual(end - start, timedelta(days=1))


@tagged('post_install', '-at_install', 'orsquare')
class TestSales(OrsquareCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.whisky = cls.make_product('Sale Whisky 750ml', cost=1000.0, price=1500.0, uom_xmlid='orsquare.uom_shop_750ml')
        cls.stock_in(cls.whisky, 10, cls.counter)
        cls.stock_in(cls.whisky, 20, cls.godown)

    def test_01_cash_sale_posts_native_documents(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 2}])
        order = self.env['pos.order'].browse(res['order_id'])
        self.assertEqual(order.state, 'paid')
        self.assertEqual(res['total'], 3000.0)
        self.assertEqual(self.qty_at(self.whisky, self.counter), 8)
        self.assertEqual(self.qty_at(self.whisky, self.godown), 20, "Godown untouched")
        self.assertEqual(order.picking_ids.location_id, self.counter)
        self.assertEqual(order.picking_ids.state, 'done')
        self.assertEqual(order.orsquare_business_date, self.company.orsquare_current_business_date())
        # COGS comes from Odoo's AVCO valuation layer, not from ORSquare.
        svl = self.env['stock.valuation.layer'].search([('stock_move_id', 'in', order.picking_ids.move_ids.ids)])
        self.assertEqual(sum(svl.mapped('value')), -2000.0)

    def test_02_replay_is_idempotent(self):
        payload = {'client_ref': 'IDEMP-1', 'lines': [{'product_id': self.whisky.id, 'qty': 1}],
                   'payments': [{'method': 'cash', 'amount': 1500.0}]}
        first = self.sales.settle(payload)
        second = self.sales.settle(payload)
        self.assertFalse(first['duplicate'])
        self.assertTrue(second['duplicate'])
        self.assertEqual(first['order_id'], second['order_id'])
        self.assertEqual(self.qty_at(self.whisky, self.counter), 9, "Stock deducted exactly once")

    def test_03_counter_short_blocks_when_auto_godown_off(self):
        with self.assertRaisesRegex(UserError, "Insufficient Counter stock"):
            self.sell([{'product_id': self.whisky.id, 'qty': 11}])
        self.assertEqual(self.qty_at(self.whisky, self.counter), 10)

    def test_04_auto_godown_pulls_in_same_transaction(self):
        self.company.orsquare_auto_godown_transfer = True
        res = self.sell([{'product_id': self.whisky.id, 'qty': 13}])
        self.assertTrue(res['auto_godown_transfer'])
        self.assertEqual(self.qty_at(self.whisky, self.counter), 0)
        self.assertEqual(self.qty_at(self.whisky, self.godown), 17)
        transfer = self.env['stock.picking'].search([('name', '=', res['auto_godown_transfer'])])
        self.assertIn('Auto-Godown Transfer for Sale', transfer.origin)

    def test_05_both_short_rolls_back_everything(self):
        self.company.orsquare_auto_godown_transfer = True
        orders_before = self.env['pos.order'].search_count([])
        with self.assertRaisesRegex(UserError, "Insufficient Stock in Godown"):
            self.sell([{'product_id': self.whisky.id, 'qty': 40}])
        self.assertEqual(self.env['pos.order'].search_count([]), orders_before)
        self.assertEqual(self.qty_at(self.whisky, self.godown), 20, "Auto-transfer rolled back with the sale")

    def test_06_kitchen_dish_has_infinite_stock_and_no_delivery(self):
        dish = self.env['product.product'].create({
            'name': 'Paneer Tikka', 'is_kitchen': True, 'list_price': 200.0, 'available_in_pos': True,
            'taxes_id': [(6, 0, [])]})
        self.assertFalse(dish.is_storable)
        res = self.sell([{'product_id': dish.id, 'qty': 50}])
        self.assertEqual(res['pickings'], [])
        self.assertEqual(res['total'], 10000.0)

    def test_07_underpayment_and_bad_tender_rejected(self):
        with self.assertRaisesRegex(UserError, "not fully paid"):
            self.sell([{'product_id': self.whisky.id, 'qty': 1}], payments=[{'method': 'cash', 'amount': 1000.0}])
        with self.assertRaisesRegex(UserError, "Unknown payment"):
            self.sell([{'product_id': self.whisky.id, 'qty': 1}], payments=[{'method': 'bitcoin', 'amount': 1500.0}])

    def test_08_cash_change_records_net_cash_only(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}], payments=[{'method': 'cash', 'amount': 2000.0}])
        order = self.env['pos.order'].browse(res['order_id'])
        self.assertEqual(res['change'], 500.0)
        self.assertEqual(sum(order.payment_ids.mapped('amount')), 1500.0)

    def test_09_split_cash_upi(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}],
                        payments=[{'method': 'cash', 'amount': 500.0}, {'method': 'upi', 'amount': 1000.0}])
        order = self.env['pos.order'].browse(res['order_id'])
        by = {p.payment_method_id.orsquare_key: p.amount for p in order.payment_ids}
        self.assertEqual(by, {'cash': 500.0, 'upi': 1000.0})

    def test_10_khata_requires_customer(self):
        with self.assertRaisesRegex(UserError, "Khata"):
            self.sell([{'product_id': self.whisky.id, 'qty': 1}], payments=[{'method': 'khata', 'amount': 1500.0}])
        cust = self.env['res.partner'].create({'name': 'Ramesh'})
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}],
                        payments=[{'method': 'khata', 'amount': 1500.0}], partner_id=cust.id)
        self.assertEqual(res['total'], 1500.0)

    def test_11_trade_discount_is_pre_tax_and_prorated(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 2}],
                        payments=[{'method': 'cash', 'amount': 2700.0}],
                        bill_discount={'kind': 'amount', 'value': 300.0})
        self.assertEqual(res['total'], 2700.0)

    def test_12_settlement_concession_keeps_tax_value(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}],
                        payments=[{'method': 'cash', 'amount': 1400.0}], settlement_concession=100.0)
        order = self.env['pos.order'].browse(res['order_id'])
        self.assertEqual(order.amount_total, 1500.0, "Legal bill value unchanged")
        self.assertEqual(order.orsquare_concession, 100.0)

    def test_13_offline_oversell_is_accepted_and_flagged(self):
        self.company.orsquare_auto_godown_transfer = True
        res = self.sales.settle({
            'client_ref': 'OFF-1', 'offline': True, 'created_at': fields.Datetime.now().isoformat(),
            'lines': [{'product_id': self.whisky.id, 'qty': 40}],
            'payments': [{'method': 'cash', 'amount': 60000.0}]})
        self.assertTrue(res['flagged'])
        disc = self.env['orsquare.stock_discrepancy'].search([('pos_order_id', '=', res['order_id'])])
        self.assertEqual(disc.qty_short, 10)
        self.assertEqual(disc.state, 'open')

    def test_14_sealed_day_rejects_dated_sale_but_live_sale_rolls_forward(self):
        today = self.company.orsquare_current_business_date()
        self.day.action_seal(self.day.live_expected_cash())
        # An offline bill dated inside the sealed day is rejected...
        with self.assertRaisesRegex(UserError, "sealed"):
            self.sales.settle({'client_ref': 'OFF-SEALED', 'offline': True,
                               'created_at': fields.Datetime.now().isoformat(),
                               'lines': [{'product_id': self.whisky.id, 'qty': 1}],
                               'payments': [{'method': 'cash', 'amount': 1500.0}]})
        # ...but trading that continues live after an early seal goes to the next business day.
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}])
        self.assertTrue(res['rolled_forward'])
        self.assertEqual(res['business_date'], str(today + timedelta(days=1)))

    def test_16_gst_tax_computed_server_side(self):
        tax = self.env['account.tax'].search([('name', '=', '5% GST S'), ('company_id', '=', self.company.id)], limit=1)
        snack = self.make_product('Chips', cost=10.0, price=100.0, taxes_id=[(6, 0, tax.ids)])
        self.stock_in(snack, 5, self.counter)
        res = self.sell([{'product_id': snack.id, 'qty': 2}], payments=[{'method': 'cash', 'amount': 210.0}])
        self.assertEqual(res['total'], 210.0)
        self.assertEqual(res['tax'], 10.0)

    def test_17_b2b_invoice_generated(self):
        cust = self.env['res.partner'].create({'name': 'Hotel Pooja', 'vat': '27AAAAA0000A1Z5'})
        res = self.sell([{'product_id': self.whisky.id, 'qty': 3}], partner_id=cust.id, to_invoice=True)
        self.assertTrue(res['invoice_id'])
        inv = self.env['account.move'].browse(res['invoice_id'])
        self.assertEqual(inv.state, 'posted')
        self.assertEqual(inv.amount_total, 4500.0)

    def test_17b_missing_shop_address_gives_actionable_error_not_a_crash(self):
        self.company.partner_id.state_id = False
        cust = self.env['res.partner'].create({'name': 'Hotel NoAddr'})
        with self.assertRaisesRegex(UserError, "Business details"):
            self.sell([{'product_id': self.whisky.id, 'qty': 1}], partner_id=cust.id, to_invoice=True)

    def test_18_events_are_published_in_order(self):
        seq0 = self.env['orsquare.event'].latest_seq(self.company)
        self.sell([{'product_id': self.whisky.id, 'qty': 1}])
        events = self.env['orsquare.event'].since(self.company, seq0)
        self.assertEqual([e['type'] for e in events][-1], 'sale_settled')
        self.assertTrue(all(b['seq'] > a['seq'] for a, b in zip(events, events[1:])))


@tagged('post_install', '-at_install', 'orsquare')
class TestAutoOpenDay(OrsquareCase):
    open_day_on_setup = False

    def test_first_sale_auto_opens_day(self):
        product = self.make_product('Auto Day Item', cost=10.0, price=20.0)
        self.stock_in(product, 5, self.counter)
        res = self.sell([{'product_id': product.id, 'qty': 1}])
        day = self.Day.search([('date', '=', res['business_date'])])
        self.assertTrue(day.auto_opened)
        self.assertEqual(day.state, 'open')
        self.assertEqual(day.opening_float, 0.0)

    def test_stale_open_day_blocks_opening_a_new_one(self):
        from datetime import timedelta
        stale = self.Day.open_day(0.0, date=self.company.orsquare_current_business_date() - timedelta(days=2))
        self.assertEqual(stale.state, 'open')
        with self.assertRaisesRegex(Exception, "still open"):
            self.Day.open_day(0.0)


@tagged('post_install', '-at_install', 'orsquare')
class TestQuote(OrsquareCase):
    """The counter's live numbers come from ``sales.quote`` - it must agree with ``settle`` to the paisa."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.whisky = cls.make_product('Quote Whisky 750ml', cost=1000.0, price=1500.0, uom_xmlid='orsquare.uom_shop_750ml')
        cls.stock_in(cls.whisky, 30, cls.counter)

    def test_quote_matches_settle_and_writes_nothing(self):
        lines = [{'product_id': self.whisky.id, 'qty': 3}]
        before = self.env['pos.order'].search_count([])
        for discount in (None, {'kind': 'percent', 'value': 7.5}, {'kind': 'amount', 'value': 123.45}):
            payload = {'lines': lines, 'bill_discount': discount}
            quote = self.sales.quote(payload)
            self.assertEqual(self.env['pos.order'].search_count([]), before, "A quote creates no order")
            res = self.sales.settle(dict(payload, client_ref='Q-%s' % (discount or {}).get('value', 0),
                                         payments=[{'method': 'cash', 'amount': quote['total']}]))
            self.assertEqual(quote['total'], res['total'])
            self.assertEqual(quote['tax'], res['tax'])
            before += 1

    def test_quote_needs_cashier_role(self):
        keeper = self.env['res.users'].create({
            'name': 'Keeper', 'login': 'keeper_q', 'password': 'KeeperPass#123',
            'groups_id': [(6, 0, [self.env.ref('orsquare.group_orsquare_stockkeeper').id,
                                  self.env.ref('base.group_user').id])]})
        with self.assertRaises(AccessError):
            self.sales.with_user(keeper).quote({'lines': [{'product_id': self.whisky.id, 'qty': 1}]})
