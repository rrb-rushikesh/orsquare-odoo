# -*- coding: utf-8 -*-
"""Promo / coupon codes (e.g. ``PROMO10``, ``FLAT50``).

A promo is only a *pre-tax trade discount* generator: ``settle`` turns it into the same prorated bill discount a
cashier could type by hand, so tax, accounting and returns need no special handling. Usage counting is
race-safe (the promo row is locked while it is checked and incremented).
"""
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import float_compare, float_round


class OrsquarePromo(models.Model):
    _name = 'orsquare.promo'
    _description = "Promo Code"
    _order = 'code'

    code = fields.Char(required=True, index=True)
    name = fields.Char()
    company_id = fields.Many2one('res.company', required=True, default=lambda s: s.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id')
    kind = fields.Selection([('percent', 'Percent off'), ('amount', 'Flat amount off')], required=True, default='percent')
    value = fields.Float(required=True)
    min_bill = fields.Monetary(string="Minimum bill", currency_field='currency_id')
    max_discount = fields.Monetary(string="Maximum discount", currency_field='currency_id',
                                   help="Caps a percent promo. 0 = no cap.")
    date_from = fields.Date()
    date_to = fields.Date()
    max_uses = fields.Integer(help="0 = unlimited")
    used_count = fields.Integer(readonly=True, copy=False)
    active = fields.Boolean(default=True)

    _sql_constraints = [('code_unique', 'unique(code, company_id)', "This promo code already exists.")]

    @api.constrains('kind', 'value')
    def _check_value(self):
        for p in self:
            if p.value <= 0 or (p.kind == 'percent' and p.value > 100):
                raise ValidationError(_("A promo needs a positive value (at most 100 for a percentage)."))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('code'):
                vals['code'] = vals['code'].strip().upper()
        return super().create(vals_list)

    # ------------------------------------------------------------------ evaluation
    def _evaluate(self, gross, today, strict=True):
        """Discount amount for a bill of ``gross`` (pre-tax base value); raises a clear reason when not valid.

        ``strict=False`` is for an OFFLINE bill that was already discounted at the counter: the customer
        was promised the discount, so validity/usage limits are not re-litigated at sync time.
        """
        self.ensure_one()
        cur = self.currency_id
        if strict:
            if not self.active:
                raise UserError(_("Promo %s is not active.", self.code))
            if (self.date_from and today < self.date_from) or (self.date_to and today > self.date_to):
                raise UserError(_("Promo %s is not valid today.", self.code))
            if self.max_uses and self.used_count >= self.max_uses:
                raise UserError(_("Promo %s has been fully used.", self.code))
            if float_compare(gross, self.min_bill, precision_rounding=cur.rounding) < 0:
                raise UserError(_("Promo %(c)s needs a bill of at least %(m)s.", c=self.code, m=self.min_bill))
        amount = gross * self.value / 100.0 if self.kind == 'percent' else self.value
        if self.kind == 'percent' and self.max_discount:
            amount = min(amount, self.max_discount)
        return float_round(min(amount, gross), precision_rounding=cur.rounding)

    @api.model
    def lookup(self, code):
        code = (code or '').strip().upper()
        promo = self.sudo().with_context(active_test=False).search(
            [('code', '=', code), ('company_id', '=', self.env.company.id)], limit=1)
        if not promo:
            raise UserError(_("Unknown promo code '%s'.", code))
        return promo

    @api.model
    def check_promo(self, code, bill_total):
        """Preview for the cashier: what would this code take off a bill of ``bill_total``?"""
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_cashier')):
            raise AccessError(_("You are not allowed to apply promos."))
        promo = self.lookup(code)
        return {'code': promo.code, 'discount': promo._evaluate(float(bill_total), fields.Date.context_today(self))}

    @api.model
    def consume(self, code, gross, strict=True):
        """Validate and COUNT one use (row-locked). Returns ``(promo, discount_amount)``."""
        promo = self.lookup(code)
        self.env.cr.execute("SELECT id FROM orsquare_promo WHERE id = %s FOR UPDATE", [promo.id])
        promo.invalidate_recordset()
        amount = promo._evaluate(gross, fields.Date.context_today(self), strict)
        promo.used_count += 1
        return promo, amount

    # ------------------------------------------------------------------ owner management API
    @api.model
    def list_promos(self):
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_cashier')):
            raise AccessError(_("You are not allowed to see promos."))
        return [{'id': p.id, 'code': p.code, 'name': p.name or '', 'kind': p.kind, 'value': p.value,
                 'min_bill': p.min_bill, 'max_discount': p.max_discount, 'date_from': str(p.date_from or ''),
                 'date_to': str(p.date_to or ''), 'max_uses': p.max_uses, 'used_count': p.used_count,
                 'active': p.active} for p in self.sudo().with_context(active_test=False).search([])]

    @api.model
    def create_promo(self, code, kind, value, name=None, min_bill=0.0, max_discount=0.0, date_from=None,
                     date_to=None, max_uses=0):
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_owner')):
            raise AccessError(_("Only the shop owner can create promos."))
        return self.sudo().create({
            'code': code, 'name': name, 'kind': kind, 'value': float(value), 'min_bill': float(min_bill or 0),
            'max_discount': float(max_discount or 0), 'date_from': date_from or False, 'date_to': date_to or False,
            'max_uses': int(max_uses or 0)}).id

    @api.model
    def set_promo_active(self, promo_id, active):
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_owner')):
            raise AccessError(_("Only the shop owner can change promos."))
        self.sudo().browse(int(promo_id)).active = bool(active)
        return True
