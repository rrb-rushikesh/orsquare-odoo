# -*- coding: utf-8 -*-
import json

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

ORSQUARE_TABS = [
    ('dashboard', 'Dashboard'),
    ('sales', 'Sales'),
    ('purchases', 'Purchases'),
    ('stock', 'Stock'),
    ('products', 'Products'),
    ('accounts', 'Accounts'),
    ('cashflow', 'Cash Flow'),
    ('daybook', 'Daybook'),
    ('calendar', 'Calendar'),
    ('reports', 'Reports'),
    ('settings', 'Settings'),
]


class ResCompany(models.Model):
    """Shop-level ORSquare configuration.

    One account = one shop = one database = one company, so shop settings live directly on
    ``res.company``.  This is the single home for everything the spec calls *Business Studio*
    (tabs, feature toggles), *Sales Register Controls*, *Costing & Purchases* and
    *Day Closing Rules*.
    """
    _inherit = 'res.company'

    # --- Business Studio: tabs and feature extensions -------------------------------------
    orsquare_enabled_tabs = fields.Char(
        string="Enabled Tabs", default=",".join(t for t, _n in ORSQUARE_TABS),
        help="Comma separated list of ORSquare tabs the owner has switched on.")
    orsquare_feature_open_bottle = fields.Boolean(string="Open Bottle (Peg) Mode", default=True)
    orsquare_feature_kitchen = fields.Boolean(string="Kitchen Extension", default=False)
    orsquare_feature_tables = fields.Boolean(string="Restaurant Tables", default=False)
    # surface variants: the same tab, a different presentation (data is identical, only the view changes)
    orsquare_stock_variant = fields.Selection(
        [('standard', 'Standard stock list'), ('wine', 'Brand x size matrix (WineStock)')],
        string="Stock View", default='standard', required=True)
    orsquare_accounts_variant = fields.Selection(
        [('standard', 'Standard accounts'), ('advanced', 'Advanced accounts workspace')],
        string="Accounts View", default='standard', required=True)
    # which preset the shop started from, and which version of it (lets the platform spot a stale preset)
    orsquare_profile = fields.Char(string="Business Preset", copy=False)
    orsquare_preset_version = fields.Integer(string="Preset Version", copy=False)
    # optimistic-lock counter: bumped on every real Business Studio change; an editor holding an older
    # number is told to reload instead of silently overwriting a colleague's change
    orsquare_settings_version = fields.Integer(string="Settings Version", default=1, copy=False)

    # --- Sales Register Controls -----------------------------------------------------------
    orsquare_auto_godown_transfer = fields.Boolean(
        string="Auto-Godown Transfer on Checkout", default=False,
        help="When Counter stock is short, atomically move the shortfall from the Godown to "
             "the Counter inside the same transaction as the sale.")
    orsquare_continuous_scanning = fields.Boolean(string="Continuous Scanning Mode", default=False)
    orsquare_default_payment_mode = fields.Selection(
        [('cash', 'Cash'), ('upi', 'UPI'), ('prompt', 'All / Prompt')],
        string="Default Payment Mode", default='prompt', required=True)

    # --- Day Closing Rules / Data Control --------------------------------------------------
    orsquare_cutoff_hour = fields.Float(
        string="Business-Day Cutoff (hour)", default=2.0,
        help="Local time at which a new business day starts. 2.0 = 02:00. A sale at 01:30 "
             "belongs to the previous business date.")
    orsquare_tz = fields.Char(string="Shop Timezone", default='Asia/Kolkata', required=True)
    orsquare_cash_materiality = fields.Monetary(
        string="Cash Materiality Threshold", default=5.0, currency_field='currency_id',
        help="Cash difference tolerated when sealing a business day.")

    # --- Costing & Purchases (configurable cost composition) -------------------------------
    orsquare_cost_include_discounts = fields.Boolean(string="Factor Discounts in Cost", default=True)
    orsquare_cost_include_expenses = fields.Boolean(string="Factor Expenses in Cost", default=True)
    orsquare_cost_include_taxes = fields.Boolean(string="Factor Taxes in Cost", default=False)
    orsquare_penny_tolerance = fields.Monetary(
        string="Bill Penny Tolerance", default=5.0, currency_field='currency_id',
        help="Largest difference to the supplier's printed total that is booked to Round-off.")

    # --- Bill & Invoice branding -----------------------------------------------------------
    orsquare_bill_template = fields.Selection(
        [('thermal', 'Compact Thermal'), ('a4', 'A4 Tax Invoice')], default='thermal', required=True)
    orsquare_thermal_width = fields.Selection([('58', '58 mm'), ('80', '80 mm')], default='80', required=True)
    orsquare_fssai_no = fields.Char(string="FSSAI No.")
    orsquare_liquor_license_no = fields.Char(string="Liquor License No.")
    orsquare_show_hsn = fields.Boolean(default=True)
    orsquare_show_mrp = fields.Boolean(default=True)
    orsquare_show_excise_matrix = fields.Boolean(default=False)
    orsquare_bank_details = fields.Text(string="Bank Details (printed on A4 invoice)")
    orsquare_upi_id = fields.Char(string="UPI ID")
    orsquare_invoice_prefix = fields.Char(string="Invoice Number Prefix", default='INV-')

    @api.constrains('orsquare_cutoff_hour')
    def _check_cutoff_hour(self):
        for company in self:
            if not (0.0 <= company.orsquare_cutoff_hour < 12.0):
                raise ValidationError(_("The business-day cutoff must be between 00:00 and 11:59."))

    @api.constrains('orsquare_tz')
    def _check_tz(self):
        import zoneinfo
        for company in self:
            try:
                zoneinfo.ZoneInfo(company.orsquare_tz)
            except Exception:
                raise ValidationError(_("'%s' is not a valid timezone.", company.orsquare_tz))

    @api.constrains('orsquare_enabled_tabs')
    def _check_tabs(self):
        valid = {t for t, _n in ORSQUARE_TABS}
        for company in self:
            tabs = {t for t in (company.orsquare_enabled_tabs or '').split(',') if t}
            if tabs - valid:
                raise ValidationError(_("Unknown tab(s): %s", ", ".join(sorted(tabs - valid))))

    def orsquare_tab_list(self):
        self.ensure_one()
        return [t for t in (self.orsquare_enabled_tabs or '').split(',') if t]

    # ------------------------------------------------------------------ plan entitlements
    def orsquare_entitlements(self):
        """What the shop's plan allows, as pushed by the platform: {plan, features, tabs, max_staff}.

        A missing key means "no limit". The shop never *deletes* anything because of a plan; what is enabled
        stays stored and simply is not effective while it is outside the entitlement.
        """
        self.ensure_one()
        raw = self.env['ir.config_parameter'].sudo().get_param('orsquare.entitlements')
        try:
            data = json.loads(raw) if raw else {}
        except ValueError:
            data = {}
        return data if isinstance(data, dict) else {}

    def orsquare_entitled_tabs(self):
        self.ensure_one()
        allowed = self.orsquare_entitlements().get('tabs')
        everything = [t for t, _n in ORSQUARE_TABS]
        return everything if not allowed else [t for t in everything if t in set(allowed)]

    def orsquare_feature_entitled(self, feature):
        self.ensure_one()
        allowed = self.orsquare_entitlements().get('features')
        return True if not allowed else feature in set(allowed)

    def orsquare_feature_on(self, feature):
        """Switched on by the owner AND allowed by the plan."""
        self.ensure_one()
        return bool(self['orsquare_feature_%s' % feature]) and self.orsquare_feature_entitled(feature)

    def orsquare_effective_tab_list(self):
        """Tabs the shop really has: switched on AND in the plan."""
        self.ensure_one()
        entitled = set(self.orsquare_entitled_tabs())
        return [t for t in self.orsquare_tab_list() if t in entitled]

