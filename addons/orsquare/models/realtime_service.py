# -*- coding: utf-8 -*-
"""Realtime gateway authorisation (Centrifugo).

The browser never chooses channels: Odoo issues a short-lived HS256 *connection token* whose ``channels``
claim subscribes the device **server-side** to exactly what its user may see.

* ``shop:<database>``        events without amounts   -> every staff device of that shop
* ``shop:<database>:money``  the same events with amounts -> only users with ``can_see_money``

Channels are keyed by the database name (not company id): every shop database has company id 1, so an id-based
name would let two shops on one gateway see each other's events.
"""
import base64
import hashlib
import hmac
import json
import time

from odoo import api, models, _
from odoo.exceptions import UserError

from .security_utils import require_staff

TOKEN_TTL = 3600


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def channel_names(dbname):
    return 'shop:%s' % dbname, 'shop:%s:money' % dbname


def sign_hs256(claims, secret):
    header = _b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    body = _b64(json.dumps(claims, separators=(',', ':')).encode())
    signing_input = ('%s.%s' % (header, body)).encode()
    sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return '%s.%s.%s' % (header, body, _b64(sig))


class OrsquareRealtimeService(models.AbstractModel):
    _name = 'orsquare.realtime.service'
    _description = "ORSquare Realtime Token"

    @api.model
    def token(self):
        require_staff(self.env)
        params = self.env['ir.config_parameter'].sudo()
        secret = params.get_param('orsquare.centrifugo_secret')
        if not secret:
            raise UserError(_("Realtime updates are not configured for this installation."))
        user = self.env.user
        safe, money = channel_names(self.env.cr.dbname)
        channels = [safe]
        if self.env.su or user.has_group('orsquare.group_orsquare_can_see_money') \
                or user.has_group('orsquare.group_orsquare_owner'):
            channels.append(money)
        now = int(time.time())
        claims = {'sub': '%s:%s' % (self.env.cr.dbname, user.id), 'exp': now + TOKEN_TTL, 'iat': now,
                  'channels': channels, 'info': {'name': user.name}}
        return {'token': sign_hs256(claims, secret), 'channels': channels, 'expires_in': TOKEN_TTL,
                'url': params.get_param('orsquare.centrifugo_ws_url') or ''}
