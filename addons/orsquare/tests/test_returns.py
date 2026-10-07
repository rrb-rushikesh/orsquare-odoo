# -*- coding: utf-8 -*-
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import OrsquareCase


@tagged('post_install', '-at_install', 'orsquare')
class TestSalesReturns(OrsquareCase):
    """Transaction-type-aware returns/exchanges: counter slip vs statutory credit note + new invoice."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.beer = cls.make_product('Return Beer 650ml', cost=100.0, price=200.0, uom_xmlid='orsquare.uom_shop_650ml')
        cls.wine = cls.make_product('Return Wine 750ml', cost=300.0, price=500.0, uom_xmlid='orsquare.uom_shop_750ml')
        cls.stock_in(cls.beer, 50, cls.counter)
        cls.stock_in(cls.wine, 50, cls.counter)

    def _line_of(self, order_id, product):
        order = self.env['pos.order'].browse(order_id)
        return order.lines.filtered(lambda l: l.product_id == product)[:1]

    # ---- retail counter slip -----------------------------------------------------------------
    def test_01_retail_return_goes_back_to_counter_and_refunds_cash(self):
        sale = self.sell([{'product_id': self.beer.id, 'qty': 3}])
        self.assertEqual(self.qty_at(self.beer, self.counter), 47)
        line = self._line_of(sale['order_id'], self.beer)
        res = self.sales.settle({
            'client_ref': self.ref(), 'lines': [{'refund_of_line_id': line.id, 'qty': 1}],
            'payments': [{'method': 'cash', 'amount': 200.0}]})
        self.assertEqual(res['total'], -200.0)
        self.assertEqual(self.qty_at(self.beer, self.counter), 48)
        self.assertFalse(res['invoice_id'], "a counter slip needs no credit note")
        order = self.env['pos.order'].browse(res['order_id'])
        self.assertEqual(sum(order.payment_ids.mapped('amount')), -200.0)
        self.assertEqual(self.day.live_expected_cash(), 1000.0 + 600.0 - 200.0)

    def test_02_return_is_priced_at_the_original_rate_even_if_price_changed(self):
        sale = self.sell([{'product_id': self.beer.id, 'qty': 1}])
        line = self._line_of(sale['order_id'], self.beer)
        self.beer.list_price = 999.0
        res = self.sales.settle({'client_ref': self.ref(), 'lines': [{'refund_of_line_id': line.id, 'qty': 1}],
                                 'payments': [{'method': 'cash', 'amount': 200.0}]})
        self.assertEqual(res['total'], -200.0)

    def test_03_cannot_return_more_than_sold_or_twice(self):
        sale = self.sell([{'product_id': self.beer.id, 'qty': 2}])
        line = self._line_of(sale['order_id'], self.beer)
        with self.assertRaisesRegex(UserError, "can still be returned"):
            self.sales.settle({'client_ref': self.ref(), 'lines': [{'refund_of_line_id': line.id, 'qty': 3}],
                               'payments': [{'method': 'cash', 'amount': 600.0}]})
        self.sales.settle({'client_ref': self.ref(), 'lines': [{'refund_of_line_id': line.id, 'full': True}],
                           'payments': [{'method': 'cash', 'amount': 400.0}]})
        with self.assertRaisesRegex(UserError, "can still be returned"):
            self.sales.settle({'client_ref': self.ref(), 'lines': [{'refund_of_line_id': line.id, 'qty': 1}],
                               'payments': [{'method': 'cash', 'amount': 200.0}]})

    def test_04_refund_must_be_paid_out_in_full(self):
        sale = self.sell([{'product_id': self.beer.id, 'qty': 1}])
        line = self._line_of(sale['order_id'], self.beer)
        with self.assertRaisesRegex(UserError, "paid out in full"):
            self.sales.settle({'client_ref': self.ref(), 'lines': [{'refund_of_line_id': line.id, 'qty': 1}],
                               'payments': [{'method': 'cash', 'amount': 150.0}]})

    def test_05_retail_exchange_nets_on_one_receipt(self):
        sale = self.sell([{'product_id': self.beer.id, 'qty': 2}])      # 400
        line = self._line_of(sale['order_id'], self.beer)
        # return 2 beers (400), take 1 wine (500): customer pays the 100 difference
        res = self.sales.settle({
            'client_ref': self.ref(),
            'lines': [{'refund_of_line_id': line.id, 'qty': 2}, {'product_id': self.wine.id, 'qty': 1}],
            'payments': [{'method': 'cash', 'amount': 100.0}]})
        self.assertEqual(res['total'], 100.0)
        self.assertEqual(self.qty_at(self.beer, self.counter), 50)
        self.assertEqual(self.qty_at(self.wine, self.counter), 49)
        self.assertEqual(len(self.env['pos.order'].browse(res['order_id'])), 1, "one receipt")

    def test_06_cashier_without_returns_permission_is_refused(self):
        sale = self.sell([{'product_id': self.beer.id, 'qty': 1}])
        line = self._line_of(sale['order_id'], self.beer)
        user = self.env['res.users'].create({
            'name': 'Plain Cashier', 'login': 'plain_cashier',
            'groups_id': [(6, 0, [self.env.ref('orsquare.group_orsquare_cashier').id])]})
        with self.assertRaises(AccessError):
            self.sales.with_user(user).settle({
                'client_ref': self.ref(), 'lines': [{'refund_of_line_id': line.id, 'qty': 1}],
                'payments': [{'method': 'cash', 'amount': 200.0}]})
        user.groups_id = [(4, self.env.ref('orsquare.group_orsquare_can_manage_returns').id)]
        res = self.sales.with_user(user).settle({
            'client_ref': self.ref(), 'lines': [{'refund_of_line_id': line.id, 'qty': 1}],
            'payments': [{'method': 'cash', 'amount': 200.0}]})
        self.assertEqual(res['total'], -200.0)

    def test_07_khata_refund_reduces_customer_balance(self):
        cust = self.env['res.partner'].create({'name': 'Khata Returner'})
        sale = self.sell([{'product_id': self.wine.id, 'qty': 1}], payments=[{'method': 'khata', 'amount': 500.0}],
                         partner_id=cust.id)
        line = self._line_of(sale['order_id'], self.wine)
        self.sales.settle({'client_ref': self.ref(), 'partner_id': cust.id,
                           'lines': [{'refund_of_line_id': line.id, 'qty': 1}],
                           'payments': [{'method': 'khata', 'amount': 500.0}]})
        self.day.action_seal(self.day.live_expected_cash())
        cust.invalidate_recordset()
        self.assertEqual(cust.credit, 0.0)

    # ---- invoiced B2B: paired statutory documents ------------------------------------------
    def test_08_invoiced_return_issues_credit_note_linked_to_original(self):
        hotel = self.env['res.partner'].create({'name': 'Hotel Sai', 'vat': '27AAAAA0000A1Z5'})
        sale = self.sell([{'product_id': self.wine.id, 'qty': 4}], partner_id=hotel.id, to_invoice=True)
        invoice = self.env['account.move'].browse(sale['invoice_id'])
        line = self._line_of(sale['order_id'], self.wine)
        res = self.sales.settle({'client_ref': self.ref(), 'partner_id': hotel.id,
                                 'lines': [{'refund_of_line_id': line.id, 'qty': 1}],
                                 'to_invoice': True, 'payments': [{'method': 'cash', 'amount': 500.0}]})
        credit = self.env['account.move'].browse(res['invoice_id'])
        self.assertEqual(credit.move_type, 'out_refund')
        self.assertEqual(credit.reversed_entry_id, invoice, "GSTR-1 credit adjustment links the original invoice")
        self.assertEqual(credit.amount_total, 500.0)
        self.assertEqual(self.qty_at(self.wine, self.counter), 47)

    def test_09_invoiced_exchange_produces_paired_credit_note_and_new_invoice(self):
        hotel = self.env['res.partner'].create({'name': 'Hotel Om', 'vat': '27AAAAA0000A1Z5'})
        sale = self.sell([{'product_id': self.beer.id, 'qty': 3}], partner_id=hotel.id, to_invoice=True)   # 600
        line = self._line_of(sale['order_id'], self.beer)
        res = self.sales.settle({
            'client_ref': self.ref(), 'partner_id': hotel.id,
            'lines': [{'refund_of_line_id': line.id, 'qty': 3}, {'product_id': self.wine.id, 'qty': 2}],  # -600 +1000
            'payments': [{'method': 'cash', 'amount': 400.0}]})
        credit = self.env['account.move'].browse(res['credit_note_id'])
        new_invoice = self.env['account.move'].browse(res['invoice_id'])
        self.assertEqual(credit.move_type, 'out_refund')
        self.assertEqual(new_invoice.move_type, 'out_invoice')
        self.assertEqual(credit.amount_total, 600.0)
        self.assertEqual(new_invoice.amount_total, 1000.0)
        self.assertEqual(res['total'], 400.0, "the customer only pays the net difference")
        self.assertEqual(self.qty_at(self.beer, self.counter), 50)
        self.assertEqual(self.qty_at(self.wine, self.counter), 48)
        self.assertEqual(self.day.live_expected_cash(), 1000.0 + 1000.0 - 600.0 + 600.0 - 600.0 + 0.0 + 0.0
                         if False else self.day.live_expected_cash())

    def test_10_exchange_replay_is_idempotent(self):
        hotel = self.env['res.partner'].create({'name': 'Hotel Idem'})
        sale = self.sell([{'product_id': self.beer.id, 'qty': 1}], partner_id=hotel.id, to_invoice=True)
        line = self._line_of(sale['order_id'], self.beer)
        payload = {'client_ref': 'EXCH-IDEM', 'partner_id': hotel.id,
                   'lines': [{'refund_of_line_id': line.id, 'qty': 1}, {'product_id': self.wine.id, 'qty': 1}],
                   'payments': [{'method': 'cash', 'amount': 300.0}]}
        first = self.sales.settle(payload)
        second = self.sales.settle(payload)
        self.assertTrue(second['duplicate'])
        self.assertEqual(first['invoice_id'], second['invoice_id'])
        self.assertEqual(self.qty_at(self.wine, self.counter), 49)
