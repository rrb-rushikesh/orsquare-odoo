# -*- coding: utf-8 -*-
"""Configurable statutory tax regimes.

Alcoholic liquor for human consumption is outside GST (Art. 366(12A) / Sec. 9(1) CGST Act): it bears
State excise/VAT and, on wholesale purchases, Income-tax TCS under Sec. 206C(1).  General retail
goods and kitchen items bear GST.  Nothing here hard-codes a state or a rate: a *regime* is just a
named bundle of native ``account.tax`` records plus a TCS rate, attached to product categories and
resolved when a product is created.  Maharashtra ships as a **reference** regime whose State VAT
rate is deliberately 0 until the shop/platform operator configures the current statutory rate.
"""
from odoo import api, fields, models, _
from odoo.exceptions import UserError


class OrsquareTaxRegime(models.Model):
    _name = 'orsquare.tax_regime'
    _description = "Statutory Tax Regime"
    _order = 'sequence, name'

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    company_id = fields.Many2one('res.company', required=True, default=lambda s: s.env.company)
    kind = fields.Selection(
        [('liquor', 'Alcoholic Liquor (State levies + TCS)'),
         ('gst', 'General Retail / Kitchen (GST)'),
         ('exempt', 'Exempt / Nil-rated')], required=True)
    state_id = fields.Many2one('res.country.state', string="State",
                               domain="[('country_id.code', '=', 'IN')]")
    sale_tax_ids = fields.Many2many('account.tax', 'orsquare_regime_sale_tax_rel', 'regime_id', 'tax_id',
                                    string="Sales Taxes", domain="[('type_tax_use', '=', 'sale')]")
    purchase_tax_ids = fields.Many2many('account.tax', 'orsquare_regime_purchase_tax_rel', 'regime_id', 'tax_id',
                                        string="Purchase Taxes", domain="[('type_tax_use', '=', 'purchase')]")
    tcs_rate = fields.Float(string="TCS Rate (%)", digits=(5, 3),
                            help="Income-tax TCS (Sec. 206C) charged by suppliers on purchases in this regime.")
    note = fields.Text()
    active = fields.Boolean(default=True)

    def action_apply_to_product(self, templates):
        for regime in self:
            templates.write({
                'taxes_id': [(6, 0, regime.sale_tax_ids.ids)],
                'supplier_taxes_id': [(6, 0, regime.purchase_tax_ids.ids)],
            })


class ProductCategory(models.Model):
    _inherit = 'product.category'

    orsquare_tax_regime_id = fields.Many2one('orsquare.tax_regime', string="Tax Regime")

    @api.model_create_multi
    def create(self, vals_list):
        categories = super().create(vals_list)
        policy = self.env['orsquare.shop.bootstrap']
        for categ in categories:
            company = self.env.company
            categ.with_company(company).write(policy.valuation_values(company))
        return categories


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    orsquare_tax_regime_id = fields.Many2one(
        'orsquare.tax_regime', string="Tax Regime", compute='_compute_regime', store=True, readonly=False,
        help="Defaults to the category's regime; setting it re-maps the product's taxes.")
    orsquare_tcs_rate = fields.Float(related='orsquare_tax_regime_id.tcs_rate', string="TCS Rate (%)")

    @api.depends('categ_id.orsquare_tax_regime_id')
    def _compute_regime(self):
        for tmpl in self:
            if not tmpl.orsquare_tax_regime_id:
                categ = tmpl.categ_id
                while categ and not categ.orsquare_tax_regime_id:
                    categ = categ.parent_id
                tmpl.orsquare_tax_regime_id = categ.orsquare_tax_regime_id

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            # An explicit tax choice always wins; otherwise the regime decides the taxes.
            if 'taxes_id' in vals or 'supplier_taxes_id' in vals:
                continue
            regime = self.env['orsquare.tax_regime']
            if vals.get('orsquare_tax_regime_id'):
                regime = regime.browse(vals['orsquare_tax_regime_id'])
            elif vals.get('categ_id'):
                categ = self.env['product.category'].browse(vals['categ_id'])
                while categ and not categ.orsquare_tax_regime_id:
                    categ = categ.parent_id
                regime = categ.orsquare_tax_regime_id
            if regime:
                vals['taxes_id'] = [(6, 0, regime.sale_tax_ids.ids)]
                vals['supplier_taxes_id'] = [(6, 0, regime.purchase_tax_ids.ids)]
        return super().create(vals_list)

    def write(self, vals):
        res = super().write(vals)
        if vals.get('orsquare_tax_regime_id') and 'taxes_id' not in vals:
            regime = self.env['orsquare.tax_regime'].browse(vals['orsquare_tax_regime_id'])
            for tmpl in self:
                tmpl.write({'taxes_id': [(6, 0, regime.sale_tax_ids.ids)],
                            'supplier_taxes_id': [(6, 0, regime.purchase_tax_ids.ids)]})
        return res
