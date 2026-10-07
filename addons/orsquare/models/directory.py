# -*- coding: utf-8 -*-
"""The platform's global login directory, seen from a shop.

A shop database only knows its own users, so two shops could each have a user ``ravi@example.com`` and the sign-in
screen (which never asks for a shop) could not tell which one is meant. The platform database therefore keeps one
row per sign-in key (``orsquare_platform_login``: key -> shop). A shop *claims* a key before it creates the user, so a
key can belong to exactly one shop, and sign-in becomes one indexed lookup instead of a scan of every shop database.

The directory is switched on per shop (``orsquare.directory_enabled = 1``, set by provisioning); a standalone or test
database that has no platform database next to it simply skips it.
"""
import logging

from odoo.exceptions import UserError
from odoo.modules.registry import Registry
from odoo.tools.translate import _

_logger = logging.getLogger(__name__)


def normalize(key):
    return (key or '').strip().lower()


def enabled(env):
    return env['ir.config_parameter'].sudo().get_param('orsquare.directory_enabled') == '1'


def _platform_db(env):
    return env['ir.config_parameter'].sudo().get_param('orsquare.platform_db') or 'orsquare_platform'


def claim(env, keys, kind='staff'):
    """Reserve ``keys`` for this shop; raise if another shop already owns one. No-op when the directory is off."""
    if not enabled(env):
        return []
    shop = env.cr.dbname
    keys = [k for k in dict.fromkeys(normalize(k) for k in keys) if k]
    taken = []
    with Registry(_platform_db(env)).cursor() as cr:
        for key in keys:
            cr.execute("""
                INSERT INTO orsquare_platform_login (key, shop_code, kind, create_date, write_date)
                VALUES (%s, %s, %s, now() at time zone 'utc', now() at time zone 'utc')
                ON CONFLICT (key) DO NOTHING RETURNING key""", (key, shop, kind))
            if cr.fetchone():
                taken.append(key)
                continue
            cr.execute("SELECT shop_code FROM orsquare_platform_login WHERE key = %s", (key,))
            row = cr.fetchone()
            if row and row[0] != shop:
                raise UserError(_("The login '%s' is already used by another shop.", key))
    return taken


def release(env, keys):
    """Give keys back (best effort: a failed release only leaves an unused reservation)."""
    if not enabled(env):
        return
    try:
        with Registry(_platform_db(env)).cursor() as cr:
            cr.execute("DELETE FROM orsquare_platform_login WHERE key = ANY(%s) AND shop_code = %s",
                       ([normalize(k) for k in keys], env.cr.dbname))
    except Exception:
        _logger.warning("Could not release directory keys %s", list(keys), exc_info=True)
