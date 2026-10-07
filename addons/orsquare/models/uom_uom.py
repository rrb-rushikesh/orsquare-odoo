# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError

class UoM(models.Model):
    _inherit = 'uom.uom'

    is_platform_base = fields.Boolean(
        string="Platform Base Unit",
        default=False,
        readonly=True,
        help="Standard platform-managed base unit shipped by ORSquare. Non-deletable.",
    )
    is_shop_visible = fields.Boolean(
        string="Visible in Shop",
        default=True,
        help="Shop owner toggle to show/hide this unit in new creation dropdowns.",
    )
    orsquare_base_unit_id = fields.Many2one(
        'uom.uom',
        string="Base Unit",
        ondelete='restrict',
        domain="[('is_platform_base', '=', True), ('is_shop_visible', '=', True)]",
        help="Parent Tier 1 Base Unit this shop unit is derived from.",
    )
    orsquare_ratio = fields.Float(
        string="Ratio to Base Unit",
        digits=(12, 4),
        default=1.0,
        help="Conversion multiplier to the base unit (e.g. 750 for 750 ml from ml, 10 for Pack of 10 from Piece).",
    )

    @api.onchange('orsquare_base_unit_id', 'orsquare_ratio')
    def _onchange_orsquare_derivation(self):
        """Automatically synchronizes native Odoo category_id, factor, and uom_type when derived from a base unit."""
        if self.orsquare_base_unit_id:
            self.category_id = self.orsquare_base_unit_id.category_id
            if self.orsquare_ratio <= 0.0:
                raise ValidationError(_("Conversion ratio to base unit must be strictly positive."))
            
            base = self.orsquare_base_unit_id
            target_factor = base.factor / self.orsquare_ratio
            self.rounding = 0.000001

            if abs(target_factor - 1.0) < 1e-9:
                # If target factor is 1.0, keep existing uom_type or smaller if reference exists
                if not self.uom_type or self.uom_type == 'reference':
                    # Only allow reference if no reference exists in category
                    ref = self.search([('category_id', '=', self.category_id.id), ('uom_type', '=', 'reference'), ('id', '!=', self._origin.id)], limit=1)
                    self.uom_type = 'reference' if not ref else 'smaller'
                self.factor = 1.0
            elif target_factor > 1.0:
                self.uom_type = 'smaller'
                self.factor = target_factor
            else:
                self.uom_type = 'bigger'
                self.factor = target_factor

    @api.constrains('orsquare_ratio')
    def _check_orsquare_ratio(self):
        for uom in self:
            if uom.orsquare_base_unit_id and uom.orsquare_ratio <= 0.0:
                raise ValidationError(_("Unit '%s': Conversion ratio must be strictly positive.", uom.name))

    @api.ondelete(at_uninstall=False)
    def _unlink_except_platform_base(self):
        for uom in self:
            if uom.is_platform_base:
                raise UserError(_(
                    "Unit '%s' is a standard ORSquare Platform Base Unit and cannot be deleted. "
                    "Use the shop visibility toggle (Eye icon) to hide it from dropdowns instead.",
                    uom.name
                ))

    def _register_hook(self):
        super()._register_hook()
        # Bootstrap invariant: Ensure core platform base units are marked and 6-decimal rounding is enforced
        core_base_units = [
            'uom.product_uom_litre',
            'uom.product_uom_unit',
            'uom.product_uom_kgm',
            'uom.product_uom_gram',
        ]
        for xmlid in core_base_units:
            uom = self.env.ref(xmlid, raise_if_not_found=False)
            if uom and (not uom.is_platform_base or uom.rounding > 0.000001):
                uom.sudo().write({
                    'is_platform_base': True,
                    'is_shop_visible': True,
                    'rounding': 0.000001,
                })
