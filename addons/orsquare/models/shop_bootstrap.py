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
    'state_vat_payable': ('112361', 'State VAT Payable (Liquor)', 'liability_current', False),
    'opening_equity': ('300100', 'Opening Balance Equity', 'equity', False),
    'owner_drawings': ('300200', 'Owner Drawings', 'equity', False),
    'owner_capital': ('300300', 'Owner Capital Introduced', 'equity', False),
    'misc_income': ('400002', 'Miscellaneous Income', 'income_other', False),
}

# key: (name, landed_cost_ok, account key used as the product's expense account)
SERVICE_PRODUCTS = {
    'discount_cap': ('Trade Discount (capitalised into stock cost)', True, 'stock_interim_in'),
    'discount_exp': ('Discount Received (income)', False, 'discount_received'),
    'charge_cap': ('Freight & Handling (capitalised into stock cost)', True, 'stock_interim_in'),
    'charge_exp': ('Freight & Handling (expense)', False, 'freight_inward'),
    'tcs': ('TCS Receivable (Sec 206C)', False, 'tcs_receivable'),
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

    @api.model
    def simplify_liquidity(self, company):
        """Retail cash/UPI payments post straight to the journal's account.

        Odoo's default parks every payment in an 'Outstanding' account until a bank statement is
        reconciled. A shop's cash drawer and UPI collections have no statement to reconcile, so the
        payment accounts are the journals' own accounts: cash in hand is one number, payments are 'paid'.
        """
        self.journal('upi', company)
        journals = self.env['account.journal'].search([('company_id', '=', company.id), ('type', 'in', ('cash', 'bank'))])
        for journal in journals:
            if not journal.default_account_id:
                continue
            for line in journal.inbound_payment_method_line_ids | journal.outbound_payment_method_line_ids:
                if line.payment_account_id != journal.default_account_id:
                    line.payment_account_id = journal.default_account_id

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
    def sync_restaurant_mode(self, company):
        """Mirror the Tables feature onto the POS config. Odoo forbids changing it while a session is
        open, so it is applied now when possible and again whenever the next day opens."""
        config = self.env['pos.config'].sudo().search([('company_id', '=', company.id)], limit=1)
        want = bool(company.orsquare_feature_tables)
        if config and config.module_pos_restaurant != want \
                and not config.session_ids.filtered(lambda s: s.state != 'closed'):
            config.module_pos_restaurant = want

    @api.model
    def scrap_location(self, company):
        loc = self.env['stock.location'].search([
            ('scrap_location', '=', True), ('company_id', 'in', (False, company.id))], limit=1)
        if loc:
            acc = self.account('stock_adjustment', company)
            if loc.valuation_in_account_id != acc or loc.valuation_out_account_id != acc:
                loc.sudo().write({'valuation_in_account_id': acc.id, 'valuation_out_account_id': acc.id})
        return loc

    @api.model
    def chart_account(self, code, company=None):
        company = company or self.env.company
        account = self.env['account.account'].with_company(company).search([('code', '=', code)], limit=1)
        if not account:
            raise ValueError("Account %s is missing from the chart of accounts" % code)
        return account

    @api.model
    def service_product(self, key, company=None):
        """Non-stock service products used as bill lines for discounts, charges and TCS."""
        company = company or self.env.company
        name, landed, acc_key = SERVICE_PRODUCTS[key]
        product = self.env.ref('orsquare.svc_%s_%s' % (key, company.id), raise_if_not_found=False)
        if product and product.exists():
            return product
        vals = {
            'name': name, 'type': 'service', 'sale_ok': False, 'purchase_ok': True, 'is_storable': False,
            'landed_cost_ok': landed, 'taxes_id': [(6, 0, [])], 'supplier_taxes_id': [(6, 0, [])],
            'property_account_expense_id': self.account(acc_key, company).id,
            'company_id': company.id,
        }
        if landed:
            vals['split_method_landed_cost'] = 'by_current_cost_price'
        product = self.env['product.product'].with_company(company).create(vals)
        self.env['ir.model.data'].sudo().create({
            'module': 'orsquare', 'name': 'svc_%s_%s' % (key, company.id),
            'model': 'product.product', 'res_id': product.id, 'noupdate': True})
        return product

    # ------------------------------------------------------------------ statutory tax regimes
    @api.model
    def ensure_tax_regimes(self, company):
        """Seed regimes (idempotent). Rates are configuration, never code: the Maharashtra
        reference ships with State VAT at 0 % until the operator sets the current statutory rate."""
        Regime = self.env['orsquare.tax_regime']
        Tax = self.env['account.tax'].with_company(company)
        if Regime.search_count([('company_id', '=', company.id)]):
            return
        mh = self.env.ref('base.state_in_mh', raise_if_not_found=False)
        vat = Tax.search([('name', '=', 'State VAT (Liquor)'), ('company_id', '=', company.id)], limit=1)
        if not vat:
            group = self.env['account.tax.group'].search([('name', '=', 'State VAT (Liquor)')], limit=1)                 or self.env['account.tax.group'].create({
                    'name': 'State VAT (Liquor)', 'country_id': self.env.ref('base.in').id})
            vat = Tax.create({
                'name': 'State VAT (Liquor)', 'type_tax_use': 'sale', 'amount_type': 'percent', 'amount': 0.0,
                'description': 'State VAT', 'company_id': company.id, 'tax_group_id': group.id,
                'invoice_repartition_line_ids': [
                    (0, 0, {'repartition_type': 'base', 'document_type': 'invoice'}),
                    (0, 0, {'repartition_type': 'tax', 'document_type': 'invoice',
                            'account_id': self.account('state_vat_payable', company).id})],
                'refund_repartition_line_ids': [
                    (0, 0, {'repartition_type': 'base', 'document_type': 'refund'}),
                    (0, 0, {'repartition_type': 'tax', 'document_type': 'refund',
                            'account_id': self.account('state_vat_payable', company).id})],
            })
        Regime.create({
            'name': 'Alcoholic Liquor - Maharashtra (reference)', 'kind': 'liquor', 'company_id': company.id,
            'state_id': mh.id if mh else False, 'sale_tax_ids': [(6, 0, vat.ids)], 'tcs_rate': 1.0,
            'note': "Outside GST (Art. 366(12A), Sec. 9(1) CGST Act). State VAT rate is intentionally 0 here: "
                    "set the current statutory rate on the tax. TCS under Sec. 206C(1) is configurable.",
        })
        for rate in (0, 5, 12, 18, 28):
            sale = Tax.search([('name', '=', '%s%% GST S' % rate if rate else '0%'), ('type_tax_use', '=', 'sale'),
                               ('company_id', '=', company.id)], limit=1)
            purchase = Tax.search([('name', '=', '%s%% GST' % rate if rate else '0%'), ('type_tax_use', '=', 'purchase'),
                                   ('company_id', '=', company.id)], limit=1)
            Regime.create({
                'name': 'GST %s%%' % rate if rate else 'GST Nil-rated (0%)', 'kind': 'gst', 'company_id': company.id,
                'sale_tax_ids': [(6, 0, sale.ids)], 'purchase_tax_ids': [(6, 0, purchase.ids)],
            })
        exempt = Tax.search([('name', '=', '0% Exempt'), ('company_id', '=', company.id)], limit=1)
        Regime.create({'name': 'Exempt', 'kind': 'exempt', 'company_id': company.id,
                       'sale_tax_ids': [(6, 0, exempt.ids)]})

    # ------------------------------------------------------------------ localisation + tenant configuration
    @api.model
    def ensure_india(self, company):
        """Indian shop defaults: country and INR.

        The Indian chart (GST taxes, HSN) must be chosen BEFORE accounting is installed (scripts/
        build_template.sh sets the company country first, exactly as Odoo's own database creation
        does). Swapping a chart later would delete accounts that POS already references, so here we
        only verify and, for a pristine company, align country/currency; we never swap a chart.
        """
        india = self.env.ref('base.in')
        inr = self.env.ref('base.INR')
        inr.active = True
        if company.chart_template != 'in':
            _logger.warning("Company %s is not on the Indian chart (%s); build the template with the "
                            "company country set to India before installing orsquare.", company.name,
                            company.chart_template)
            return False
        vals = {}
        if company.country_id != india:
            vals['country_id'] = india.id
        if company.currency_id != inr and not self.env['account.move'].sudo().search_count(
                [('company_id', '=', company.id), ('state', '=', 'posted')]):
            vals['currency_id'] = inr.id
        if vals:
            company.write(vals)
        return bool(vals)

    @api.model
    def configure_shop(self, name, owner_name, owner_login, owner_password, state_code='MH', gstin=None,
                       street=None, city=None, zip_code=None, phone=None, email=None, fssai_no=None,
                       liquor_license_no=None, upi_id=None, tz='Asia/Kolkata', preset=None):
        """Turn a cloned template database into one specific shop (idempotent per owner login).

        Also neutralises the template's default ``admin/admin`` login: a shop database must never ship
        a known password.
        """
        import secrets
        company = self.env.company
        state = self.env['res.country.state'].search([('country_id.code', '=', 'IN'), ('code', '=', state_code)], limit=1)
        company.partner_id.write({k: v for k, v in {
            'name': name, 'vat': gstin, 'street': street, 'city': city, 'zip': zip_code, 'phone': phone,
            'email': email, 'state_id': state.id or False}.items() if v})
        company.write({k: v for k, v in {
            'name': name, 'orsquare_fssai_no': fssai_no, 'orsquare_liquor_license_no': liquor_license_no,
            'orsquare_upi_id': upi_id, 'orsquare_tz': tz}.items() if v})
        if state:
            mh_regime = self.env['orsquare.tax_regime'].search([('kind', '=', 'liquor'), ('company_id', '=', company.id)], limit=1)
            if mh_regime:
                mh_regime.state_id = state
        admin = self.env.ref('base.user_admin', raise_if_not_found=False)
        if admin:
            admin.sudo().write({'password': secrets.token_urlsafe(32)})
        staff = self.env['orsquare.staff.service'].sudo()      # platform provisioning: privileged by design
        owner_id = staff.create_staff(owner_name, owner_login, owner_password, ['owner'])
        if preset:
            staff.apply_preset(preset)
        return {'company_id': company.id, 'owner_id': owner_id, 'database': self.env.cr.dbname}

    # ------------------------------------------------------------------ entry point
    @api.model
    def bootstrap_company(self, company):
        """Run every idempotent shop-setup step for ``company``."""
        self.ensure_india(company)
        self.ensure_accounts(company)
        self.env['stock.warehouse'].search([('company_id', '=', company.id)])._orsquare_ensure_topology()
        self.apply_valuation_policy(company)
        # Real-time stock: the Counter quant must drop at the moment of sale (not at session close).
        company.point_of_sale_update_stock_quantities = 'real'
        self.scrap_location(company)
        self.pos_config(company)
        self.simplify_liquidity(company)
        for key in SERVICE_PRODUCTS:
            self.service_product(key, company)
        self.ensure_tax_regimes(company)
        return True
