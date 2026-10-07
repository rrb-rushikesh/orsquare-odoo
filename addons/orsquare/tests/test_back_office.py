# -*- coding: utf-8 -*-
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import OrsquareCase


class BackOfficeCase(OrsquareCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reports = cls.env['orsquare.stock.reports']
        cls.accounts = cls.env['orsquare.accounts.service']
        cls.cashflow = cls.env['orsquare.cashflow.service']
        cls.rep = cls.env['orsquare.reports.service']
        cls.item = cls.make_product('BO Beer 650ml', cost=100.0, price=200.0, uom_xmlid='orsquare.uom_shop_650ml')

    @classmethod
    def make_user(cls, login, groups):
        return cls.env['res.users'].create({
            'name': login, 'login': login,
            'groups_id': [(6, 0, [cls.env.ref(g).id for g in groups])]})


@tagged('post_install', '-at_install', 'orsquare')
class TestStockReports(BackOfficeCase):

    def test_01_opening_stock_once_per_product(self):
        self.reports.set_opening_stock([{'product_id': self.item.id, 'qty': 24, 'cost': 90.0}], 'godown')
        self.assertEqual(self.qty_at(self.item, self.godown), 24)
        self.assertEqual(self.item.standard_price, 90.0)
        with self.assertRaisesRegex(UserError, "already has stock history"):
            self.reports.set_opening_stock([{'product_id': self.item.id, 'qty': 5}], 'godown')

    def test_02_audited_adjustment_needs_reason_and_is_a_real_move(self):
        self.stock_in(self.item, 10, self.counter)
        with self.assertRaisesRegex(UserError, "reason"):
            self.reports.adjust_stock(self.item.id, 'counter', 8, '')
        self.reports.adjust_stock(self.item.id, 'counter', 8, 'Breakage found at count')
        self.assertEqual(self.qty_at(self.item, self.counter), 8)
        hist = self.reports.movement_history(self.item.id)
        self.assertEqual(hist[0]['kind'], 'adjustment')

    def test_03_position_splits_locations_and_masks_valuation(self):
        self.stock_in(self.item, 30, self.godown, cost=100.0)
        self.stock_in(self.item, 10, self.counter)
        row = self.reports.stock_position([self.item.id])[0]
        self.assertEqual((row['godown'], row['counter'], row['total']), (30, 10, 40))
        self.assertEqual(row['value'], 4000.0)
        cashier = self.make_user('masked_cashier', ['orsquare.group_orsquare_cashier'])
        masked = self.reports.with_user(cashier).stock_position([self.item.id])[0]
        self.assertNotIn('value', masked, "valuation hidden without can_see_valuation")
        self.assertIsNone(self.reports.with_user(cashier).stock_value_by_location())

    def test_04_conservation_total_equals_godown_counter_and_opened(self):
        cap = self.make_product('Cons Whisky 750ml', cost=1500.0, uom_xmlid='orsquare.uom_shop_750ml')
        self.stock_in(cap, 10, self.godown)
        self.stock.manual_transfer(self.wh, 'godown_to_counter', {cap.id: 4})
        bottle = self.Bottle.open_bottle(cap)
        self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 90}, 'price': 170.0}])
        row = self.reports.stock_position([cap.id])[0]
        self.assertEqual(row['godown'], 6)
        self.assertEqual(row['counter'], 3)
        self.assertEqual(row['opened_ml'], 660.0)
        self.assertAlmostEqual(row['total'], 6 + 3 + 660 / 750, places=6)

    def test_05_low_stock_alert(self):
        self.item.product_tmpl_id.orsquare_low_stock_qty = 5
        self.stock_in(self.item, 4, self.counter)
        self.assertTrue(self.reports.stock_position([self.item.id])[0]['low'])
        names = [r['name'] for r in self.reports.needs_attention_stock()]
        self.assertIn(self.item.display_name, names)

    def test_06_history_classifies_moves(self):
        self.stock_in(self.item, 10, self.godown)
        self.stock.manual_transfer(self.wh, 'godown_to_counter', {self.item.id: 3})
        self.sell([{'product_id': self.item.id, 'qty': 1}])
        kinds = [h['kind'] for h in self.reports.movement_history(self.item.id)]
        self.assertEqual(kinds[:3], ['sale', 'transfer', 'adjustment'])

    def test_07_discrepancy_resolution_adjusts_counter(self):
        self.company.orsquare_auto_godown_transfer = False
        self.stock_in(self.item, 1, self.counter)
        res = self.sales.settle({'client_ref': 'DISC-1', 'offline': True,
                                 'lines': [{'product_id': self.item.id, 'qty': 3}],
                                 'payments': [{'method': 'cash', 'amount': 600.0}]})
        disc = self.env['orsquare.stock_discrepancy'].search([('pos_order_id', '=', res['order_id'])])
        self.assertEqual(self.qty_at(self.item, self.counter), -2)
        self.reports.resolve_discrepancy(disc.id, note='recount', counted_qty=0)
        self.assertEqual(disc.state, 'resolved')
        self.assertEqual(self.qty_at(self.item, self.counter), 0)


@tagged('post_install', '-at_install', 'orsquare')
class TestAccounts(BackOfficeCase):

    def test_01_party_creation_and_opening_balances(self):
        cust = self.accounts.create_party('Ramesh Kirana', 'customer', mobile='9999900001', opening_balance=1500.0)
        sup = self.accounts.create_party('Anand Distributors', 'supplier', opening_balance=-4000.0)
        d = self.accounts.directory('all')
        by_id = {r['id']: r for r in d['rows']}
        self.assertEqual(by_id[cust]['receivable'], 1500.0)
        self.assertEqual(by_id[sup]['payable'], 4000.0)
        self.assertEqual((by_id[cust]['balance'], by_id[cust]['side']), (1500.0, 'Dr'))
        self.assertEqual((by_id[sup]['balance'], by_id[sup]['side']), (4000.0, 'Cr'))
        self.assertEqual(by_id[cust]['kind'], 'customer')
        self.assertEqual(self.accounts.directory('suppliers')['rows'][0]['kind'], 'supplier')

    def test_02_khata_receipt_reconciles_oldest_first(self):
        cust = self.env['res.partner'].create({'name': 'Khata Payer', 'customer_rank': 1})
        self.stock_in(self.item, 20, self.counter)
        self.sell([{'product_id': self.item.id, 'qty': 3}], payments=[{'method': 'khata', 'amount': 600.0}], partner_id=cust.id)
        self.day.action_seal(self.day.live_expected_cash())   # Khata receivable posts at session close
        self.assertEqual(self.accounts.directory('customers', search='Khata Payer')['rows'][0]['receivable'], 600.0)
        # the customer pays part of it in cash after the day was sealed -> goes to the next business day
        self.accounts.receive_payment(cust.id, 250.0, 'cash', 'part payment')
        row = self.accounts.directory('customers', search='Khata Payer')['rows'][0]
        self.assertEqual(row['receivable'], 350.0)
        st = self.accounts.statement(cust.id)
        self.assertTrue(all(r['side'] == ('Dr' if r['balance'] > 0 else 'Cr' if r['balance'] < 0 else 'Flat') for r in st['rows']))
        self.assertEqual(st['closing'], 350.0)
        self.assertEqual(st['side'], 'Dr')
        self.assertEqual(st['total_debit'] - st['total_credit'], st['closing'])
        self.assertEqual([r['balance'] for r in st['rows']][-1], 350.0)

    def test_03_cash_receipt_feeds_the_daybook_drawer(self):
        cust = self.env['res.partner'].create({'name': 'Drawer Payer', 'customer_rank': 1})
        before = self.day.live_expected_cash()
        self.accounts.receive_payment(cust.id, 400.0, 'cash')
        self.assertEqual(self.day.live_expected_cash(), before + 400.0)
        self.accounts.receive_payment(cust.id, 100.0, 'upi')
        self.assertEqual(self.day.live_expected_cash(), before + 400.0, "UPI never enters the drawer")

    def test_04_supplier_payment_reduces_payable_and_drawer(self):
        sup = self.accounts.create_party('Cash Supplier', 'supplier', opening_balance=-1000.0)
        before = self.day.live_expected_cash()
        self.accounts.pay_supplier(sup, 300.0, 'cash')
        row = self.accounts.directory('suppliers', search='Cash Supplier')['rows'][0]
        self.assertEqual(row['payable'], 700.0)
        self.assertEqual(self.day.live_expected_cash(), before - 300.0)

    def test_05_employee_advance_recovery_and_wage(self):
        emp = self.accounts.create_party('Sunil Waiter', 'employee')
        self.accounts.employee_voucher(emp, 'advance', 2000.0)
        self.assertEqual(self.accounts.employee_advance_balance(emp), 2000.0)
        self.accounts.employee_voucher(emp, 'recovery', 500.0)
        self.assertEqual(self.accounts.employee_advance_balance(emp), 1500.0)
        self.accounts.employee_voucher(emp, 'wage', 8000.0, 'upi')
        self.assertEqual(self.accounts.employee_advance_balance(emp), 1500.0)
        wage_lines = self.env['account.move.line'].search([('account_id.code', '=', '210100'), ('parent_state', '=', 'posted')])
        self.assertEqual(sum(wage_lines.mapped('debit')), 8000.0)

    def test_06_balances_hidden_without_can_see_money(self):
        cust = self.accounts.create_party('Masked Cust', 'customer', opening_balance=900.0)
        cashier = self.make_user('nomoney', ['orsquare.group_orsquare_cashier'])
        d = self.accounts.with_user(cashier).directory('all', search='Masked Cust')
        self.assertIsNone(d['rows'][0]['receivable'])
        self.assertIsNone(d['rows'][0]['balance'])
        self.assertIsNone(d['rows'][0]['side'])
        with self.assertRaises(AccessError):
            self.accounts.with_user(cashier).statement(cust)

    def test_07_correction_is_a_reversal_not_an_edit(self):
        cust = self.env['res.partner'].create({'name': 'Reversal Cust', 'customer_rank': 1})
        pid = self.accounts.receive_payment(cust.id, 100.0, 'cash')
        payment = self.env['account.payment'].browse(pid)
        self.assertTrue(payment.move_id.state == 'posted')
        with self.assertRaises(UserError):
            payment.move_id.unlink()


@tagged('post_install', '-at_install', 'orsquare')
class TestCashflow(BackOfficeCase):

    def test_01_expense_voucher_reduces_drawer_and_hits_expense_account(self):
        before = self.day.live_expected_cash()
        self.cashflow.new_entry('expense', 120.0, 'cash', 'Tea & cleaning')
        self.assertEqual(self.day.live_expected_cash(), before - 120.0)
        lines = self.env['account.move.line'].search([('account_id.code', '=', '210705'), ('parent_state', '=', 'posted')])
        self.assertEqual(sum(lines.mapped('debit')), 120.0)

    def test_02_income_owner_drawing_and_capital(self):
        before = self.day.live_expected_cash()
        self.cashflow.new_entry('income', 50.0, 'cash', 'Scrap sale')
        self.cashflow.new_entry('owner_drawing', 1000.0, 'cash')
        self.cashflow.new_entry('capital_injection', 3000.0, 'cash')
        self.assertEqual(self.day.live_expected_cash(), before + 50.0 - 1000.0 + 3000.0)

    def test_03_register_has_live_pos_rows_and_running_balance(self):
        self.stock_in(self.item, 10, self.counter)
        self.sell([{'product_id': self.item.id, 'qty': 2}])                     # 400 cash, session still open
        self.cashflow.new_entry('expense', 100.0, 'cash', 'Electricity')
        reg = self.cashflow.register(mode='cash')
        types = [r['type'] for r in reg['rows']]
        self.assertIn('pos_sale', types, "cash sale appears immediately (live), before the day is sealed")
        self.assertEqual(reg['cash_in'] - reg['cash_out'], 400.0 - 100.0)
        self.assertEqual(reg['closing'], reg['rows'][-1]['balance'])
        self.assertEqual(reg['expenses_out'], 100.0)

    def test_04_khata_sale_is_not_cash_in(self):
        cust = self.env['res.partner'].create({'name': 'Credit Cust'})
        self.stock_in(self.item, 10, self.counter)
        self.sell([{'product_id': self.item.id, 'qty': 1}], payments=[{'method': 'khata', 'amount': 200.0}], partner_id=cust.id)
        reg = self.cashflow.register()
        self.assertEqual(reg['cash_in'], 0.0)

    def test_05_cashflow_hidden_without_can_see_money(self):
        cashier = self.make_user('cf_cashier', ['orsquare.group_orsquare_cashier'])
        with self.assertRaises(AccessError):
            self.cashflow.with_user(cashier).register()


@tagged('post_install', '-at_install', 'orsquare')
class TestReports(BackOfficeCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.stock_in(cls.item, 50, cls.counter, cost=100.0)

    def test_01_dashboard_live_today(self):
        self.sell([{'product_id': self.item.id, 'qty': 3}])
        self.sell([{'product_id': self.item.id, 'qty': 1}], payments=[{'method': 'upi', 'amount': 200.0}])
        d = self.rep.dashboard()
        self.assertEqual(d['today']['total_sales'], 800.0)
        self.assertEqual(d['today']['payments']['cash'], 600.0)
        self.assertEqual(d['today']['payments']['upi'], 200.0)
        self.assertEqual(d['today']['gross_profit'], 400.0)
        self.assertEqual(d['today']['drawer_cash'], 1600.0)
        self.assertEqual(d['stock_value']['counter'], 4600.0)
        self.assertEqual(len(d['trend']), 7)
        self.assertEqual(d['retailer_summary']['todayTotal'], 800.0)
        self.assertEqual(d['retailer_summary']['monthTotal'], 800.0)
        self.assertEqual(d['retailer_summary']['cashInToday'], 800.0)
        self.assertEqual(d['retailer_summary']['todayNetProfit'], 400.0)

    def test_02_dashboard_masks_for_cashier_with_dash_not_zero(self):
        cashier = self.make_user('dash_cashier', ['orsquare.group_orsquare_cashier'])
        d = self.rep.with_user(cashier).dashboard()
        self.assertIsNone(d['today']['total_sales'])
        self.assertIsNone(d['today']['gross_profit'])
        self.assertIsNone(d['today']['drawer_cash'])
        self.assertIsNone(d['stock_value'])
        self.assertNotIn('todayTotal', d['retailer_summary'])

    def test_03_trend_uses_frozen_snapshots_for_sealed_days(self):
        self.sell([{'product_id': self.item.id, 'qty': 2}])
        self.day.action_seal(1400.0)
        d = self.rep.calendar(str(self.day.date), str(self.day.date))
        self.assertEqual(d['totals']['net_sales'], 400.0)
        detail = self.rep.day_detail(str(self.day.date))
        self.assertEqual(detail['state'], 'sealed')

    def test_04_trial_balance_balances_and_profit_loss(self):
        self.sell([{'product_id': self.item.id, 'qty': 4}])                     # revenue 800, cogs 400
        self.day.action_seal(1800.0)
        tb = self.rep.trial_balance()
        self.assertTrue(tb['balanced'])
        self.assertEqual(round(tb['total_debit'] - tb['total_credit'], 2), 0.0)
        pl = self.rep.profit_and_loss()
        self.assertEqual(pl['total_revenue'], 800.0)
        self.assertEqual(pl['total_cogs'], 400.0)
        self.assertEqual(pl['gross_profit'], 400.0)

    def test_05_balance_sheet_balances(self):
        self.sell([{'product_id': self.item.id, 'qty': 4}])
        self.cashflow.new_entry('expense', 50.0, 'cash', 'Misc')
        self.day.action_seal(1750.0)
        bs = self.rep.balance_sheet()
        self.assertTrue(bs['balanced'], bs)

    def test_06_gst_report_splits_output_and_input(self):
        sale_tax = self.env['account.tax'].search([('name', '=', '5% GST S'), ('company_id', '=', self.company.id)], limit=1)
        pur_tax = self.env['account.tax'].search([('name', '=', '5% GST'), ('type_tax_use', '=', 'purchase'),
                                                  ('company_id', '=', self.company.id)], limit=1)
        snack = self.make_product('GST Snack', cost=10.0, price=100.0, taxes_id=[(6, 0, sale_tax.ids)],
                                  supplier_taxes_id=[(6, 0, pur_tax.ids)])
        self.env['orsquare.purchase.service'].record_bill({
            'client_ref': self.ref(), 'supplier_id': self.env['res.partner'].create({'name': 'GST Sup'}).id,
            'lines': [{'product_id': snack.id, 'qty': 20, 'rate': 10.0}]})
        self.stock.manual_transfer(self.wh, 'godown_to_counter', {snack.id: 10})
        self.sell([{'product_id': snack.id, 'qty': 4}], payments=[{'method': 'cash', 'amount': 420.0}])
        self.day.action_seal(self.day.live_expected_cash())
        g = self.rep.gst_report()
        self.assertEqual(round(g['total_input_credit'], 2), 10.0)

    def test_07_registers(self):
        self.sell([{'product_id': self.item.id, 'qty': 1}])
        rows = self.rep.registers('sales')['rows']
        self.assertEqual(rows[0]['total'], 200.0)
        self.assertEqual(rows[0]['type'], 'counter')

    def test_08_ledger_hidden_for_cashier(self):
        cashier = self.make_user('led_cashier', ['orsquare.group_orsquare_cashier'])
        with self.assertRaises(AccessError):
            self.rep.with_user(cashier).trial_balance()

    def test_09_attention_lists_overdue_khata_and_unclosed_day(self):
        cust = self.env['res.partner'].create({'name': 'Old Debtor', 'customer_rank': 1})
        self.company.orsquare_khata_overdue_days = 0
        self.accounts.create_party('Old Debtor2', 'customer', opening_balance=500.0)
        att = self.rep.dashboard()['attention']
        self.assertIn('overdue_khata', [a['type'] for a in att])
