# -*- coding: utf-8 -*-
"""Tenant bootstrap: everything a brand-new shop database needs to be ready to bill.

The bootstrap is idempotent. It is run by the module install hook, by upgrade migrations and by
``provision_shop`` when a shop database is cloned from the template database.
"""
import logging

from odoo import api, models, _

_logger = logging.getLogger(__name__)

# key: (code, name, account_type, reconcile)
ORSQUARE_ACCOUNTS = {
    'stock_valuation': ('100901', 'Stock Valuation (Inventory Asset)', 'asset_current', False),
    'stock_interim_in': ('100902', 'Stock Interim (Received)', 'asset_current', True),
    'stock_interim_out': ('100903', 'Stock Interim (Delivered)', 'asset_current', True),
    'tcs_receivable': ('100904', 'TCS Receivable (Sec 206C)', 'asset_current', False),
    'employee_advances': ('100905', 'Employee Advances', 'asset_current', False),
    'cogs': ('210701', 'Cost of Goods Sold', 'expense_direct_cost', False),
    'stock_adjustment': ('210702', 'Stock Adjustment / Wastage', 'expense', False),
    'freight_inward': ('210703', 'Freight & Handling Inward', 'expense', False),
    'cash_settlement_loss': ('210704', 'Cash Settlement Difference', 'expense', False),
    'petty_expense': ('210705', 'Petty Cash Expenses', 'expense', False),
    'discount_received': ('400001', 'Discount Received', 'income_other', False),
    'discount_allowed': ('210706', 'Discount Allowed', 'expense', False),
    'landed_clearing': ('100906', 'Landed Cost Clearing', 'asset_current', True),
}


class OrsquareShopBootstrap(models.AbstractModel):
    _name = 'orsquare.shop.bootstrap'
    _description = "ORSquare Shop Bootstrap"

    # ------------------------------------------------------------------ accounts
    @api.model
    def account(self, key, company=None):
        """Return the ORSquare account registered under ``key`` for ``company`` (created if needed)."""
        company = company or self.env.company
        xmlid = 'orsquare.acc_%s_%s' % (key, company.id)
        account = self.env.ref(xmlid, raise_if_not_found=False)
        if account and account.exists():
            return account
        code, name, atype, reconcile = ORSQUARE_ACCOUNTS[key]
        Account = self.env['account.account'].with_company(company)
        account = Account.search([('code', '=', code)], limit=1)
        if not account:
            account = Account.create({
                'code': code, 'name': name, 'account_type': atype, 'reconcile': reconcile,
                'company_ids': [(6, 0, [company.id])],
            })
        self.env['ir.model.data'].sudo().create({
            'module': 'orsquare', 'name': 'acc_%s_%s' % (key, company.id),
            'model': 'account.account', 'res_id': account.id, 'noupdate': True,
        })
        return account

    @api.model
    def ensure_accounts(self, company):
        return {key: self.account(key, company) for key in ORSQUARE_ACCOUNTS}

    # ------------------------------------------------------------------ valuation policy
    @api.model
    def valuation_values(self, company):
        """Product-category values for AVCO + automated valuation."""
        acc = self.ensure_accounts(company)
        journal = self.env['account.journal'].search([
            ('company_id', '=', company.id), ('code', '=', 'STJ')], limit=1)
        values = {
            'property_cost_method': 'average',
            'property_valuation': 'real_time',
            'property_stock_valuation_account_id': acc['stock_valuation'].id,
            'property_stock_account_input_categ_id': acc['stock_interim_in'].id,
            'property_stock_account_output_categ_id': acc['stock_interim_out'].id,
            'property_account_expense_categ_id': acc['cogs'].id,
        }
        if journal:
            values['property_stock_journal'] = journal.id
        return values

    @api.model
    def apply_valuation_policy(self, company, categories=None):
        categories = categories if categories is not None else self.env['product.category'].search([])
        values = self.valuation_values(company)
        for categ in categories.with_company(company):
            categ.write(values)
        company.anglo_saxon_accounting = True

    # ------------------------------------------------------------------ POS: journals, tenders, config
    @api.model
    def _xmlid_record(self, name, model, company, create_vals):
        xmlid = 'orsquare.%s_%s' % (name, company.id)
        rec = self.env.ref(xmlid, raise_if_not_found=False)
        if rec and rec.exists():
            return rec
        rec = self.env[model].with_company(company).create(create_vals)
        self.env['ir.model.data'].sudo().create({
            'module': 'orsquare', 'name': '%s_%s' % (name, company.id),
            'model': model, 'res_id': rec.id, 'noupdate': True})
        return rec

    @api.model
    def journal(self, key, company):
        vals = {
            'upi': {'name': 'UPI', 'type': 'bank', 'code': 'UPI', 'company_id': company.id},
        }[key]
        existing = self.env['account.journal'].search(
            [('company_id', '=', company.id), ('code', '=', vals['code'])], limit=1)
        if existing:
            return existing
        return self._xmlid_record('journal_%s' % key, 'account.journal', company, vals)

    @api.model
    def payment_method(self, key, company=None):
        company = company or self.env.company
        PM = self.env['pos.payment.method'].with_company(company)
        found = PM.search([('orsquare_key', '=', key), ('company_id', '=', company.id)], limit=1)
        if found:
            return found
        # Adopt a pre-existing equivalent method instead of creating a conflicting duplicate.
        adopt_domain = {
            'cash': [('is_cash_count', '=', True)],
            'upi': [('journal_id.code', '=', 'UPI')],
            'khata': [('journal_id', '=', False), ('receivable_account_id.code', '!=', '210704')],
            'concession': [('journal_id', '=', False), ('receivable_account_id.code', '=', '210704')],
        }[key]
        adopted = PM.search([('company_id', '=', company.id), ('orsquare_key', '=', False)] + adopt_domain, limit=1)
        if adopted:
            adopted.orsquare_key = key
            return adopted
        cash = self.env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'cash')], limit=1)
        vals = {
            'cash': {'name': 'Cash', 'journal_id': cash.id, 'is_cash_count': True},
            'upi': {'name': 'UPI', 'journal_id': self.journal('upi', company).id},
            'khata': {'name': 'Khata', 'split_transactions': True},
            'concession': {'name': 'Settlement Concession',
                           'receivable_account_id': self.account('cash_settlement_loss', company).id},
        }[key]
        vals.update({'orsquare_key': key, 'company_id': company.id})
        return self._xmlid_record('pm_%s' % key, 'pos.payment.method', company, vals)

    @api.model
    def pos_config(self, company=None):
        """The single counter register (one shop = one cash drawer = one POS config)."""
        company = company or self.env.company
        config = self.env['pos.config'].search([('company_id', '=', company.id)], order='id', limit=1)
        wh = self.env['stock.warehouse'].orsquare_main_warehouse(company)
        methods = self.env['pos.payment.method']
        for key in ('cash', 'upi', 'khata', 'concession'):
            methods |= self.payment_method(key, company)
        if not config:
            config = self.env['pos.config'].with_company(company).create({
                'name': 'ORSquare Counter', 'company_id': company.id,
                'picking_type_id': wh.pos_type_id.id,
                'payment_method_ids': [(6, 0, methods.ids)],
            })
        else:
            missing = methods - config.payment_method_ids
            if missing and not config.session_ids.filtered(lambda s: s.state != 'closed'):
                config.payment_method_ids = [(4, m.id) for m in missing]
            if config.picking_type_id != wh.pos_type_id and not config.session_ids.filtered(lambda s: s.state != 'closed'):
                config.picking_type_id = wh.pos_type_id
        return config

    @api.model
    def scrap_location(self, company):
        loc = self.env['stock.location'].search([
            ('scrap_location', '=', True), ('company_id', 'in', (False, company.id))], limit=1)
        if loc:
            acc = self.account('stock_adjustment', company)
            if loc.valuation_in_account_id != acc or loc.valuation_out_account_id != acc:
                loc.sudo().write({'valuation_in_account_id': acc.id, 'valuation_out_account_id': acc.id})
        return loc

    # ------------------------------------------------------------------ entry point
    @api.model
    def bootstrap_company(self, company):
        """Run every idempotent shop-setup step for ``company``."""
        self.ensure_accounts(company)
        self.env['stock.warehouse'].search([('company_id', '=', company.id)])._orsquare_ensure_topology()
        self.apply_valuation_policy(company)
        # Real-time stock: the Counter quant must drop at the moment of sale (not at session close).
        company.point_of_sale_update_stock_quantities = 'real'
        self.scrap_location(company)
        self.pos_config(company)
        return True
