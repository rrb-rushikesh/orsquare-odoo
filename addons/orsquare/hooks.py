# -*- coding: utf-8 -*-
from odoo import api, SUPERUSER_ID

CORE_BASE_UNITS = [
    'uom.product_uom_litre',
    'uom.product_uom_unit',
    'uom.product_uom_kgm',
    'uom.product_uom_gram',
]


def post_init_hook(env):
    """
    Bootstrap hook executed after module installation/upgrade.
    Ensures core Odoo base units and decimal precisions are properly configured
    even if core records were initialized with noupdate=1 in base/uom modules.
    """
    # 1. Enforce 6-decimal precision on Product Unit of Measure
    dp = env['decimal.precision'].search([('name', '=', 'Product Unit of Measure')], limit=1)
    if dp:
        dp.write({'digits': 6})
    else:
        env['decimal.precision'].create({
            'name': 'Product Unit of Measure',
            'digits': 6,
        })

    # 2. Configure core platform base units
    for xmlid in CORE_BASE_UNITS:
        uom = env.ref(xmlid, raise_if_not_found=False)
        if uom:
            uom.write({
                'is_platform_base': True,
                'is_shop_visible': True,
                'rounding': 0.000001,
            })

    # 3. Shop bootstrap: accounts, retail topology (Godown/Counter/Opened), AVCO valuation policy
    for company in env['res.company'].search([]):
        env['orsquare.shop.bootstrap'].bootstrap_company(company)
