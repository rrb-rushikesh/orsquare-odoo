# -*- coding: utf-8 -*-
import json

from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install', 'orsquare')
class TestHttpApi(HttpCase):
    """HTTP-level guardrails: 401 JSON instead of redirects, gate behaviour, whitelist, origin checks."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.owner = cls.env['res.users'].create({
            'name': 'HTTP Owner', 'login': 'http_owner', 'password': 'HttpOwner#2026',
            'groups_id': [(6, 0, [cls.env.ref('orsquare.group_orsquare_owner').id, cls.env.ref('base.group_user').id])]})
        cls.env['orsquare.business_day'].open_day(500.0)
        wh = cls.env['stock.warehouse'].orsquare_main_warehouse(cls.company)
        cls.item = cls.env['product.product'].create({
            'name': 'HTTP Beer', 'type': 'consu', 'is_storable': True, 'list_price': 200.0,
            'standard_price': 100.0, 'taxes_id': [(6, 0, [])], 'available_in_pos': True})
        cls.env['stock.quant']._update_available_quantity(cls.item, wh.orsquare_counter_id, 10)
        cls.env.cr.flush()

    def _post(self, path, payload, headers=None):
        h = {'Content-Type': 'application/json'}
        h.update(headers or {})
        return self.url_open(path, data=json.dumps(payload), headers=h, allow_redirects=False)

    def _login(self):
        r = self._post('/api/session/login', {'login': 'http_owner', 'password': 'HttpOwner#2026'})
        self.assertEqual(r.status_code, 200, r.text)
        return r

    # ---- the zero-landing-leakage guardrails ---------------------------------------------------
    def test_01_unauthenticated_api_is_401_json_never_a_redirect(self):
        r = self.url_open('/api/session/me', allow_redirects=False)
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json()['error']['code'], 'unauthenticated')
        self.assertNotIn('Location', r.headers)
        for path in ('/api/sync/bootstrap', '/api/sync/delta?since_seq=0'):
            r = self.url_open(path, allow_redirects=False)
            self.assertEqual(r.status_code, 401, path)

    def test_02_gate_is_204_when_logged_out_and_302_to_app_when_logged_in(self):
        r = self.url_open('/api/session/gate', allow_redirects=False)
        self.assertEqual(r.status_code, 204)
        self.assertFalse(r.content)
        self._login()
        r = self.url_open('/api/session/gate', allow_redirects=False)
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers['Location'], 'https://app.orsquare.com')
        self.assertEqual(r.headers['Cache-Control'], 'no-store')

    def test_03_login_logout_cycle(self):
        r = self._post('/api/session/login', {'login': 'http_owner', 'password': 'wrong'})
        self.assertEqual(r.status_code, 401, r.text)
        self.assertEqual(r.json()['error']['code'], 'bad_credentials')
        self._login()
        me = self.url_open('/api/session/me')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()['data']['login'], 'http_owner')
        self.assertIn('owner', me.json()['data']['roles'])
        out = self._post('/api/session/logout', {})
        self.assertEqual(out.status_code, 200)
        self.assertEqual(self.url_open('/api/session/me', allow_redirects=False).status_code, 401)

    def test_04_health_is_public(self):
        self.assertEqual(self.url_open('/api/health').json()['data']['status'], 'up')

    # ---- bootstrap / sync over HTTP ---------------------------------------------------------------
    def test_05_bootstrap_and_flush_over_http(self):
        self._login()
        boot = self.url_open('/api/sync/bootstrap')
        self.assertEqual(boot.status_code, 200)
        self.assertIn('HTTP Beer', [p['name'] for p in boot.json()['data']['products']])
        m = {'id': 'http-1', 'device_id': 'http-dev', 'device_seq': 1, 'kind': 'sale',
             'payload': {'lines': [{'product_id': self.item.id, 'qty': 1}],
                         'payments': [{'method': 'cash', 'amount': 200.0}]}}
        r = self._post('/api/sync/flush', {'mutations': [m]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['results'][0]['status'], 'ok')
        r2 = self._post('/api/sync/flush', {'mutations': [m]})
        self.assertEqual(r2.json()['data']['results'][0]['status'], 'duplicate')
        delta = self.url_open('/api/sync/delta?since_seq=0')
        self.assertEqual(delta.status_code, 200)

    # ---- generic call: whitelist, errors, CSRF-ish checks ------------------------------------------
    def test_06_call_whitelist(self):
        self._login()
        ok = self._post('/api/call', {'service': 'reports', 'method': 'dashboard', 'params': {}})
        self.assertEqual(ok.status_code, 200, ok.text)
        for service, method in (('reports', '_attention'), ('sales', 'unlink'), ('nope', 'x'),
                                ('staff', 'create_staff_unsafe')):
            r = self._post('/api/call', {'service': service, 'method': method, 'params': {}})
            self.assertEqual(r.status_code, 403, (service, method))

    def test_07_business_errors_are_422_not_500(self):
        self._login()
        r = self._post('/api/call', {'service': 'sales', 'method': 'settle', 'params': {'payload': {
            'client_ref': 'http-bad', 'lines': [{'product_id': self.item.id, 'qty': 1}],
            'payments': [{'method': 'cash', 'amount': 5.0}]}}})
        self.assertEqual(r.status_code, 422)
        self.assertIn('not fully paid', r.json()['error']['message'])

    def test_08_mutating_calls_need_json_content_type_and_trusted_origin(self):
        self._login()
        r = self.url_open('/api/call', data='service=reports', headers={'Content-Type': 'text/plain'},
                          allow_redirects=False)
        self.assertEqual(r.status_code, 422)
        r = self._post('/api/call', {'service': 'reports', 'method': 'dashboard', 'params': {}},
                       headers={'Origin': 'https://evil.example.com'})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()['error']['code'], 'untrusted_origin')
        r = self._post('/api/call', {'service': 'reports', 'method': 'dashboard', 'params': {}},
                       headers={'Origin': self.base_url()})
        self.assertEqual(r.status_code, 200)

    def test_09_sale_settle_via_call_end_to_end(self):
        self._login()
        r = self._post('/api/call', {'service': 'sales', 'method': 'settle', 'params': {'payload': {
            'client_ref': 'http-sale-1', 'lines': [{'product_id': self.item.id, 'qty': 2}],
            'payments': [{'method': 'cash', 'amount': 400.0}]}}})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['data']['total'], 400.0)
        day = self._post('/api/call', {'service': 'day', 'method': 'day_current', 'params': {}})
        self.assertEqual(day.json()['data']['state'], 'open')
