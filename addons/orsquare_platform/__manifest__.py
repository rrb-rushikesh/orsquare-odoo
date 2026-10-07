# -*- coding: utf-8 -*-
{
    'name': 'ORSquare Platform (Developer Console backend)',
    'version': '18.0.2.0.0',
    'category': 'Technical',
    'summary': 'Fleet registry, shop provisioning, suspension and audit trail for the platform operator',
    'description': """
Installed ONLY in the platform database (``orsquare_platform``), never in a shop database.
Platform developers are ordinary Odoo system users of that database. Shops stay separate databases:
this module keeps the registry (who, plan, expiry, status), provisions a shop by cloning the template database,
and writes an append-only audit trail of every operator action.
    """,
    'author': 'ORSquare',
    'license': 'LGPL-3',
    'depends': ['base', 'auth_totp', 'auth_password_policy'],
    'data': [
        'security/platform_security.xml',
        'security/ir.model.access.csv',
        'data/platform_data.xml',
    ],
    'installable': True,
    'application': False,
}
