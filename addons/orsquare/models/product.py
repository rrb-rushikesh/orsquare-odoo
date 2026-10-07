# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.tools import float_is_zero, float_round


class OrsquareBrand(models.Model):
    """Catalog Masters -> Brands: umbrella brand families for registers and reports."""
    _name = 'orsquare.brand'
    _description = "Brand"
    _order = 'name'

    name = fields.Char(required=True)
    company_id = fields.Many2one('res.company', default=lambda s: s.env.company)

    _sql_constraints = [('name_unique', 'unique(name, company_id)', "This brand already exists.")]


class OrsquarePegSize(models.Model):
    """Open-bottle portion offered for a bottle product (e.g. 60 ml peg at INR 120)."""
    _name = 'orsquare.peg_size'
    _description = "Open Bottle Peg Size"
    _order = 'product_tmpl_id, ml'

    product_tmpl_id = fields.Many2one('product.template', required=True, ondelete='cascade', index=True)
    name = fields.Char(compute='_compute_name', store=True)
    ml = fields.Float(string="Portion (ml)", required=True)
    price = fields.Monetary(string="Selling Rate", required=True, currency_field='currency_id')
    currency_id = fields.Many2one(related='product_tmpl_id.currency_id')

    _sql_constraints = [
        ('ml_positive', 'CHECK(ml > 0)', "A peg must be a positive number of ml."),
        ('price_nonneg', 'CHECK(price >= 0)', "A peg price cannot be negative."),
        ('unique_ml', 'unique(product_tmpl_id, ml)', "This peg size already exists for the product."),
    ]

    @api.depends('ml')
    def _compute_name(self):
        for peg in self:
            peg.name = "%g ml" % peg.ml

    @api.constrains('ml', 'product_tmpl_id')
    def _check_ml_fits_bottle(self):
        for peg in self:
            capacity = peg.product_tmpl_id.orsquare_capacity_ml
            if capacity and peg.ml > capacity:
                raise ValidationError(_(
                    "A %(ml)g ml peg is larger than the %(cap)g ml bottle.", ml=peg.ml, cap=capacity))


class OrsquareMarginRule(models.Model):
    """Optional price-setting assistance: category + bottle size -> suggested margin.

    Never stored on ``uom.uom`` and never applied silently: it only produces a suggestion.
    """
    _name = 'orsquare.margin_rule'
    _description = "Category Size Margin Rule"

    categ_id = fields.Many2one('product.category', string="Category", required=True)
    uom_id = fields.Many2one('uom.uom', string="Size", required=True)
    margin_amount = fields.Monetary(required=True, currency_field='currency_id')
    currency_id = fields.Many2one('res.currency', default=lambda s: s.env.company.currency_id)
    company_id = fields.Many2one('res.company', default=lambda s: s.env.company)

    _sql_constraints = [
        ('rule_unique', 'unique(categ_id, uom_id, company_id)', "A margin rule already exists for this category and size."),
        ('margin_nonneg', 'CHECK(margin_amount >= 0)', "The margin cannot be negative."),
    ]


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    is_kitchen = fields.Boolean(
        string="Kitchen Dish",
        help="Prepared food: infinite stock, no stock moves; revenue and tax post normally.")
    orsquare_brand_id = fields.Many2one('orsquare.brand', string="Brand")
    orsquare_short_code = fields.Char(
        string="Short Code", help="Quick-search code; also the prefix of open-bottle labels (e.g. RC).")
    orsquare_peg_size_ids = fields.One2many('orsquare.peg_size', 'product_tmpl_id', string="Peg Sizes")
    orsquare_capacity_ml = fields.Float(
        string="Bottle Capacity (ml)", compute='_compute_capacity_ml', store=True, digits=(12, 3),
        help="Derived from the product's unit of measure (Volume category). 0 when not a volume unit.")
    orsquare_can_open = fields.Boolean(
        string="Can Be Opened (Peg Sales)", compute='_compute_can_open', store=True)
    orsquare_suggested_price = fields.Monetary(
        compute='_compute_suggested_price', currency_field='currency_id',
        help="Cost + category/size margin. A suggestion only; it never changes the selling price.")

    @api.depends('uom_id', 'uom_id.factor', 'uom_id.category_id')
    def _compute_capacity_ml(self):
        volume = self.env.ref('uom.product_uom_categ_vol', raise_if_not_found=False)
        for tmpl in self:
            uom = tmpl.uom_id
            if volume and uom and uom.category_id == volume and uom.factor:
                # reference unit of Volume is litre; factor = units of this uom per litre.
                tmpl.orsquare_capacity_ml = float_round(1000.0 / uom.factor, precision_digits=3)
            else:
                tmpl.orsquare_capacity_ml = 0.0

    @api.depends('orsquare_capacity_ml', 'is_storable')
    def _compute_can_open(self):
        for tmpl in self:
            tmpl.orsquare_can_open = bool(tmpl.orsquare_capacity_ml) and tmpl.is_storable

    @api.depends('standard_price', 'categ_id', 'uom_id')
    def _compute_suggested_price(self):
        # One query for all rules, then walk each category's parent chain in memory (no per-product search).
        rules = {(r.categ_id.id, r.uom_id.id): r.margin_amount
                 for r in self.env['orsquare.margin_rule'].search([])}
        for tmpl in self:
            margin = None
            categ = tmpl.categ_id
            while categ and margin is None:
                margin = rules.get((categ.id, tmpl.uom_id.id))
                categ = categ.parent_id
            tmpl.orsquare_suggested_price = tmpl.standard_price + margin if margin is not None else 0.0

    def _orsquare_find_margin_rule(self, Rule=None):
        self.ensure_one()
        Rule = Rule or self.env['orsquare.margin_rule']
        categ = self.categ_id
        while categ:
            rule = Rule.search([('categ_id', '=', categ.id), ('uom_id', '=', self.uom_id.id)], limit=1)
            if rule:
                return rule
            categ = categ.parent_id
        return Rule

    def action_apply_suggested_price(self):
        """Explicit user confirmation of the suggestion (the only way a rule changes a price)."""
        for tmpl in self:
            if not tmpl.orsquare_suggested_price:
                raise UserError(_("No margin rule matches %s.", tmpl.display_name))
            tmpl.list_price = tmpl.orsquare_suggested_price
        return True

    @api.constrains('is_kitchen', 'is_storable', 'type')
    def _check_kitchen_infinite_stock(self):
        for tmpl in self:
            if tmpl.is_kitchen and tmpl.is_storable:
                raise ValidationError(_(
                    "Kitchen dishes have infinite stock: '%s' cannot be a stock-tracked product.",
                    tmpl.display_name))

    @api.constrains('orsquare_short_code')
    def _check_short_code(self):
        for tmpl in self.filtered('orsquare_short_code'):
            dup = self.with_context(active_test=False).search([
                ('orsquare_short_code', '=ilike', tmpl.orsquare_short_code), ('id', '!=', tmpl.id),
                ('company_id', 'in', (False, tmpl.company_id.id))], limit=1)
            if dup:
                raise ValidationError(_("Short code '%s' is already used by %s.",
                                        tmpl.orsquare_short_code, dup.display_name))

    # ------------------------------------------------------------------ portions (Full / Half)
    def orsquare_set_portions(self, full_rate, half_rate):
        """Offer Full/Half portions via native variants (single parent template).

        Full rate becomes ``list_price``; Half is a native attribute extra price.
        """
        self.ensure_one()
        if not self.is_kitchen:
            raise UserError(_("Portions are only offered for kitchen dishes."))
        if half_rate <= 0 or full_rate <= 0 or half_rate >= full_rate:
            raise UserError(_("The Half rate must be positive and lower than the Full rate."))
        attribute = self.env['product.attribute'].search([('name', '=', 'Portion')], limit=1)
        if not attribute:
            attribute = self.env['product.attribute'].create({
                'name': 'Portion', 'create_variant': 'always',
                'value_ids': [(0, 0, {'name': 'Full', 'sequence': 1}), (0, 0, {'name': 'Half', 'sequence': 2})],
            })
        values = {v.name: v for v in attribute.value_ids}
        line = self.attribute_line_ids.filtered(lambda l: l.attribute_id == attribute)
        if not line:
            self.write({'attribute_line_ids': [(0, 0, {
                'attribute_id': attribute.id, 'value_ids': [(6, 0, [values['Full'].id, values['Half'].id])]})]})
        self.list_price = full_rate
        half = self.env['product.template.attribute.value'].search([
            ('product_tmpl_id', '=', self.id), ('product_attribute_value_id', '=', values['Half'].id)])
        half.price_extra = half_rate - full_rate
        return True

    @api.model_create_multi
    def create(self, vals_list):
        # Kitchen dishes are untracked consumables regardless of what the client sent.
        for vals in vals_list:
            if vals.get('is_kitchen'):
                vals['type'] = 'consu'
                vals['is_storable'] = False
        return super().create(vals_list)


class ProductProduct(models.Model):
    _inherit = 'product.product'

    def orsquare_peg_for(self, ml):
        self.ensure_one()
        return self.product_tmpl_id.orsquare_peg_size_ids.filtered(lambda p: float_is_zero(p.ml - ml, precision_digits=3))[:1]
