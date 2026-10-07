# -*- coding: utf-8 -*-
"""Catalog Masters (categories, units, brands) + product create/update + restaurant tables."""
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import float_compare

from .security_utils import require_staff


class OrsquareCatalogService(models.AbstractModel):
    _name = 'orsquare.catalog.service'
    _description = "ORSquare Catalog Masters Service"

    @api.model
    def _require(self, group='orsquare.group_orsquare_stockkeeper'):
        if not (self.env.su or self.env.user.has_group(group)):
            raise AccessError(_("You are not allowed to change the catalog."))

    @api.model
    def _valuation(self):
        return self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_valuation')

    # ------------------------------------------------------------------ units (two tiers)
    @api.model
    def units(self):
        """Catalog Masters -> Units: Tier 1 base units (with the eye toggle) and Tier 2 shop units."""
        require_staff(self.env)
        env = self.sudo().env
        base = env['uom.uom'].with_context(active_test=False).search([('is_platform_base', '=', True)], order='category_id, id')
        shop = env['uom.uom'].search([('orsquare_base_unit_id', '!=', False)], order='category_id, factor desc')
        return {
            'base_units': [{'id': u.id, 'name': u.name, 'category': u.category_id.name,
                            'visible': u.is_shop_visible} for u in base],
            'shop_units': [{'id': u.id, 'name': u.name, 'base_unit': u.orsquare_base_unit_id.name,
                            'ratio': u.orsquare_ratio, 'base_unit_id': u.orsquare_base_unit_id.id} for u in shop],
        }

    @api.model
    def set_base_unit_visibility(self, uom_id, visible):
        """The Eye toggle. Non-destructive: hiding never touches shop units or products."""
        self._require('orsquare.group_orsquare_owner')
        uom = self.sudo().env['uom.uom'].with_context(active_test=False).browse(int(uom_id)).exists()
        if not uom or not uom.is_platform_base:
            raise UserError(_("Only platform base units can be shown or hidden."))
        uom.is_shop_visible = bool(visible)
        return True

    @api.model
    def create_shop_unit(self, name, base_unit_id, ratio):
        """Tier 2 unit derived from a visible Tier 1 unit (e.g. '180 ml' = 180 x ml)."""
        self._require()
        env = self.sudo().env
        base = env['uom.uom'].browse(int(base_unit_id)).exists()
        ratio = float(ratio)
        if not base or not base.is_platform_base:
            raise UserError(_("Choose one of the standard base units."))
        if not base.is_shop_visible:
            raise UserError(_("%s is hidden; show it before creating units from it.", base.name))
        if ratio <= 0:
            raise UserError(_("The ratio must be strictly positive."))
        if env['uom.uom'].search_count([('name', '=ilike', name), ('category_id', '=', base.category_id.id)]):
            raise UserError(_("A unit called '%s' already exists.", name))
        factor = base.factor / ratio
        if abs(factor - 1.0) < 1e-9:
            raise UserError(_("A shop unit with ratio 1 would duplicate %s; use the base unit itself.", base.name))
        vals = {
            'name': name, 'category_id': base.category_id.id, 'rounding': 0.000001,
            'orsquare_base_unit_id': base.id, 'orsquare_ratio': ratio,
            'uom_type': 'smaller' if factor > 1.0 else 'bigger', 'factor': factor,
        }
        return env['uom.uom'].create(vals).id

    # ------------------------------------------------------------------ brands / categories
    @api.model
    def brands(self):
        require_staff(self.env)
        return [{'id': b.id, 'name': b.name} for b in self.env['orsquare.brand'].search([])]

    @api.model
    def create_brand(self, name):
        self._require()
        return self.sudo().env['orsquare.brand'].create({'name': name.strip()}).id

    @api.model
    def categories(self):
        require_staff(self.env)
        return [{'id': c.id, 'name': c.complete_name, 'regime': c.orsquare_tax_regime_id.name or ''}
                for c in self.env['product.category'].search([])]

    @api.model
    def create_category(self, name, parent_id=None, regime_id=None):
        self._require()
        return self.sudo().env['product.category'].create({
            'name': name.strip(), 'parent_id': parent_id or False,
            'orsquare_tax_regime_id': regime_id or False}).id

    @api.model
    def tax_regimes(self):
        require_staff(self.env)
        return [{'id': r.id, 'name': r.name, 'kind': r.kind, 'tcs_rate': r.tcs_rate,
                 'sale_taxes': r.sale_tax_ids.mapped('name'), 'purchase_taxes': r.purchase_tax_ids.mapped('name')}
                for r in self.env['orsquare.tax_regime'].search([])]

    @api.model
    def set_regime_tax_rate(self, tax_id, amount):
        """Configure a statutory rate (State VAT etc.) without code changes."""
        self._require('orsquare.group_orsquare_owner')
        tax = self.sudo().env['account.tax'].browse(int(tax_id)).exists()
        if not tax or float(amount) < 0:
            raise UserError(_("Invalid tax or rate."))
        tax.amount = float(amount)
        return True

    @api.model
    def set_regime_tcs_rate(self, regime_id, rate):
        self._require('orsquare.group_orsquare_owner')
        if float(rate) < 0:
            raise UserError(_("A TCS rate cannot be negative."))
        self.sudo().env['orsquare.tax_regime'].browse(int(regime_id)).tcs_rate = float(rate)
        return True

    # ------------------------------------------------------------------ products
    PRODUCT_FIELDS = {
        'name': 'name', 'barcode': 'barcode', 'list_price': 'list_price', 'categ_id': 'categ_id',
        'uom_id': 'uom_id', 'brand_id': 'orsquare_brand_id', 'short_code': 'orsquare_short_code',
        'regime_id': 'orsquare_tax_regime_id', 'low_stock_qty': 'orsquare_low_stock_qty',
        'is_kitchen': 'is_kitchen', 'default_code': 'default_code', 'mrp': 'orsquare_mrp',
    }

    @api.model
    def save_product(self, values, product_tmpl_id=None):
        """Create/update a catalog product.

        ``values`` keys: name, barcode, list_price (selling rate), cost (valuation rights only), categ_id,
        uom_id (shop unit; the bottle size), brand_id, short_code, regime_id, kind (retail|kitchen|consumable),
        pegs [{ml, price}], portions {full, half}, low_stock_qty.
        """
        self._require()
        env = self.sudo().env
        vals = {self.PRODUCT_FIELDS[k]: v for k, v in values.items() if k in self.PRODUCT_FIELDS}
        kind = values.get('kind')
        if kind == 'kitchen':
            vals.update({'is_kitchen': True, 'type': 'consu', 'is_storable': False})
        elif kind == 'retail':
            vals.update({'is_kitchen': False, 'type': 'consu', 'is_storable': True})
        elif kind == 'consumable':
            vals.update({'is_kitchen': False, 'type': 'consu', 'is_storable': False})
        if 'cost' in values:
            if not self._valuation():
                raise AccessError(_("You cannot set purchase rates."))
            vals['standard_price'] = float(values['cost'])
        if vals.get('uom_id'):
            vals['uom_po_id'] = vals['uom_id']
        vals.setdefault('available_in_pos', True)
        if product_tmpl_id:
            tmpl = env['product.template'].browse(int(product_tmpl_id)).exists()
            vals.pop('available_in_pos', None)
            tmpl.write(vals)
        else:
            tmpl = env['product.template'].create(vals)
        if 'pegs' in values:
            tmpl.orsquare_peg_size_ids.unlink()
            tmpl.write({'orsquare_peg_size_ids': [(0, 0, {'ml': float(p['ml']), 'price': float(p['price'])})
                                                  for p in values['pegs']]})
        portions = values.get('portions')
        if portions:
            tmpl.orsquare_set_portions(float(portions['full']), float(portions['half']))
        return tmpl.id

    @api.model
    def suggest_price(self, product_tmpl_id):
        tmpl = self.env['product.template'].browse(int(product_tmpl_id))
        if not self._valuation():
            raise AccessError(_("Margins are hidden for your role."))
        return {'suggested_price': tmpl.orsquare_suggested_price, 'cost': tmpl.standard_price,
                'margin': tmpl.orsquare_suggested_price - tmpl.standard_price}

    @api.model
    def set_margin_rule(self, categ_id, uom_id, margin_amount):
        self._require('orsquare.group_orsquare_owner')
        Rule = self.sudo().env['orsquare.margin_rule']
        rule = Rule.search([('categ_id', '=', int(categ_id)), ('uom_id', '=', int(uom_id))], limit=1)
        if rule:
            rule.margin_amount = float(margin_amount)
            return rule.id
        return Rule.create({'categ_id': int(categ_id), 'uom_id': int(uom_id), 'margin_amount': float(margin_amount)}).id

    @api.model
    def list_products(self, search=None, kind=None, limit=200, offset=0, changed_since=None):
        """Catalog listing; purchase cost only for staff with valuation rights."""
        require_staff(self.env)
        domain = [('available_in_pos', '=', True)]
        if search:
            domain += ['|', '|', ('name', 'ilike', search), ('barcode', 'ilike', search),
                       ('orsquare_short_code', 'ilike', search)]
        if kind == 'kitchen':
            domain.append(('is_kitchen', '=', True))
        elif kind == 'retail':
            domain.append(('is_kitchen', '=', False))
        if changed_since:
            domain = [d for d in domain if d != ('available_in_pos', '=', True)]
            domain.append(('write_date', '>', changed_since))
        see = self._valuation()
        out = []
        for t in self.sudo().env['product.template'].with_context(active_test=not changed_since).search(
                domain, limit=limit, offset=offset, order='name'):
            row = {
                'id': t.id, 'product_id': t.product_variant_id.id, 'category': t.categ_id.name or '',
                'category_id': t.categ_id.id, 'low_stock_qty': t.orsquare_low_stock_qty, 'name': t.name, 'barcode': t.barcode or '', 'short_code': t.orsquare_short_code or '',
                'price': t.list_price, 'mrp': t.orsquare_mrp or None, 'uom': t.uom_id.name, 'capacity_ml': t.orsquare_capacity_ml,
                'kind': 'kitchen' if t.is_kitchen else ('retail' if t.is_storable else 'consumable'),
                'brand': t.orsquare_brand_id.name or '', 'regime': t.orsquare_tax_regime_id.name or '',
                'can_open': t.orsquare_can_open, 'active': t.active and t.available_in_pos,
                'taxes': [{'name': x.name, 'amount': x.amount, 'amount_type': x.amount_type,
                           'price_include': x.price_include} for x in t.taxes_id],
                'pegs': [{'ml': p.ml, 'price': p.price} for p in t.orsquare_peg_size_ids],
                'variants': [{'id': v.id, 'name': v.display_name, 'price': v.lst_price} for v in t.product_variant_ids]
                if len(t.product_variant_ids) > 1 else [],
            }
            if see:
                row['cost'] = t.standard_price
                row['suggested_price'] = t.orsquare_suggested_price
            out.append(row)
        return out

    # ------------------------------------------------------------------ restaurant floors & tables
    @api.model
    def floors(self):
        require_staff(self.env)
        return [{'id': f.id, 'name': f.name, 'tables': [
            {'id': t.id, 'number': t.table_number, 'seats': t.seats} for t in f.table_ids.sorted('table_number')]}
            for f in self.env['restaurant.floor'].search([])]

    @api.model
    def create_floor(self, name):
        self._require('orsquare.group_orsquare_owner')
        env = self.sudo().env
        config = env['orsquare.shop.bootstrap'].pos_config(self.env.company)
        return env['restaurant.floor'].create({'name': name, 'pos_config_ids': [(6, 0, config.ids)]}).id

    @api.model
    def bulk_create_tables(self, floor_id, start, end, seats=4):
        """1-click generator: tables ``start..end`` on a floor, laid out on a tidy grid."""
        self._require('orsquare.group_orsquare_owner')
        start, end, seats = int(start), int(end), int(seats)
        if start < 1 or end < start or end - start > 199:
            raise UserError(_("Give a sensible table range (at most 200 tables)."))
        floor = self.sudo().env['restaurant.floor'].browse(int(floor_id)).exists()
        if not floor:
            raise UserError(_("Unknown section."))
        existing = set(floor.table_ids.mapped('table_number'))
        clash = sorted(existing & set(range(start, end + 1)))
        if clash:
            raise UserError(_("Table(s) %s already exist in %s.", ", ".join(map(str, clash)), floor.name))
        per_row = 5
        vals = []
        for i, number in enumerate(range(start, end + 1)):
            row, col = divmod(i, per_row)
            vals.append({'floor_id': floor.id, 'table_number': number, 'seats': seats,
                         'position_h': 40 + col * 110, 'position_v': 40 + row * 110, 'width': 80, 'height': 80})
        return self.sudo().env['restaurant.table'].create(vals).ids
