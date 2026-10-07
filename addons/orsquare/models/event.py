# -*- coding: utf-8 -*-
"""Domain events: one append-only feed serving both realtime push and offline delta sync.

* ``seq`` (the record id) is a monotonic, gap-free-by-commit-order cursor: writers take a
  transaction-scoped advisory lock before inserting, so rows become visible in id order and a
  client that has seen ``seq = N`` can never later receive an event with a smaller seq.
* After commit, the event is pushed (best effort) to Centrifugo's HTTP API on channel
  ``shop:<company_id>``.  Odoo holds no WebSockets and a push failure never affects the business
  transaction; clients recover missed events from the feed (``since_seq``).
"""
import json
import logging
import urllib.request

from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

EVENT_LOCK_KEY = 7_203_001  # arbitrary constant, scoped to this database


class OrsquareEvent(models.Model):
    _name = 'orsquare.event'
    _description = "ORSquare Domain Event"
    _order = 'id'
    _log_access = True

    company_id = fields.Many2one('res.company', required=True, index=True)
    type = fields.Char(required=True, index=True)
    payload = fields.Json(help="Non-monetary facts: safe for every staff member.")
    money = fields.Json(help="Amounts only: delivered to users with can_see_money.")

    @api.model
    def publish(self, company, event_type, payload=None, money=None):
        """Record an event in the current transaction and push it after commit."""
        company = company or self.env.company
        self.env.cr.execute("SELECT pg_advisory_xact_lock(%s)", [EVENT_LOCK_KEY])
        event = self.sudo().create({
            'company_id': company.id, 'type': event_type, 'payload': payload or {}, 'money': money or {}})
        url = self.env['ir.config_parameter'].sudo().get_param('orsquare.centrifugo_url')
        api_key = self.env['ir.config_parameter'].sudo().get_param('orsquare.centrifugo_api_key')
        if url:
            # Two channels: 'shop:N' carries no amounts (every staff device); 'shop:N:money' carries the
            # full event and must only be authorised by the realtime gateway for can_see_money users.
            safe = {'seq': event.id, 'type': event_type, 'payload': payload or {}}
            full = dict(safe, money=money or {})
            base = 'shop:%s' % company.id
            self.env.cr.postcommit.add(lambda: self._push(url, api_key, base, safe))
            if money:
                self.env.cr.postcommit.add(lambda: self._push(url, api_key, base + ':money', full))
        return event

    @staticmethod
    def _push(url, api_key, channel, message):
        try:
            body = json.dumps({'method': 'publish', 'params': {'channel': channel, 'data': message}}).encode()
            req = urllib.request.Request(
                url.rstrip('/') + '/api', data=body,
                headers={'Content-Type': 'application/json', 'Authorization': 'apikey %s' % (api_key or '')})
            urllib.request.urlopen(req, timeout=2).read()
        except Exception:  # never let a push failure surface into business flows
            _logger.warning("ORSquare realtime push failed for %s", channel, exc_info=True)

    @api.model
    def since(self, company, since_seq, limit=500, with_money=None):
        """Events after ``since_seq``; amounts are included only for users who may see money."""
        if with_money is None:
            with_money = self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_money')
        events = self.sudo().search([('company_id', '=', company.id), ('id', '>', since_seq)],
                                    order='id', limit=limit)
        out = []
        for e in events:
            row = {'seq': e.id, 'type': e.type, 'payload': e.payload}
            if with_money and e.money:
                row['money'] = e.money
            out.append(row)
        return out

    @api.model
    def latest_seq(self, company):
        row = self.sudo().search([('company_id', '=', company.id)], order='id desc', limit=1)
        return row.id or 0

    def write(self, vals):
        raise UserError(_("Events are append-only."))


class OrsquareStockDiscrepancy(models.Model):
    """A physical-stock conflict accepted from an offline sale (surfaced at day closing)."""
    _name = 'orsquare.stock_discrepancy'
    _description = "Stock Discrepancy (offline oversell)"
    _order = 'id desc'

    company_id = fields.Many2one('res.company', required=True, default=lambda s: s.env.company, index=True)
    product_id = fields.Many2one('product.product', required=True, index=True)
    location_id = fields.Many2one('stock.location', required=True)
    qty_short = fields.Float(digits='Product Unit of Measure', required=True)
    pos_order_id = fields.Many2one('pos.order', ondelete='set null')
    business_date = fields.Date(index=True)
    state = fields.Selection([('open', 'Open'), ('resolved', 'Resolved')], default='open', index=True)
    note = fields.Text()
    resolved_by = fields.Many2one('res.users', readonly=True)
    resolved_at = fields.Datetime(readonly=True)

    def action_resolve(self, note=None):
        self.write({'state': 'resolved', 'note': note or self.note,
                    'resolved_by': self.env.uid, 'resolved_at': fields.Datetime.now()})
        return True
