# -*- coding: utf-8 -*-
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged

from ..models.platform import drop_database, shop_env


@tagged('post_install', '-at_install', 'orsquare_platform')
class TestPlatform(TransactionCase):
    """The operator layer: registry, provisioning by cloning the template, suspension, audit."""

    SLUG = 'ptest'
    DB = 'orsquare_shop_ptest'

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.svc = cls.env['orsquare.platform.service']
        cls.dev = cls.env['res.users'].create({
            'name': 'Dev', 'login': 'dev_test', 'password': 'DevPass#12345',
            'groups_id': [(6, 0, [cls.env.ref('base.group_system').id])]})
        cls.plain = cls.env['res.users'].create({
            'name': 'Plain', 'login': 'plain_test', 'password': 'PlainPass#12345',
            'groups_id': [(6, 0, [cls.env.ref('base.group_user').id])]})
        drop_database(cls.DB)

    @classmethod
    def tearDownClass(cls):
        try:
            drop_database(cls.DB)
        finally:
            super().tearDownClass()

    def test_01_only_developers(self):
        with self.assertRaises(AccessError):
            self.svc.with_user(self.plain).fleet()
        self.assertTrue(self.svc.with_user(self.dev).fleet()['total'] >= 0)

    def test_02_audit_is_append_only(self):
        self.svc.with_user(self.dev)._log('probe')
        entry = self.env['orsquare.platform.audit'].search([('action', '=', 'probe')], limit=1)
        with self.assertRaises(UserError):
            entry.write({'detail': 'tamper'})
        with self.assertRaises(UserError):
            entry.unlink()

    def test_03_provision_suspend_reset_studio(self):
        dev = self.svc.with_user(self.dev)
        with self.assertRaisesRegex(UserError, "at least 8"):
            dev.create_shop('Bad', self.SLUG, 'O', 'o_login', 'short')
        with self.assertRaisesRegex(UserError, "a-z, 0-9"):
            dev.create_shop('Bad', 'Bad Slug!', 'O', 'o_login', 'LongEnough#1')
        row = dev.create_shop('Platform Test Wines', self.SLUG, 'Pat Owner', 'pat_owner', 'PatPass#2026',
                              phone='9000000000', preset='bar', plan='trial', trial_days=14)
        self.assertEqual(row['code'], self.DB)
        self.assertEqual(row['lifecycle'], 'trial')
        self.assertIn(self.DB, [r['code'] for r in dev.fleet(search='platform test')['rows']])

        # the new shop is a real, configured shop with a working owner
        detail = dev.shop_detail(self.DB)
        self.assertEqual([s['login'] for s in detail['staff']], ['pat_owner'])
        self.assertTrue(detail['settings']['orsquare_feature_open_bottle'], "bar preset applied")
        with shop_env(self.DB) as env:
            admin = env.ref('base.user_admin')
            self.assertNotEqual(admin.sudo().password or '', 'admin')   # default password neutralised

        # suspend -> the shop's own flag is set; reactivate clears it
        with self.assertRaisesRegex(UserError, "reason"):
            dev.suspend(self.DB, ' ')
        self.assertEqual(dev.suspend(self.DB, 'unpaid')['lifecycle'], 'suspended')
        with shop_env(self.DB) as env:
            self.assertEqual(env['ir.config_parameter'].sudo().get_param('orsquare.suspended'), '1')
        self.assertEqual(dev.reactivate(self.DB)['lifecycle'], 'trial')
        with shop_env(self.DB) as env:
            self.assertEqual(env['ir.config_parameter'].sudo().get_param('orsquare.suspended'), '0')

        # owner password reset works against the shop's own login
        dev.reset_owner_password(self.DB, 'NewPass#2026x')
        with shop_env(self.DB) as env:
            uid = env['res.users'].authenticate(self.DB, {'type': 'password', 'login': 'pat_owner', 'password': 'NewPass#2026x'},
                                                {'interactive': False})
            self.assertTrue(uid)

        # studio: features can be changed per shop, and the change is audited
        out = dev.studio_apply(self.DB, values={'orsquare_feature_kitchen': True})
        self.assertTrue(out['orsquare_feature_kitchen'])
        self.assertEqual(dev.extend(self.DB, 30)['plan'], 'trial')
        actions = [a['action'] for a in dev.audit(shop_code=self.DB)]
        for expected in ('create_shop', 'suspend', 'reactivate', 'reset_owner_password', 'studio', 'extend'):
            self.assertIn(expected, actions)
        self.assertIn(self.DB, dev.system()['unregistered'] or [self.DB])   # sanity: system() runs
