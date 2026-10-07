# -*- coding: utf-8 -*-
"""Platform registry models (platform database only).

A shop is still its own database; these tables only keep what the Developer Console needs about the fleet: who and
which plan (``orsquare.platform.shop``), what each plan allows (``orsquare.platform.plan``), which sign-in key
belongs to which shop (``orsquare.platform.login``) and the append-only audit trail of every operator action.
Every column the console filters or sorts on is indexed, so the registry stays fast at 10,000+ shops.
"""
import logging
import re
from contextlib import contextmanager

import odoo
from odoo import SUPERUSER_ID, _, api, fields, models
from odoo.exceptions import UserError, ValidationError
from odoo.modules.registry import Registry

from odoo.addons.orsquare.models.login_throttle import ThrottleLogic
from odoo.addons.orsquare.models.presets import ALL_TABS, FEATURES

_logger = logging.getLogger(__name__)

SLUG_RE = re.compile(r'^[a-z0-9_]{2,30}$')
PLAN_CODE_RE = re.compile(r'^[a-z][a-z0-9_]{1,19}$')
STATUSES = [('active', 'Active'), ('suspended', 'Suspended'), ('archived', 'Archived')]
LOGIN_KINDS = [('owner', 'Shop owner'), ('staff', 'Shop staff'), ('operator', 'Platform operator')]


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
def shop_env(dbname, actor=None):
    """A superuser environment inside one shop database (committed on a clean exit).

    ``actor`` names the platform operator in the shop's own governance log, so a change made from the console shows
    who made it instead of "root".
    """
    with Registry(dbname).cursor() as cr:
        yield api.Environment(cr, SUPERUSER_ID, {'orsquare_actor': actor} if actor else {})


class PlatformPlan(models.Model):
    _name = 'orsquare.platform.plan'
    _description = "Subscription plan and what it allows"
    _order = 'sequence, id'

    code = fields.Char(required=True, index=True)
    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    description = fields.Char()
    features = fields.Char(help="Comma separated shop features this plan includes. Empty = all.")
    tabs = fields.Char(help="Comma separated tabs this plan includes. Empty = all.")
    max_staff = fields.Integer(help="Most staff accounts a shop may have. 0 = unlimited.")
    builtin = fields.Boolean(help="Shipped with the platform: cannot be deleted.")

    _sql_constraints = [
        ('code_unique', 'unique(code)', "A plan with this code already exists."),
        ('max_staff_positive', 'check(max_staff >= 0)', "The staff limit cannot be negative."),
    ]

    @staticmethod
    def _split(value):
        return [v for v in (value or '').split(',') if v]

    @api.constrains('code')
    def _check_code(self):
        for plan in self:
            if not PLAN_CODE_RE.match(plan.code or ''):
                raise ValidationError(_("A plan code starts with a letter and uses a-z, 0-9 and _ (2 to 20 characters)."))

    @api.constrains('features', 'tabs')
    def _check_lists(self):
        for plan in self:
            bad = set(self._split(plan.features)) - set(FEATURES)
            if bad:
                raise ValidationError(_("Unknown feature(s): %s", ", ".join(sorted(bad))))
            bad = set(self._split(plan.tabs)) - set(ALL_TABS)
            if bad:
                raise ValidationError(_("Unknown tab(s): %s", ", ".join(sorted(bad))))

    def entitlements(self):
        """What is pushed into a shop of this plan. ``None``/0 mean "no limit"."""
        self.ensure_one()
        return {'plan': self.code, 'features': self._split(self.features) or None,
                'tabs': self._split(self.tabs) or None, 'max_staff': self.max_staff or 0}

    def as_dict(self):
        self.ensure_one()
        return {'code': self.code, 'name': self.name, 'description': self.description or '', 'sequence': self.sequence,
                'features': self._split(self.features), 'tabs': self._split(self.tabs), 'max_staff': self.max_staff,
                'builtin': self.builtin}


class PlatformShop(models.Model):
    _name = 'orsquare.platform.shop'
    _description = "Registered shop (tenant)"
    _order = 'create_date desc, id desc'

    name = fields.Char(required=True, index='trigram')
    code = fields.Char(required=True, index='trigram', help="The shop's database name.")
    owner_name = fields.Char(index='trigram')
    owner_login = fields.Char(index='trigram')
    phone = fields.Char(index='trigram')
    plan = fields.Char(default='trial', required=True, index=True)
    status = fields.Selection(STATUSES, default='active', required=True, index=True)
    expires_on = fields.Date(index=True)
    suspended_reason = fields.Char()
    preset = fields.Char()

    _sql_constraints = [('code_unique', 'unique(code)', "A shop with this code already exists.")]

    @api.constrains('plan')
    def _check_plan(self):
        known = set(self.env['orsquare.platform.plan'].sudo().search([]).mapped('code'))
        for shop in self:
            if shop.plan not in known:
                raise ValidationError(_("Unknown plan '%s'.", shop.plan))


class PlatformLogin(models.Model):
    """One row per sign-in key (login, phone): which shop it belongs to. A key belongs to exactly one shop."""
    _name = 'orsquare.platform.login'
    _description = "Global sign-in directory"

    key = fields.Char(required=True, index=True)
    shop_code = fields.Char(required=True, index=True)
    kind = fields.Selection(LOGIN_KINDS, required=True, default='staff')

    _sql_constraints = [('key_unique', 'unique(key)', "This sign-in key is already used.")]


class PlatformAudit(models.Model):
    """Append-only: nothing is ever edited or removed."""
    _name = 'orsquare.platform.audit'
    _description = "Operator audit trail"
    _order = 'id desc'

    actor = fields.Char(required=True, index=True)
    action = fields.Char(required=True, index=True)
    shop_code = fields.Char(index=True)
    detail = fields.Char()
    create_date = fields.Datetime(readonly=True, index=True)

    def write(self, vals):
        raise UserError(_("The audit trail is append-only."))

    def unlink(self):
        raise UserError(_("The audit trail is append-only."))


class PlatformThrottle(ThrottleLogic, models.Model):
    """Brute-force protection for operator sign-in (5 failures per login+IP in 5 minutes), same rules as the shops."""
    _name = 'orsquare.platform.throttle'
    _description = "Operator sign-in throttle"

    key = fields.Char(required=True, index=True)
    failures = fields.Integer(default=0)
    window_start = fields.Datetime(default=fields.Datetime.now)

    _sql_constraints = [('key_unique', 'unique(key)', "One throttle row per key.")]
