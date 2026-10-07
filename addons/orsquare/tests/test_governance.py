# -*- coding: utf-8 -*-
"""Governance: tab grants as native groups, the server-side gate, the change log, optimistic locking, plan
entitlements, staff password/MFA reset and the two-step (password + authenticator) sign-in."""
import base64
import json
import time

from odoo.exceptions import AccessError, UserError
from odoo.tests import HttpCase, tagged

from odoo.addons.orsquare.api_registry import API_GATES, API_REGISTRY, MUTATION_TABS
from odoo.addons.orsquare.models.governance import ConflictError
from odoo.addons.orsquare.models.security_utils import enforce_gate
from .common import OrsquareCase


class GovernanceCase(OrsquareCase):
    open_day_on_setup = False

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.staff = cls.env['orsquare.staff.service']
        cls.audit = cls.env['orsquare.config_audit']
        cls.owner = cls.env['res.users'].create({
            'name': 'Gov Owner', 'login': 'gov_owner', 'password': 'GovOwner#2026',
            'groups_id': [(6, 0, [cls.env.ref('orsquare.group_orsquare_owner').id, cls.env.ref('base.group_user').id])]})

    def make_staff(self, login, roles, tabs=None, **kw):
        uid = self.staff.with_user(self.owner).create_staff(login.title(), login, 'StaffPass#123', roles, tabs=tabs, **kw)
        return self.env['res.users'].browse(uid)

    def set_entitlements(self, **ent):
        self.env['ir.config_parameter'].sudo().set_param('orsquare.entitlements', json.dumps(ent))

    def last_audit(self, **domain):
        return self.audit.search([(k, '=', v) for k, v in domain.items()], limit=1)


@tagged('post_install', '-at_install', 'orsquare')
class TestTabGroups(GovernanceCase):

    def test_01_tab_grants_are_native_groups(self):
        user = self.make_staff('tabs_a', ['cashier'], tabs=['sales', 'stock'])
        self.assertTrue(user.has_group('orsquare.group_orsquare_tab_sales'))
        self.assertTrue(user.has_group('orsquare.group_orsquare_tab_stock'))
        self.assertFalse(user.has_group('orsquare.group_orsquare_tab_accounts'))
        self.assertEqual(user.orsquare_granted_tabs(), ['sales', 'stock'])

    def test_02_owner_has_every_tab_through_the_owner_group(self):
        for tab in ('dashboard', 'sales', 'purchases', 'stock', 'products', 'accounts', 'cashflow', 'daybook',
                    'calendar', 'reports', 'settings'):
            self.assertTrue(self.owner.has_group('orsquare.group_orsquare_tab_%s' % tab), tab)

    def test_03_role_default_tabs_are_materialised_at_creation(self):
        cashier = self.make_staff('cash_default', ['cashier'])
        self.assertEqual(cashier.orsquare_granted_tabs(), ['sales', 'accounts', 'cashflow', 'daybook'])
        keeper = self.make_staff('keep_default', ['stockkeeper'])
        self.assertEqual(keeper.orsquare_granted_tabs(), ['purchases', 'stock', 'products'])

    def test_04_update_replaces_the_grant_and_unknown_tabs_are_refused(self):
        user = self.make_staff('tabs_b', ['cashier'])
        self.staff.with_user(self.owner).update_staff(user.id, tabs=['sales'])
        self.assertEqual(user.orsquare_granted_tabs(), ['sales'])
        self.staff.with_user(self.owner).update_staff(user.id, tabs=[])
        self.assertEqual(user.orsquare_granted_tabs(), [])
        with self.assertRaisesRegex(UserError, "Unknown tab"):
            self.staff.with_user(self.owner).update_staff(user.id, tabs=['sales', 'nope'])

    def test_04b_partial_flag_update_changes_only_the_named_switch(self):
        user = self.make_staff('flag_a', ['cashier'], flags={'can_see_money': True, 'can_see_valuation': True})
        self.staff.with_user(self.owner).update_staff(user.id, flags={'can_see_money': False})
        self.assertFalse(user.has_group('orsquare.group_orsquare_can_see_money'))
        self.assertTrue(user.has_group('orsquare.group_orsquare_can_see_valuation'), "not named, so untouched")

    def test_05_role_change_keeps_tabs_unless_told_otherwise(self):
        user = self.make_staff('tabs_c', ['cashier'], tabs=['sales'])
        self.staff.with_user(self.owner).update_staff(user.id, roles=['stockkeeper'])
        self.assertEqual(user.orsquare_roles(), ['stockkeeper'])
        self.assertEqual(user.orsquare_granted_tabs(), ['sales'])

    def test_06_effective_tabs_need_shop_switch_and_plan(self):
        user = self.make_staff('tabs_d', ['cashier'], tabs=['sales', 'stock', 'accounts'])
        self.staff.with_user(self.owner).update_settings({'orsquare_enabled_tabs': ['sales', 'stock', 'accounts', 'settings']})
        self.assertEqual(user.orsquare_effective_tabs(), ['sales', 'stock', 'accounts'])
        self.staff.with_user(self.owner).update_settings({'orsquare_enabled_tabs': ['sales', 'accounts', 'settings']})
        self.assertEqual(user.orsquare_effective_tabs(), ['sales', 'accounts'], "shop switched Stock off")
        self.staff.with_user(self.owner).update_settings({'orsquare_enabled_tabs': ['sales', 'stock', 'accounts', 'settings']})
        self.set_entitlements(tabs=['sales', 'stock'])
        self.assertEqual(user.orsquare_effective_tabs(), ['sales', 'stock'], "the plan has no Accounts")
        self.assertEqual(user.orsquare_granted_tabs(), ['sales', 'stock', 'accounts'], "nothing was deleted")


@tagged('post_install', '-at_install', 'orsquare')
class TestServerGate(GovernanceCase):

    def as_user(self, user):
        return self.env(user=user)

    def test_01_a_tab_you_do_not_have_is_refused_by_the_server(self):
        cashier = self.make_staff('gate_a', ['cashier'], tabs=['sales'])
        enforce_gate(self.as_user(cashier), 'sales', 'settle')
        with self.assertRaises(AccessError):
            enforce_gate(self.as_user(cashier), 'purchases', 'record_bill')
        with self.assertRaises(AccessError):
            enforce_gate(self.as_user(cashier), 'reports', 'trial_balance')
        self.staff.with_user(self.owner).update_staff(cashier.id, tabs=['sales', 'purchases'])
        enforce_gate(self.as_user(cashier), 'purchases', 'record_bill')

    def test_02_shared_calls_work_from_any_screen_that_uses_them(self):
        cashier = self.make_staff('gate_b', ['cashier'], tabs=['sales'])
        env = self.as_user(cashier)
        for service, method in (('accounts', 'directory'), ('catalog', 'list_products'), ('stock', 'stock_position'),
                                ('reports', 'dashboard'), ('day', 'day_current'), ('bills', 'thermal_text')):
            enforce_gate(env, service, method)          # must not raise
        with self.assertRaises(AccessError):
            enforce_gate(env, 'accounts', 'employee_voucher')    # Accounts-only
        with self.assertRaises(AccessError):
            enforce_gate(env, 'catalog', 'save_product')         # Products-only

    def test_03_the_shop_switching_a_tab_off_closes_its_api_even_for_the_owner(self):
        enforce_gate(self.as_user(self.owner), 'purchases', 'record_bill')
        self.staff.with_user(self.owner).update_settings(
            {'orsquare_enabled_tabs': [t for t in ('dashboard', 'sales', 'stock', 'settings')]})
        with self.assertRaises(AccessError):
            enforce_gate(self.as_user(self.owner), 'purchases', 'record_bill')
        enforce_gate(self.as_user(self.owner), 'sales', 'settle')

    def test_04_feature_switches_are_enforced_on_the_server(self):
        self.staff.with_user(self.owner).update_settings(
            {'orsquare_feature_tables': False, 'orsquare_feature_open_bottle': False})
        with self.assertRaises(AccessError):
            enforce_gate(self.as_user(self.owner), 'tabs', 'table_status')
        with self.assertRaises(AccessError):
            enforce_gate(self.as_user(self.owner), 'bottles', 'tray')
        with self.assertRaises(AccessError):
            enforce_gate(self.as_user(self.owner), 'day', 'open_bottle')
        self.staff.with_user(self.owner).update_settings(
            {'orsquare_feature_tables': True, 'orsquare_feature_open_bottle': True})
        enforce_gate(self.as_user(self.owner), 'tabs', 'table_status')
        enforce_gate(self.as_user(self.owner), 'bottles', 'tray')

    def test_05_a_feature_outside_the_plan_stays_off_even_if_stored_on(self):
        self.company.orsquare_feature_kitchen = True
        self.set_entitlements(features=['open_bottle'])
        self.assertFalse(self.company.orsquare_feature_on('kitchen'))
        self.assertTrue(self.company.orsquare_feature_kitchen, "stored value is untouched")
        self.assertFalse(self.staff.with_user(self.owner).me()['features']['kitchen'])

    def test_06_unlisted_service_has_no_gate_and_still_needs_a_role(self):
        enforce_gate(self.env, 'realtime', 'token')
        enforce_gate(self.env, 'sync', 'bootstrap')

    def test_07_offline_outbox_cannot_replay_a_revoked_tab(self):
        cashier = self.make_staff('gate_c', ['cashier'], tabs=['sales'])
        sync = self.env['orsquare.sync.service'].with_user(cashier)
        res = sync.flush([{'id': 'gov-1', 'device_id': 'dev-gov', 'device_seq': 1, 'kind': 'cash_entry',
                           'payload': {'kind': 'expense', 'amount': 10.0, 'mode': 'cash', 'description': 'x'}}])
        item = res['results'][0]
        self.assertEqual(item['status'], 'error')
        self.assertEqual(item['error']['code'], 'access_denied')


@tagged('post_install', '-at_install', 'orsquare')
class TestChangeLogAndLocking(GovernanceCase):

    def test_01_staff_changes_are_logged_with_before_and_after(self):
        user = self.make_staff('log_a', ['cashier'])
        created = self.last_audit(kind='staff', action='created', target='log_a')
        self.assertTrue(created)
        self.assertEqual(json.loads(created.after)['roles'], ['cashier'])
        self.staff.with_user(self.owner).update_staff(user.id, roles=['stockkeeper'], flags={'can_see_valuation': True})
        upd = self.last_audit(kind='staff', action='updated', target='log_a')
        self.assertEqual(json.loads(upd.before)['roles'], ['cashier'])
        self.assertEqual(json.loads(upd.after)['roles'], ['stockkeeper'])
        self.assertEqual(upd.actor_login, 'gov_owner')

    def test_02_a_no_op_writes_no_log_row_and_no_version_bump(self):
        v = self.company.orsquare_settings_version
        n = self.audit.search_count([])
        out = self.staff.with_user(self.owner).update_settings(
            {'orsquare_cutoff_hour': self.company.orsquare_cutoff_hour})
        self.assertEqual(out['changed'], [])
        self.assertEqual(self.company.orsquare_settings_version, v)
        self.assertEqual(self.audit.search_count([]), n)

    def test_03_settings_change_is_logged_and_bumps_the_version(self):
        v = self.company.orsquare_settings_version
        out = self.staff.with_user(self.owner).update_settings({'orsquare_cutoff_hour': 4.0})
        self.assertEqual(out['version'], v + 1)
        self.assertEqual(out['changed'], ['orsquare_cutoff_hour'])
        row = self.last_audit(kind='settings')
        self.assertEqual(json.loads(row.after), {'orsquare_cutoff_hour': 4.0})
        self.assertNotEqual(json.loads(row.before)['orsquare_cutoff_hour'], 4.0)

    def test_04_the_log_is_append_only(self):
        self.make_staff('log_b', ['cashier'])
        row = self.audit.search([], limit=1)
        with self.assertRaises(UserError):
            row.write({'note': 'edited'})
        with self.assertRaises(UserError):
            row.unlink()

    def test_05_only_the_owner_reads_the_log(self):
        cashier = self.make_staff('log_c', ['cashier'])
        with self.assertRaises(AccessError):
            self.staff.with_user(cashier).audit_log()
        page = self.staff.with_user(self.owner).audit_log(limit=5, kind='staff')
        self.assertLessEqual(len(page['rows']), 5)
        self.assertGreaterEqual(page['total'], len(page['rows']))
        self.assertTrue(all(r['kind'] == 'staff' for r in page['rows']))

    def test_06_stale_version_is_a_conflict_and_changes_nothing(self):
        v = self.company.orsquare_settings_version
        self.staff.with_user(self.owner).update_settings({'orsquare_cutoff_hour': 5.0}, expected_version=v)
        with self.assertRaises(ConflictError):
            self.staff.with_user(self.owner).update_settings({'orsquare_cutoff_hour': 6.0}, expected_version=v)
        self.assertEqual(self.company.orsquare_cutoff_hour, 5.0)
        self.staff.with_user(self.owner).update_settings(
            {'orsquare_cutoff_hour': 6.0}, expected_version=self.company.orsquare_settings_version)
        self.assertEqual(self.company.orsquare_cutoff_hour, 6.0)


@tagged('post_install', '-at_install', 'orsquare')
class TestPresetsAndEntitlements(GovernanceCase):

    def test_01_preset_sets_profile_version_variant_and_tabs(self):
        out = self.staff.with_user(self.owner).apply_preset('restaurant')
        self.assertIn('orsquare_feature_tables', out['changed'] + ['orsquare_feature_tables'])
        self.assertEqual(self.company.orsquare_profile, 'restaurant')
        self.assertEqual(self.company.orsquare_preset_version, 2)
        self.assertEqual(self.company.orsquare_stock_variant, 'standard')
        self.assertNotIn('stock', self.company.orsquare_tab_list())
        self.staff.with_user(self.owner).apply_preset('wine_shop')
        self.assertEqual(self.company.orsquare_stock_variant, 'wine')
        self.assertIn('stock', self.company.orsquare_tab_list())
        self.assertTrue(self.last_audit(kind='preset'))

    def test_02_unknown_preset_is_refused(self):
        with self.assertRaisesRegex(UserError, "Unknown preset"):
            self.staff.with_user(self.owner).apply_preset('casino')

    def test_02b_settings_tab_cannot_be_switched_off(self):
        with self.assertRaisesRegex(UserError, "Settings tab cannot be switched off"):
            self.staff.with_user(self.owner).update_settings({'orsquare_enabled_tabs': ['sales', 'stock']})
        self.staff.with_user(self.owner).update_settings({'orsquare_enabled_tabs': ['sales', 'settings']})

    def test_03_plan_is_a_ceiling_for_features_and_tabs(self):
        self.set_entitlements(features=['open_bottle'], tabs=['sales', 'stock', 'settings'])
        with self.assertRaisesRegex(UserError, "plan does not include this feature"):
            self.staff.with_user(self.owner).update_settings({'orsquare_feature_kitchen': True})
        with self.assertRaisesRegex(UserError, "plan does not include one of those tabs"):
            self.staff.with_user(self.owner).update_settings({'orsquare_enabled_tabs': ['sales', 'reports', 'settings']})
        self.staff.with_user(self.owner).update_settings({'orsquare_feature_open_bottle': True})

    def test_04_preset_never_switches_on_what_the_plan_excludes(self):
        self.set_entitlements(features=['open_bottle'])
        self.staff.with_user(self.owner).apply_preset('bar')
        self.assertTrue(self.company.orsquare_feature_open_bottle)
        self.assertFalse(self.company.orsquare_feature_kitchen)
        self.assertFalse(self.company.orsquare_feature_tables)

    def test_05_staff_limit_from_the_plan(self):
        limit = self.staff.with_user(self.owner)._active_staff_count() + 1
        self.set_entitlements(max_staff=limit)
        self.make_staff('cap_a', ['cashier'])
        with self.assertRaisesRegex(UserError, "plan allows"):
            self.make_staff('cap_b', ['cashier'])

    def test_06_experience_payload_describes_choices_limits_and_version(self):
        self.set_entitlements(plan='basic', features=['open_bottle'])
        exp = self.staff.with_user(self.owner).get_experience()
        self.assertEqual(exp['plan'], 'basic')
        self.assertEqual(exp['version'], self.company.orsquare_settings_version)
        feats = {f['key']: f for f in exp['features']}
        self.assertTrue(feats['open_bottle']['entitled'])
        self.assertFalse(feats['kitchen']['entitled'])
        self.assertEqual({t['key'] for t in exp['tabs']}, {
            'dashboard', 'sales', 'purchases', 'stock', 'products', 'accounts', 'cashflow', 'daybook', 'calendar',
            'reports', 'settings'})
        self.assertEqual(exp['variants']['stock']['options'][1][0], 'wine')
        self.assertEqual({p['code'] for p in exp['presets']}, {'wine_shop', 'bar', 'restaurant', 'grocery'})
        cashier = self.make_staff('exp_c', ['cashier'])
        with self.assertRaises(AccessError):
            self.staff.with_user(cashier).get_experience()


@tagged('post_install', '-at_install', 'orsquare')
class TestStaffHygiene(GovernanceCase):

    def test_01_owner_resets_a_staff_password(self):
        user = self.make_staff('pw_a', ['cashier'])
        self.staff.with_user(self.owner).reset_staff_password(user.id, 'BrandNew#2026')
        self.env.flush_all()        # Odoo checks credentials in SQL, for the environment's user
        me = user.with_user(user)
        me._check_credentials({'type': 'password', 'password': 'BrandNew#2026'}, {'interactive': True})
        with self.assertRaises(Exception):
            me._check_credentials({'type': 'password', 'password': 'StaffPass#123'}, {'interactive': True})
        row = self.last_audit(kind='security', action='password_reset', target='pw_a')
        self.assertTrue(row)
        self.assertNotIn('BrandNew', (row.before or '') + (row.after or '') + (row.note or ''), "never log a password")

    def test_02_weak_password_is_refused_and_non_owner_cannot_reset(self):
        user = self.make_staff('pw_b', ['cashier'])
        with self.assertRaisesRegex(UserError, "at least 8"):
            self.staff.with_user(self.owner).reset_staff_password(user.id, 'short')
        with self.assertRaises(AccessError):
            self.staff.with_user(user).reset_staff_password(user.id, 'LongEnough#123')

    def test_03_owner_cannot_touch_another_shops_user_or_the_system_user(self):
        with self.assertRaisesRegex(UserError, "Unknown staff member"):
            self.staff.with_user(self.owner).reset_staff_password(1, 'LongEnough#123')

    def test_04_mfa_reset_clears_the_authenticator(self):
        user = self.make_staff('mfa_a', ['cashier'])
        user.sudo().totp_secret = base64.b32encode(b'01234567890123456789').decode()
        self.env.flush_all()
        self.assertTrue(user.sudo().totp_enabled)
        self.staff.with_user(self.owner).reset_staff_mfa(user.id)
        self.env.invalidate_all()
        self.assertFalse(user.sudo().totp_enabled)
        self.assertTrue(self.last_audit(kind='security', action='mfa_reset', target='mfa_a'))

    def test_05_logins_are_normalised_to_lowercase(self):
        uid = self.staff.with_user(self.owner).create_staff('Mixed', ' MiXeD.Case@Example.com ', 'StaffPass#123', ['cashier'])
        self.assertEqual(self.env['res.users'].browse(uid).login, 'mixed.case@example.com')


@tagged('post_install', '-at_install', 'orsquare')
class TestTwoStepSignIn(HttpCase):
    """Password first, then (for accounts that enrolled an authenticator) the 6-digit code."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user = cls.env['res.users'].create({
            'name': 'Mfa Owner', 'login': 'mfa_owner', 'password': 'MfaOwner#2026',
            'groups_id': [(6, 0, [cls.env.ref('orsquare.group_orsquare_owner').id, cls.env.ref('base.group_user').id])]})
        cls.env.cr.flush()

    def _post(self, path, payload):
        return self.url_open(path, data=json.dumps(payload), headers={'Content-Type': 'application/json'},
                             allow_redirects=False)

    @staticmethod
    def _code(secret, offset=0):
        from odoo.addons.auth_totp.models.totp import hotp
        return '%06d' % hotp(base64.b32decode(secret), int(time.time() / 30) + offset)

    def _login(self, password='MfaOwner#2026'):
        return self._post('/api/session/login', {'login': 'mfa_owner', 'password': password})

    def test_01_enrol_then_two_step_sign_in_then_remove(self):
        self.assertEqual(self._login().status_code, 200)
        self.assertFalse(self.url_open('/api/session/me').json()['data']['mfa']['enabled'])

        begin = self._post('/api/session/mfa/begin', {})
        self.assertEqual(begin.status_code, 200, begin.text)
        data = begin.json()['data']
        self.assertTrue(data['qrcode'])
        self.assertTrue(data['url'].startswith('otpauth://totp/'))
        bad = self._post('/api/session/mfa/enable', {'secret': data['secret'], 'code': '000000'})
        self.assertEqual(bad.status_code, 422)
        ok = self._post('/api/session/mfa/enable', {'secret': data['secret'], 'code': self._code(data['secret'])})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertTrue(self.url_open('/api/session/me').json()['data']['mfa']['enabled'], "stays signed in")
        self._post('/api/session/logout', {})

        # step 1: right password -> asked for the code, and nothing is signed in yet
        step1 = self._login()
        self.assertEqual(step1.status_code, 200, step1.text)
        self.assertEqual(step1.json()['data'], {'mfa_required': True, 'mfa': 'totp'})
        self.assertEqual(self.url_open('/api/session/me', allow_redirects=False).status_code, 401)
        # step 2: a wrong code is refused, the right one signs in
        self.assertEqual(self._post('/api/session/mfa', {'code': '123456'}).status_code, 401)
        self.assertEqual(self._post('/api/session/mfa', {'code': 'abcdef'}).status_code, 401)
        done = self._post('/api/session/mfa', {'code': self._code(data['secret'])})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(done.json()['data']['login'], 'mfa_owner')
        self.assertEqual(self.url_open('/api/session/me').status_code, 200)

        # remove it: needs the password
        self.assertEqual(self._post('/api/session/mfa/disable', {'password': 'wrong'}).status_code, 422)
        self.assertEqual(self._post('/api/session/mfa/disable', {'password': 'MfaOwner#2026'}).status_code, 200)
        events = {r.action for r in self.env['orsquare.config_audit'].search([('kind', '=', 'security'), ('target', '=', 'mfa_owner')])}
        self.assertTrue({'mfa_enabled', 'mfa_disabled'} <= events, "self-service security changes are logged")
        self._post('/api/session/logout', {})
        again = self._login()
        self.assertNotIn('mfa_required', again.json()['data'])

    def test_02_wrong_password_never_reaches_the_code_step(self):
        r = self._login('nope')
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self._post('/api/session/mfa', {'code': '123456'}).status_code, 401)

    def test_03_code_step_without_a_password_step_is_refused(self):
        r = self._post('/api/session/mfa', {'code': '123456'})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json()['error']['code'], 'mfa_expired')

    def test_04_repeated_wrong_codes_are_throttled(self):
        self._login()
        begin = self._post('/api/session/mfa/begin', {}).json()['data']
        self._post('/api/session/mfa/enable', {'secret': begin['secret'], 'code': self._code(begin['secret'])})
        self._post('/api/session/logout', {})
        self.assertTrue(self._login().json()['data']['mfa_required'])
        statuses = [self._post('/api/session/mfa', {'code': '000000'}).status_code for _i in range(7)]
        self.assertEqual(statuses[:5], [401] * 5)
        self.assertIn(429, statuses[5:])
        # even the right code is refused while throttled
        self.assertEqual(self._post('/api/session/mfa', {'code': self._code(begin['secret'])}).status_code, 429)


@tagged('post_install', '-at_install', 'orsquare')
class TestGateOverHttp(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        grp = cls.env.ref
        cls.owner = cls.env['res.users'].create({
            'name': 'Gate Owner', 'login': 'gate_owner', 'password': 'GateOwner#2026',
            'groups_id': [(6, 0, [grp('orsquare.group_orsquare_owner').id, grp('base.group_user').id])]})
        cls.staff = cls.env['orsquare.staff.service']
        cls.staff.with_user(cls.owner).create_staff('Gate Cashier', 'gate_cashier', 'GateCash#2026', ['cashier'], tabs=['sales'])
        cls.env.cr.flush()

    def _post(self, path, payload):
        return self.url_open(path, data=json.dumps(payload), headers={'Content-Type': 'application/json'},
                             allow_redirects=False)

    def _call(self, service, method, params=None):
        return self._post('/api/call', {'service': service, 'method': method, 'params': params or {}})

    def test_01_the_http_dispatcher_applies_the_gate(self):
        self._post('/api/session/login', {'login': 'gate_cashier', 'password': 'GateCash#2026'})
        denied = self._call('purchases', 'list_bills')
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(self._call('reports', 'trial_balance').status_code, 403)
        self.assertNotEqual(self._call('reports', 'dashboard').status_code, 403)
        self._post('/api/session/logout', {})
        self._post('/api/session/login', {'login': 'gate_owner', 'password': 'GateOwner#2026'})
        self.assertNotEqual(self._call('purchases', 'list_bills').status_code, 403)

    def test_02_a_stale_settings_version_is_http_409(self):
        self._post('/api/session/login', {'login': 'gate_owner', 'password': 'GateOwner#2026'})
        v = self._call('staff', 'get_experience').json()['data']['version']
        first = self._call('staff', 'update_settings', {'values': {'orsquare_cutoff_hour': 3.0}, 'expected_version': v})
        self.assertEqual(first.status_code, 200, first.text)
        stale = self._call('staff', 'update_settings', {'values': {'orsquare_cutoff_hour': 4.0}, 'expected_version': v})
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()['error']['code'], 'version_conflict')


@tagged('post_install', '-at_install', 'orsquare')
class TestRegistryCoverage(OrsquareCase):
    """Adding an API method must be a decision about who may call it, never an accident."""

    # Open to any signed-in staff on purpose: each checks the role itself (or only serves the caller's own data).
    OPEN = {'staff', 'sync', 'realtime'}

    def test_01_every_service_is_gated_or_explicitly_open(self):
        shop_services = {s for s, (model, _m) in API_REGISTRY.items() if s != 'platform'}
        ungated = shop_services - set(API_GATES) - self.OPEN
        self.assertFalse(ungated, "decide the gate for: %s" % sorted(ungated))
        self.assertFalse(set(API_GATES) - shop_services, "gate for a service that does not exist")

    def test_02_gates_only_name_real_methods_tabs_and_features(self):
        tabs = {t for t, _n in self.env['res.company']._fields['orsquare_enabled_tabs'].default and []} or {
            'dashboard', 'sales', 'purchases', 'stock', 'products', 'accounts', 'cashflow', 'daybook', 'calendar',
            'reports', 'settings'}
        for service, gates in API_GATES.items():
            methods = API_REGISTRY[service][1]
            for method, spec in gates.items():
                self.assertTrue(method == '*' or method in methods, "%s.%s is not an API method" % (service, method))
                self.assertTrue(spec['tabs'] and set(spec['tabs']) <= tabs, (service, method, spec))
                self.assertIn(spec.get('feature'), (None, 'open_bottle', 'kitchen', 'tables'))
        for kind, kind_tabs in MUTATION_TABS.items():
            self.assertTrue(set(kind_tabs) <= tabs, kind)
        self.assertEqual(set(MUTATION_TABS), set(self.env['orsquare.sync.service'].MUTATIONS), "every offline mutation has a tab")
