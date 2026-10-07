# -*- coding: utf-8 -*-
"""Staff Access + shop settings (Business Studio).

Staff Access is deliberately tiny: it only assigns users to the native Odoo groups defined in
``security/orsquare_security.xml`` and stores which tabs a user may open.  There is no parallel
employee-governance system: users, groups, ACLs and record rules are Odoo's.
"""
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError

from .res_company import ORSQUARE_TABS

ALL_TABS = [t for t, _n in ORSQUARE_TABS]
ROLE_GROUPS = {
    'owner': 'orsquare.group_orsquare_owner',
    'cashier': 'orsquare.group_orsquare_cashier',
    'stockkeeper': 'orsquare.group_orsquare_stockkeeper',
}
FLAG_GROUPS = {
    'can_see_money': 'orsquare.group_orsquare_can_see_money',
    'can_see_valuation': 'orsquare.group_orsquare_can_see_valuation',
    'can_manage_returns': 'orsquare.group_orsquare_can_manage_returns',
}
ROLE_DEFAULT_TABS = {
    'cashier': ['sales', 'daybook', 'accounts', 'cashflow'],
    'stockkeeper': ['stock', 'purchases', 'products'],
}
# settings an owner may change through the API (whitelist, never mass-assign)
SETTINGS_FIELDS = [
    'orsquare_enabled_tabs', 'orsquare_feature_open_bottle', 'orsquare_feature_kitchen', 'orsquare_feature_tables',
    'orsquare_auto_godown_transfer', 'orsquare_continuous_scanning', 'orsquare_default_payment_mode',
    'orsquare_cutoff_hour', 'orsquare_tz', 'orsquare_cash_materiality',
    'orsquare_cost_include_discounts', 'orsquare_cost_include_expenses', 'orsquare_cost_include_taxes',
    'orsquare_penny_tolerance', 'orsquare_bill_template', 'orsquare_thermal_width', 'orsquare_fssai_no',
    'orsquare_liquor_license_no', 'orsquare_show_hsn', 'orsquare_show_mrp', 'orsquare_show_excise_matrix',
    'orsquare_bank_details', 'orsquare_upi_id', 'orsquare_invoice_prefix', 'orsquare_khata_overdue_days',
]


class ResUsers(models.Model):
    _inherit = 'res.users'

    orsquare_tabs = fields.Char(
        string="Granted Tabs", help="Comma separated tabs the owner granted; empty = role default.")

    @api.constrains('orsquare_tabs')
    def _check_orsquare_tabs(self):
        for user in self:
            bad = {t for t in (user.orsquare_tabs or '').split(',') if t} - set(ALL_TABS)
            if bad:
                raise ValidationError(_("Unknown tab(s): %s", ", ".join(sorted(bad))))

    def orsquare_roles(self):
        self.ensure_one()
        return [r for r, g in ROLE_GROUPS.items() if self.has_group(g)]

    def orsquare_effective_tabs(self):
        """Tabs this user may open: owner = every enabled tab; staff = grant (or role default) ∩ enabled."""
        self.ensure_one()
        enabled = set(self.company_id.orsquare_tab_list())
        if self.has_group(ROLE_GROUPS['owner']):
            granted = set(ALL_TABS)
        else:
            explicit = {t for t in (self.orsquare_tabs or '').split(',') if t}
            if explicit:
                granted = explicit
            else:
                granted = set()
                for role, tabs in ROLE_DEFAULT_TABS.items():
                    if self.has_group(ROLE_GROUPS[role]):
                        granted |= set(tabs)
        return [t for t in ALL_TABS if t in granted and t in enabled]


class OrsquareStaffService(models.AbstractModel):
    _name = 'orsquare.staff.service'
    _description = "ORSquare Staff Access & Settings"

    @api.model
    def _require_owner(self):
        if not (self.env.su or self.env.user.has_group(ROLE_GROUPS['owner'])):
            raise AccessError(_("Only the shop owner can do that."))

    # ------------------------------------------------------------------ session / bootstrap info
    @api.model
    def me(self):
        user = self.env.user
        company = user.company_id
        return {
            'id': user.id, 'name': user.name, 'login': user.login,
            'roles': user.orsquare_roles(),
            'flags': {k: self.env.su or user.has_group(g) or user.has_group(ROLE_GROUPS['owner'])
                      for k, g in FLAG_GROUPS.items()},
            'tabs': user.orsquare_effective_tabs(),
            'company': {
                'id': company.id, 'name': company.name, 'currency': company.currency_id.name,
                'tz': company.orsquare_tz, 'gstin': company.vat or '',
                'business_date': str(company.orsquare_current_business_date()),
            },
            'features': {
                'open_bottle': company.orsquare_feature_open_bottle, 'kitchen': company.orsquare_feature_kitchen,
                'tables': company.orsquare_feature_tables,
                'auto_godown_transfer': company.orsquare_auto_godown_transfer,
                'continuous_scanning': company.orsquare_continuous_scanning,
                'default_payment_mode': company.orsquare_default_payment_mode,
            },
        }

    # ------------------------------------------------------------------ staff
    @api.model
    def list_staff(self):
        self._require_owner()
        env = self.sudo().env
        groups = [self.env.ref(g) for g in ROLE_GROUPS.values()]
        users = env['res.users'].with_context(active_test=False).search([
            ('company_id', '=', self.env.company.id), ('groups_id', 'in', [g.id for g in groups])])
        return [{
            'id': u.id, 'name': u.name, 'login': u.login, 'active': u.active, 'roles': u.orsquare_roles(),
            'flags': {k: u.has_group(g) for k, g in FLAG_GROUPS.items()},
            'tabs': u.orsquare_effective_tabs(),
        } for u in users]

    @api.model
    def _group_ids(self, roles, flags):
        ids = []
        for role in roles:
            if role not in ROLE_GROUPS:
                raise UserError(_("Unknown role '%s'.", role))
            ids.append(self.env.ref(ROLE_GROUPS[role]).id)
        for key, on in (flags or {}).items():
            if key not in FLAG_GROUPS:
                raise UserError(_("Unknown permission '%s'.", key))
            if on:
                ids.append(self.env.ref(FLAG_GROUPS[key]).id)
        return ids

    @api.model
    def create_staff(self, name, login, password, roles, flags=None, tabs=None):
        self._require_owner()
        if len(password or '') < 8:
            raise UserError(_("The password must be at least 8 characters."))
        if not roles:
            raise UserError(_("Choose a role."))
        env = self.sudo().env
        if env['res.users'].with_context(active_test=False).search_count([('login', '=', login)]):
            raise UserError(_("The login '%s' is already taken.", login))
        user = env['res.users'].create({
            'name': name, 'login': login, 'password': password, 'company_id': self.env.company.id,
            'company_ids': [(6, 0, [self.env.company.id])],
            'groups_id': [(6, 0, self._group_ids(roles, flags) + [self.env.ref('base.group_user').id])],
            'orsquare_tabs': ','.join(tabs) if tabs else False,
        })
        return user.id

    @api.model
    def update_staff(self, user_id, roles=None, flags=None, tabs=None, active=None):
        self._require_owner()
        user = self.sudo().env['res.users'].with_context(active_test=False).browse(int(user_id)).exists()
        if not user or user.company_id != self.env.company:
            raise UserError(_("Unknown staff member."))
        if user == self.env.user and (active is False or (roles is not None and 'owner' not in roles)):
            raise UserError(_("You cannot remove your own owner access."))
        if user.id == 1:
            raise UserError(_("The system user cannot be changed here."))
        vals = {}
        if roles is not None or flags is not None:
            current_roles = roles if roles is not None else user.orsquare_roles()
            current_flags = flags if flags is not None else {k: user.has_group(g) for k, g in FLAG_GROUPS.items()}
            managed = [self.env.ref(g).id for g in list(ROLE_GROUPS.values()) + list(FLAG_GROUPS.values())]
            keep = [g.id for g in user.groups_id if g.id not in managed]
            vals['groups_id'] = [(6, 0, keep + self._group_ids(current_roles, current_flags))]
        if tabs is not None:
            vals['orsquare_tabs'] = ','.join(tabs) if tabs else False
        if active is not None:
            vals['active'] = bool(active)
        user.write(vals)
        return True

    # ------------------------------------------------------------------ settings (Business Studio)
    @api.model
    def get_settings(self):
        company = self.env.company
        out = {f: company[f] for f in SETTINGS_FIELDS}
        out['orsquare_tab_catalog'] = ORSQUARE_TABS
        return out

    @api.model
    def update_settings(self, values):
        self._require_owner()
        unknown = set(values) - set(SETTINGS_FIELDS)
        if unknown:
            raise UserError(_("Unknown setting(s): %s", ", ".join(sorted(unknown))))
        company = self.env.company.sudo()
        vals = dict(values)
        if isinstance(vals.get('orsquare_enabled_tabs'), (list, tuple)):
            vals['orsquare_enabled_tabs'] = ','.join(vals['orsquare_enabled_tabs'])
        company.write(vals)
        if 'orsquare_feature_tables' in vals:
            self.env['orsquare.shop.bootstrap'].sync_restaurant_mode(company)
        self.env['orsquare.event'].publish(company, 'settings_changed', {'keys': sorted(vals)})
        return True
