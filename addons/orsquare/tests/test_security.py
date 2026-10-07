# -*- coding: utf-8 -*-
import json

from odoo.exceptions import AccessError
from odoo.tests import HttpCase, tagged

from .common import OrsquareCase


@tagged('post_install', '-at_install', 'orsquare')
class TestSecurityHardening(OrsquareCase):

    def _user(self, login, groups):
        return self.env['res.users'].create({
            'name': login, 'login': login, 'groups_id': [(6, 0, [self.env.ref(g).id for g in groups])]})

    def test_01_plain_internal_user_cannot_read_any_orsquare_data(self):
        nobody = self._user('sec_nobody', ['base.group_user'])
        item = self.make_product('Sec Item')
        calls = [
            ('orsquare.stock.reports', 'stock_position', {}),
            ('orsquare.stock.reports', 'movement_history', {'product_id': item.id}),
            ('orsquare.accounts.service', 'directory', {}),
            ('orsquare.reports.service', 'dashboard', {}),
            ('orsquare.reports.service', 'calendar', {'date_from': '2026-10-01', 'date_to': '2026-10-07'}),
            ('orsquare.catalog.service', 'list_products', {}),
            ('orsquare.catalog.service', 'units', {}),
            ('orsquare.catalog.service', 'tax_regimes', {}),
            ('orsquare.sync.service', 'bootstrap', {}),
            ('orsquare.sync.service', 'delta', {'since_seq': 0}),
            ('orsquare.staff.service', 'me', {}),
            ('orsquare.staff.service', 'get_settings', {}),
        ]
        for model, method, kwargs in calls:
            with self.assertRaises(AccessError, msg='%s.%s' % (model, method)):
                getattr(self.env[model].with_user(nobody), method)(**kwargs)

    def test_02_cashier_without_money_does_not_see_amounts_in_the_event_feed(self):
        item = self.make_product('Event Item', cost=100.0, price=200.0)
        self.stock_in(item, 5, self.counter)
        seq0 = self.env['orsquare.event'].latest_seq(self.company)
        self.sell([{'product_id': item.id, 'qty': 1}])
        cashier = self._user('sec_cashier', ['orsquare.group_orsquare_cashier'])
        owner = self._user('sec_owner', ['orsquare.group_orsquare_owner'])
        sale_c = [e for e in self.env['orsquare.sync.service'].with_user(cashier).delta(seq0)['events']
                  if e['type'] == 'sale_settled'][0]
        sale_o = [e for e in self.env['orsquare.sync.service'].with_user(owner).delta(seq0)['events']
                  if e['type'] == 'sale_settled'][0]
        self.assertNotIn('money', sale_c)
        self.assertNotIn('total', sale_c['payload'])
        self.assertEqual(sale_o['money']['total'], 200.0)

    def test_03_money_channel_only_when_there_is_money(self):
        from unittest import mock
        sent = []

        def fake_urlopen(req, timeout=None):
            sent.append(json.loads(req.data)['params'])
            return mock.Mock(read=lambda: b'{}')

        self.env['ir.config_parameter'].sudo().set_param('orsquare.centrifugo_url', 'http://centrifugo.invalid')
        with mock.patch('odoo.addons.orsquare.models.event.urllib.request.urlopen', fake_urlopen):
            self.env['orsquare.event'].publish(self.company, 'day_sealed', {'date': 'x'})
            self.env['orsquare.event'].publish(self.company, 'sale_settled', {'order_id': 1}, money={'total': 5.0})
            self.env.cr.postcommit.run()      # the test cursor never commits: run the hooks by hand
        channels = [m['channel'] for m in sent]
        base = 'shop:%s' % self.company.id
        self.assertEqual(channels.count(base), 2)
        self.assertEqual(channels.count(base + ':money'), 1, "only the event with amounts goes to the money channel")
        self.assertTrue(all('money' not in m['data'] for m in sent if m['channel'] == base))


@tagged('post_install', '-at_install', 'orsquare')
class TestLoginThrottle(HttpCase):

    def _login(self, password):
        return self.url_open('/api/session/login', data=json.dumps({'login': 'throttle_user', 'password': password}),
                             headers={'Content-Type': 'application/json'}, allow_redirects=False)

    def test_01_brute_force_is_blocked_then_correct_password_still_fails_while_blocked(self):
        self.env['res.users'].create({
            'name': 'Throttle', 'login': 'throttle_user', 'password': 'RightPass#12345',
            'groups_id': [(6, 0, [self.env.ref('orsquare.group_orsquare_cashier').id])]})
        self.env.cr.flush()
        for _i in range(5):
            self.assertEqual(self._login('wrong').status_code, 401)
        blocked = self._login('wrong')
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.json()['error']['code'], 'too_many_attempts')
        self.assertEqual(self._login('RightPass#12345').status_code, 429, "no oracle while blocked")

    def test_02_bad_call_parameters_are_422_not_500(self):
        user = self.env['res.users'].create({
            'name': 'Param', 'login': 'param_user', 'password': 'ParamPass#12345',
            'groups_id': [(6, 0, [self.env.ref('orsquare.group_orsquare_owner').id, self.env.ref('base.group_user').id])]})
        self.env.cr.flush()
        ok = self.url_open('/api/session/login', data=json.dumps({'login': 'param_user', 'password': 'ParamPass#12345'}),
                           headers={'Content-Type': 'application/json'})
        self.assertEqual(ok.status_code, 200, ok.text)
        r = self.url_open('/api/call', data=json.dumps({'service': 'reports', 'method': 'dashboard',
                                                         'params': {'bogus': 1}}),
                          headers={'Content-Type': 'application/json'})
        self.assertEqual(r.status_code, 422)
        self.assertIn('Invalid parameters', r.json()['error']['message'])
