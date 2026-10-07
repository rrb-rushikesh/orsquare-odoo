# -*- coding: utf-8 -*-
"""Developer Console service: everything an operator can do, behind two operator levels.

* ``admin``   may change anything.
* ``support`` may look (fleet, shop detail, audit, system) but never change.

Both need an authenticator app (``orsquare.platform.require_mfa``, on unless explicitly set to 0). The console never
reads shop business data: it keeps the registry, clones the template database to provision, and applies operator
actions through a shop's own services (so every rule and every governance-log entry of the shop still applies).
Every action is written to the append-only audit trail. All lists are paged on the server and answered from indexed
columns, so the cost of a screen does not grow with the size of the fleet.
"""
import logging
import time
from datetime import timedelta

import odoo
from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError
from odoo.release import version as odoo_version

from odoo.addons.orsquare.models import directory
from odoo.addons.orsquare.models.presets import ALL_TABS, FEATURES
from .platform import SLUG_RE, drop_database, shop_env

_logger = logging.getLogger(__name__)

PLATFORM_DB_KEY = 'orsquare_platform'
EXPIRING_DAYS = 7
MAX_PAGE = 200
OPERATOR_MIN_PASSWORD = 12
FLEET_ORDER = {
    'created': 'create_date', 'name': 'name', 'code': 'code', 'plan': 'plan',
    'expires': 'expires_on', 'status': 'status', 'owner': 'owner_name',
}


class PlatformService(models.AbstractModel):
    _name = 'orsquare.platform.service'
    _description = "Developer Console service"

    # ------------------------------------------------------------------ operator levels
    @api.model
    def _role(self, user=None):
        user = user or self.env.user
        if user.has_group('orsquare_platform.group_platform_admin') or user.has_group('base.group_system'):
            return 'admin'
        if user.has_group('orsquare_platform.group_platform_support'):
            return 'support'
        return None

    @api.model
    def _mfa_required(self):
        return self.env['ir.config_parameter'].sudo().get_param('orsquare.platform.require_mfa', '1') != '0'

    @api.model
    def _require_dev(self, write=False, enrolled=True):
        """Operators only. ``write`` needs the admin level; ``enrolled`` needs the authenticator (everything but
        ``me`` so the console can show the enrolment step)."""
        if self.env.su:
            return
        role = self._role()
        if not role:
            raise AccessError(_("Platform operators only."))
        if write and role != 'admin':
            raise AccessError(_("Your operator level is read-only. Ask a platform admin."))
        if enrolled and self._mfa_required() and not self.env.user.sudo().totp_enabled:
            raise AccessError(_("Set up your authenticator app before using the console."))

    @api.model
    def _log(self, action, shop_code=None, detail=None):
        self.env['orsquare.platform.audit'].sudo().create({
            'actor': self.env.user.login or 'system', 'action': action, 'shop_code': shop_code, 'detail': detail or ''})

    @api.model
    def _actor(self):
        return 'platform:%s' % (self.env.user.login or 'system')

    @api.model
    def _page(self, page, page_size):
        page_size = max(1, min(int(page_size or 50), MAX_PAGE))
        page = max(1, int(page or 1))
        return page, page_size

    # ------------------------------------------------------------------ registry helpers
    @api.model
    def _shop(self, code):
        shop = self.env['orsquare.platform.shop'].sudo().search([('code', '=', code)], limit=1)
        if not shop:
            raise UserError(_("Unknown shop '%s'.", code))
        return shop

    @api.model
    def _today(self):
        return fields.Date.context_today(self)

    @api.model
    def _lifecycle(self, shop):
        """Same rule as the SQL used for the counts and filters below (a test keeps them in step)."""
        if shop.status in ('suspended', 'archived'):
            return shop.status
        if shop.expires_on:
            days = (shop.expires_on - self._today()).days
            if days < 0:
                return 'expired'
            if days <= EXPIRING_DAYS:
                return 'expiring'
        return 'trial' if shop.plan == 'trial' else 'active'

    @api.model
    def _lifecycle_domain(self, name):
        today = self._today()
        soon = today + timedelta(days=EXPIRING_DAYS)
        live = [('status', '=', 'active')]
        later = ['|', ('expires_on', '=', False), ('expires_on', '>', soon)]
        return {
            'suspended': [('status', '=', 'suspended')],
            'archived': [('status', '=', 'archived')],
            'expired': live + [('expires_on', '<', today)],
            'expiring': live + [('expires_on', '>=', today), ('expires_on', '<=', soon)],
            'trial': live + [('plan', '=', 'trial')] + later,
            'active': live + [('plan', '!=', 'trial')] + later,
        }.get(name)

    @api.model
    def _lifecycle_counts(self):
        self.env['orsquare.platform.shop'].flush_model()
        today = self._today()
        self.env.cr.execute("""
            SELECT CASE WHEN status = 'archived' THEN 'archived'
                        WHEN status = 'suspended' THEN 'suspended'
                        WHEN expires_on IS NOT NULL AND expires_on < %(today)s THEN 'expired'
                        WHEN expires_on IS NOT NULL AND expires_on <= %(soon)s THEN 'expiring'
                        WHEN plan = 'trial' THEN 'trial' ELSE 'active' END AS lc, count(*)
              FROM orsquare_platform_shop GROUP BY 1""",
                            {'today': today, 'soon': today + timedelta(days=EXPIRING_DAYS)})
        return dict(self.env.cr.fetchall())

    @api.model
    def _row(self, shop):
        return {
            'code': shop.code, 'name': shop.name, 'owner_name': shop.owner_name or '', 'owner_login': shop.owner_login or '',
            'phone': shop.phone or '', 'plan': shop.plan, 'status': shop.status, 'lifecycle': self._lifecycle(shop),
            'expires_on': str(shop.expires_on or ''), 'suspended_reason': shop.suspended_reason or '',
            'created_at': shop.create_date.isoformat() if shop.create_date else None, 'preset': shop.preset or '',
        }

    @api.model
    def _plan(self, code):
        plan = self.env['orsquare.platform.plan'].sudo().search([('code', '=', code)], limit=1)
        if not plan:
            raise UserError(_("Unknown plan '%s'.", code))
        return plan

    @api.model
    def _push_entitlements(self, code, plan_code):
        """Tell the shop what its plan allows. Nothing in the shop is deleted: it only caps what is effective."""
        import json
        payload = self._plan(plan_code).entitlements()
        with shop_env(code) as env:
            env['ir.config_parameter'].sudo().set_param('orsquare.entitlements', json.dumps(payload))

    @api.model
    def _set_shop_blocked(self, code, blocked):
        with shop_env(code) as env:
            env['ir.config_parameter'].sudo().set_param('orsquare.suspended', '1' if blocked else '0')

    # ------------------------------------------------------------------ identity
    @api.model
    def me(self):
        self._require_dev(enrolled=False)
        user = self.env.user
        role = self._role() or 'admin'
        return {
            'id': user.id,
            'name': user.name,
            'login': user.login,
            'surface': 'dev',
            'roles': ['developer'],
            'platform_role': role,
            'mfa': {'enabled': bool(user.sudo().totp_enabled), 'required': self._mfa_required()},
            'flags': {'can_see_money': True, 'can_see_valuation': True, 'can_manage_returns': True},
            'tabs': [],
            'company': {
                'id': user.company_id.id if user.company_id else 0,
                'name': user.company_id.name if user.company_id else 'ORSquare Platform',
                'currency': 'INR',
                'tz': user.tz or 'Asia/Kolkata',
                'gstin': '',
                'business_date': str(self._today()),
            },
            'features': {},
            'shop': PLATFORM_DB_KEY,
        }

    # ------------------------------------------------------------------ fleet
    @api.model
    def _shop_domain(self, search=None, lifecycle=None, plan=None):
        domain = []
        q = (search or '').strip()
        if q:
            domain += ['|', '|', '|', '|', ('name', 'ilike', q), ('code', 'ilike', q), ('owner_name', 'ilike', q),
                       ('owner_login', 'ilike', q), ('phone', 'ilike', q)]
        if lifecycle:
            lc = self._lifecycle_domain(lifecycle)
            if lc is None:
                raise UserError(_("Unknown lifecycle '%s'.", lifecycle))
            domain += lc
        if plan:
            domain.append(('plan', '=', plan))
        return domain

    @api.model
    def fleet(self, search=None, lifecycle=None, plan=None, page=1, page_size=50, sort='created', desc=True):
        """One page of the fleet plus the fleet-wide counts. Server-side search, filter, sort and paging."""
        self._require_dev()
        page, page_size = self._page(page, page_size)
        column = FLEET_ORDER.get(sort)
        if not column:
            raise UserError(_("Cannot sort by '%s'.", sort))
        direction = 'desc' if desc else 'asc'
        order = '%s %s%s, id desc' % (column, direction, ' nulls last' if column == 'expires_on' else '')
        shops = self.env['orsquare.platform.shop'].sudo()
        domain = self._shop_domain(search, lifecycle, plan)
        rows = shops.search(domain, order=order, limit=page_size, offset=(page - 1) * page_size)
        counts = self._lifecycle_counts()
        return {
            'rows': [self._row(s) for s in rows], 'total': shops.search_count(domain),
            'page': page, 'page_size': page_size, 'counts': counts, 'grand_total': sum(counts.values()),
        }

    @api.model
    def shop_detail(self, code):
        """Registry row plus a live look inside the shop: staff, health and what its plan allows."""
        self._require_dev()
        shop = self._shop(code)
        detail = self._row(shop)
        try:
            with shop_env(code) as env:
                detail['staff'] = env['orsquare.staff.service'].list_staff()
            detail['health'] = self.shop_health(code)
        except Exception as exc:     # a broken shop must still be manageable (suspend, archive, delete)
            _logger.warning("Could not look inside %s", code, exc_info=True)
            detail['staff'] = []
            detail['health'] = None
            detail['live_error'] = str(exc)[:300]
        return detail

    @api.model
    def shop_health(self, code):
        self._require_dev()
        self._shop(code)
        template = self.env['ir.config_parameter'].sudo().get_param('orsquare.platform.template_db', 'orsquare_template')
        with shop_env(code) as env:
            env.cr.execute("SELECT latest_version FROM ir_module_module WHERE name = 'orsquare'")
            row = env.cr.fetchone()
            env.cr.execute("SELECT pg_database_size(current_database())")
            size = env.cr.fetchone()[0]
            company = env.company
            params = env['ir.config_parameter'].sudo()
            day = env['orsquare.business_day'].search([], order='id desc', limit=1)
            from odoo.addons.orsquare.models.presets import PRESET_VERSION
            health = {
                'module_version': row[0] if row else None, 'db_size_bytes': size,
                'staff_count': env['orsquare.staff.service']._active_staff_count(),
                'last_day': str(day.date) if day else None, 'day_state': day.state if day else None,
                'settings_version': company.orsquare_settings_version, 'profile': company.orsquare_profile or '',
                'preset_version': company.orsquare_preset_version or 0, 'current_preset_version': PRESET_VERSION,
                'blocked': params.get_param('orsquare.suspended') == '1',
                'directory': params.get_param('orsquare.directory_enabled') == '1',
                'entitlements': company.orsquare_entitlements(),
            }
        try:
            with shop_env(template) as tenv:
                tenv.cr.execute("SELECT latest_version FROM ir_module_module WHERE name = 'orsquare'")
                trow = tenv.cr.fetchone()
                health['template_version'] = trow[0] if trow else None
        except Exception:
            health['template_version'] = None
        health['needs_upgrade'] = bool(health['template_version'] and health['module_version'] != health['template_version'])
        return health

    # ------------------------------------------------------------------ provisioning
    @api.model
    def _key_owner(self, key):
        """Who owns a sign-in key: this transaction's view first, then the latest committed state (a shop reserves its
        staff logins on its own connection, which this transaction's snapshot may not show yet)."""
        cr = self.env.cr
        cr.execute("SELECT shop_code FROM orsquare_platform_login WHERE key = %s", (key,))
        row = cr.fetchone()
        if row:
            return row[0]
        with odoo.sql_db.db_connect(cr.dbname).cursor() as fresh:
            fresh.execute("SELECT shop_code FROM orsquare_platform_login WHERE key = %s", (key,))
            row = fresh.fetchone()
        return row[0] if row else None

    @api.model
    def _claim(self, code, keys, kind):
        """Reserve sign-in keys for a shop in the platform directory: atomic, so two requests can never both win a key."""
        import psycopg2.errors
        cr = self.env.cr
        for key in [k for k in dict.fromkeys(directory.normalize(k) for k in keys) if k]:
            try:
                with cr.savepoint():
                    cr.execute("""
                        INSERT INTO orsquare_platform_login (key, shop_code, kind, create_date, write_date)
                        VALUES (%s, %s, %s, now() at time zone 'utc', now() at time zone 'utc')
                        ON CONFLICT (key) DO NOTHING RETURNING id""", (key, code, kind))
                    if cr.fetchone():
                        continue
            except (psycopg2.errors.SerializationFailure, psycopg2.errors.UniqueViolation):
                pass
            owner = self._key_owner(key)
            if owner and owner != code:
                raise UserError(_("The login '%s' is already used by another shop or operator.", key))
        self.env['orsquare.platform.login'].invalidate_model()

    @api.model
    def create_shop(self, name, slug, owner_name, owner_login, owner_password, phone=None, preset='wine_shop',
                    plan='trial', trial_days=14, state_code='MH'):
        """Clone the template database into ``orsquare_shop_<slug>`` and make it a ready shop with its owner."""
        self._require_dev(write=True)
        from odoo.addons.orsquare.models.presets import PRESETS
        slug = (slug or '').strip().lower()
        if not SLUG_RE.match(slug):
            raise UserError(_("The shop code may only use a-z, 0-9 and _ (2 to 30 characters)."))
        if preset not in PRESETS:
            raise UserError(_("Unknown preset '%s'.", preset))
        if len(owner_password or '') < 8:
            raise UserError(_("The owner password needs at least 8 characters."))
        if not (name or '').strip() or not (owner_login or '').strip():
            raise UserError(_("The shop name and the owner login are required."))
        self._plan(plan)
        owner_login = directory.normalize(owner_login)
        phone = (phone or '').strip() or False
        code = 'orsquare_shop_%s' % slug
        if self.env['orsquare.platform.shop'].sudo().search_count([('code', '=', code)]) or odoo.service.db.exp_db_exist(code):
            raise UserError(_("The shop code '%s' is already taken.", slug))
        self._claim(code, [owner_login, phone], 'owner')      # fails fast, before the expensive clone
        params = self.env['ir.config_parameter'].sudo()
        template = params.get_param('orsquare.platform.template_db', 'orsquare_template')
        t0 = time.monotonic()
        odoo.service.db.exp_duplicate_database(template, code)
        try:
            self._push_entitlements(code, plan)
            with shop_env(code, actor=self._actor()) as env:
                env['orsquare.shop.bootstrap'].configure_shop(
                    name=name.strip(), owner_name=owner_name or owner_login, owner_login=owner_login,
                    owner_password=owner_password, state_code=state_code, preset=preset, phone=phone)
                sp = env['ir.config_parameter'].sudo()
                origins = params.get_param('orsquare.platform.shop_origins')
                if origins:
                    sp.set_param('orsquare.allowed_origins', origins)
                app = params.get_param('orsquare.app_url')
                if app:
                    sp.set_param('orsquare.app_url', app)
                # from now on the shop reserves every new staff login in the platform directory
                sp.set_param('orsquare.platform_db', self.env.cr.dbname)
                sp.set_param('orsquare.directory_enabled', '1')
        except Exception:
            _logger.exception("Provisioning %s failed; removing the half-made database", code)
            drop_database(code)
            raise
        shop = self.env['orsquare.platform.shop'].sudo().create({
            'name': name.strip(), 'code': code, 'owner_name': owner_name, 'owner_login': owner_login,
            'phone': phone, 'plan': plan, 'preset': preset,
            'expires_on': self._today() + timedelta(days=int(trial_days)) if trial_days else False})
        self._log('create_shop', code, '%s (%s), preset %s, %.1fs' % (name.strip(), plan, preset, time.monotonic() - t0))
        return self._row(shop)

    # ------------------------------------------------------------------ lifecycle
    @api.model
    def suspend(self, code, reason):
        self._require_dev(write=True)
        if not (reason or '').strip():
            raise UserError(_("Give a reason: it is recorded in the audit trail."))
        shop = self._shop(code)
        self._set_shop_blocked(code, True)
        shop.write({'status': 'suspended', 'suspended_reason': reason.strip()})
        self._log('suspend', code, reason.strip())
        return self._row(shop)

    @api.model
    def reactivate(self, code):
        """Bring a suspended or archived shop back."""
        self._require_dev(write=True)
        shop = self._shop(code)
        self._set_shop_blocked(code, False)
        shop.write({'status': 'active', 'suspended_reason': False})
        self._log('reactivate', code)
        return self._row(shop)

    @api.model
    def archive(self, code, reason=None):
        """Retire a shop: blocked like a suspension, kept intact, and the only state a shop can be deleted from."""
        self._require_dev(write=True)
        shop = self._shop(code)
        self._set_shop_blocked(code, True)
        shop.write({'status': 'archived', 'suspended_reason': (reason or '').strip() or False})
        self._log('archive', code, (reason or '').strip())
        return self._row(shop)

    @api.model
    def delete_shop(self, code, confirm):
        """Permanently remove an archived shop: its database, its files, its registry row and its sign-in keys."""
        self._require_dev(write=True)
        shop = self._shop(code)
        if shop.status != 'archived':
            raise UserError(_("Only an archived shop can be deleted. Archive it first."))
        if (confirm or '').strip() != code:
            raise UserError(_("Type the shop code exactly to confirm."))
        name = shop.name
        self.env['orsquare.platform.login'].sudo().search([('shop_code', '=', code)]).unlink()
        shop.unlink()
        self._log('delete_shop', code, name)
        # The row is removed in this transaction and the database dropped now: if the DROP fails the whole request
        # rolls back and the shop is still listed; if the commit were ever lost after a DROP, deleting again is
        # harmless (dropping a missing database is a no-op) and clears the ghost row.
        drop_database(code)
        return True

    @api.model
    def reset_owner_password(self, code, new_password):
        self._require_dev(write=True)
        shop = self._shop(code)
        with shop_env(code, actor=self._actor()) as env:
            owner = env['res.users'].search([('login', '=', shop.owner_login)], limit=1)
            if not owner:
                raise UserError(_("The owner account was not found in this shop."))
            env['orsquare.staff.service'].reset_staff_password(owner.id, new_password)
        self._log('reset_owner_password', code, shop.owner_login)
        return True

    @api.model
    def set_expiry(self, code, expires_on, plan=None):
        self._require_dev(write=True)
        shop = self._shop(code)
        vals = {'expires_on': expires_on or False}
        if plan and plan != shop.plan:
            self._plan(plan)
            vals['plan'] = plan
        if 'plan' in vals:
            self._push_entitlements(code, plan)
        shop.write(vals)
        self._log('set_expiry', code, '%s %s' % (vals.get('plan', shop.plan), expires_on or 'no expiry'))
        return self._row(shop)

    @api.model
    def extend(self, code, days):
        """Move the expiry date by ``days`` (negative shortens). From today if the shop has none or it has passed."""
        self._require_dev(write=True)
        shop = self._shop(code)
        today = self._today()
        base = shop.expires_on if shop.expires_on and shop.expires_on > today else today
        shop.expires_on = base + timedelta(days=int(days))
        self._log('extend', code, '%+d days -> %s' % (int(days), shop.expires_on))
        return self._row(shop)

    # ------------------------------------------------------------------ inside a shop: Business Studio, staff, log
    @api.model
    def shop_experience(self, code):
        self._require_dev()
        self._shop(code)
        with shop_env(code) as env:
            return env['orsquare.staff.service'].get_experience()

    @api.model
    def studio_apply(self, code, values=None, preset=None, expected_version=None):
        """Operator-side Business Studio: change a shop's tabs/features/variants, or apply a preset."""
        self._require_dev(write=True)
        self._shop(code)
        with shop_env(code, actor=self._actor()) as env:
            staff = env['orsquare.staff.service']
            if preset:
                staff.apply_preset(preset, expected_version)
                expected_version = None
            if values:
                staff.update_settings(values, expected_version)
            result = staff.get_experience()
        self._log('studio', code, ('preset %s' % preset) if preset else ', '.join(sorted(values or {})))
        return result

    @api.model
    def shop_staff(self, code):
        self._require_dev()
        self._shop(code)
        with shop_env(code) as env:
            return env['orsquare.staff.service'].list_staff()

    @api.model
    def shop_staff_create(self, code, name, login, password, roles, flags=None, tabs=None, phone=None):
        self._require_dev(write=True)
        self._shop(code)
        with shop_env(code, actor=self._actor()) as env:
            uid = env['orsquare.staff.service'].create_staff(name, login, password, roles, flags, tabs, phone)
            staff = env['orsquare.staff.service'].list_staff()
        self._log('staff_create', code, directory.normalize(login))
        return {'id': uid, 'staff': staff}

    @api.model
    def shop_staff_update(self, code, user_id, roles=None, flags=None, tabs=None, active=None):
        self._require_dev(write=True)
        self._shop(code)
        with shop_env(code, actor=self._actor()) as env:
            env['orsquare.staff.service'].update_staff(user_id, roles, flags, tabs, active)
            staff = env['orsquare.staff.service'].list_staff()
        self._log('staff_update', code, str(user_id))
        return staff

    @api.model
    def shop_staff_reset_password(self, code, user_id, new_password):
        self._require_dev(write=True)
        self._shop(code)
        with shop_env(code, actor=self._actor()) as env:
            env['orsquare.staff.service'].reset_staff_password(user_id, new_password)
        self._log('staff_reset_password', code, str(user_id))
        return True

    @api.model
    def shop_staff_reset_mfa(self, code, user_id):
        self._require_dev(write=True)
        self._shop(code)
        with shop_env(code, actor=self._actor()) as env:
            env['orsquare.staff.service'].reset_staff_mfa(user_id)
        self._log('staff_reset_mfa', code, str(user_id))
        return True

    @api.model
    def shop_audit(self, code, limit=50, offset=0, kind=None):
        """The shop's own governance log (who changed which setting or role, before and after)."""
        self._require_dev()
        self._shop(code)
        with shop_env(code) as env:
            return env['orsquare.staff.service'].audit_log(limit, offset, kind)

    # ------------------------------------------------------------------ plans & entitlements
    @api.model
    def plans(self):
        self._require_dev()
        self.env['orsquare.platform.shop'].flush_model()
        self.env.cr.execute("SELECT plan, count(*) FROM orsquare_platform_shop GROUP BY plan")
        used = dict(self.env.cr.fetchall())
        out = []
        for plan in self.env['orsquare.platform.plan'].sudo().search([]):
            d = plan.as_dict()
            d['shops'] = used.get(plan.code, 0)
            out.append(d)
        return {'plans': out, 'features': list(FEATURES), 'tabs': list(ALL_TABS)}

    @api.model
    def save_plan(self, code, name, features=None, tabs=None, max_staff=0, description=None, sequence=None):
        self._require_dev(write=True)
        Plan = self.env['orsquare.platform.plan'].sudo()
        plan = Plan.search([('code', '=', code)], limit=1)
        vals = {'name': (name or '').strip(), 'features': ','.join(features or []), 'tabs': ','.join(tabs or []),
                'max_staff': int(max_staff or 0), 'description': description or False}
        if not vals['name']:
            raise UserError(_("A plan needs a name."))
        if sequence is not None:
            vals['sequence'] = int(sequence)
        if plan:
            plan.write(vals)
            self._log('plan_update', None, code)
        else:
            plan = Plan.create(dict(vals, code=(code or '').strip().lower()))
            self._log('plan_create', None, plan.code)
        return self.plans()

    @api.model
    def delete_plan(self, code):
        self._require_dev(write=True)
        plan = self._plan(code)
        if plan.builtin:
            raise UserError(_("A built-in plan cannot be deleted."))
        if self.env['orsquare.platform.shop'].sudo().search_count([('plan', '=', code)]):
            raise UserError(_("Shops are still on this plan. Move them first."))
        plan.unlink()
        self._log('plan_delete', None, code)
        return self.plans()

    @api.model
    def push_plan(self, code, offset=0, limit=25):
        """Send a plan's current limits to the shops on it, a slice at a time (the console loops until done)."""
        self._require_dev(write=True)
        self._plan(code)
        limit = max(1, min(int(limit or 25), 100))
        offset = max(0, int(offset or 0))
        shops = self.env['orsquare.platform.shop'].sudo()
        total = shops.search_count([('plan', '=', code)])
        batch = shops.search([('plan', '=', code)], order='id', limit=limit, offset=offset)
        failed = []
        for shop in batch:
            try:
                self._push_entitlements(shop.code, code)
            except Exception as exc:
                _logger.warning("Could not push plan %s to %s", code, shop.code, exc_info=True)
                failed.append({'code': shop.code, 'error': str(exc)[:200]})
        nxt = offset + len(batch)
        if nxt >= total:
            self._log('plan_push', None, '%s -> %s shops' % (code, total))
        return {'total': total, 'done': min(nxt, total), 'next_offset': nxt if nxt < total else None, 'failed': failed}

    # ------------------------------------------------------------------ operators
    @api.model
    def _operator_users(self):
        Users = self.env['res.users'].sudo().with_context(active_test=False)
        admin = self.env.ref('orsquare_platform.group_platform_admin')
        support = self.env.ref('orsquare_platform.group_platform_support')
        system = self.env.ref('base.group_system')
        return Users.search([('groups_id', 'in', [admin.id, support.id, system.id]), ('id', '!=', 1)], order='active desc, name')

    @api.model
    def _operator_row(self, user):
        return {'id': user.id, 'name': user.name, 'login': user.login, 'active': user.active,
                'role': self._role(user), 'mfa': bool(user.sudo().totp_enabled)}

    @api.model
    def operators(self):
        self._require_dev(write=True)
        return [self._operator_row(u) for u in self._operator_users()]

    @api.model
    def _role_groups(self, role):
        if role not in ('admin', 'support'):
            raise UserError(_("Choose a level: admin or support."))
        return self.env.ref('orsquare_platform.group_platform_%s' % role)

    @api.model
    def _check_operator_password(self, password):
        if len(password or '') < OPERATOR_MIN_PASSWORD:
            raise UserError(_("An operator password needs at least %s characters.", OPERATOR_MIN_PASSWORD))
        self.env['res.users']._check_password_policy([password])

    @api.model
    def _operator(self, user_id):
        user = self.env['res.users'].sudo().with_context(active_test=False).browse(int(user_id)).exists()
        if not user or user.id == 1 or not self._role(user):
            raise UserError(_("Unknown operator."))
        return user

    @api.model
    def _admins_left(self, without):
        admins = [u for u in self._operator_users() if u.active and self._role(u) == 'admin' and u != without]
        return len(admins)

    @api.model
    def create_operator(self, name, login, password, role):
        self._require_dev(write=True)
        login = directory.normalize(login)
        if not login or not (name or '').strip():
            raise UserError(_("A name and a login are required."))
        group = self._role_groups(role)
        self._check_operator_password(password)
        Users = self.env['res.users'].sudo()
        if Users.with_context(active_test=False).search_count([('login', '=', login)]):
            raise UserError(_("The login '%s' is already taken.", login))
        self._claim(PLATFORM_DB_KEY, [login], 'operator')
        user = Users.create({'name': name.strip(), 'login': login, 'password': password,
                             'groups_id': [(6, 0, [self.env.ref('base.group_user').id, group.id])]})
        self._log('operator_create', None, '%s (%s)' % (login, role))
        return self._operator_row(user)

    @api.model
    def set_operator_role(self, user_id, role):
        self._require_dev(write=True)
        user = self._operator(user_id)
        group = self._role_groups(role)
        if user == self.env.user:
            raise UserError(_("You cannot change your own level."))
        if user.has_group('base.group_system'):
            raise UserError(_("This account is a system administrator; change it in the database."))
        if role != 'admin' and self._role(user) == 'admin' and self._admins_left(user) == 0:
            raise UserError(_("There must always be one active admin."))
        both = [self.env.ref('orsquare_platform.group_platform_admin').id, self.env.ref('orsquare_platform.group_platform_support').id]
        user.write({'groups_id': [(3, g) for g in both] + [(4, group.id)]})
        self._log('operator_role', None, '%s -> %s' % (user.login, role))
        return self._operator_row(user)

    @api.model
    def set_operator_active(self, user_id, active):
        self._require_dev(write=True)
        user = self._operator(user_id)
        if user == self.env.user and not active:
            raise UserError(_("You cannot deactivate yourself."))
        if not active and self._role(user) == 'admin' and self._admins_left(user) == 0:
            raise UserError(_("There must always be one active admin."))
        user.write({'active': bool(active)})
        self._log('operator_active', None, '%s -> %s' % (user.login, bool(active)))
        return self._operator_row(user)

    @api.model
    def reset_operator_password(self, user_id, new_password):
        self._require_dev(write=True)
        user = self._operator(user_id)
        self._check_operator_password(new_password)
        user.write({'password': new_password})
        self._log('operator_reset_password', None, user.login)
        return True

    @api.model
    def reset_operator_mfa(self, user_id):
        self._require_dev(write=True)
        user = self._operator(user_id)
        user.sudo().write({'totp_secret': False})
        self._log('operator_reset_mfa', None, user.login)
        return True

    # ------------------------------------------------------------------ audit & system
    @api.model
    def audit(self, page=1, page_size=50, shop_code=None, action=None, actor=None, q=None, date_from=None, date_to=None):
        """Audit trail, newest first, filtered and paged on the server."""
        self._require_dev()
        page, page_size = self._page(page, page_size)
        domain = []
        if shop_code:
            domain.append(('shop_code', '=', shop_code))
        if action:
            domain.append(('action', '=', action))
        if actor:
            domain.append(('actor', '=', actor))
        if q and q.strip():
            domain += ['|', '|', ('detail', 'ilike', q.strip()), ('shop_code', 'ilike', q.strip()), ('action', 'ilike', q.strip())]
        if date_from:
            domain.append(('create_date', '>=', '%s 00:00:00' % date_from))
        if date_to:
            domain.append(('create_date', '<=', '%s 23:59:59' % date_to))
        Audit = self.env['orsquare.platform.audit'].sudo()
        rows = Audit.search(domain, limit=page_size, offset=(page - 1) * page_size)
        total = Audit.search_count(domain)
        Audit.flush_model()
        self.env.cr.execute("SELECT DISTINCT action FROM orsquare_platform_audit ORDER BY 1")
        actions = [r[0] for r in self.env.cr.fetchall()]
        return {
            'rows': [{'id': a.id, 'at': a.create_date.isoformat(), 'actor': a.actor, 'action': a.action,
                      'shop_code': a.shop_code or '', 'detail': a.detail or ''} for a in rows],
            'total': total, 'page': page, 'page_size': page_size, 'actions': actions,
        }

    @api.model
    def _shop_database_names(self):
        """Every shop database in the cluster, read on a fresh connection (a long-running transaction's snapshot may
        predate a database that was just created)."""
        with odoo.sql_db.db_connect('postgres').cursor() as cr:
            cr.execute("SELECT datname FROM pg_database WHERE datname LIKE 'orsquare\\_shop%%' ORDER BY datname")
            return [r[0] for r in cr.fetchall()]

    @api.model
    def _unregistered(self, names=None):
        self.env['orsquare.platform.shop'].flush_model()
        self.env.cr.execute("SELECT code FROM orsquare_platform_shop")
        registered = {r[0] for r in self.env.cr.fetchall()}
        return [n for n in (names if names is not None else self._shop_database_names()) if n not in registered]

    @api.model
    def system(self):
        self._require_dev()
        self.env['orsquare.platform.login'].flush_model()
        params = self.env['ir.config_parameter'].sudo()
        template = params.get_param('orsquare.platform.template_db', 'orsquare_template')
        names = self._shop_database_names()
        dbs = len(names)
        unregistered = self._unregistered(names)
        self.env.cr.execute("SELECT plan, count(*) FROM orsquare_platform_shop GROUP BY plan")
        by_plan = dict(self.env.cr.fetchall())
        self.env.cr.execute("SELECT count(*) FROM orsquare_platform_login")
        keys = self.env.cr.fetchone()[0]
        self.env.cr.execute("SELECT pg_database_size(current_database())")
        size = self.env.cr.fetchone()[0]
        mod = self.env['ir.module.module'].sudo().search([('name', '=', 'orsquare_platform')], limit=1)
        template_info = {'db': template, 'exists': bool(odoo.service.db.exp_db_exist(template)), 'version': None}
        if template_info['exists']:
            try:
                with shop_env(template) as tenv:
                    tenv.cr.execute("SELECT latest_version FROM ir_module_module WHERE name = 'orsquare'")
                    row = tenv.cr.fetchone()
                    template_info['version'] = row[0] if row else None
            except Exception:
                _logger.warning("Could not read the template version", exc_info=True)
        return {
            'engine': 'Odoo %s' % odoo_version, 'platform_db': self.env.cr.dbname, 'platform_module': mod.latest_version,
            'server_time': fields.Datetime.to_string(fields.Datetime.now()), 'shop_databases': dbs,
            'registered_shops': sum(by_plan.values()), 'unregistered': unregistered[:50],
            'unregistered_count': len(unregistered), 'counts': self._lifecycle_counts(), 'plans': by_plan,
            'directory_keys': keys, 'operators': len(self._operator_users()), 'template': template_info,
            'require_mfa': self._mfa_required(), 'platform_db_bytes': size,
        }

    # ------------------------------------------------------------------ directory & adoption
    @api.model
    def rebuild_directory(self, offset=0, limit=25):
        """(Re)index every shop's sign-in keys in the platform directory, a slice of shops at a time, and switch each
        shop's directory on. Safe to repeat. The first slice also indexes the operators."""
        self._require_dev(write=True)
        limit = max(1, min(int(limit or 25), 100))
        offset = max(0, int(offset or 0))
        shops = self.env['orsquare.platform.shop'].sudo()
        total = shops.search_count([])
        batch = shops.search([], order='id', limit=limit, offset=offset)
        conflicts, failed = [], []
        if offset == 0:
            for user in self._operator_users():
                if user.active and user.login:
                    try:
                        self._claim(PLATFORM_DB_KEY, [user.login], 'operator')
                    except UserError as exc:
                        conflicts.append({'shop': PLATFORM_DB_KEY, 'error': str(exc)})
        for shop in batch:
            try:
                keys = [shop.owner_login, shop.phone]
                with shop_env(shop.code) as env:
                    # every way a staff member may type their sign-in: login, e-mail, phone, mobile
                    env.cr.execute("""
                        SELECT u.login, p.email, p.phone, p.mobile
                          FROM res_users u JOIN res_partner p ON p.id = u.partner_id
                         WHERE u.active AND u.id IN (
                               SELECT r.uid FROM res_groups_users_rel r
                                 JOIN ir_model_data d ON d.model = 'res.groups' AND d.res_id = r.gid AND d.module = 'orsquare'
                                WHERE d.name IN ('group_orsquare_owner', 'group_orsquare_cashier', 'group_orsquare_stockkeeper'))""")
                    for row in env.cr.fetchall():
                        keys += list(row)
                    sp = env['ir.config_parameter'].sudo()
                    sp.set_param('orsquare.platform_db', self.env.cr.dbname)
                    sp.set_param('orsquare.directory_enabled', '1')
                self._claim(shop.code, keys, 'staff')
                self.env['orsquare.platform.login'].sudo().search([
                    ('shop_code', '=', shop.code), ('key', 'in', [directory.normalize(shop.owner_login)])]).write({'kind': 'owner'})
            except UserError as exc:
                conflicts.append({'shop': shop.code, 'error': str(exc)})
            except Exception as exc:
                _logger.warning("Could not index %s", shop.code, exc_info=True)
                failed.append({'shop': shop.code, 'error': str(exc)[:200]})
        nxt = offset + len(batch)
        if nxt >= total:
            self._log('rebuild_directory', None, '%s shops' % total)
        return {'total': total, 'done': min(nxt, total), 'next_offset': nxt if nxt < total else None,
                'conflicts': conflicts, 'failed': failed}

    @api.model
    def _is_orsquare_shop(self, db_name):
        """Plain SQL, no registry load: is the ORSquare module installed in this database?"""
        try:
            with odoo.sql_db.db_connect(db_name).cursor() as cr:
                cr.execute("SELECT to_regclass('ir_module_module') IS NOT NULL")
                if not cr.fetchone()[0]:
                    return False
                cr.execute("SELECT 1 FROM ir_module_module WHERE name = 'orsquare' AND state = 'installed'")
                return bool(cr.fetchone())
        except Exception:
            return False

    @api.model
    def adopt_unregistered(self, db_name, plan='trial'):
        """Put an existing shop database that is not in the registry under management."""
        self._require_dev(write=True)
        if db_name not in self._unregistered():
            raise UserError(_("'%s' is not an unregistered shop database.", db_name))
        self._plan(plan)
        if not self._is_orsquare_shop(db_name):
            raise UserError(_("'%s' is not an ORSquare shop (the ORSquare module is not installed in it).", db_name))
        with shop_env(db_name) as env:
            owners = env['res.users'].with_context(active_test=False).search(
                [('groups_id', 'in', env.ref('orsquare.group_orsquare_owner').id), ('id', '!=', 1)], order='id', limit=1)
            if not owners:
                raise UserError(_("This database has no shop owner, so it cannot be adopted."))
            name, owner_name, owner_login = env.company.name, owners.name, owners.login
            phone = owners.partner_id.phone or env.company.partner_id.phone or False
        self._claim(db_name, [owner_login, phone], 'owner')
        self._push_entitlements(db_name, plan)
        shop = self.env['orsquare.platform.shop'].sudo().create({
            'name': name, 'code': db_name, 'owner_name': owner_name, 'owner_login': owner_login, 'phone': phone,
            'plan': plan})
        self._log('adopt_shop', db_name, name)
        return self._row(shop)
