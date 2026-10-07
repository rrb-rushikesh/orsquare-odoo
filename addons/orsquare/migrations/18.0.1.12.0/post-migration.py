# -*- coding: utf-8 -*-
"""1.12.0: tab grants become native groups; a minimum password length is enforced.

* ``res_users.orsquare_tabs`` (free text, comma separated) is read once and turned into membership of the per-tab
  groups; a user with no explicit grant gets the tabs of their role, which is exactly what they could open before.
  The old column is then dropped, so there is a single source of truth.
* The password policy module installs with this version; give it the same minimum the staff API already enforced.
"""
import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger(__name__)

ALL_TABS = ['dashboard', 'sales', 'purchases', 'stock', 'products', 'accounts', 'cashflow', 'daybook', 'calendar',
            'reports', 'settings']
ROLE_DEFAULT_TABS = {
    'orsquare.group_orsquare_cashier': ['sales', 'daybook', 'accounts', 'cashflow'],
    'orsquare.group_orsquare_stockkeeper': ['stock', 'purchases', 'products'],
}


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    cr.execute("SELECT 1 FROM information_schema.columns WHERE table_name='res_users' AND column_name='orsquare_tabs'")
    has_column = bool(cr.fetchone())
    explicit = {}
    if has_column:
        cr.execute("SELECT id, orsquare_tabs FROM res_users WHERE orsquare_tabs IS NOT NULL AND orsquare_tabs <> ''")
        explicit = {uid: [t for t in (tabs or '').split(',') if t in ALL_TABS] for uid, tabs in cr.fetchall()}

    owner = env.ref('orsquare.group_orsquare_owner')
    tab_groups = {t: env.ref('orsquare.group_orsquare_tab_%s' % t) for t in ALL_TABS}
    role_groups = {env.ref(x): tabs for x, tabs in ROLE_DEFAULT_TABS.items()}
    users = env['res.users'].with_context(active_test=False).search([
        ('groups_id', 'in', [g.id for g in role_groups] + [owner.id])])
    for user in users:
        if user.has_group('orsquare.group_orsquare_owner'):
            continue                                   # the owner group implies every tab group
        if user.id in explicit:
            tabs = explicit[user.id]
        else:
            tabs = sorted({t for g, ts in role_groups.items() if g in user.groups_id for t in ts})
        user.write({'groups_id': [(4, tab_groups[t].id) for t in tabs]})
    if has_column:
        cr.execute("ALTER TABLE res_users DROP COLUMN orsquare_tabs")
    _logger.info("orsquare 1.12.0: converted tab grants of %s users to groups", len(users))

    params = env['ir.config_parameter'].sudo()
    if not params.get_param('auth_password_policy.minlength'):
        params.set_param('auth_password_policy.minlength', '8')
