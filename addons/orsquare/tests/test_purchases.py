# -*- coding: utf-8 -*-
from datetime import timedelta

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import OrsquareCase


@tagged('post_install', '-at_install', 'orsquare')
class TestPurchases(OrsquareCase):
    """Advanced + simple supplier bills, native landed costs, TCS, round-off, returns, exchanges."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.boot = cls.env['orsquare.shop.bootstrap']
        cls.purchases = cls.env['orsquare.purchase.service']
        unit = cls.env.ref('uom.product_uom_categ_unit')
        cls.case24 = cls.env['uom.uom'].create({'name': 'Case of 24', 'category_id': unit.id,
                                                'uom_type': 'bigger', 'factor_inv': 24.0})
        cls.case12 = cls.env['uom.uom'].create({'name': 'Case of 12', 'category_id': unit.id,
                                                'uom_type': 'bigger', 'factor_inv': 12.0})
        cls.supplier = cls.env['res.partner'].create({'name': 'Anand Wines', 'supplier_rank': 1})
        cls.can = cls.make_product('Tuborg Strong 330ml Can', cost=1.0, price=125.0, uom_po_id=cls.case24.id)
        cls.can.uom_po_id = cls.case24
        cls.btl = cls.make_product('Tuborg Strong 650ml', cost=1.0, price=200.0)
        cls.btl.uom_po_id = cls.case12
        cls.payable = cls.env['account.account'].search([('account_type', '=', 'liability_payable')], limit=1)

    # ---- the real Anand Wines invoice (docs/advanced-billing-spec.md section 2) -------------
    def _anand_payload(self, **over):
        payload = {
            'client_ref': self.ref(), 'supplier_id': self.supplier.id, 'advanced': True,
            'supplier_invoice_no': 'BEER--7845', 'tp_no': '10651', 'tp_date': '2026-07-22',
            'lines': [
                {'product_id': self.can.id, 'qty': 5, 'uom_id': self.case24.id, 'amount': 13852.00},
                {'product_id': self.btl.id, 'qty': 25, 'uom_id': self.case12.id, 'amount': 55408.00},
            ],
            'adjustments': [
                {'type': 'discount', 'description': 'Trade D- on Carlsberg', 'amount': 1050.0},
                {'type': 'discount', 'description': 'Trade Dis. on CIPL Product', 'amount': 1100.0},
                {'type': 'expense', 'description': 'Add Stamp & Handling', 'amount': 15.0},
            ],
            'tcs': {'rate': 2.0, 'amount': 1342.0},   # printed TCS (calculated would be 1,342.50)
            'stated_total': 68467.0,
        }
        payload.update(over)
        return payload

    def _acct_balance(self, code, bill):
        lines = bill.line_ids.filtered(lambda l: l.account_id.code == code)
        return round(sum(lines.mapped('balance')), 2)

    def test_01_anand_wines_invoice_reproduced_exactly(self):
        res = self.purchases.record_bill(self._anand_payload())
        bill = self.env['account.move'].browse(res['bill_id'])
        self.assertEqual(bill.state, 'posted')
        self.assertEqual(bill.amount_total, 68467.0, "Net payable equals the supplier's printed total")
        self.assertEqual(bill.partner_id, self.supplier)
        self.assertEqual(bill.ref, 'BEER--7845')
        self.assertEqual(bill.orsquare_tp_no, '10651')
        # goods landed in the Godown in pieces (5 x 24 cans, 25 x 12 bottles)
        self.assertEqual(self.qty_at(self.can, self.godown), 120)
        self.assertEqual(self.qty_at(self.btl, self.godown), 300)
        # inventory = goods 69,260 - discounts 2,150 + handling 15 = 67,125 (Odoo landed cost did the allocation)
        value = self.svl_value(self.can) + self.svl_value(self.btl)
        self.assertEqual(round(value, 2), 67125.0)
        self.assertEqual(res['landed_cost'] and True, True)
        # TCS is an asset, not stock cost
        self.assertEqual(self._acct_balance('100904', bill), 1342.0)
        # legal payable is NEVER averaged: exactly the invoice total
        self.assertEqual(self._acct_balance(self.payable.code, bill), -68467.0)
        # allocation by value: cans are 20% of the goods
        self.assertAlmostEqual(self.svl_value(self.can) / value, 13852.0 / 69260.0, places=3)

    def test_02_replay_is_idempotent(self):
        payload = self._anand_payload(client_ref='PUR-IDEMP')
        first = self.purchases.record_bill(payload)
        second = self.purchases.record_bill(payload)
        self.assertTrue(second['duplicate'])
        self.assertEqual(first['bill_id'], second['bill_id'])
        self.assertEqual(self.qty_at(self.can, self.godown), 120)

    def test_03_discounts_off_in_cost_policy_book_to_income(self):
        self.company.orsquare_cost_include_discounts = False
        res = self.purchases.record_bill(self._anand_payload())
        bill = self.env['account.move'].browse(res['bill_id'])
        self.assertEqual(bill.amount_total, 68467.0)
        value = self.svl_value(self.can) + self.svl_value(self.btl)
        self.assertEqual(round(value, 2), 69260.0 + 15.0, "stock stays at gross; discounts do not lower cost")
        self.assertEqual(self._acct_balance('400001', bill), -2150.0, "Discount Received income")

    def test_04_expenses_off_in_cost_policy_book_to_pl(self):
        self.company.orsquare_cost_include_expenses = False
        res = self.purchases.record_bill(self._anand_payload())
        bill = self.env['account.move'].browse(res['bill_id'])
        value = self.svl_value(self.can) + self.svl_value(self.btl)
        self.assertEqual(round(value, 2), 69260.0 - 2150.0)
        self.assertEqual(self._acct_balance('210703', bill), 15.0, "Freight & handling expense")

    def test_05_per_adjustment_override_beats_policy(self):
        payload = self._anand_payload()
        payload['adjustments'][2]['capitalize'] = False       # expense this one handling charge
        res = self.purchases.record_bill(payload)
        bill = self.env['account.move'].browse(res['bill_id'])
        self.assertEqual(self._acct_balance('210703', bill), 15.0)

    def test_06_tcs_override_vs_calculated_penny_roundoff(self):
        """Auto TCS 2% = 1,342.50; supplier printed 68,467 -> 50 paise to Round-off, total matches."""
        payload = self._anand_payload()
        payload['tcs'] = {'rate': 2.0}                       # no override -> calculated 1,342.50
        res = self.purchases.record_bill(payload)
        bill = self.env['account.move'].browse(res['bill_id'])
        self.assertEqual(bill.orsquare_tcs_calculated, 1342.5)
        self.assertEqual(bill.amount_total, 68467.0)
        self.assertEqual(self._acct_balance('213202', bill), -0.5, "50p lands on Round off Income")

    def test_07_difference_beyond_tolerance_is_refused(self):
        payload = self._anand_payload(stated_total=68500.0)
        with self.assertRaisesRegex(UserError, "round-off tolerance"):
            self.purchases.record_bill(payload)

    def test_08_back_dated_purchase_into_sealed_day_rejected(self):
        self.day.action_seal(1000.0)
        with self.assertRaisesRegex(UserError, "sealed"):
            self.purchases.record_bill(self._anand_payload(
                bill_date=str(self.company.orsquare_current_business_date())))

    def test_09_simple_bill_with_gst_input_credit(self):
        tax = self.env['account.tax'].search([('name', '=', '5% GST'), ('type_tax_use', '=', 'purchase'),
                                              ('company_id', '=', self.company.id)], limit=1)
        snack = self.make_product('Peanuts Pack', cost=1.0, price=30.0, supplier_taxes_id=[(6, 0, tax.ids)])
        res = self.purchases.record_bill({
            'client_ref': self.ref(), 'supplier_id': self.supplier.id,
            'lines': [{'product_id': snack.id, 'qty': 100, 'rate': 20.0}]})
        bill = self.env['account.move'].browse(res['bill_id'])
        self.assertEqual(bill.amount_untaxed, 2000.0)
        self.assertEqual(bill.amount_tax, 100.0)
        self.assertEqual(self.svl_value(snack), 2000.0, "GST input credit is not stock cost")
        self.assertEqual(self.qty_at(snack, self.godown), 100)

    def test_10_composition_shop_capitalises_tax_into_cost(self):
        self.company.orsquare_cost_include_taxes = True
        tax = self.env['account.tax'].search([('name', '=', '5% GST'), ('type_tax_use', '=', 'purchase'),
                                              ('company_id', '=', self.company.id)], limit=1)
        snack = self.make_product('Cashew Pack', cost=1.0, price=30.0, supplier_taxes_id=[(6, 0, tax.ids)])
        res = self.purchases.record_bill({
            'client_ref': self.ref(), 'supplier_id': self.supplier.id,
            'lines': [{'product_id': snack.id, 'qty': 100, 'rate': 20.0}]})
        bill = self.env['account.move'].browse(res['bill_id'])
        self.assertEqual(bill.amount_tax, 0.0)
        self.assertEqual(self.svl_value(snack), 2100.0, "tax is part of the cost for a composition shop")

    def test_11_reverse_rate_entry_hits_exact_line_total(self):
        """Total 15,000.33 for 100 pieces -> rate 150.0033 -> line total exactly 15,000.33."""
        p = self.make_product('Reverse Rate Item')
        res = self.purchases.record_bill({
            'client_ref': self.ref(), 'supplier_id': self.supplier.id,
            'lines': [{'product_id': p.id, 'qty': 100, 'amount': 15000.33}]})
        bill = self.env['account.move'].browse(res['bill_id'])
        self.assertEqual(bill.amount_untaxed, 15000.33)

    def test_12_item_discounts_percent_and_fixed(self):
        p1 = self.make_product('Disc Pct Item')
        p2 = self.make_product('Disc Fixed Item')
        res = self.purchases.record_bill({
            'client_ref': self.ref(), 'supplier_id': self.supplier.id,
            'lines': [{'product_id': p1.id, 'qty': 10, 'rate': 100.0, 'discount_pct': 5.0},
                      {'product_id': p2.id, 'qty': 10, 'rate': 100.0, 'discount_amount': 50.0}]})
        bill = self.env['account.move'].browse(res['bill_id'])
        self.assertEqual(bill.amount_untaxed, 950.0 + 950.0)

    def test_13_payment_at_bill_time_moves_drawer_cash(self):
        p = self.make_product('Cash Paid Item')
        before = self.day.live_expected_cash()
        res = self.purchases.record_bill({
            'client_ref': self.ref(), 'supplier_id': self.supplier.id,
            'lines': [{'product_id': p.id, 'qty': 5, 'rate': 100.0}],
            'payments': [{'method': 'cash', 'amount': 200.0}]})
        bill = self.env['account.move'].browse(res['bill_id'])
        self.assertEqual(bill.amount_residual, 300.0)
        self.assertEqual(bill.payment_state, 'partial')
        self.assertEqual(self.day.live_expected_cash(), before - 200.0)

    def test_14_preview_matches_recorded_total(self):
        prev = self.purchases.preview_bill(self._anand_payload())
        self.assertEqual(prev['gross'], 69260.0)
        self.assertEqual(prev['tcs_calculated'], 1342.5)

    def test_15_return_to_supplier_credit_note_and_stock(self):
        res = self.purchases.record_bill(self._anand_payload())
        ret = self.purchases.return_to_supplier({
            'bill_id': res['bill_id'], 'lines': [{'product_id': self.can.id, 'qty': 24}]})   # 1 case of cans
        self.assertEqual(self.qty_at(self.can, self.godown), 96)
        credit = self.env['account.move'].browse(ret['credit_note_id'])
        self.assertEqual(credit.move_type, 'in_refund')
        self.assertEqual(credit.state, 'posted')
        self.assertEqual(credit.reversed_entry_id.id, res['bill_id'])
        self.assertGreater(credit.amount_total, 0)
        # the supplier ledger moved by exactly the credit note
        supplier_balance = sum(self.env['account.move.line'].search([
            ('partner_id', '=', self.supplier.id), ('account_id.account_type', '=', 'liability_payable'),
            ('parent_state', '=', 'posted')]).mapped('balance'))
        self.assertEqual(round(supplier_balance, 2), round(-68467.0 + credit.amount_total, 2))

    def test_16_exchange_pairs_credit_note_with_new_bill_and_nets_ledger(self):
        res = self.purchases.record_bill(self._anand_payload())
        replacement = self.make_product('Replacement Can', cost=1.0, price=130.0)
        out = self.purchases.return_to_supplier({
            'bill_id': res['bill_id'], 'lines': [{'product_id': self.can.id, 'qty': 24}],
            'exchange': {'supplier_id': self.supplier.id,
                         'lines': [{'product_id': replacement.id, 'qty': 24, 'rate': 100.0}]}})
        credit = self.env['account.move'].browse(out['credit_note_id'])
        new_bill = self.env['account.move'].browse(out['replacement_bill_id'])
        self.assertEqual(credit.move_type, 'in_refund')
        self.assertEqual(new_bill.move_type, 'in_invoice')
        self.assertEqual(self.qty_at(replacement, self.godown), 24)
        self.assertEqual(round(out['net_payable_change'], 2), round(new_bill.amount_total - credit.amount_total, 2))
        # the two documents were reconciled against each other on the payable account
        self.assertTrue(credit.payment_state in ('paid', 'in_payment', 'partial') or new_bill.payment_state in ('paid', 'in_payment', 'partial'))
