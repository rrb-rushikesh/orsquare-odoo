# -*- coding: utf-8 -*-
from datetime import timedelta

from odoo import fields

from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import OrsquareCase


@tagged('post_install', '-at_install', 'orsquare')
class TestDaybook(OrsquareCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.item = cls.make_product('Daybook Beer 650ml', cost=100.0, price=200.0, uom_xmlid='orsquare.uom_shop_650ml')
        cls.stock_in(cls.item, 100, cls.counter)

    def _move_lines(self, move):
        return {(l.account_id.code, round(l.debit, 2), round(l.credit, 2)) for l in move.line_ids}

    def test_01_expected_cash_formula(self):
        self.assertEqual(self.day.live_expected_cash(), 1000.0)
        self.sell([{'product_id': self.item.id, 'qty': 3}])                      # 600 cash
        self.sell([{'product_id': self.item.id, 'qty': 1}], payments=[{'method': 'upi', 'amount': 200.0}])
        self.assertEqual(self.day.live_expected_cash(), 1600.0, "UPI never enters the drawer")

    def test_02_petty_cash_out_reduces_expected(self):
        self.sell([{'product_id': self.item.id, 'qty': 1}])
        self.day.session_id.try_cash_in_out('out', 50.0, 'tea', {'translatedType': 'out'})
        self.assertEqual(self.day.live_expected_cash(), 1150.0)

    def test_03_external_cash_receipts_and_payments_count(self):
        """Khata cash receipt (+) and supplier cash payment (-) outside POS move the drawer."""
        cust = self.env['res.partner'].create({'name': 'Payer'})
        cash_journal = self.day.session_id.cash_journal_id
        method = self.env['account.payment.method.line'].search([
            ('journal_id', '=', cash_journal.id), ('payment_type', '=', 'inbound')], limit=1)
        pay = self.env['account.payment'].create({
            'payment_type': 'inbound', 'partner_type': 'customer', 'partner_id': cust.id,
            'amount': 300.0, 'journal_id': cash_journal.id, 'payment_method_line_id': method.id})
        pay.action_post()
        self.assertEqual(self.day.live_expected_cash(), 1300.0)

    def test_04_seal_freezes_snapshot_and_blocks_new_sales(self):
        self.sell([{'product_id': self.item.id, 'qty': 2}])                      # 400
        self.sell([{'product_id': self.item.id, 'qty': 1}], payments=[{'method': 'upi', 'amount': 200.0}])
        self.day.action_seal(1400.0)
        self.assertEqual(self.day.state, 'sealed')
        snap = self.day.snapshot
        self.assertEqual(snap['gross_sales'], 600.0)
        self.assertEqual(snap['cash_sales'], 400.0)
        self.assertEqual(snap['upi_sales'], 200.0)
        self.assertEqual(snap['bill_count'], 2)
        self.assertEqual(snap['cogs'], 300.0)
        self.assertEqual(snap['gross_profit'], 300.0)
        self.assertEqual(self.day.cash_variance, 0.0)
        self.assertEqual(self.day.session_id.state, 'closed')
        with self.assertRaises(UserError):
            self.day.write({'counted_cash': 1.0})

    def test_05_variance_within_materiality_closes_without_note(self):
        self.sell([{'product_id': self.item.id, 'qty': 1}])
        self.day.action_seal(1196.0)       # INR 4 short, tolerance 5
        self.assertEqual(self.day.cash_variance, -4.0)

    def test_06_variance_beyond_materiality_needs_reason(self):
        self.sell([{'product_id': self.item.id, 'qty': 1}])
        with self.assertRaisesRegex(UserError, "reason"):
            self.day.action_seal(1100.0)
        self.day.action_seal(1100.0, note="Cashier gave wrong change")
        self.assertEqual(self.day.cash_variance, -100.0)
        # Odoo itself booked the cash difference (we did not touch the ledger).
        diff_lines = self.env['account.move.line'].search([
            ('account_id.code', '=', '999002'), ('move_id.state', '=', 'posted')])
        self.assertEqual(sum(diff_lines.mapped('debit')), 100.0)

    def test_07_session_entry_balances_and_cogs_posted(self):
        self.sell([{'product_id': self.item.id, 'qty': 2}])
        self.day.action_seal(1400.0)
        move = self.day.session_id.move_id
        self.assertTrue(move)
        self.assertEqual(round(sum(move.line_ids.mapped('debit')) - sum(move.line_ids.mapped('credit')), 2), 0.0)
        cogs = move.line_ids.filtered(lambda l: l.account_id.code == '210701')
        self.assertEqual(sum(cogs.mapped('debit')), 200.0)

    def test_08_khata_sale_builds_receivable_on_customer(self):
        cust = self.env['res.partner'].create({'name': 'Khata Customer'})
        self.sell([{'product_id': self.item.id, 'qty': 2}], payments=[{'method': 'khata', 'amount': 400.0}],
                  partner_id=cust.id)
        self.day.action_seal(1000.0)
        cust.invalidate_recordset()
        self.assertEqual(cust.credit, 400.0)

    def test_09_settlement_concession_books_to_cash_settlement_expense(self):
        self.sell([{'product_id': self.item.id, 'qty': 1}], payments=[{'method': 'cash', 'amount': 176.0}],
                  settlement_concession=24.0)
        self.day.action_seal(1176.0)
        move = self.day.session_id.move_id
        loss = move.line_ids.filtered(lambda l: l.account_id.code == '210704')
        self.assertEqual(sum(loss.mapped('debit')), 24.0, "Short-pay lands in Cash Settlement Difference")
        sales = move.line_ids.filtered(lambda l: l.account_id.account_type == 'income')
        self.assertEqual(sum(sales.mapped('credit')), 200.0, "Legal bill value untouched")
        self.assertEqual(self.day.snapshot['concessions'], 24.0)

    def test_10_reaudit_incorporates_later_refund_and_logs(self):
        res = self.sell([{'product_id': self.item.id, 'qty': 2}])
        self.day.action_seal(1400.0)
        order = self.env['pos.order'].browse(res['order_id'])
        # Customer returns one bottle the next business day: the refund belongs to that later day.
        next_day = self.company.orsquare_current_business_date() + timedelta(days=1)
        self.Day.open_day(0.0, date=next_day)
        noon = fields.Datetime.now() + timedelta(days=1)
        refund = order.with_context(orsquare_event_dt=noon).refund()
        refund_order = self.env['pos.order'].browse(refund['res_id'])
        self.assertEqual(refund_order.orsquare_business_date, next_day)
        self.assertEqual(self.day.snapshot['adjustments_total'], 0.0)
        # refund still draft; pay + validate it like a counter return
        cash = self.env['orsquare.shop.bootstrap'].payment_method('cash')
        refund_order.add_payment({'pos_order_id': refund_order.id, 'amount': refund_order.amount_total,
                                  'payment_method_id': cash.id, 'name': 'refund'})
        refund_order.action_pos_order_paid()
        self.day.action_reaudit("Customer returned stock")
        self.assertEqual(self.day.state, 're_audited')
        log = self.day.audit_log_ids
        self.assertEqual(len(log), 1)
        self.assertEqual(log.previous_snapshot['adjustments_total'], 0.0)
        self.assertEqual(log.reason, "Customer returned stock")
        self.assertEqual(self.day.snapshot['gross_sales'], 400.0, "History is not rewritten")
        self.assertEqual(self.day.snapshot['adjustments_total'], -400.0)
        self.assertEqual(self.day.snapshot['adjusted_net_sales'], 0.0)
        with self.assertRaises(UserError):
            log.write({'reason': 'tamper'})
        with self.assertRaises(UserError):
            log.unlink()

    def test_11_reaudit_requires_reason_and_sealed_day(self):
        with self.assertRaises(UserError):
            self.day.action_reaudit("not sealed yet")
        self.day.action_seal(1000.0)
        with self.assertRaises(UserError):
            self.day.action_reaudit("   ")

    def test_12_sealed_day_cannot_be_deleted(self):
        self.day.action_seal(1000.0)
        with self.assertRaises(UserError):
            self.day.unlink()

    def test_13_summary_open_is_live_sealed_is_frozen(self):
        self.sell([{'product_id': self.item.id, 'qty': 1}])
        live = self.day.summary()
        self.assertEqual(live['figures']['gross_sales'], 200.0)
        self.day.action_seal(1200.0)
        self.sell_after = None
        frozen = self.day.summary()
        self.assertEqual(frozen['figures']['gross_sales'], 200.0)
        self.assertEqual(frozen['state'], 'sealed')
