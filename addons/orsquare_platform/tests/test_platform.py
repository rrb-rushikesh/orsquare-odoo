# -*- coding: utf-8 -*-
import base64
import json
from contextlib import contextmanager
from datetime import timedelta
from unittest import mock

import odoo
from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import HttpCase, TransactionCase, tagged

from odoo.addons.orsquare.models import directory
from ..models.platform import drop_database, shop_env


class PlatformCase(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.svc = cls.env['orsquare.platform.service']
        group = cls.env.ref
        mk = lambda login, groups: cls.env['res.users'].create({
            'name': login.title(), 'login': login, 'password': 'OperatorPass#2026',
            'groups_id': [(6, 0, [g.id for g in groups])]})
        cls.dev = mk('dev_test', [group('base.group_user'), group('orsquare_platform.group_platform_admin')])
        cls.sup = mk('sup_test', [group('base.group_user'), group('orsquare_platform.group_platform_support')])
        cls.plain = mk('plain_test', [group('base.group_user')])
        cls.env['ir.config_parameter'].sudo().set_param('orsquare.platform.require_mfa', '0')

    @classmethod
    def seed_shops(cls, n, prefix='seed'):
        today = fields.Date.context_today(cls.env['res.users'])
        rows = []
        for i in range(n):
            exp = [None, today - timedelta(days=3), today + timedelta(days=3), today + timedelta(days=60)][i % 4]
            rows.append({
                'name': 'Shop %s %05d' % (prefix, i), 'code': 'orsquare_shop_%s_%05d' % (prefix, i),
                'owner_name': 'Owner %d' % i, 'owner_login': '%s_owner_%d@example.com' % (prefix, i),
                'phone': '9%09d' % i, 'plan': ['trial', 'basic', 'pro'][i % 3],
                'status': ['active', 'active', 'active', 'suspended', 'archived'][i % 5], 'expires_on': exp})
        return cls.env['orsquare.platform.shop'].create(rows)


@tagged('post_install', '-at_install', 'orsquare_platform')
class TestOperatorLevels(PlatformCase):

    def test_01_only_operators_and_support_is_read_only(self):
        with self.assertRaises(AccessError):
            self.svc.with_user(self.plain).fleet()
        self.assertGreaterEqual(self.svc.with_user(self.dev).fleet()['grand_total'], 0)
        self.assertGreaterEqual(self.svc.with_user(self.sup).fleet()['grand_total'], 0)
        for call in (lambda s: s.suspend('orsquare_shop_x', 'no'), lambda s: s.archive('orsquare_shop_x'),
                     lambda s: s.create_operator('X', 'x_op', 'LongOperatorPass#1', 'admin'),
                     lambda s: s.save_plan('p', 'P'), lambda s: s.operators(), lambda s: s.rebuild_directory()):
            with self.assertRaises(AccessError):
                call(self.svc.with_user(self.sup))

    def test_02_authenticator_is_required_but_me_still_answers(self):
        self.env['ir.config_parameter'].sudo().set_param('orsquare.platform.require_mfa', '1')
        me = self.svc.with_user(self.dev).me()
        self.assertEqual(me['platform_role'], 'admin')
        self.assertEqual(me['mfa'], {'enabled': False, 'required': True})
        with self.assertRaisesRegex(AccessError, "authenticator"):
            self.svc.with_user(self.dev).fleet()
        self.dev.sudo().totp_secret = base64.b32encode(b'01234567890123456789').decode()
        self.env.flush_all()
        self.assertGreaterEqual(self.svc.with_user(self.dev).fleet()['grand_total'], 0)

    def test_03_audit_is_append_only(self):
        self.svc.with_user(self.dev)._log('probe')
        entry = self.env['orsquare.platform.audit'].search([('action', '=', 'probe')], limit=1)
        with self.assertRaises(UserError):
            entry.write({'detail': 'tamper'})
        with self.assertRaises(UserError):
            entry.unlink()

    def test_04_operator_management_and_its_safeguards(self):
        svc = self.svc.with_user(self.dev)
        row = svc.create_operator('New Op', ' New.Op@Example.com ', 'LongOperatorPass#1', 'support')
        self.assertEqual((row['login'], row['role']), ('new.op@example.com', 'support'))
        with self.assertRaisesRegex(UserError, "at least 12"):
            svc.create_operator('Weak', 'weak_op', 'short', 'admin')
        with self.assertRaisesRegex(UserError, "already taken|already used"):
            svc.create_operator('Dupe', 'new.op@example.com', 'LongOperatorPass#1', 'admin')
        self.assertEqual(svc.set_operator_role(row['id'], 'admin')['role'], 'admin')
        with self.assertRaisesRegex(UserError, "your own level"):
            svc.set_operator_role(self.dev.id, 'support')
        with self.assertRaisesRegex(UserError, "yourself"):
            svc.set_operator_active(self.dev.id, False)
        svc.reset_operator_password(row['id'], 'AnotherLongPass#2')
        with self.assertRaisesRegex(UserError, "at least 12"):
            svc.reset_operator_password(row['id'], 'short')
        self.assertFalse(svc.set_operator_active(row['id'], False)['active'])
        with self.assertRaisesRegex(UserError, "Choose a level"):
            svc.set_operator_role(row['id'], 'root')
        actions = [a['action'] for a in svc.audit(page_size=100)['rows']]
        self.assertIn('operator_create', actions)
        self.assertIn('operator_role', actions)

    def test_05_the_last_admin_cannot_be_removed(self):
        # as the platform itself (su) with every other admin gone, the one remaining admin is protected
        svc = self.svc.with_user(self.dev)
        for o in svc.operators():
            if o['role'] == 'admin' and o['id'] != self.dev.id and o['active']:
                svc.set_operator_active(o['id'], False)
        root = self.svc.sudo()
        with self.assertRaisesRegex(UserError, "one active admin"):
            root.set_operator_role(self.dev.id, 'support')
        with self.assertRaisesRegex(UserError, "one active admin"):
            root.set_operator_active(self.dev.id, False)
        svc.create_operator('Second', 'second_admin', 'LongOperatorPass#1', 'admin')
        self.assertEqual(root.set_operator_role(self.dev.id, 'support')['role'], 'support')   # now there is another


@tagged('post_install', '-at_install', 'orsquare_platform')
class TestFleetAtScale(PlatformCase):
    N = 2500

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.shops = cls.seed_shops(cls.N)
        cls.env.flush_all()

    def test_01_paging_is_exact_and_bounded(self):
        svc = self.svc.with_user(self.dev)
        first = svc.fleet(page=1, page_size=50)
        self.assertEqual(len(first['rows']), 50)
        self.assertGreaterEqual(first['total'], self.N)
        last_page = (first['total'] + 49) // 50
        tail = svc.fleet(page=last_page, page_size=50)
        self.assertEqual(len(tail['rows']), first['total'] - (last_page - 1) * 50)
        self.assertEqual(svc.fleet(page=last_page + 5, page_size=50)['rows'], [])
        self.assertEqual(len(svc.fleet(page_size=10_000)['rows']), 200, "page size is capped")
        codes = [r['code'] for p in (1, 2, 3) for r in svc.fleet(page=p, page_size=40, sort='code', desc=False)['rows']]
        self.assertEqual(codes, sorted(codes))
        self.assertEqual(len(set(codes)), 120, "pages never overlap")

    def test_02_query_count_does_not_grow_with_the_page(self):
        svc = self.svc.with_user(self.dev)
        svc.fleet(page=1, page_size=10)         # warm the caches: we measure steady state
        before = self.env.cr.sql_log_count
        svc.fleet(page=1, page_size=10)
        small = self.env.cr.sql_log_count - before
        before = self.env.cr.sql_log_count
        svc.fleet(page=1, page_size=200)
        large = self.env.cr.sql_log_count - before
        self.assertLessEqual(abs(large - small), 2, (small, large))
        self.assertLessEqual(large, 25)

    def test_03_counts_filters_and_python_rule_agree(self):
        svc = self.svc.with_user(self.dev)
        counts = svc.fleet()['counts']
        python = {}
        for shop in self.env['orsquare.platform.shop'].search([]):
            lc = svc._lifecycle(shop)
            python[lc] = python.get(lc, 0) + 1
        self.assertEqual(counts, python)
        for lifecycle in ('active', 'trial', 'expiring', 'expired', 'suspended', 'archived'):
            out = svc.fleet(lifecycle=lifecycle, page_size=200)
            self.assertEqual(out['total'], python.get(lifecycle, 0), lifecycle)
            self.assertTrue(all(r['lifecycle'] == lifecycle for r in out['rows']), lifecycle)
        with self.assertRaisesRegex(UserError, "Unknown lifecycle"):
            svc.fleet(lifecycle='haunted')

    def test_04_search_by_name_code_owner_phone_and_plan_filter(self):
        svc = self.svc.with_user(self.dev)
        self.assertEqual(svc.fleet(search='Shop seed 00042')['rows'][0]['code'], 'orsquare_shop_seed_00042')
        self.assertEqual(svc.fleet(search='seed_owner_77@')['total'], 1)
        self.assertEqual(svc.fleet(search='9000000123')['rows'][0]['name'], 'Shop seed 00123')
        pro = svc.fleet(plan='pro', page_size=200)
        self.assertTrue(pro['total'] > 0 and all(r['plan'] == 'pro' for r in pro['rows']))
        self.assertEqual(svc.fleet(search='nothing-matches-this-xyz')['rows'], [])

    def test_05_sorting_including_expiry_with_missing_dates_last(self):
        svc = self.svc.with_user(self.dev)
        rows = svc.fleet(sort='expires', desc=False, page_size=200)['rows']
        dated = [r['expires_on'] for r in rows if r['expires_on']]
        self.assertEqual(dated, sorted(dated))
        self.assertTrue(all(r['expires_on'] for r in rows[:len(dated)]), "undated shops come last")
        with self.assertRaisesRegex(UserError, "Cannot sort"):
            svc.fleet(sort='password')

    def test_05b_a_database_that_is_not_a_shop_cannot_be_adopted(self):
        svc = self.svc.with_user(self.dev)
        blank = 'orsquare_shop_zz_blank'
        odoo.service.db._create_empty_database(blank)
        try:
            self.assertIn(blank, svc.system()['unregistered'])
            with self.assertRaisesRegex(UserError, "not an ORSquare shop"):
                svc.adopt_unregistered(blank)
        finally:
            drop_database(blank)

    def test_06_unregistered_databases_are_found_by_one_query(self):
        out = self.svc.with_user(self.dev).system()
        self.assertIn('unregistered_count', out)
        self.assertLessEqual(len(out['unregistered']), 50)
        self.assertEqual(out['registered_shops'], sum(out['plans'].values()))


@tagged('post_install', '-at_install', 'orsquare_platform')
class TestAuditFilters(PlatformCase):

    def test_01_filters_and_paging(self):
        svc = self.svc.with_user(self.dev)
        for i in range(7):
            svc._log('probe_a' if i % 2 else 'probe_b', 'orsquare_shop_zz', 'note %d' % i)
        out = svc.audit(shop_code='orsquare_shop_zz', page_size=3)
        self.assertEqual((out['total'], len(out['rows'])), (7, 3))
        self.assertEqual(svc.audit(shop_code='orsquare_shop_zz', action='probe_a')['total'], 3)
        self.assertEqual(svc.audit(q='note 4')['total'], 1)
        self.assertEqual(svc.audit(actor='dev_test', shop_code='orsquare_shop_zz')['total'], 7)
        self.assertEqual(svc.audit(actor='nobody')['total'], 0)
        today = str(fields.Date.context_today(self.dev))
        self.assertGreaterEqual(svc.audit(date_from=today, date_to=today, shop_code='orsquare_shop_zz')['total'], 7)
        self.assertEqual(svc.audit(date_to='2000-01-01')['total'], 0)
        self.assertIn('probe_a', out['actions'])


@tagged('post_install', '-at_install', 'orsquare_platform')
class TestPlansAndDirectory(PlatformCase):

    def test_01_builtin_plans_and_custom_plan_rules(self):
        svc = self.svc.with_user(self.dev)
        codes = [p['code'] for p in svc.plans()['plans']]
        self.assertTrue({'trial', 'basic', 'pro'} <= set(codes))
        out = svc.save_plan('gold', 'Gold', features=['open_bottle', 'tables'], tabs=['sales', 'stock'], max_staff=5)
        gold = next(p for p in out['plans'] if p['code'] == 'gold')
        self.assertEqual((gold['features'], gold['tabs'], gold['max_staff']), (['open_bottle', 'tables'], ['sales', 'stock'], 5))
        out = svc.save_plan('gold', 'Gold plus', features=[], tabs=[], max_staff=0)
        gold = next(p for p in out['plans'] if p['code'] == 'gold')
        self.assertEqual((gold['name'], gold['features'], gold['max_staff']), ('Gold plus', [], 0))
        with self.assertRaises(Exception):
            svc.save_plan('bad', 'Bad', features=['teleporter'])
        with self.assertRaises(Exception):
            svc.save_plan('Bad Code!', 'Bad')
        with self.assertRaisesRegex(UserError, "built-in"):
            svc.delete_plan('trial')
        self.seed_shops(1, prefix='planuse')
        self.env['orsquare.platform.shop'].search([('code', '=', 'orsquare_shop_planuse_00000')]).plan = 'gold'
        with self.assertRaisesRegex(UserError, "still on this plan"):
            svc.delete_plan('gold')
        self.env['orsquare.platform.shop'].search([('code', '=', 'orsquare_shop_planuse_00000')]).plan = 'trial'
        svc.delete_plan('gold')
        self.assertNotIn('gold', [p['code'] for p in svc.plans()['plans']])

    def test_02_entitlement_payload_means_unlimited_when_empty(self):
        plan = self.env['orsquare.platform.plan'].search([('code', '=', 'pro')])
        self.assertEqual(plan.entitlements(), {'plan': 'pro', 'features': None, 'tabs': None, 'max_staff': 0})

    @contextmanager
    def _directory_on_this_transaction(self):
        """Run the shop-side directory helper against this test's own cursor so nothing is committed."""
        @contextmanager
        def cursor():
            yield self.env.cr
        fake = mock.Mock(cursor=cursor)
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('orsquare.directory_enabled', '1')
        with mock.patch.object(directory, 'Registry', return_value=fake):
            yield

    def test_03_a_key_belongs_to_exactly_one_shop(self):
        self.env['orsquare.platform.login'].create({'key': 'ravi@example.com', 'shop_code': 'orsquare_shop_other', 'kind': 'staff'})
        with self._directory_on_this_transaction():
            with self.assertRaisesRegex(UserError, "another shop"):
                directory.claim(self.env, ['  Ravi@Example.com '])
            claimed = directory.claim(self.env, ['fresh.key@example.com', 'FRESH.key@example.com', ''])
            self.assertEqual(claimed, ['fresh.key@example.com'])
            self.assertEqual(directory.claim(self.env, ['fresh.key@example.com']), [], "claiming your own key again is fine")
            directory.release(self.env, ['fresh.key@example.com'])
        self.assertFalse(self.env['orsquare.platform.login'].search([('key', '=', 'fresh.key@example.com')]))
        self.assertTrue(self.env['orsquare.platform.login'].search([('key', '=', 'ravi@example.com')]),
                        "releasing never removes another shop's key")

    def test_04_directory_is_off_unless_the_shop_turns_it_on(self):
        self.env['ir.config_parameter'].sudo().set_param('orsquare.directory_enabled', '0')
        self.assertEqual(directory.claim(self.env, ['whatever@example.com']), [])

    def test_05_operator_logins_are_reserved_in_the_directory(self):
        svc = self.svc.with_user(self.dev)
        svc.create_operator('Dir Op', 'dir.op@example.com', 'LongOperatorPass#1', 'admin')
        row = self.env['orsquare.platform.login'].search([('key', '=', 'dir.op@example.com')])
        self.assertEqual((row.kind, row.shop_code), ('operator', 'orsquare_platform'))
        self.seed_shops(1, prefix='dirtest')
        with self.assertRaisesRegex(UserError, "already used"):
            svc._claim('orsquare_shop_dirtest_00000', ['dir.op@example.com'], 'owner')


@tagged('post_install', '-at_install', 'orsquare_platform')
class TestProvisioningEndToEnd(PlatformCase):
    """A real shop database: clone, configure, manage, archive and delete."""

    SLUG = 'ptest'
    DB = 'orsquare_shop_ptest'

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        drop_database(cls.DB)

    @classmethod
    def tearDownClass(cls):
        try:
            drop_database(cls.DB)
            with odoo.sql_db.db_connect(cls.env.cr.dbname).cursor() as cr:
                cr.execute("DELETE FROM orsquare_platform_login WHERE shop_code = %s", (cls.DB,))
        finally:
            super().tearDownClass()

    def test_01_whole_lifecycle(self):
        dev = self.svc.with_user(self.dev)
        with self.assertRaisesRegex(UserError, "at least 8"):
            dev.create_shop('Bad', self.SLUG, 'O', 'o_login', 'short')
        with self.assertRaisesRegex(UserError, "a-z, 0-9"):
            dev.create_shop('Bad', 'Bad Slug!', 'O', 'o_login', 'LongEnough#1')
        with self.assertRaisesRegex(UserError, "Unknown plan"):
            dev.create_shop('Bad', self.SLUG, 'O', 'o_login', 'LongEnough#1', plan='platinum')
        dev.save_plan('capped', 'Capped', features=['open_bottle'], tabs=['sales', 'stock', 'settings', 'dashboard'], max_staff=2)

        row = dev.create_shop('Platform Test Wines', self.SLUG, 'Pat Owner', ' Pat_Owner ', 'PatPass#2026',
                              phone='9000000001', preset='bar', plan='capped', trial_days=14)
        self.assertEqual((row['code'], row['plan'], row['lifecycle']), (self.DB, 'capped', 'active'))
        self.assertIn(self.DB, [r['code'] for r in dev.fleet(search='platform test')['rows']])
        with self.assertRaisesRegex(UserError, "already used|already taken"):
            dev.create_shop('Other', 'ptest2', 'O', 'pat_owner', 'LongEnough#1')        # owner login is taken
        self.assertFalse(odoo.service.db.exp_db_exist('orsquare_shop_ptest2'), "nothing was cloned for the refused one")

        # a configured shop with a working owner, a neutralised admin and the plan applied
        detail = dev.shop_detail(self.DB)
        self.assertEqual([s['login'] for s in detail['staff']], ['pat_owner'])
        self.assertEqual(detail['health']['entitlements']['max_staff'], 2)
        self.assertTrue(detail['health']['directory'])
        self.assertFalse(detail['health']['blocked'])
        with shop_env(self.DB) as env:
            self.assertNotEqual(env.ref('base.user_admin').sudo().password or '', 'admin')
            owner = env['res.users'].search([('login', '=', 'pat_owner')])
            self.assertEqual(owner.partner_id.phone, '9000000001', "the owner can sign in by phone")
        keys = {r.key: r.kind for r in self.env['orsquare.platform.login'].search([('shop_code', '=', self.DB)])}
        self.assertEqual(keys, {'pat_owner': 'owner', '9000000001': 'owner'})

        # the plan is a ceiling: the bar preset asked for kitchen+tables, the plan only includes open_bottle
        exp = dev.shop_experience(self.DB)
        feats = {f['key']: f for f in exp['features']}
        self.assertTrue(feats['open_bottle']['on'] and not feats['kitchen']['on'] and not feats['tables']['on'])
        self.assertEqual({t['key'] for t in exp['tabs'] if t['entitled']}, {'sales', 'stock', 'settings', 'dashboard'})
        self.assertEqual(exp['profile'], 'bar')

        # Business Studio from the console, with the version lock
        out = dev.studio_apply(self.DB, values={'orsquare_stock_variant': 'standard'}, expected_version=exp['version'])
        self.assertEqual(out['variants']['stock']['value'], 'standard')
        with self.assertRaises(Exception):
            dev.studio_apply(self.DB, values={'orsquare_stock_variant': 'wine'}, expected_version=exp['version'])
        with self.assertRaisesRegex(UserError, "plan does not include"):
            dev.studio_apply(self.DB, values={'orsquare_feature_kitchen': True})

        # staff from the console: create, update, reset, and the plan's staff limit
        made = dev.shop_staff_create(self.DB, 'Ravi', 'Ravi.Cashier@Example.com', 'CashierPass#1', ['cashier'])
        self.assertEqual(sorted(s['login'] for s in made['staff']), ['pat_owner', 'ravi.cashier@example.com'])
        with self.assertRaisesRegex(UserError, "plan allows 2"):
            dev.shop_staff_create(self.DB, 'Third', 'third@example.com', 'CashierPass#1', ['cashier'])
        uid = next(s['id'] for s in made['staff'] if s['login'] == 'ravi.cashier@example.com')
        staff = dev.shop_staff_update(self.DB, uid, tabs=['sales'], flags={'can_see_money': False})
        self.assertEqual(next(s for s in staff if s['id'] == uid)['granted_tabs'], ['sales'])
        dev.shop_staff_reset_password(self.DB, uid, 'ResetPass#2026')
        dev.shop_staff_reset_mfa(self.DB, uid)
        with odoo.sql_db.db_connect(self.env.cr.dbname).cursor() as cr:     # the shop committed it on its own connection
            cr.execute("SELECT shop_code FROM orsquare_platform_login WHERE key = 'ravi.cashier@example.com'")
            self.assertEqual(cr.fetchall(), [(self.DB,)], "the shop reserved the new login in the platform directory")
        audit = dev.shop_audit(self.DB, limit=50)
        actors = {r['actor'] for r in audit['rows']}
        self.assertIn('platform:dev_test', actors, "the shop's own log names the operator, not root")
        self.assertTrue({'created', 'updated', 'password_reset', 'mfa_reset', 'changed'} <= {r['action'] for r in audit['rows']})

        # lifecycle: suspend -> reactivate -> archive -> delete
        with self.assertRaisesRegex(UserError, "reason"):
            dev.suspend(self.DB, ' ')
        self.assertEqual(dev.suspend(self.DB, 'unpaid')['lifecycle'], 'suspended')
        with shop_env(self.DB) as env:
            self.assertEqual(env['ir.config_parameter'].sudo().get_param('orsquare.suspended'), '1')
        self.assertEqual(dev.reactivate(self.DB)['lifecycle'], 'active')
        with shop_env(self.DB) as env:
            self.assertEqual(env['ir.config_parameter'].sudo().get_param('orsquare.suspended'), '0')
        dev.reset_owner_password(self.DB, 'NewPass#2026x')
        self.assertEqual(dev.extend(self.DB, 30)['plan'], 'capped')
        self.assertEqual(dev.set_expiry(self.DB, '2031-01-01', plan='pro')['plan'], 'pro')
        with shop_env(self.DB) as env:
            self.assertEqual(json.loads(env['ir.config_parameter'].sudo().get_param('orsquare.entitlements'))['plan'], 'pro')

        with self.assertRaisesRegex(UserError, "archived shop"):
            dev.delete_shop(self.DB, self.DB)
        self.assertEqual(dev.archive(self.DB, 'closed down')['lifecycle'], 'archived')
        with shop_env(self.DB) as env:
            self.assertEqual(env['ir.config_parameter'].sudo().get_param('orsquare.suspended'), '1', "archived shops are blocked")
        with self.assertRaisesRegex(UserError, "exactly"):
            dev.delete_shop(self.DB, 'wrong')
        self.assertTrue(odoo.service.db.exp_db_exist(self.DB))

        # an archived shop can be brought back, and a shop missing from the registry can be adopted
        self.assertEqual(dev.reactivate(self.DB)['lifecycle'], 'active')
        self.env['orsquare.platform.shop'].search([('code', '=', self.DB)]).unlink()
        self.env['orsquare.platform.login'].search([('shop_code', '=', self.DB)]).unlink()
        self.assertIn(self.DB, dev.system()['unregistered'])
        adopted = dev.adopt_unregistered(self.DB, plan='pro')
        self.assertEqual((adopted['code'], adopted['owner_login'], adopted['phone'], adopted['plan']),
                         (self.DB, 'pat_owner', '9000000001', 'pro'))
        with self.assertRaisesRegex(UserError, "not an unregistered"):
            dev.adopt_unregistered(self.DB)

        # the directory can be rebuilt from the shops themselves
        self.env['orsquare.platform.login'].search([('shop_code', '=', self.DB)]).unlink()
        progress = dev.rebuild_directory(limit=100)
        self.assertFalse([c for c in progress['conflicts'] if c['shop'] == self.DB])
        self.assertEqual(dev._key_owner('ravi.cashier@example.com'), self.DB)

        # a plan change reaches the shops that are on it, in slices
        dev.save_plan('pro', 'Pro', features=['open_bottle', 'kitchen'], tabs=[], max_staff=9)
        pushed = dev.push_plan('pro', offset=0, limit=100)
        self.assertEqual(pushed['failed'], [])
        with shop_env(self.DB) as env:
            ent = json.loads(env['ir.config_parameter'].sudo().get_param('orsquare.entitlements'))
        self.assertEqual((ent['features'], ent['max_staff']), (['open_bottle', 'kitchen'], 9))

        # finally: archive and delete for good
        dev.archive(self.DB)
        self.assertTrue(dev.delete_shop(self.DB, self.DB))
        self.assertFalse(odoo.service.db.exp_db_exist(self.DB))
        self.assertFalse(self.env['orsquare.platform.shop'].search([('code', '=', self.DB)]))
        self.assertFalse(self.env['orsquare.platform.login'].search([('shop_code', '=', self.DB)]))

        actions = [a['action'] for a in dev.audit(shop_code=self.DB, page_size=200)['rows']]
        for expected in ('create_shop', 'suspend', 'reactivate', 'archive', 'delete_shop', 'reset_owner_password', 'studio',
                         'extend', 'set_expiry', 'staff_create', 'staff_update', 'staff_reset_password', 'staff_reset_mfa',
                         'adopt_shop'):
            self.assertIn(expected, actions)


@tagged('post_install', '-at_install', 'orsquare_platform')
class TestOperatorSignInOverHttp(HttpCase):
    """The console's real door: password, throttle, authenticator step, and the two operator levels over /api/call."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        group = cls.env.ref
        mk = lambda login, g: cls.env['res.users'].create({
            'name': login.title(), 'login': login, 'password': 'OperatorPass#2026',
            'groups_id': [(6, 0, [group('base.group_user').id, group(g).id])]})
        cls.admin_op = mk('http_admin_op', 'orsquare_platform.group_platform_admin')
        cls.support_op = mk('http_support_op', 'orsquare_platform.group_platform_support')
        cls.env['ir.config_parameter'].sudo().set_param('orsquare.platform.require_mfa', '0')
        cls.env.cr.flush()

    def _post(self, path, payload):
        return self.url_open(path, data=json.dumps(payload), headers={'Content-Type': 'application/json'},
                             allow_redirects=False)

    def _login(self, login, password='OperatorPass#2026'):
        return self._post('/api/session/login', {'login': login, 'password': password, 'surface': 'dev'})

    def _call(self, method, params=None):
        return self._post('/api/call', {'service': 'platform', 'method': method, 'params': params or {}})

    def test_01_repeated_wrong_passwords_are_throttled_for_operators_too(self):
        statuses = [self._login('http_admin_op', 'wrong').status_code for _i in range(7)]
        self.assertEqual(statuses[:5], [401] * 5)
        self.assertIn(429, statuses[5:])
        self.assertEqual(self._login('http_admin_op').status_code, 429, "even the right password waits")

    def test_02_two_levels_over_the_real_api(self):
        self.assertEqual(self._login('http_support_op').status_code, 200)
        me = self._call('me').json()['data']
        self.assertEqual((me['platform_role'], me['surface']), ('support', 'dev'))
        self.assertEqual(self._call('fleet').status_code, 200)
        denied = self._call('create_operator', {'name': 'X', 'login': 'x_op', 'password': 'LongOperatorPass#1', 'role': 'admin'})
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(self._call('operators').status_code, 403)
        self._post('/api/session/logout', {})
        self.assertEqual(self._login('http_admin_op').status_code, 200)
        self.assertEqual(self._call('operators').status_code, 200)

    def test_03_operator_with_an_authenticator_needs_the_code(self):
        from odoo.addons.auth_totp.models.totp import hotp
        secret = base64.b32encode(b'01234567890123456789')
        self.admin_op.sudo().totp_secret = secret.decode()
        self.env.flush_all()
        step1 = self._login('http_admin_op')
        self.assertEqual(step1.json()['data'], {'mfa_required': True, 'mfa': 'totp'})
        self.assertEqual(self._call('fleet').status_code, 401, "not signed in until the code is given")
        import time
        code = '%06d' % hotp(base64.b32decode(secret), int(time.time() / 30))
        self.assertEqual(self._post('/api/session/mfa', {'code': '000000'}).status_code, 401)
        done = self._post('/api/session/mfa', {'code': code})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(done.json()['data']['platform_role'], 'admin')
        self.assertTrue(done.json()['data']['mfa']['enabled'])
        self.assertEqual(self._call('fleet').status_code, 200)

    def test_03b_operator_can_enrol_an_authenticator_over_http(self):
        import time
        from odoo.addons.auth_totp.models.totp import hotp
        self.assertEqual(self._login('http_support_op').status_code, 200)
        begin = self._post('/api/session/mfa/begin', {})
        self.assertEqual(begin.status_code, 200, begin.text)
        secret = begin.json()['data']['secret']
        code = '%06d' % hotp(base64.b32decode(secret), int(time.time() / 30))
        self.assertEqual(self._post('/api/session/mfa/enable', {'secret': secret, 'code': '000000'}).status_code, 422)
        ok = self._post('/api/session/mfa/enable', {'secret': secret, 'code': code})
        self.assertEqual(ok.status_code, 200, ok.text)
        me = self._call('me').json()['data']
        self.assertTrue(me['mfa']['enabled'], "still signed in, and now enrolled")

    def test_04_a_shop_user_cannot_use_the_console(self):
        r = self._post('/api/session/login', {'login': 'nobody_here', 'password': 'x', 'surface': 'dev'})
        self.assertEqual(r.status_code, 401)
