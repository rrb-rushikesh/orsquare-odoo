# -*- coding: utf-8 -*-
from odoo.tests.common import TransactionCase
from odoo.exceptions import UserError, ValidationError

class TestPrecisionAndUoM(TransactionCase):
    """
    Automated regression tests for Stage 2:
    - 6-decimal precision configuration on Product Unit of Measure.
    - Two-Tier UoM hierarchy: Platform Base Units vs Derived Shop Units.
    - Native Odoo conversion accuracy (Liters and bottle fractions).
    - Platform Base Unit non-deletion and non-destructive hiding invariants.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['uom.uom']._register_hook()
        cls.uom_model = cls.env['uom.uom']
        cls.vol_categ = cls.env.ref('uom.product_uom_categ_vol')
        cls.unit_categ = cls.env.ref('uom.product_uom_categ_unit')
        cls.weight_categ = cls.env.ref('uom.product_uom_categ_kgm')
        
        cls.uom_liter = cls.env.ref('uom.product_uom_litre')
        cls.uom_piece = cls.env.ref('uom.product_uom_unit')
        cls.uom_ml = cls.env.ref('orsquare.uom_base_ml')

    def test_01_product_uom_precision_is_six(self):
        """Verify decimal.precision for 'Product Unit of Measure' is 6 and propagated to fields."""
        dp = self.env['decimal.precision'].search([('name', '=', 'Product Unit of Measure')], limit=1)
        self.assertTrue(dp, "Product Unit of Measure decimal.precision record must exist.")
        self.assertEqual(dp.digits, 6, "Product Unit of Measure must be configured with 6 digits.")

        # Test field digits propagation
        move_qty_digits = self.env['stock.move']._fields['quantity'].get_digits(self.env)
        quant_qty_digits = self.env['stock.quant']._fields['quantity'].get_digits(self.env)
        svl_qty_digits = self.env['stock.valuation.layer']._fields['quantity'].get_digits(self.env)

        self.assertEqual(move_qty_digits, (16, 6), "stock.move.quantity must use 6 digits.")
        self.assertEqual(quant_qty_digits, (16, 6), "stock.quant.quantity must use 6 digits.")
        self.assertEqual(svl_qty_digits, (16, 6), "stock.valuation.layer.quantity must use 6 digits.")

    def test_02_platform_base_units_invariants(self):
        """Verify all Tier 1 Base Units are registered, immutable, and non-deletable."""
        base_unit_xmlids = [
            'orsquare.uom_base_ml',
            'uom.product_uom_litre',
            'uom.product_uom_unit',
            'orsquare.uom_base_pack',
            'orsquare.uom_base_plate',
            'orsquare.uom_base_bowl',
            'uom.product_uom_kgm',
            'uom.product_uom_gram',
        ]
        for xmlid in base_unit_xmlids:
            uom = self.env.ref(xmlid)
            self.assertTrue(uom.is_platform_base, f"{uom.name} must be marked as is_platform_base=True.")
            self.assertEqual(uom.rounding, 0.000001, f"{uom.name} must have rounding=0.000001.")

            # Attempt deletion: must be blocked by UserError
            with self.assertRaises(UserError):
                uom.unlink()

    def test_03_shop_bottle_units_native_conversions(self):
        """Verify all pre-seeded bottle units convert natively to Liters and milliliter peg fractions."""
        bottle_test_matrix = [
            ('orsquare.uom_shop_180ml', 180.0, 0.180000, 60.0 / 180.0),
            ('orsquare.uom_shop_375ml', 375.0, 0.375000, 60.0 / 375.0),
            ('orsquare.uom_shop_650ml', 650.0, 0.650000, 60.0 / 650.0),
            ('orsquare.uom_shop_700ml', 700.0, 0.700000, 60.0 / 700.0),
            ('orsquare.uom_shop_750ml', 750.0, 0.750000, 60.0 / 750.0),
            ('orsquare.uom_shop_1000ml', 1000.0, 1.000000, 60.0 / 1000.0),
        ]

        for xmlid, capacity_ml, expected_liter, expected_peg_fraction in bottle_test_matrix:
            uom = self.env.ref(xmlid)
            self.assertEqual(uom.rounding, 0.000001, f"{uom.name} must have 0.000001 rounding.")

            # 1. Test 1.0 full bottle conversion to Liters
            liter_qty = uom._compute_quantity(1.0, self.uom_liter, rounding_method='HALF-UP')
            self.assertAlmostEqual(
                liter_qty, expected_liter, places=6,
                msg=f"{uom.name}: 1 bottle should equal {expected_liter} Liters."
            )

            # 2. Test 60ml portion conversion into bottle fractional quantity
            peg_qty = self.uom_ml._compute_quantity(60.0, uom, rounding_method='HALF-UP')
            self.assertAlmostEqual(
                peg_qty, expected_peg_fraction, places=5,
                msg=f"{uom.name}: 60ml should equal {expected_peg_fraction} bottle fraction."
            )

    def test_04_custom_shop_unit_creation_and_derivation(self):
        """Verify creating a custom shop unit derived from a base unit synchronizes native Odoo fields."""
        custom_uom = self.uom_model.create({
            'name': 'Custom Pack of 20',
            'orsquare_base_unit_id': self.uom_piece.id,
            'orsquare_ratio': 20.0,
            'category_id': self.unit_categ.id,
            'uom_type': 'bigger',
            'factor': 0.05,
            'rounding': 0.000001,
        })
        self.assertEqual(custom_uom.category_id, self.unit_categ)
        self.assertEqual(custom_uom._compute_quantity(1.0, self.uom_piece), 20.0)
        self.assertEqual(self.uom_piece._compute_quantity(10.0, custom_uom), 0.5)

    def test_05_non_destructive_hiding_guardrail(self):
        """Verify that hiding a base unit does not break existing derived units or conversion math."""
        # Hide base ml unit
        self.uom_ml.write({'is_shop_visible': False})
        self.assertFalse(self.uom_ml.is_shop_visible)

        # Existing 750ml shop unit must still compute volume and convert without error
        uom_750 = self.env.ref('orsquare.uom_shop_750ml')
        converted_liters = uom_750._compute_quantity(1.0, self.uom_liter, rounding_method='HALF-UP')
        self.assertAlmostEqual(converted_liters, 0.750000, places=6)

        # Re-enable
        self.uom_ml.write({'is_shop_visible': True})
        self.assertTrue(self.uom_ml.is_shop_visible)
