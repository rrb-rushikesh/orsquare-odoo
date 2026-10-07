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
import base64
import io
import json
import logging
import os
import re
import time

import odoo
from odoo import SUPERUSER_ID, api, http
from odoo.exceptions import AccessDenied, AccessError, RedirectWarning, UserError, ValidationError
from odoo.http import request, Response
from odoo.modules.registry import Registry

from ..api_registry import API_REGISTRY
from ..models.governance import ConflictError
from ..models.security_utils import enforce_gate

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
    def _origin_allowed(self, db, origin):
        with Registry(db).cursor() as cr:
            raw = api.Environment(cr, SUPERUSER_ID, {})['ir.config_parameter'].get_param('orsquare.allowed_origins', '')
        allowed = {o.strip().rstrip('/') for o in raw.split(',') if o.strip()}
        allowed.add(request.httprequest.host_url.rstrip('/'))
        return origin.rstrip('/') in allowed

    def _trusted_origin(self):
        origin = request.httprequest.headers.get('Origin')
        if not origin:
            return True
        return self._origin_allowed(request.db, origin)

    def _json_body(self):
        ctype = (request.httprequest.content_type or '').split(';')[0].strip().lower()
        if ctype != 'application/json':
            raise UserError("Content-Type must be application/json.")
        try:
            return json.loads(request.httprequest.get_data(as_text=True) or '{}')
        except ValueError:
            raise UserError("Malformed JSON body.")

    def _authenticate(self):
        """True when the cookie carries a live session. Never touches a database otherwise (a guest on a
        multi-shop host has no database yet), so unauthenticated calls are always a clean 401."""
        uid = request.session.uid
        if not uid or not request.db:
            return False
        request.update_env(user=uid)
        return True

    @staticmethod
    def _me_model(env):
        """Shop databases answer with the staff identity; the platform database with the developer's."""
        return 'orsquare.staff.service' if 'orsquare.staff.service' in env else 'orsquare.platform.service'

    @staticmethod
    def _suspended(env):
        return env['ir.config_parameter'].sudo().get_param('orsquare.suspended') == '1'

    def _guard(self, handler, mutating=False):
        """Authentication + CSRF-ish checks + uniform error mapping around ``handler``."""
        try:
            if not self._authenticate():
                return _err(401, 'unauthenticated', 'Sign in required.')
            if self._suspended(request.env):
                return _err(403, 'account_suspended', 'This shop is suspended. Please contact ORSquare support.')
            if mutating and not self._trusted_origin():
                return _err(403, 'untrusted_origin', 'Origin not allowed.')
            return _ok(handler())
        except AccessDenied as exc:
            return _err(401, 'unauthenticated', str(exc))
        except AccessError as exc:
            return _err(403, 'forbidden', exc.args[0] if exc.args else 'Not allowed.')
        except ConflictError as exc:
            return _err(409, 'version_conflict', exc.args[0] if exc.args else 'Someone else changed this first.')
        except (UserError, ValidationError, RedirectWarning) as exc:
            return _err(422, 'rejected', exc.args[0] if exc.args else str(exc))
        except Exception:
            _logger.exception("ORSquare API error")
            return _err(500, 'server_error', 'Something went wrong on the server.')

    # ------------------------------------------------------------------ session
    @http.route('/api/health', type='http', auth='none', methods=['GET'], csrf=False, readonly=False)
    def health(self, **kw):
        if request.db:
            with Registry(request.db).cursor() as cr:
                cr.execute("SELECT 1")
        return _ok({'status': 'up'})

    SHOP_CODE = re.compile(r'^orsquare_[a-z0-9_]{1,50}$')
    PLATFORM_DB = 'orsquare_platform'
    MFA_WINDOW = 300         # seconds a password-verified, not-yet-MFA-verified session stays valid

    @staticmethod
    def _throttle(env):
        """The sign-in throttle of this database: the shop's own, or the platform's for operators."""
        for name in ('orsquare.login_throttle', 'orsquare.platform.throttle'):
            if name in env:
                return env[name]
        return None

    @staticmethod
    def _record_security_event(env, action, login):
        """Write a sign-in security event to whichever log this database has (a shop's governance log, or the
        platform's operator audit trail)."""
        if 'orsquare.config_audit' in env:
            env['orsquare.config_audit'].log('security', action, login)
        elif 'orsquare.platform.audit' in env:
            env['orsquare.platform.audit'].sudo().create({'actor': login, 'action': action, 'detail': 'self-service'})

    @staticmethod
    def _db_exists(name):
        return bool(name) and odoo.service.db.exp_db_exist(name)

    @staticmethod
    def _shop_dbs(limit):
        with odoo.sql_db.db_connect('postgres').cursor() as cr:
            cr.execute("SELECT datname FROM pg_database WHERE datname LIKE 'orsquare\\_shop%%' ORDER BY datname LIMIT %s",
                       (limit,))
            return [r[0] for r in cr.fetchall()]

    def _platform_lookup(self, sql, params):
        """One indexed query against the platform database; None when it is absent or the lookup fails."""
        if not self._db_exists(self.PLATFORM_DB):
            return None
        try:
            with Registry(self.PLATFORM_DB).cursor() as cr:
                cr.execute(sql, params)
                return cr.fetchone()
        except Exception:
            _logger.warning("Platform lookup skipped due to lookup error", exc_info=True)
            return None

    def _resolve_db(self, body):
        """Resolve the tenant database without asking the user for it.

        0. Developer Console (explicit surface, ``dev.`` host, or the platform code): the platform database.
        1. The platform's login directory: one indexed lookup, authoritative (a key belongs to exactly one shop,
           or is a platform operator). A stale shop code sent by the browser can never override it.
        2. Host sub-domain (``<slug>.orsquare.com``), 3. an explicit shop code, 4. the platform registry
           (owner login / phone / code), 5. the single shop of a one-shop install, 6. the database the request
           already carries. Shop databases are never scanned: that would cost O(shops) on every sign-in.
        """
        surface = str(body.get('surface', '')).strip()
        host = (request.httprequest.host or '').split(':')[0].lower()
        shop_code = str(body.get('shop', '')).strip()
        login = str(body.get('login', '')).strip().lower()
        if (surface == 'dev' or host.startswith('dev.') or shop_code == self.PLATFORM_DB) and self._db_exists(self.PLATFORM_DB):
            return self.PLATFORM_DB

        if login:
            row = self._platform_lookup("SELECT shop_code, kind FROM orsquare_platform_login WHERE key = %s", (login,))
            if row and (row[1] == 'operator' or self._db_exists(row[0])):
                return self.PLATFORM_DB if row[1] == 'operator' else row[0]

        parts = host.split('.')
        if len(parts) >= 3 and parts[0] not in ('app', 'www', 'dev', 'api', 'rt', 'localhost'):
            for candidate in ('orsquare_%s' % parts[0], 'orsquare_shop_%s' % parts[0]):
                if self._db_exists(candidate):
                    return candidate

        if shop_code and self.SHOP_CODE.match(shop_code) and self._db_exists(shop_code):
            return shop_code

        if login:
            row = self._platform_lookup("""
                SELECT code FROM orsquare_platform_shop
                WHERE (owner_login = %s OR phone = %s OR code = %s) AND status != 'deleted' LIMIT 1""",
                (login, login, login))
            if row and self._db_exists(row[0]):
                return row[0]

        # a one-shop install (development, single terminal) needs no directory
        shop_dbs = self._shop_dbs(2)
        if len(shop_dbs) == 1:
            return shop_dbs[0]
        return request.db or None

    # ------------------------------------------------------------------ session issuing
    def _issue_cookie(self, registry, uid):
        """Persist the session and set its cookie. Odoo only persists sessions of database-bound requests and this
        request has none yet (a guest has no database), so it is done here; rotating the id also defeats fixation."""
        with registry.cursor() as cr:
            env = api.Environment(cr, uid, {})
            session = request.session
            if session.should_rotate:
                http.root.session_store.rotate(session, env)
            else:
                http.root.session_store.save(session)
            request.future_response.set_cookie(
                'session_id', session.sid, max_age=http.get_session_max_inactivity(env), httponly=True)

    def _identity(self, registry, uid, db):
        with registry.cursor() as cr:
            env = api.Environment(cr, uid, {})
            info = env[self._me_model(env)].me()
            info['shop'] = db
            return info

    @http.route('/api/session/login', type='http', auth='none', methods=['POST'], csrf=False, readonly=False)
    def login(self, **kw):
        try:
            body = self._json_body()
            db = self._resolve_db(body)
            if not db:
                return _err(401, 'bad_credentials', 'Wrong shop, login or password.')
            origin = request.httprequest.headers.get('Origin')
            if origin and not self._origin_allowed(db, origin):
                return _err(403, 'untrusted_origin', 'Origin not allowed.')
            login = str(body.get('login', '')).strip().lower()
            ip = request.httprequest.remote_addr
            registry = Registry(db)

            # Resolve canonical login (supports email, phone, or username)
            with registry.cursor() as cr:
                cr.execute("""
                    SELECT u.login FROM res_users u
                    JOIN res_partner p ON p.id = u.partner_id
                    WHERE (u.login = %s OR p.email = %s OR p.phone = %s OR p.mobile = %s) AND u.active = true
                    ORDER BY (u.login = %s) DESC, u.id ASC LIMIT 1
                """, (login, login, login, login, login))
                row = cr.fetchone()
                auth_login = row[0] if row else login

            with registry.cursor() as cr:
                if self._suspended(api.Environment(cr, SUPERUSER_ID, {})):
                    return _err(403, 'account_suspended', 'This shop is suspended. Please contact ORSquare support.')
            with registry.cursor() as cr:
                throttle = self._throttle(api.Environment(cr, SUPERUSER_ID, {}))
                if throttle is not None and throttle.is_blocked(auth_login, ip):
                    return _err(429, 'too_many_attempts', 'Too many failed sign-ins. Try again in a few minutes.')
            try:
                request.session.authenticate(db, {
                    'type': 'password', 'login': auth_login, 'password': body.get('password', '')})
            except AccessDenied:
                with registry.cursor() as cr:
                    throttle = self._throttle(api.Environment(cr, SUPERUSER_ID, {}))
                    if throttle is not None:
                        throttle.record_failure(auth_login, ip)
                raise
            with registry.cursor() as cr:
                throttle = self._throttle(api.Environment(cr, SUPERUSER_ID, {}))
                if throttle is not None:
                    throttle.clear(login, ip)

            if request.session.uid is None and request.session.get('pre_uid'):
                # Password was right but the account has an authenticator: hold a short-lived pre-session
                # and ask for the 6-digit code. Nothing about the account is revealed yet.
                request.session['orsquare_pre_db'] = db
                request.session['orsquare_pre_at'] = time.time()
                self._issue_cookie(registry, request.session['pre_uid'])
                return _ok({'mfa_required': True, 'mfa': 'totp'})

            self._issue_cookie(registry, request.session.uid)
            return _ok(self._identity(registry, request.session.uid, db))
        except AccessDenied:
            return _err(401, 'bad_credentials', 'Wrong shop, login or password.')
        except UserError as exc:
            return _err(422, 'rejected', exc.args[0])

    @http.route('/api/session/mfa', type='http', auth='none', methods=['POST'], csrf=False, readonly=False)
    def mfa(self, **kw):
        """Second step of sign-in: the 6-digit code for a password-verified pre-session."""
        try:
            body = self._json_body()
            session = request.session
            db, pre_uid = session.get('orsquare_pre_db'), session.get('pre_uid')
            if not (db and pre_uid) or time.time() - float(session.get('orsquare_pre_at') or 0) > self.MFA_WINDOW:
                return _err(401, 'mfa_expired', 'Sign in again.')
            registry = Registry(db)
            ip = request.httprequest.remote_addr
            throttle_key = 'mfa:%s' % session.get('pre_login')
            with registry.cursor() as cr:
                throttle = self._throttle(api.Environment(cr, SUPERUSER_ID, {}))
                if throttle is not None and throttle.is_blocked(throttle_key, ip):
                    return _err(429, 'too_many_attempts', 'Too many wrong codes. Try again in a few minutes.')
            code = re.sub(r'\s', '', str(body.get('code', '')))
            with registry.cursor() as cr:
                env = api.Environment(cr, pre_uid, {})
                try:
                    if not code.isdigit():
                        raise AccessDenied()
                    env['res.users'].browse(pre_uid)._totp_check(int(code))
                except AccessDenied:
                    with registry.cursor() as cr2:
                        throttle = self._throttle(api.Environment(cr2, SUPERUSER_ID, {}))
                        if throttle is not None:
                            throttle.record_failure(throttle_key, ip)
                    return _err(401, 'bad_code', 'That code is not right. Check the 6 digits and try again.')
                session.finalize(env)
            for key in ('orsquare_pre_db', 'orsquare_pre_at'):
                session.pop(key, None)
            with registry.cursor() as cr:
                throttle = self._throttle(api.Environment(cr, SUPERUSER_ID, {}))
                if throttle is not None:
                    throttle.clear(throttle_key, ip)
            self._issue_cookie(registry, session.uid)
            return _ok(self._identity(registry, session.uid, db))
        except AccessDenied:
            return _err(401, 'bad_credentials', 'Sign in again.')

    # ---- authenticator enrolment (signed-in users; same primitives as Odoo's own 2FA wizard) --------------------
    @http.route('/api/session/mfa/begin', type='http', auth='none', methods=['POST'], csrf=False, readonly=False)
    def mfa_begin(self, **kw):
        def handler():
            import qrcode
            from odoo.addons.auth_totp.models.totp import ALGORITHM, DIGITS, TIMESTEP
            user = request.env.user
            if user.sudo().totp_enabled:
                raise UserError("An authenticator is already set up. Remove it first to set up a new one.")
            secret = base64.b32encode(os.urandom(20)).decode()
            issuer = 'ORSquare'
            label = '%s:%s' % (issuer, user.login)
            url = 'otpauth://totp/%s?secret=%s&issuer=%s&algorithm=%s&digits=%s&period=%s' % (
                label.replace(' ', '%20'), secret, issuer, ALGORITHM.upper(), DIGITS, TIMESTEP)
            buf = io.BytesIO()
            qrcode.make(url.encode(), box_size=4).save(buf, optimise=True, format='PNG')
            return {'secret': secret, 'url': url, 'qrcode': base64.b64encode(buf.getvalue()).decode()}
        return self._guard(handler, mutating=True)

    @http.route('/api/session/mfa/enable', type='http', auth='none', methods=['POST'], csrf=False, readonly=False)
    def mfa_enable(self, **kw):
        def handler():
            body = self._json_body()
            user = request.env.user
            code = re.sub(r'\s', '', str(body.get('code', '')))
            secret = str(body.get('secret', ''))
            ip = request.httprequest.remote_addr
            throttle = self._throttle(request.env(su=True))
            key = 'mfa-enrol:%s' % user.login
            if throttle is not None and throttle.is_blocked(key, ip):
                raise UserError("Too many wrong codes. Try again in a few minutes.")
            if not code.isdigit() or not secret or not user._totp_try_setting(secret, int(code)):
                if throttle is not None:
                    throttle.record_failure(key, ip)
                raise UserError("That code is not right. Check the 6 digits and try again.")
            self._record_security_event(request.env, 'mfa_enabled', user.login)
            request.env.flush_all()
            http.root.session_store.save(request.session)
            return {'enabled': True}
        return self._guard(handler, mutating=True)

    @http.route('/api/session/mfa/disable', type='http', auth='none', methods=['POST'], csrf=False, readonly=False)
    def mfa_disable(self, **kw):
        def handler():
            body = self._json_body()
            user = request.env.user
            try:
                user._check_credentials({'type': 'password', 'password': str(body.get('password', ''))}, {'interactive': True})
            except AccessDenied:
                raise UserError("The password is not right.")
            user.sudo().write({'totp_secret': False})
            self._record_security_event(request.env, 'mfa_disabled', user.login)
            request.env.flush_all()
            request.session.session_token = request.env.user._compute_session_token(request.session.sid)
            http.root.session_store.save(request.session)
            return {'enabled': False}
        return self._guard(handler, mutating=True)

    @http.route('/api/session/logout', type='http', auth='none', methods=['POST'], csrf=False, readonly=False)
    def logout(self, **kw):
        if request.session.uid and request.db and not self._trusted_origin():
            return _err(403, 'untrusted_origin', 'Origin not allowed.')
        request.session.logout(keep_db=True)
        return _ok({'logged_out': True})

    @http.route('/api/session/me', type='http', auth='none', methods=['GET'], csrf=False, readonly=False)
    def me(self, **kw):
        return self._guard(lambda: request.env[self._me_model(request.env)].me())

    @http.route('/api/session/gate', type='http', auth='none', methods=['GET'], csrf=False, readonly=False)
    def gate(self, **kw):
        """Called by the reverse proxy BEFORE serving the public landing page.

        Authenticated -> 302 straight to the application (landing HTML is never transmitted).
        Not authenticated -> 204, the proxy serves the static marketing page.
        """
        uid = request.session.uid
        if not uid or not request.db:
            return Response(status=204, headers=[('Cache-Control', 'no-store')])
        request.update_env(user=uid)
        params = request.env['ir.config_parameter'].sudo()
        app = params.get_param('orsquare.app_url', 'https://app.orsquare.com').rstrip('/')
        # a signed-in user of the platform database is a platform operator by construction
        target = app + ('/dev' if 'orsquare.platform.service' in request.env else '')
        return Response(status=302, headers=[('Location', target), ('Cache-Control', 'no-store')])

    # ------------------------------------------------------------------ sync
    @http.route('/api/sync/bootstrap', type='http', auth='none', methods=['GET'], csrf=False, readonly=False)
    def bootstrap(self, **kw):
        return self._guard(lambda: request.env['orsquare.sync.service'].bootstrap())

    @http.route('/api/sync/delta', type='http', auth='none', methods=['GET'], csrf=False, readonly=False)
    def delta(self, since_seq='0', since_ts=None, **kw):
        return self._guard(lambda: request.env['orsquare.sync.service'].delta(int(since_seq), since_ts))

    @http.route('/api/sync/flush', type='http', auth='none', methods=['POST'], csrf=False, readonly=False)
    def flush(self, **kw):
        return self._guard(lambda: request.env['orsquare.sync.service'].flush(self._json_body().get('mutations', [])),
                           mutating=True)

    # ------------------------------------------------------------------ generic whitelisted calls
    @http.route('/api/call', type='http', auth='none', methods=['POST'], csrf=False, readonly=False)
    def call(self, **kw):
        def handler():
            body = self._json_body()
            entry = API_REGISTRY.get(body.get('service'))
            method = body.get('method')
            if not entry or method not in entry[1] or entry[0] not in request.env:
                raise AccessError("Unknown API method.")
            params = body.get('params') or {}
            if not isinstance(params, dict):
                raise UserError("params must be an object.")
            enforce_gate(request.env, body.get('service'), method)
            try:
                return getattr(request.env[entry[0]], method)(**params)
            except TypeError as exc:      # wrong/missing parameter names -> the caller's mistake, not a crash
                if 'argument' in str(exc):
                    raise UserError("Invalid parameters for %s.%s" % (body.get('service'), method))
                raise
        return self._guard(handler, mutating=True)
