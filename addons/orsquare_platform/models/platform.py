# -*- coding: utf-8 -*-
"""Platform operator layer: fleet registry, provisioning, suspension, studio and audit.

Lives in the platform database only.  A shop is still its own database; this module never reads shop business
data, it only (a) keeps the registry the Developer Console shows, (b) creates a shop by cloning the template
database with Odoo's own ``duplicate_database`` (SQL + filestore) and configuring it through the shop's own
``configure_shop``, and (c) applies operator actions to a shop through that shop's own services.
Every action is written to an append-only audit trail.
"""
import logging
import re
import time
from contextlib import contextmanager
from datetime import timedelta

import odoo
from odoo import SUPERUSER_ID, _, api, fields, models
from odoo.exceptions import AccessError, UserError
from odoo.release import version as odoo_version

_logger = logging.getLogger(__name__)

SLUG_RE = re.compile(r'^[a-z0-9_]{2,30}$')
PLANS = [('trial', 'Trial'), ('basic', 'Basic'), ('pro', 'Pro')]
PRESETS = ('wine_shop', 'bar', 'restaurant', 'grocery')


def drop_database(dbname):
    """Drop a shop database and its filestore.

    Own implementation (not ``exp_drop``, which silently does nothing when Odoo's database listing is
    restricted): release this process's pooled connections, end any other session on it, then DROP.
    """
    import os
    import shutil
    from contextlib import closing
    from odoo.modules.registry import Registry
    Registry.delete(dbname)
    odoo.sql_db.close_db(dbname)
    if not odoo.service.db.exp_db_exist(dbname):
        return False
    with closing(odoo.sql_db.db_connect('postgres').cursor()) as cr:
        cr._cnx.autocommit = True     # DROP DATABASE cannot run inside a transaction
        cr.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()", [dbname])
        cr.execute('DROP DATABASE "%s"' % dbname.replace('"', ''))
    filestore = odoo.tools.config.filestore(dbname)
    if os.path.exists(filestore):
        shutil.rmtree(filestore)
    return True


@contextmanager
def shop_env(dbname):
    """A superuser environment inside one shop database (committed on a clean exit)."""
    with odoo.registry(dbname).cursor() as cr:
        yield api.Environment(cr, SUPERUSER_ID, {})


class PlatformShop(models.Model):
    _name = 'orsquare.platform.shop'
    _description = "Registered shop (tenant)"
    _order = 'create_date desc, id desc'

    name = fields.Char(required=True)
    code = fields.Char(required=True, index=True, help="The shop's database name: what staff type at sign-in.")
    owner_name = fields.Char()
    owner_login = fields.Char()
    phone = fields.Char()
    plan = fields.Selection(PLANS, default='trial', required=True)
    status = fields.Selection([('active', 'Active'), ('suspended', 'Suspended')], default='active', required=True)
    expires_on = fields.Date()
    suspended_reason = fields.Char()
    preset = fields.Char()

    _sql_constraints = [('code_unique', 'unique(code)', "A shop with this code already exists.")]


class PlatformAudit(models.Model):
    """Append-only: nothing is ever edited or removed."""
    _name = 'orsquare.platform.audit'
    _description = "Operator audit trail"
    _order = 'id desc'

    actor = fields.Char(required=True)
    action = fields.Char(required=True)
    shop_code = fields.Char(index=True)
    detail = fields.Char()

    def write(self, vals):
        raise UserError(_("The audit trail is append-only."))

    def unlink(self):
        raise UserError(_("The audit trail is append-only."))


class PlatformService(models.AbstractModel):
    _name = 'orsquare.platform.service'
    _description = "Developer Console service"

    # ------------------------------------------------------------------ plumbing
    @api.model
    def _require_dev(self):
        if not (self.env.su or self.env.user.has_group('base.group_system')):
            raise AccessError(_("Platform developers only."))

    @api.model
    def _log(self, action, shop_code=None, detail=None):
        self.env['orsquare.platform.audit'].sudo().create({
            'actor': self.env.user.login or 'system', 'action': action, 'shop_code': shop_code, 'detail': detail or ''})

    @api.model
    def _shop(self, code):
        shop = self.env['orsquare.platform.shop'].search([('code', '=', code)], limit=1)
        if not shop:
            raise UserError(_("Unknown shop '%s'.", code))
        return shop

    @api.model
    def _lifecycle(self, shop):
        if shop.status == 'suspended':
            return 'suspended'
        if shop.expires_on:
            days = (shop.expires_on - fields.Date.context_today(self)).days
            if days < 0:
                return 'expired'
            if days <= 7:
                return 'expiring'
        return 'trial' if shop.plan == 'trial' else 'active'

    @api.model
    def _row(self, shop):
        return {
            'code': shop.code, 'name': shop.name, 'owner_name': shop.owner_name or '', 'owner_login': shop.owner_login or '',
            'phone': shop.phone or '', 'plan': shop.plan, 'status': shop.status, 'lifecycle': self._lifecycle(shop),
            'expires_on': str(shop.expires_on or ''), 'suspended_reason': shop.suspended_reason or '',
            'created_at': shop.create_date.isoformat() if shop.create_date else None, 'preset': shop.preset or '',
        }

    # ------------------------------------------------------------------ identity
    @api.model
    def me(self):
        self._require_dev()
        user = self.env.user
        return {'id': user.id, 'name': user.name, 'login': user.login, 'surface': 'dev', 'roles': ['developer']}

    # ------------------------------------------------------------------ fleet
    @api.model
    def fleet(self, search=None, lifecycle=None):
        self._require_dev()
        rows = [self._row(s) for s in self.env['orsquare.platform.shop'].search([])]
        if search:
            q = search.strip().lower()
            rows = [r for r in rows if q in ' '.join((r['name'], r['code'], r['owner_name'], r['owner_login'], r['phone'])).lower()]
        if lifecycle:
            rows = [r for r in rows if r['lifecycle'] == lifecycle]
        counts = {}
        for s in self.env['orsquare.platform.shop'].search([]):
            counts[self._lifecycle(s)] = counts.get(self._lifecycle(s), 0) + 1
        return {'rows': rows, 'counts': counts, 'total': sum(counts.values())}

    @api.model
    def shop_detail(self, code):
        """Registry row plus a live look inside the shop: staff accounts and current settings."""
        self._require_dev()
        shop = self._shop(code)
        detail = self._row(shop)
        with shop_env(code) as env:
            staff = env['orsquare.staff.service']
            detail['staff'] = staff.list_staff()
            detail['settings'] = staff.get_settings()
            detail['presets'] = staff.list_presets()
        return detail

    # ------------------------------------------------------------------ provisioning
    @api.model
    def create_shop(self, name, slug, owner_name, owner_login, owner_password, phone=None, preset='wine_shop',
                    plan='trial', trial_days=14, state_code='MH'):
        """Clone the template database into ``orsquare_shop_<slug>`` and make it a ready shop with its owner."""
        self._require_dev()
        slug = (slug or '').strip().lower()
        if not SLUG_RE.match(slug):
            raise UserError(_("The shop code may only use a-z, 0-9 and _ (2 to 30 characters)."))
        if preset not in PRESETS:
            raise UserError(_("Unknown preset '%s'.", preset))
        if len(owner_password or '') < 8:
            raise UserError(_("The owner password needs at least 8 characters."))
        if not (name or '').strip() or not (owner_login or '').strip():
            raise UserError(_("The shop name and the owner login are required."))
        code = 'orsquare_shop_%s' % slug
        if self.env['orsquare.platform.shop'].search_count([('code', '=', code)]) or odoo.service.db.exp_db_exist(code):
            raise UserError(_("The shop code '%s' is already taken.", slug))
        params = self.env['ir.config_parameter'].sudo()
        template = params.get_param('orsquare.platform.template_db', 'orsquare_template')
        t0 = time.monotonic()
        odoo.service.db.exp_duplicate_database(template, code)
        try:
            with shop_env(code) as env:
                env['orsquare.shop.bootstrap'].configure_shop(
                    name=name.strip(), owner_name=owner_name or owner_login, owner_login=owner_login.strip(),
                    owner_password=owner_password, state_code=state_code, preset=preset, phone=phone)
                origins = params.get_param('orsquare.platform.shop_origins')
                if origins:
                    env['ir.config_parameter'].sudo().set_param('orsquare.allowed_origins', origins)
                app = params.get_param('orsquare.app_url')
                if app:
                    env['ir.config_parameter'].sudo().set_param('orsquare.app_url', app)
        except Exception:
            _logger.exception("Provisioning %s failed; removing the half-made database", code)
            drop_database(code)
            raise
        shop = self.env['orsquare.platform.shop'].create({
            'name': name.strip(), 'code': code, 'owner_name': owner_name, 'owner_login': owner_login.strip(),
            'phone': phone or False, 'plan': plan, 'preset': preset,
            'expires_on': fields.Date.context_today(self) + timedelta(days=int(trial_days)) if trial_days else False})
        self._log('create_shop', code, '%s (%s), preset %s, %.1fs' % (name.strip(), plan, preset, time.monotonic() - t0))
        return self._row(shop)

    # ------------------------------------------------------------------ lifecycle
    @api.model
    def suspend(self, code, reason):
        self._require_dev()
        if not (reason or '').strip():
            raise UserError(_("Give a reason: it is recorded in the audit trail."))
        shop = self._shop(code)
        with shop_env(code) as env:
            env['ir.config_parameter'].sudo().set_param('orsquare.suspended', '1')
        shop.write({'status': 'suspended', 'suspended_reason': reason.strip()})
        self._log('suspend', code, reason.strip())
        return self._row(shop)

    @api.model
    def reactivate(self, code):
        self._require_dev()
        shop = self._shop(code)
        with shop_env(code) as env:
            env['ir.config_parameter'].sudo().set_param('orsquare.suspended', '0')
        shop.write({'status': 'active', 'suspended_reason': False})
        self._log('reactivate', code)
        return self._row(shop)

    @api.model
    def reset_owner_password(self, code, new_password):
        self._require_dev()
        if len(new_password or '') < 8:
            raise UserError(_("The password needs at least 8 characters."))
        shop = self._shop(code)
        with shop_env(code) as env:
            owner = env['res.users'].search([('login', '=', shop.owner_login)], limit=1)
            if not owner:
                raise UserError(_("The owner account was not found in this shop."))
            owner.write({'password': new_password})
        self._log('reset_owner_password', code, shop.owner_login)
        return True

    @api.model
    def set_expiry(self, code, expires_on, plan=None):
        self._require_dev()
        shop = self._shop(code)
        vals = {'expires_on': expires_on or False}
        if plan:
            if plan not in dict(PLANS):
                raise UserError(_("Unknown plan '%s'.", plan))
            vals['plan'] = plan
        shop.write(vals)
        self._log('set_expiry', code, '%s %s' % (vals.get('plan', shop.plan), expires_on or 'no expiry'))
        return self._row(shop)

    @api.model
    def extend(self, code, days):
        """Move the expiry date by ``days`` (negative shortens). From today if the shop has none or it has passed."""
        self._require_dev()
        shop = self._shop(code)
        today = fields.Date.context_today(self)
        base = shop.expires_on if shop.expires_on and shop.expires_on > today else today
        shop.expires_on = base + timedelta(days=int(days))
        self._log('extend', code, '%+d days -> %s' % (int(days), shop.expires_on))
        return self._row(shop)

    # ------------------------------------------------------------------ business studio (per shop)
    @api.model
    def studio_apply(self, code, values=None, preset=None):
        """Operator-side Business Studio: change a shop's tabs/features, or apply a preset."""
        self._require_dev()
        self._shop(code)
        with shop_env(code) as env:
            staff = env['orsquare.staff.service']
            if preset:
                staff.apply_preset(preset)
            if values:
                staff.update_settings(values)
            result = staff.get_settings()
        self._log('studio', code, 'preset %s' % preset if preset else ', '.join(sorted(values or {})))
        return result

    # ------------------------------------------------------------------ audit & system
    @api.model
    def audit(self, limit=100, shop_code=None):
        self._require_dev()
        domain = [('shop_code', '=', shop_code)] if shop_code else []
        return [{'id': a.id, 'at': a.create_date.isoformat(), 'actor': a.actor, 'action': a.action,
                 'shop_code': a.shop_code or '', 'detail': a.detail or ''}
                for a in self.env['orsquare.platform.audit'].search(domain, limit=min(int(limit), 500))]

    @api.model
    def system(self):
        self._require_dev()
        dbs = [d for d in odoo.service.db.list_dbs(True) if d.startswith('orsquare_shop')]
        mod = self.env['ir.module.module'].sudo().search([('name', '=', 'orsquare_platform')], limit=1)
        return {'engine': 'Odoo %s' % odoo_version, 'platform_db': self.env.cr.dbname, 'platform_module': mod.latest_version,
                'server_time': fields.Datetime.to_string(fields.Datetime.now()), 'shop_databases': len(dbs),
                'registered_shops': self.env['orsquare.platform.shop'].search_count([]),
                'unregistered': sorted(set(dbs) - set(self.env['orsquare.platform.shop'].search([]).mapped('code')))}
