# -*- coding: utf-8 -*-
"""Staff Access + shop settings (Business Studio).

Staff Access is deliberately tiny: it only assigns users to the native Odoo groups defined in
``security/orsquare_security.xml`` (a role, three data switches, one group per tab). There is no parallel
employee-governance system: users, groups, ACLs and record rules are Odoo's. Every change is written to the
append-only governance log (``orsquare.config_audit``) with what it was before and after.
"""
from odoo import api, models, _
from odoo.exceptions import AccessError, UserError

from . import directory
from .governance import ConflictError
from .presets import ACCOUNTS_VARIANTS, ALL_TABS, FEATURES, PRESET_VERSION, PRESETS, ROLE_DEFAULT_TABS, STOCK_VARIANTS
from .res_company import ORSQUARE_TABS
from .security_utils import require_staff

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
TAB_GROUP = 'orsquare.group_orsquare_tab_%s'
MIN_PASSWORD = 8

# settings an owner may change through the API (whitelist, never mass-assign)
SETTINGS_FIELDS = [
    'orsquare_enabled_tabs', 'orsquare_feature_open_bottle', 'orsquare_feature_kitchen', 'orsquare_feature_tables',
    'orsquare_stock_variant', 'orsquare_accounts_variant',
    'orsquare_auto_godown_transfer', 'orsquare_continuous_scanning', 'orsquare_default_payment_mode',
    'orsquare_cutoff_hour', 'orsquare_tz', 'orsquare_cash_materiality',
    'orsquare_cost_include_discounts', 'orsquare_cost_include_expenses', 'orsquare_cost_include_taxes',
    'orsquare_penny_tolerance', 'orsquare_bill_template', 'orsquare_thermal_width', 'orsquare_fssai_no',
    'orsquare_liquor_license_no', 'orsquare_show_hsn', 'orsquare_show_mrp', 'orsquare_show_excise_matrix',
    'orsquare_bank_details', 'orsquare_upi_id', 'orsquare_invoice_prefix', 'orsquare_khata_overdue_days',
]


class ResUsers(models.Model):
    _inherit = 'res.users'

    def orsquare_roles(self):
        self.ensure_one()
        return [r for r, g in ROLE_GROUPS.items() if self.has_group(g)]

    def orsquare_granted_tabs(self):
        """Tabs this person has been given, whatever the shop currently has switched on."""
        self.ensure_one()
        return [t for t in ALL_TABS if self.has_group(TAB_GROUP % t)]

    def orsquare_effective_tabs(self):
        """Tabs this user may open right now: granted AND switched on for the shop AND allowed by the plan."""
        self.ensure_one()
        enabled = set(self.company_id.orsquare_effective_tab_list())
        return [t for t in self.orsquare_granted_tabs() if t in enabled]


class OrsquareStaffService(models.AbstractModel):
    _name = 'orsquare.staff.service'
    _description = "ORSquare Staff Access & Settings"

    @api.model
    def _require_owner(self):
        if not (self.env.su or self.env.user.has_group(ROLE_GROUPS['owner'])):
            raise AccessError(_("Only the shop owner can do that."))

    @api.model
    def _audit(self, *args, **kwargs):
        return self.env['orsquare.config_audit'].log(*args, **kwargs)

    # ------------------------------------------------------------------ session / bootstrap info
    @api.model
    def me(self):
        require_staff(self.env)
        user = self.env.user
        company = user.company_id
        return {
            'id': user.id, 'name': user.name, 'login': user.login,
            'roles': user.orsquare_roles(),
            'flags': {k: self.env.su or user.has_group(g) or user.has_group(ROLE_GROUPS['owner'])
                      for k, g in FLAG_GROUPS.items()},
            'tabs': user.orsquare_effective_tabs(),
            'mfa': {'enabled': bool(user.sudo().totp_enabled)},
            'company': {
                'id': company.id, 'name': company.name, 'currency': company.currency_id.name,
                'tz': company.orsquare_tz, 'gstin': company.vat or '',
                'business_date': str(company.orsquare_current_business_date()),
            },
            'features': {
                'open_bottle': company.orsquare_feature_on('open_bottle'),
                'kitchen': company.orsquare_feature_on('kitchen'),
                'tables': company.orsquare_feature_on('tables'),
                'auto_godown_transfer': company.orsquare_auto_godown_transfer,
                'continuous_scanning': company.orsquare_continuous_scanning,
                'default_payment_mode': company.orsquare_default_payment_mode,
            },
            'variants': {'stock': company.orsquare_stock_variant, 'accounts': company.orsquare_accounts_variant},
            'settings_version': company.orsquare_settings_version,
        }

    # ------------------------------------------------------------------ staff
    @api.model
    def _staff_domain(self):
        groups = [self.env.ref(g) for g in ROLE_GROUPS.values()]
        return [('company_id', '=', self.env.company.id), ('groups_id', 'in', [g.id for g in groups])]

    @api.model
    def _staff_row(self, u):
        return {
            'id': u.id, 'name': u.name, 'login': u.login, 'active': u.active, 'roles': u.orsquare_roles(),
            'flags': {k: u.has_group(g) for k, g in FLAG_GROUPS.items()},
            'tabs': u.orsquare_effective_tabs(), 'granted_tabs': u.orsquare_granted_tabs(),
            'mfa': bool(u.sudo().totp_enabled),
        }

    @api.model
    def list_staff(self):
        self._require_owner()
        users = self.sudo().env['res.users'].with_context(active_test=False).search(
            self._staff_domain(), order='active desc, name')
        return [self._staff_row(u) for u in users]

    @api.model
    def _group_ids(self, roles, flags, tabs=None):
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
        for tab in tabs or []:
            ids.append(self.env.ref(TAB_GROUP % tab).id)
        return ids

    @api.model
    def _clean_tabs(self, tabs):
        bad = [t for t in (tabs or []) if t not in ALL_TABS]
        if bad:
            raise UserError(_("Unknown tab(s): %s", ", ".join(sorted(set(bad)))))
        return [t for t in ALL_TABS if t in set(tabs or [])]

    @api.model
    def _check_password(self, password):
        if len(password or '') < MIN_PASSWORD:
            raise UserError(_("The password must be at least %s characters.", MIN_PASSWORD))
        self.env['res.users']._check_password_policy([password])

    @api.model
    def _active_staff_count(self):
        return self.sudo().env['res.users'].search_count(self._staff_domain())

    @api.model
    def create_staff(self, name, login, password, roles, flags=None, tabs=None, phone=None):
        self._require_owner()
        login = directory.normalize(login)
        if not login or not (name or '').strip():
            raise UserError(_("A name and a login are required."))
        self._check_password(password)
        if not roles:
            raise UserError(_("Choose a role."))
        limit = int(self.env.company.orsquare_entitlements().get('max_staff') or 0)
        if limit and self._active_staff_count() >= limit:
            raise UserError(_("Your plan allows %s staff accounts. Disable one or ask to upgrade.", limit))
        env = self.sudo().env
        if env['res.users'].with_context(active_test=False).search_count([('login', '=', login)]):
            raise UserError(_("The login '%s' is already taken.", login))
        if tabs is None:
            granted = []
            for role in roles:
                granted += ROLE_DEFAULT_TABS.get(role, [])
            tabs = granted
        tabs = self._clean_tabs(tabs)
        phone = (phone or '').strip() or False
        claimed = directory.claim(self.env, [login, phone])
        try:
            user = env['res.users'].create({
                'name': name.strip(), 'login': login, 'password': password, 'company_id': self.env.company.id,
                'company_ids': [(6, 0, [self.env.company.id])],
                'groups_id': [(6, 0, self._group_ids(roles, flags, tabs) + [self.env.ref('base.group_user').id])],
            })
            if phone:
                user.partner_id.write({'phone': phone})        # they can also sign in with their number
        except Exception:
            directory.release(self.env, claimed)
            raise
        self._audit('staff', 'created', login, after={'roles': roles, 'flags': flags or {}, 'tabs': tabs})
        return user.id

    @api.model
    def _staff_user(self, user_id):
        user = self.sudo().env['res.users'].with_context(active_test=False).browse(int(user_id)).exists()
        if not user or user.company_id != self.env.company or user.id == 1:
            raise UserError(_("Unknown staff member."))
        return user

    @api.model
    def update_staff(self, user_id, roles=None, flags=None, tabs=None, active=None):
        self._require_owner()
        user = self._staff_user(user_id)
        if user == self.env.user and (active is False or (roles is not None and 'owner' not in roles)):
            raise UserError(_("You cannot remove your own owner access."))
        before = self._staff_row(user)
        vals = {}
        if roles is not None or flags is not None or tabs is not None:
            current_roles = roles if roles is not None else user.orsquare_roles()
            # a partial `flags` only changes the switches it names
            current_flags = {k: user.has_group(g) for k, g in FLAG_GROUPS.items()}
            current_flags.update(flags or {})
            current_tabs = self._clean_tabs(tabs) if tabs is not None else user.orsquare_granted_tabs()
            managed = [self.env.ref(g).id for g in list(ROLE_GROUPS.values()) + list(FLAG_GROUPS.values())
                       + [TAB_GROUP % t for t in ALL_TABS]]
            keep = [g.id for g in user.groups_id if g.id not in managed]
            vals['groups_id'] = [(6, 0, keep + self._group_ids(current_roles, current_flags, current_tabs))]
        if active is not None:
            vals['active'] = bool(active)
        if vals:
            user.write(vals)
        after = self._staff_row(user)
        if before != after:
            self._audit('staff', 'updated', user.login, before=before, after=after)
        return True

    @api.model
    def reset_staff_password(self, user_id, new_password):
        """Owner sets a new password for a staff member. Their other sessions end (the session token follows the
        password)."""
        self._require_owner()
        user = self._staff_user(user_id)
        self._check_password(new_password)
        user.write({'password': new_password})
        self._audit('security', 'password_reset', user.login)
        return True

    @api.model
    def reset_staff_mfa(self, user_id):
        """Owner removes a staff member's authenticator (lost phone). They can enrol a new one at next sign-in."""
        self._require_owner()
        user = self._staff_user(user_id)
        user.sudo().write({'totp_secret': False})
        self._audit('security', 'mfa_reset', user.login)
        return True

    @api.model
    def audit_log(self, limit=50, offset=0, kind=None, target=None):
        self._require_owner()
        return self.env['orsquare.config_audit'].page(limit, offset, kind, target)

    # ------------------------------------------------------------------ presets
    @api.model
    def list_presets(self):
        return [{'code': code, 'name': p['name'], 'description': p['description'], 'version': PRESET_VERSION,
                 'values': p['values']} for code, p in PRESETS.items()]

    @api.model
    def apply_preset(self, name, expected_version=None):
        """Apply a shop preset (tabs, features, stock view). Everything stays adjustable afterwards; nothing is
        deleted. Features/tabs outside the plan are left off."""
        self._require_owner()
        if name not in PRESETS:
            raise UserError(_("Unknown preset '%s'.", name))
        company = self.env.company
        values = dict(PRESETS[name]['values'])
        for feature in FEATURES:
            if values.get('orsquare_feature_%s' % feature) and not company.orsquare_feature_entitled(feature):
                values['orsquare_feature_%s' % feature] = False
        entitled = set(company.orsquare_entitled_tabs())
        values['orsquare_enabled_tabs'] = [t for t in values['orsquare_enabled_tabs'] if t in entitled]
        return self._write_settings(values, expected_version, preset=name)

    # ------------------------------------------------------------------ settings (Business Studio)
    @api.model
    def get_settings(self):
        require_staff(self.env)
        company = self.env.company
        out = {f: company[f] for f in SETTINGS_FIELDS}
        out['orsquare_tab_catalog'] = ORSQUARE_TABS
        out['orsquare_settings_version'] = company.orsquare_settings_version
        return out

    @api.model
    def get_experience(self):
        """Everything the Business Studio screen needs in one call: current choices, what the plan allows, the
        catalog of tabs/variants/presets and the version to send back when saving."""
        self._require_owner()
        company = self.env.company
        ent = company.orsquare_entitlements()
        entitled_tabs = set(company.orsquare_entitled_tabs())
        enabled = set(company.orsquare_tab_list())
        return {
            'version': company.orsquare_settings_version,
            'profile': company.orsquare_profile or '',
            'preset_version': company.orsquare_preset_version or 0,
            'current_preset_version': PRESET_VERSION,
            'plan': ent.get('plan') or '',
            'max_staff': int(ent.get('max_staff') or 0),
            'staff_count': self._active_staff_count(),
            'tabs': [{'key': k, 'label': n, 'enabled': k in enabled, 'entitled': k in entitled_tabs}
                     for k, n in ORSQUARE_TABS],
            'features': [{'key': f, 'on': bool(company['orsquare_feature_%s' % f]),
                          'entitled': company.orsquare_feature_entitled(f)} for f in FEATURES],
            'variants': {
                'stock': {'value': company.orsquare_stock_variant, 'options': [list(o) for o in STOCK_VARIANTS]},
                'accounts': {'value': company.orsquare_accounts_variant, 'options': [list(o) for o in ACCOUNTS_VARIANTS]},
            },
            'presets': self.list_presets(),
            'settings': self.get_settings(),
        }

    @api.model
    def update_settings(self, values, expected_version=None):
        self._require_owner()
        return self._write_settings(values, expected_version)

    @api.model
    def _write_settings(self, values, expected_version=None, preset=None):
        unknown = set(values) - set(SETTINGS_FIELDS)
        if unknown:
            raise UserError(_("Unknown setting(s): %s", ", ".join(sorted(unknown))))
        company = self.env.company.sudo()
        if expected_version is not None and int(expected_version) != company.orsquare_settings_version:
            raise ConflictError(_("Someone else changed these settings. Reload to see their changes, then try again."))
        vals = dict(values)
        if isinstance(vals.get('orsquare_enabled_tabs'), (list, tuple)):
            vals['orsquare_enabled_tabs'] = ','.join(t for t in ALL_TABS if t in set(vals['orsquare_enabled_tabs']))
        # the plan is a ceiling: you cannot switch on what it does not include
        for feature in FEATURES:
            key = 'orsquare_feature_%s' % feature
            if vals.get(key) and not company.orsquare_feature_entitled(feature):
                raise UserError(_("Your plan does not include this feature."))
        if 'orsquare_enabled_tabs' in vals:
            wanted = {t for t in vals['orsquare_enabled_tabs'].split(',') if t}
            if 'settings' not in wanted:
                raise UserError(_("The Settings tab cannot be switched off: it is where Business Studio lives."))
            if wanted - set(company.orsquare_entitled_tabs()):
                raise UserError(_("Your plan does not include one of those tabs."))
        before = {k: company[k] for k in vals}
        changed = {k: v for k, v in vals.items() if self._differs(company, k, v)}
        if preset:
            changed['orsquare_profile'] = preset
            changed['orsquare_preset_version'] = PRESET_VERSION
        if not changed:
            return {'version': company.orsquare_settings_version, 'changed': []}
        company.write(dict(changed, orsquare_settings_version=company.orsquare_settings_version + 1))
        if 'orsquare_feature_tables' in changed:
            self.env['orsquare.shop.bootstrap'].sync_restaurant_mode(company)
        self._audit('preset' if preset else 'settings', 'applied' if preset else 'changed',
                    preset or ', '.join(sorted(changed)),
                    before={k: before[k] for k in changed if k in before},
                    after={k: company[k] for k in changed})
        self.env['orsquare.event'].publish(company, 'settings_changed', {'keys': sorted(changed)})
        return {'version': company.orsquare_settings_version, 'changed': sorted(changed)}

    @staticmethod
    def _differs(company, field, new):
        old = company[field]
        if isinstance(old, float) or isinstance(new, float):
            return abs(float(old or 0) - float(new or 0)) > 1e-9
        return (old or False) != (new or False)
