# -*- coding: utf-8 -*-
"""Business Studio presets: a starting point for a kind of shop that the owner can still adjust toggle by toggle.

Presets are versioned code (reviewed, tested, shipped with the module) rather than rows to edit by hand. A shop
remembers which preset and which *version* of it was applied (``orsquare_profile`` / ``orsquare_preset_version``),
so the platform can tell a shop that is on an older preset and re-apply it deliberately. Re-applying never deletes
data: presets only set switches.
"""
from .res_company import ORSQUARE_TABS

ALL_TABS = [t for t, _n in ORSQUARE_TABS]
PRESET_VERSION = 2

# Every tab a preset leaves on; "restaurant" has no godown stock screen.
_RETAIL_TABS = list(ALL_TABS)
_NO_STOCK_TABS = [t for t in ALL_TABS if t != 'stock']

PRESETS = {
    'wine_shop': {
        'name': 'Wine shop',
        'description': 'Bottles in godown and counter, open-bottle pegs, brand x size stock matrix.',
        'values': {
            'orsquare_feature_open_bottle': True, 'orsquare_feature_kitchen': False, 'orsquare_feature_tables': False,
            'orsquare_auto_godown_transfer': True, 'orsquare_stock_variant': 'wine',
            'orsquare_enabled_tabs': _RETAIL_TABS,
        },
    },
    'bar': {
        'name': 'Bar & lounge',
        'description': 'Pegs, kitchen tickets and table tabs on top of the wine-shop stock view.',
        'values': {
            'orsquare_feature_open_bottle': True, 'orsquare_feature_kitchen': True, 'orsquare_feature_tables': True,
            'orsquare_auto_godown_transfer': True, 'orsquare_stock_variant': 'wine',
            'orsquare_enabled_tabs': _RETAIL_TABS,
        },
    },
    'restaurant': {
        'name': 'Restaurant',
        'description': 'Tables and kitchen tickets; no bottle pegs, no godown stock screen.',
        'values': {
            'orsquare_feature_open_bottle': False, 'orsquare_feature_kitchen': True, 'orsquare_feature_tables': True,
            'orsquare_auto_godown_transfer': False, 'orsquare_stock_variant': 'standard',
            'orsquare_enabled_tabs': _NO_STOCK_TABS,
        },
    },
    'grocery': {
        'name': 'Grocery / retail',
        'description': 'Plain counter retail with a simple stock list.',
        'values': {
            'orsquare_feature_open_bottle': False, 'orsquare_feature_kitchen': False, 'orsquare_feature_tables': False,
            'orsquare_auto_godown_transfer': True, 'orsquare_stock_variant': 'standard',
            'orsquare_enabled_tabs': _RETAIL_TABS,
        },
    },
}

# Who may open which tab by default; used only when a staff member is created without an explicit grant.
ROLE_DEFAULT_TABS = {
    'cashier': ['sales', 'daybook', 'accounts', 'cashflow'],
    'stockkeeper': ['stock', 'purchases', 'products'],
}

FEATURES = ('open_bottle', 'kitchen', 'tables')
STOCK_VARIANTS = (('standard', 'Standard stock list'), ('wine', 'Brand x size matrix (WineStock)'))
ACCOUNTS_VARIANTS = (('standard', 'Standard accounts'), ('advanced', 'Advanced accounts workspace'))
