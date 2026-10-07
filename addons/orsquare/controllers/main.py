# -*- coding: utf-8 -*-
"""HTTP JSON API for the React app.

Hard guardrails (see AGENTS.md section 4):

* An unauthenticated API call is answered with **401 JSON**, never a redirect to a login page, so the
  SPA can show a clean login state and never bounces an authenticated user anywhere.
* ``/api/session/gate`` is what the reverse proxy (Caddy ``forward_auth``) calls *before any HTML is
  sent* on the public marketing domain: authenticated -> 302 to the application, otherwise 204 and
  the static landing page is served.
* Session cookies are Odoo's native HttpOnly cookie; the proxy scopes it to the root domain.
* State-changing calls need ``Content-Type: application/json`` (not a CORS-simple request) and a
  trusted ``Origin``.
"""
import json
import logging

from odoo import http
from odoo.exceptions import AccessDenied, AccessError, RedirectWarning, UserError, ValidationError
from odoo.http import request, Response

from ..api_registry import API_REGISTRY

_logger = logging.getLogger(__name__)


def _json(payload, status=200, headers=None):
    body = json.dumps(payload, default=str)
    return Response(body, status=status, content_type='application/json; charset=utf-8',
                    headers=[('Cache-Control', 'no-store')] + list(headers or []))


def _ok(data=None):
    return _json({'ok': True, 'data': data})


def _err(status, code, message):
    return _json({'ok': False, 'error': {'code': code, 'message': message}}, status=status)


class OrsquareApi(http.Controller):

    # ------------------------------------------------------------------ helpers
    def _trusted_origin(self):
        origin = request.httprequest.headers.get('Origin')
        if not origin:
            return True
        allowed = request.env['ir.config_parameter'].sudo().get_param('orsquare.allowed_origins', '')
        allowed = {o.strip().rstrip('/') for o in allowed.split(',') if o.strip()}
        allowed.add(request.httprequest.host_url.rstrip('/'))
        return origin.rstrip('/') in allowed

    def _json_body(self):
        ctype = (request.httprequest.content_type or '').split(';')[0].strip().lower()
        if ctype != 'application/json':
            raise UserError("Content-Type must be application/json.")
        try:
            return json.loads(request.httprequest.get_data(as_text=True) or '{}')
        except ValueError:
            raise UserError("Malformed JSON body.")

    def _authenticate(self):
        uid = request.session.uid
        if not uid:
            return False
        request.update_env(user=uid)
        return True

    def _guard(self, handler, mutating=False):
        """Authentication + CSRF-ish checks + uniform error mapping around ``handler``."""
        try:
            if not self._authenticate():
                return _err(401, 'unauthenticated', 'Sign in required.')
            if mutating and not self._trusted_origin():
                return _err(403, 'untrusted_origin', 'Origin not allowed.')
            return _ok(handler())
        except AccessDenied as exc:
            return _err(401, 'unauthenticated', str(exc))
        except AccessError as exc:
            return _err(403, 'forbidden', exc.args[0] if exc.args else 'Not allowed.')
        except (UserError, ValidationError, RedirectWarning) as exc:
            return _err(422, 'rejected', exc.args[0] if exc.args else str(exc))
        except Exception:
            _logger.exception("ORSquare API error")
            return _err(500, 'server_error', 'Something went wrong on the server.')

    # ------------------------------------------------------------------ session
    @http.route('/api/health', type='http', auth='public', methods=['GET'], csrf=False)
    def health(self, **kw):
        request.env.cr.execute("SELECT 1")
        return _ok({'status': 'up'})

    @http.route('/api/session/login', type='http', auth='public', methods=['POST'], csrf=False)
    def login(self, **kw):
        try:
            if not self._trusted_origin():
                return _err(403, 'untrusted_origin', 'Origin not allowed.')
            body = self._json_body()
            request.session.authenticate(request.db, {
                'type': 'password', 'login': body.get('login', ''), 'password': body.get('password', '')})
            request.update_env(user=request.session.uid)
            return _ok(request.env['orsquare.staff.service'].me())
        except AccessDenied:
            return _err(401, 'bad_credentials', 'Wrong login or password.')
        except UserError as exc:
            return _err(422, 'rejected', exc.args[0])

    @http.route('/api/session/logout', type='http', auth='public', methods=['POST'], csrf=False)
    def logout(self, **kw):
        if request.session.uid and not self._trusted_origin():
            return _err(403, 'untrusted_origin', 'Origin not allowed.')
        request.session.logout(keep_db=True)
        return _ok({'logged_out': True})

    @http.route('/api/session/me', type='http', auth='public', methods=['GET'], csrf=False)
    def me(self, **kw):
        return self._guard(lambda: request.env['orsquare.staff.service'].me())

    @http.route('/api/session/gate', type='http', auth='public', methods=['GET'], csrf=False)
    def gate(self, **kw):
        """Called by the reverse proxy BEFORE serving the public landing page.

        Authenticated -> 302 straight to the application (landing HTML is never transmitted).
        Not authenticated -> 204, the proxy serves the static marketing page.
        """
        uid = request.session.uid
        if not uid:
            return Response(status=204, headers=[('Cache-Control', 'no-store')])
        request.update_env(user=uid)
        params = request.env['ir.config_parameter'].sudo()
        app = params.get_param('orsquare.app_url', 'https://app.orsquare.com').rstrip('/')
        user = request.env.user
        target = app + ('/dev' if user.has_group('base.group_system') and params.get_param(
            'orsquare.dev_console', '0') == '1' else '')
        return Response(status=302, headers=[('Location', target), ('Cache-Control', 'no-store')])

    # ------------------------------------------------------------------ sync
    @http.route('/api/sync/bootstrap', type='http', auth='public', methods=['GET'], csrf=False)
    def bootstrap(self, **kw):
        return self._guard(lambda: request.env['orsquare.sync.service'].bootstrap())

    @http.route('/api/sync/delta', type='http', auth='public', methods=['GET'], csrf=False)
    def delta(self, since_seq='0', since_ts=None, **kw):
        return self._guard(lambda: request.env['orsquare.sync.service'].delta(int(since_seq), since_ts))

    @http.route('/api/sync/flush', type='http', auth='public', methods=['POST'], csrf=False)
    def flush(self, **kw):
        return self._guard(lambda: request.env['orsquare.sync.service'].flush(self._json_body().get('mutations', [])),
                           mutating=True)

    # ------------------------------------------------------------------ generic whitelisted calls
    @http.route('/api/call', type='http', auth='public', methods=['POST'], csrf=False)
    def call(self, **kw):
        def handler():
            body = self._json_body()
            entry = API_REGISTRY.get(body.get('service'))
            method = body.get('method')
            if not entry or method not in entry[1]:
                raise AccessError("Unknown API method.")
            params = body.get('params') or {}
            if not isinstance(params, dict):
                raise UserError("params must be an object.")
            return getattr(request.env[entry[0]], method)(**params)
        return self._guard(handler, mutating=True)
