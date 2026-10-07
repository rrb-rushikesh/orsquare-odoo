# -*- coding: utf-8 -*-
import base64

from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import OrsquareCase


@tagged('post_install', '-at_install', 'orsquare')
class TestBills(OrsquareCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.bills = cls.env['orsquare.bill.service']
        cls.company.write({'orsquare_upi_id': 'shop@upi', 'orsquare_liquor_license_no': 'FL-III-851',
                           'orsquare_show_excise_matrix': True})
        cls.company.partner_id.vat = '27AAAAA0000A1Z5'
        tax = cls.env['account.tax'].search([('name', '=', '5% GST S'), ('company_id', '=', cls.company.id)], limit=1)
        cls.whisky = cls.make_product('Bill Whisky 750ml', cost=1000.0, price=1500.0, uom_xmlid='orsquare.uom_shop_750ml',
                                      orsquare_mrp=1600.0)
        cls.snack = cls.make_product('Bill Chips', cost=10.0, price=100.0, taxes_id=[(6, 0, tax.ids)])
        cls.stock_in(cls.whisky, 10, cls.counter)
        cls.stock_in(cls.snack, 10, cls.counter)

    def test_01_document_has_everything_needed_to_print(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 2}, {'product_id': self.snack.id, 'qty': 1}],
                        payments=[{'method': 'cash', 'amount': 3105.0}])
        doc = self.bills.bill_document(res['order_id'])
        self.assertEqual(doc['header']['gstin'], '27AAAAA0000A1Z5')
        self.assertEqual(doc['header']['liquor_license'], 'FL-III-851')
        self.assertEqual(doc['totals']['total'], 3105.0)
        self.assertEqual(doc['totals']['taxable'], 3100.0)
        self.assertEqual(len(doc['lines']), 2)
        self.assertEqual(doc['lines'][0]['mrp'], 1600.0)
        self.assertEqual(round(sum(t['amount'] for t in doc['taxes']), 2), 5.0, "5% GST split into CGST + SGST")
        self.assertTrue(doc['totals']['in_words'])
        self.assertEqual(doc['payments'][0]['key'], 'cash')

    def test_02_upi_qr_payload(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}], payments=[{'method': 'upi', 'amount': 1500.0}])
        qr = self.bills.bill_document(res['order_id'])['upi_qr']
        self.assertTrue(qr.startswith('upi://pay?pa=shop%40upi'))
        self.assertIn('am=1500.00', qr)
        self.assertIn('cu=INR', qr)

    def test_03_no_qr_without_upi_id_or_for_refunds(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}])
        line = self.env['pos.order'].browse(res['order_id']).lines
        ref = self.sales.settle({'client_ref': self.ref(), 'lines': [{'refund_of_line_id': line.id, 'qty': 1}],
                                 'payments': [{'method': 'cash', 'amount': 1500.0}]})
        doc = self.bills.bill_document(ref['order_id'])
        self.assertTrue(doc['bill']['is_refund'])
        self.assertIsNone(doc['upi_qr'])
        self.assertTrue(doc['bill']['refund_of'])
        self.company.orsquare_upi_id = False
        self.assertIsNone(self.bills.bill_document(res['order_id'])['upi_qr'])

    def test_04_excise_matrix_counts_bottles_not_pegs(self):
        self.whisky.product_tmpl_id.orsquare_peg_size_ids = [(0, 0, {'ml': 60, 'price': 120.0})]
        bottle = self.Bottle.open_bottle(self.whisky)
        res = self.sell([{'product_id': self.whisky.id, 'qty': 3},
                        {'peg': {'bottle_id': bottle.id, 'ml': 60}}], payments=[{'method': 'cash', 'amount': 4620.0}])
        matrix = self.bills.bill_document(res['order_id'])['excise_matrix']
        self.assertEqual(matrix, [{'size_ml': 750, 'bottles': 3.0}])
        self.company.orsquare_show_excise_matrix = False
        self.assertNotIn('excise_matrix', self.bills.bill_document(res['order_id']))

    def test_05_thermal_text_respects_paper_width(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}])
        for cols in (32, 48):
            lines = self.bills.thermal_text(res['order_id'], cols)
            self.assertTrue(lines)
            self.assertTrue(all(len(l) <= cols for l in lines), [l for l in lines if len(l) > cols])
        self.assertTrue(any('TOTAL' in l for l in self.bills.thermal_text(res['order_id'])))
        self.company.orsquare_thermal_width = '58'
        self.assertTrue(all(len(l) <= 32 for l in self.bills.thermal_text(res['order_id'])))

    def test_06_escpos_has_cut_and_drawer_pulse(self):
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}])
        raw = base64.b64decode(self.bills.escpos(res['order_id']))
        self.assertTrue(raw.startswith(b'\x1b\x40'))
        self.assertIn(b'\x1d\x56\x41\x03', raw)
        self.assertTrue(raw.endswith(b'\x1b\x70\x00\x19\xfa'))
        raw2 = base64.b64decode(self.bills.escpos(res['order_id'], open_drawer=False))
        self.assertFalse(raw2.endswith(b'\x1b\x70\x00\x19\xfa'))

    def test_07_peg_line_prints_as_peg(self):
        self.whisky.product_tmpl_id.orsquare_peg_size_ids = [(0, 0, {'ml': 60, 'price': 120.0})]
        bottle = self.Bottle.open_bottle(self.whisky)
        res = self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 60}}], payments=[{'method': 'cash', 'amount': 120.0}])
        doc = self.bills.bill_document(res['order_id'])
        self.assertTrue(doc['lines'][0]['is_peg'])
        self.assertEqual(doc['lines'][0]['peg_ml'], 60.0)
        self.assertEqual(doc['totals']['total'], 120.0)
        self.assertTrue(any('1 peg' in l for l in self.bills.thermal_text(res['order_id'])))

    def test_08_a4_template_includes_bank_details(self):
        self.company.write({'orsquare_bill_template': 'a4', 'orsquare_bank_details': 'ICICI A/c 123, IFSC ICIC0001107'})
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}])
        self.assertIn('ICICI', self.bills.bill_document(res['order_id'])['bank_details'])

    def test_09_unknown_bill_and_permissions(self):
        with self.assertRaises(UserError):
            self.bills.bill_document(999999)
        nobody = self.env['res.users'].create({'name': 'N', 'login': 'bill_nobody',
                                               'groups_id': [(6, 0, [self.env.ref('base.group_user').id])]})
        res = self.sell([{'product_id': self.whisky.id, 'qty': 1}])
        with self.assertRaises(AccessError):
            self.bills.with_user(nobody).bill_document(res['order_id'])
