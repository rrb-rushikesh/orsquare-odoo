# -*- coding: utf-8 -*-
{
    'name': 'ORSquare Retail Core',
    'version': '18.0.1.3.0',
    'category': 'Point of Sale/Retail',
    'summary': 'High-speed retail operations engine for counter and beverage operations',
    'description': """
ORSquare Retail Core Engine (Odoo 18 Community)
================================================
Thin backend module providing authoritative retail operations:
- Godown -> Counter -> OP Stock location topology.
- Odoo-native fractional stock movement for portion/peg dispensing.
- Validated 6-decimal bottle UoM precision configuration.
- Operational business-day cutoff attribution decoupled from accounting periods.
- Single inventory authority: All stock and valuation derived from standard Odoo quants and SVLs.
    """,
    'author': 'ORSquare',
    'license': 'LGPL-3',
    'depends': [
        'base',
        'stock_account',
        'point_of_sale',
        'purchase_stock',
        'stock_landed_costs',
        'l10n_in',
        'pos_restaurant',
        'hr',
    ],
    'data': [
        'security/orsquare_security.xml',
        'security/ir.model.access.csv',
        'data/precision_data.xml',
        'data/uom_data.xml',
        'views/uom_views.xml',
    ],
    'installable': True,
    'application': True,
    'auto_install': False,
    'post_init_hook': 'post_init_hook',
}
