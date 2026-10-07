# -*- coding: utf-8 -*-
"""Governance plumbing shared by Staff Access, Business Studio and the platform: the append-only change log
and the conflict error used for optimistic locking."""
import json

from odoo import api, fields, models, _
from odoo.exceptions import UserError


class ConflictError(UserError):
    """Somebody else changed the same thing first. The API answers 409 ``version_conflict``."""


def _dump(value):
    return json.dumps(value, sort_keys=True, default=str, ensure_ascii=False) if value is not None else False


class OrsquareConfigAudit(models.Model):
    """Who changed which governance setting, from what to what. Append-only: nothing is edited or removed.

    Written by the services (not by ORM hooks), so it records the *intent* ("role changed to cashier") once,
    at the one place every change flows through, with no cost on ordinary reads and writes.
    """
    _name = 'orsquare.config_audit'
    _description = "Governance change log"
    _order = 'id desc'

    kind = fields.Selection([
        ('staff', 'Staff access'), ('settings', 'Business Studio'), ('preset', 'Preset'),
        ('security', 'Security'), ('platform', 'Platform operator')], required=True, index=True)
    action = fields.Char(required=True, index=True)
    target = fields.Char(index=True, help="The person or setting the change was about.")
    actor_id = fields.Many2one('res.users', ondelete='set null')
    actor_login = fields.Char()
    before = fields.Text()
    after = fields.Text()
    note = fields.Char()

    def write(self, vals):
        raise UserError(_("The governance log is append-only."))

    def unlink(self):
        raise UserError(_("The governance log is append-only."))

    @api.model
    def log(self, kind, action, target=None, before=None, after=None, note=None):
        user = self.env.user
        # a change made from the platform console names the operator, not "root"
        actor = self.env.context.get('orsquare_actor') or user.login
        return self.sudo().create({
            'kind': kind, 'action': action, 'target': target,
            'actor_id': user.id if user.id != 1 else False, 'actor_login': actor,
            'before': _dump(before), 'after': _dump(after), 'note': note})

    @api.model
    def page(self, limit=50, offset=0, kind=None, target=None):
        """One page, newest first, with the total for the same filter."""
        domain = []
        if kind:
            domain.append(('kind', '=', kind))
        if target:
            domain.append(('target', '=', target))
        limit = max(1, min(int(limit or 50), 200))
        offset = max(0, int(offset or 0))
        rows = self.sudo().search(domain, limit=limit, offset=offset)
        return {
            'total': self.sudo().search_count(domain), 'limit': limit, 'offset': offset,
            'rows': [{
                'id': r.id, 'at': r.create_date.isoformat() if r.create_date else None, 'kind': r.kind,
                'action': r.action, 'target': r.target or '', 'actor': r.actor_login or '',
                'before': json.loads(r.before) if r.before else None,
                'after': json.loads(r.after) if r.after else None, 'note': r.note or ''} for r in rows]}
