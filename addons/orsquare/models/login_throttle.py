# -*- coding: utf-8 -*-
"""Brute-force protection for the API login: 5 failures per (login, ip) in 5 minutes -> blocked 5 minutes.

Stored in the database (not memory) so it holds across Odoo workers and restarts.
"""
from datetime import timedelta

from odoo import SUPERUSER_ID, api, fields, models

MAX_FAILURES = 5
WINDOW = timedelta(minutes=5)


class OrsquareLoginThrottle(models.Model):
    _name = 'orsquare.login_throttle'
    _description = "API Login Throttle"

    key = fields.Char(required=True, index=True)
    failures = fields.Integer(default=0)
    window_start = fields.Datetime(default=fields.Datetime.now)

    _sql_constraints = [('key_unique', 'unique(key)', "One throttle row per key.")]

    @api.model
    def _key(self, login, ip):
        return '%s|%s' % ((login or '').lower().strip(), ip or '')

    @api.model
    def is_blocked(self, login, ip):
        row = self.search([('key', '=', self._key(login, ip))], limit=1)
        if not row:
            return False
        if fields.Datetime.now() - row.window_start > WINDOW:
            return False
        return row.failures >= MAX_FAILURES

    @api.model
    def record_failure(self, login, ip):
        # separate cursor: the failed login's request transaction is rolled back, the counter must persist
        key = self._key(login, ip)
        with self.pool.cursor() as cr:
            env = api.Environment(cr, SUPERUSER_ID, {})
            row = env['orsquare.login_throttle'].search([('key', '=', key)], limit=1)
            now = fields.Datetime.now()
            if not row:
                env['orsquare.login_throttle'].create({'key': key, 'failures': 1, 'window_start': now})
            elif now - row.window_start > WINDOW:
                row.write({'failures': 1, 'window_start': now})
            else:
                row.failures += 1

    @api.model
    def clear(self, login, ip):
        self.search([('key', '=', self._key(login, ip))]).unlink()
