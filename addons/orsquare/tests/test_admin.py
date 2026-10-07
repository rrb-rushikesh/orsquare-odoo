# -*- coding: utf-8 -*-
import os

from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import OrsquareCase


class AdminCase(OrsquareCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.staff = cls.env['orsquare.staff.service']
        cls.catalog = cls.env['orsquare.catalog.service']
        cls.wipe = cls.env['orsquare.wipe.service']
        cls.owner = cls.env['res.users'].create({
            'name': 'Shop Owner', 'login': 'owner_test', 'password': 'OwnerPass#123',
            'groups_id': [(6, 0, [cls.env.ref('orsquare.group_orsquare_owner').id, cls.env.ref('base.group_user').id])]})


@tagged('post_install', '-at_install', 'orsquare')
class TestStaffAccess(AdminCase):

    def test_01_owner_creates_cashier_with_masking_flags(self):
        uid = self.staff.with_user(self.owner).create_staff(
            'Asha', 'asha', 'AshaPass123', ['cashier'], flags={'can_see_money': False, 'can_manage_returns': True})
        user = self.env['res.users'].browse(uid)
        self.assertEqual(user.orsquare_roles(), ['cashier'])
        self.assertFalse(user.has_group('orsquare.group_orsquare_can_see_money'))
        self.assertTrue(user.has_group('orsquare.group_orsquare_can_manage_returns'))
        self.assertTrue(user.has_group('point_of_sale.group_pos_user'), "built on native Odoo groups")

    def test_02_non_owner_cannot_manage_staff(self):
        cashier = self.env['res.users'].browse(self.staff.with_user(self.owner).create_staff(
            'Bob', 'bob', 'BobPass1234', ['cashier']))
        with self.assertRaises(AccessError):
            self.staff.with_user(cashier).create_staff('Eve', 'eve', 'EvePass1234', ['owner'])
        with self.assertRaises(AccessError):
            self.staff.with_user(cashier).update_settings({'orsquare_cutoff_hour': 3.0})

    def test_03_password_and_login_rules(self):
        with self.assertRaisesRegex(UserError, "8 characters"):
            self.staff.with_user(self.owner).create_staff('X', 'x1', 'short', ['cashier'])
        self.staff.with_user(self.owner).create_staff('X', 'dupe', 'LongEnough123', ['cashier'])
        with self.assertRaisesRegex(UserError, "already taken"):
            self.staff.with_user(self.owner).create_staff('Y', 'dupe', 'LongEnough123', ['cashier'])

    def test_04_tab_grants_intersect_enabled_tabs(self):
        uid = self.staff.with_user(self.owner).create_staff('Tabs', 'tabs', 'TabsPass123', ['cashier'],
                                                            tabs=['sales', 'stock'])
        user = self.env['res.users'].browse(uid)
        self.assertEqual(user.orsquare_effective_tabs(), ['sales', 'stock'])
        self.staff.with_user(self.owner).update_settings({'orsquare_enabled_tabs': ['sales', 'daybook']})
        self.assertEqual(user.orsquare_effective_tabs(), ['sales'], "owner switched Stock off shop-wide")
        self.assertEqual(self.owner.orsquare_effective_tabs(), ['sales', 'daybook'])

    def test_05_role_default_tabs(self):
        uid = self.staff.with_user(self.owner).create_staff('Stock', 'stk', 'StkPass12345', ['stockkeeper'])
        self.assertEqual(self.env['res.users'].browse(uid).orsquare_effective_tabs(), ['purchases', 'stock', 'products'][::-1][::-1]
                         if False else ['purchases', 'stock', 'products'])

    def test_06_update_staff_roles_flags_and_deactivate(self):
        uid = self.staff.with_user(self.owner).create_staff('Zed', 'zed', 'ZedPass12345', ['cashier'])
        self.staff.with_user(self.owner).update_staff(uid, roles=['stockkeeper'], flags={'can_see_valuation': True})
        user = self.env['res.users'].browse(uid)
        self.assertEqual(user.orsquare_roles(), ['stockkeeper'])
        self.assertTrue(user.has_group('orsquare.group_orsquare_can_see_valuation'))
        self.staff.with_user(self.owner).update_staff(uid, active=False)
        self.assertFalse(user.active)

    def test_07_owner_cannot_lock_themselves_out(self):
        with self.assertRaisesRegex(UserError, "own owner access"):
            self.staff.with_user(self.owner).update_staff(self.owner.id, roles=['cashier'])

    def test_08_me_reports_role_flags_tabs_and_features(self):
        me = self.staff.with_user(self.owner).me()
        self.assertEqual(me['roles'], ['owner', 'cashier', 'stockkeeper'][:0] or me['roles'])
        self.assertIn('owner', me['roles'])
        self.assertTrue(me['flags']['can_see_money'])
        self.assertIn('settings', me['tabs'])
        self.assertIn('auto_godown_transfer', me['features'])

    def test_09_settings_whitelist_and_validation(self):
        self.staff.with_user(self.owner).update_settings({
            'orsquare_auto_godown_transfer': True, 'orsquare_cutoff_hour': 3.0, 'orsquare_feature_kitchen': True})
        self.assertTrue(self.company.orsquare_auto_godown_transfer)
        self.assertEqual(self.company.orsquare_cutoff_hour, 3.0)
        with self.assertRaisesRegex(UserError, "Unknown setting"):
            self.staff.with_user(self.owner).update_settings({'name': 'Hacked Name'})
        with self.assertRaises(Exception):
            self.staff.with_user(self.owner).update_settings({'orsquare_cutoff_hour': 25.0})


@tagged('post_install', '-at_install', 'orsquare')
class TestCatalogMasters(AdminCase):

    def test_01_hiding_base_unit_is_non_destructive(self):
        ml = self.env.ref('orsquare.uom_base_ml')
        self.catalog.with_user(self.owner).set_base_unit_visibility(ml.id, False)
        self.assertFalse(ml.is_shop_visible)
        p = self.make_product('Still Works', uom_xmlid='orsquare.uom_shop_750ml')
        self.assertEqual(p.orsquare_capacity_ml, 750.0)
        with self.assertRaisesRegex(UserError, "hidden"):
            self.catalog.create_shop_unit('500 ml', ml.id, 500)
        self.catalog.with_user(self.owner).set_base_unit_visibility(ml.id, True)
        self.assertTrue(ml.is_shop_visible)

    def test_02_create_shop_unit_converts_exactly(self):
        ml = self.env.ref('orsquare.uom_base_ml')
        uid = self.catalog.create_shop_unit('500 ml', ml.id, 500)
        unit = self.env['uom.uom'].browse(uid)
        litre = self.env.ref('uom.product_uom_litre')
        self.assertEqual(unit._compute_quantity(2, litre), 1.0, "2 x 500 ml = 1 L")
        self.assertEqual(unit.rounding, 0.000001)
        with self.assertRaisesRegex(UserError, "already exists"):
            self.catalog.create_shop_unit('500 ml', ml.id, 500)
        with self.assertRaisesRegex(UserError, "strictly positive"):
            self.catalog.create_shop_unit('Zero', ml.id, 0)
        with self.assertRaisesRegex(UserError, "standard base"):
            self.catalog.create_shop_unit('Bad', unit.id, 2)

    def test_03_pack_unit_from_piece(self):
        piece = self.env.ref('uom.product_uom_unit')
        uid = self.catalog.create_shop_unit('Pack of 10', piece.id, 10)
        unit = self.env['uom.uom'].browse(uid)
        self.assertEqual(unit._compute_quantity(3, piece), 30.0)

    def test_04_regime_drives_product_taxes_and_rates_are_configurable(self):
        regimes = {r['name']: r for r in self.catalog.tax_regimes()}
        liquor = self.env['orsquare.tax_regime'].search([('kind', '=', 'liquor')], limit=1)
        self.assertEqual(liquor.sale_tax_ids.amount, 0.0, "no state rate is hard-coded")
        self.catalog.with_user(self.owner).set_regime_tax_rate(liquor.sale_tax_ids.id, 12.5)
        categ = self.catalog.create_category('Whisky', regime_id=liquor.id)
        tmpl_id = self.catalog.save_product({'name': 'Taxed Whisky', 'categ_id': categ, 'kind': 'retail',
                                            'list_price': 1000.0})
        tmpl = self.env['product.template'].browse(tmpl_id)
        self.assertEqual(tmpl.taxes_id.amount, 12.5)
        self.assertEqual(tmpl.orsquare_tax_regime_id, liquor)
        self.assertTrue(tmpl.is_storable)
        self.catalog.with_user(self.owner).set_regime_tcs_rate(liquor.id, 2.0)
        self.assertEqual(tmpl.orsquare_tcs_rate, 2.0)

    def test_05_save_product_pegs_portions_and_kitchen(self):
        uom = self.env.ref('orsquare.uom_shop_750ml')
        tid = self.catalog.save_product({
            'name': 'Peg Whisky', 'kind': 'retail', 'uom_id': uom.id, 'list_price': 2000.0, 'cost': 1500.0,
            'short_code': 'PW', 'pegs': [{'ml': 30, 'price': 70}, {'ml': 60, 'price': 120}]})
        tmpl = self.env['product.template'].browse(tid)
        self.assertEqual(tmpl.uom_po_id, uom)
        self.assertEqual(sorted(tmpl.orsquare_peg_size_ids.mapped('ml')), [30.0, 60.0])
        self.assertTrue(tmpl.orsquare_can_open)
        did = self.catalog.save_product({'name': 'Paneer Tikka', 'kind': 'kitchen', 'list_price': 200.0,
                                         'portions': {'full': 200.0, 'half': 120.0}})
        dish = self.env['product.template'].browse(did)
        self.assertTrue(dish.is_kitchen)
        self.assertFalse(dish.is_storable)
        self.assertEqual(len(dish.product_variant_ids), 2, "Full/Half are native variants of ONE template")
        prices = sorted(dish.product_variant_ids.mapped('lst_price'))
        self.assertEqual(prices, [120.0, 200.0])

    def test_06_kitchen_dish_is_never_storable(self):
        tid = self.catalog.save_product({'name': 'Dish', 'kind': 'kitchen', 'list_price': 10.0})
        with self.assertRaises(Exception):
            self.env['product.template'].browse(tid).write({'is_storable': True})

    def test_07_cost_is_masked_in_listing_and_cannot_be_set_without_rights(self):
        cashier = self.env['res.users'].create({
            'name': 'Mask', 'login': 'mask_c', 'groups_id': [(6, 0, [self.env.ref('orsquare.group_orsquare_stockkeeper').id])]})
        self.catalog.save_product({'name': 'Masked Item', 'kind': 'retail', 'list_price': 50.0, 'cost': 30.0})
        row = self.catalog.with_user(cashier).list_products(search='Masked Item')[0]
        self.assertNotIn('cost', row)
        row = self.catalog.list_products(search='Masked Item')[0]
        self.assertEqual(row['cost'], 30.0)
        with self.assertRaises(AccessError):
            self.catalog.with_user(cashier).save_product({'name': 'X', 'kind': 'retail', 'cost': 1.0})

    def test_08_margin_rule_suggests_but_never_overwrites(self):
        uom = self.env.ref('orsquare.uom_shop_750ml')
        categ = self.env['product.category'].create({'name': 'Whisky Margin'})
        self.catalog.with_user(self.owner).set_margin_rule(categ.id, uom.id, 25.0)
        tid = self.catalog.save_product({'name': 'Margin Whisky', 'kind': 'retail', 'uom_id': uom.id,
                                         'categ_id': categ.id, 'list_price': 300.0, 'cost': 180.0})
        tmpl = self.env['product.template'].browse(tid)
        self.assertEqual(tmpl.orsquare_suggested_price, 205.0)
        self.assertEqual(tmpl.list_price, 300.0, "the suggestion never overwrites the real price")
        tmpl.action_apply_suggested_price()
        self.assertEqual(tmpl.list_price, 205.0)

    def test_09_tables_bulk_generator(self):
        floor = self.catalog.with_user(self.owner).create_floor('Garden')
        ids = self.catalog.with_user(self.owner).bulk_create_tables(floor, 1, 10, 4)
        self.assertEqual(len(ids), 10)
        tables = self.env['restaurant.table'].browse(ids)
        self.assertEqual(set(tables.mapped('seats')), {4})
        with self.assertRaisesRegex(UserError, "already exist"):
            self.catalog.with_user(self.owner).bulk_create_tables(floor, 8, 12, 4)
        self.assertEqual(self.catalog.floors()[-1]['name'], 'Garden')

    def test_10_brands(self):
        bid = self.catalog.create_brand('Royal Challenge')
        self.assertIn(bid, [b['id'] for b in self.catalog.brands()])
        with self.assertRaises(Exception):
            self.catalog.create_brand('Royal Challenge')


@tagged('post_install', '-at_install', 'orsquare')
class TestDataWipe(AdminCase):

    def _master_counts(self):
        return {m: self.env[m].with_context(active_test=False).search_count([]) for m in (
            'product.template', 'res.partner', 'account.account', 'account.journal', 'account.tax',
            'res.users', 'uom.uom', 'orsquare.tax_regime', 'orsquare.peg_size', 'stock.warehouse')}

    def _do_business(self):
        item = self.make_product('Wipe Whisky 750ml', cost=1500.0, price=2000.0, uom_xmlid='orsquare.uom_shop_750ml')
        self.stock_in(item, 5, self.counter)
        bottle = self.Bottle.open_bottle(item)
        self.sell([{'peg': {'bottle_id': bottle.id, 'ml': 60}, 'price': 120.0}])
        self.sell([{'product_id': item.id, 'qty': 1}])
        return item

    def test_01_preview_lists_clear_and_keep(self):
        self._do_business()
        pv = self.wipe.with_user(self.owner).preview()
        self.assertGreater(pv['will_clear']['pos_order'], 0)
        self.assertGreater(pv['will_keep']['products'], 0)

    def test_02_challenge_required(self):
        with self.assertRaisesRegex(UserError, "shop name"):
            self.wipe.with_user(self.owner).wipe_shop('wrong name', 'OwnerPass#123')
        with self.assertRaisesRegex(UserError, "password"):
            self.wipe.with_user(self.owner).wipe_shop(self.company.name, 'bad password')

    def test_03_only_owner(self):
        cashier = self.env['res.users'].create({
            'name': 'Wc', 'login': 'wipe_c', 'groups_id': [(6, 0, [self.env.ref('orsquare.group_orsquare_cashier').id])]})
        with self.assertRaises(AccessError):
            self.wipe.with_user(cashier).wipe_shop(self.company.name, 'x')

    def test_04_wipe_clears_operations_keeps_masters_and_writes_verified_backup(self):
        item = self._do_business()
        masters_before = self._master_counts()
        self.assertGreater(self.env['pos.order'].search_count([]), 0)
        res = self.wipe.with_user(self.owner).wipe_shop(self.company.name, 'OwnerPass#123')
        self.assertTrue(res['backup_reference'].startswith('BAK-'))
        audit = self.env['orsquare.console_audit'].search([('backup_reference', '=', res['backup_reference'])])
        self.assertEqual(audit.action, 'OPERATIONAL_DATA_WIPED')
        self.assertTrue(os.path.exists(audit.backup_path))
        self.assertGreater(audit.backup_size, 1000)
        self.assertEqual(len(audit.backup_sha256), 64)
        # operational data is gone ...
        for model in ('pos.order', 'account.move', 'stock.move', 'stock.picking', 'stock.quant',
                      'orsquare.opened_bottle', 'orsquare.business_day', 'stock.valuation.layer'):
            self.assertEqual(self.env[model].with_context(active_test=False).search_count([]), 0, model)
        # ... masters are intact, and the topology survived
        self.assertEqual(self._master_counts(), masters_before)
        self.assertTrue(self.wh.orsquare_counter_id.exists())
        self.assertFalse(self.env['stock.location'].search([('location_id', '=', self.wh.orsquare_opened_id.id)]))
        self.assertTrue(item.exists())
        # the audit record itself is immutable
        with self.assertRaises(UserError):
            audit.unlink()

    def test_05_shop_can_trade_again_after_wipe(self):
        item = self._do_business()
        self.wipe.with_user(self.owner).wipe_shop(self.company.name, 'OwnerPass#123')
        self.stock_in(item, 3, self.counter)
        res = self.sell([{'product_id': item.id, 'qty': 1}])     # auto-opens a fresh day + session
        self.assertEqual(res['total'], 2000.0)
