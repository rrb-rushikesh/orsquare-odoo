# -*- coding: utf-8 -*-
"""The ONLY service methods reachable over HTTP.  Anything not listed here is unreachable: the generic
dispatcher refuses unknown services/methods, so adding a model method never silently exposes it."""

API_REGISTRY = {
    'sales': ('orsquare.sale.service', {'settle', 'quote'}),
    'purchases': ('orsquare.purchase.service', {'record_bill', 'preview_bill', 'return_to_supplier', 'list_bills', 'bill_detail', 'summary'}),
    'stock': ('orsquare.stock.reports', {
        'set_opening_stock', 'adjust_stock', 'resolve_discrepancy', 'stock_position', 'stock_value_by_location',
        'movement_history', 'opened_shelf', 'needs_attention_stock'}),
    'bottles': ('orsquare.opened_bottle', {'tray'}),
    'accounts': ('orsquare.accounts.service', {
        'directory', 'create_party', 'lookup_gstin', 'statement', 'receive_payment', 'pay_supplier', 'employee_voucher',
        'employee_advance_balance'}),
    'cashflow': ('orsquare.cashflow.service', {'new_entry', 'register'}),
    'reports': ('orsquare.reports.service', {
        'dashboard', 'calendar', 'day_detail', 'trial_balance', 'profit_and_loss', 'balance_sheet', 'gst_report',
        'registers'}),
    'catalog': ('orsquare.catalog.service', {
        'units', 'set_base_unit_visibility', 'create_shop_unit', 'brands', 'create_brand', 'categories',
        'create_category', 'tax_regimes', 'set_regime_tax_rate', 'set_regime_tcs_rate', 'save_product',
        'suggest_price', 'set_margin_rule', 'list_products', 'floors', 'create_floor', 'bulk_create_tables'}),
    'staff': ('orsquare.staff.service', {
        'me', 'list_staff', 'create_staff', 'update_staff', 'reset_staff_password', 'reset_staff_mfa',
        'get_settings', 'update_settings', 'get_experience', 'list_presets', 'apply_preset', 'audit_log'}),
    'wipe': ('orsquare.wipe.service', {'preview', 'wipe_shop'}),
    'day': ('orsquare.api.facade', {
        'day_open', 'day_current', 'day_seal', 'day_reaudit', 'transfer', 'open_bottle', 'finish_bottle',
        'discrepancies', 'bill_lookup', 'bill_detail'}),
    'tabs': ('orsquare.tab.service', {
        'table_status', 'tab_open', 'tab_get', 'tab_save', 'tab_transfer', 'tab_cancel', 'tab_kot'}),
    'promos': ('orsquare.promo', {'list_promos', 'create_promo', 'set_promo_active', 'check_promo'}),
    'bills': ('orsquare.bill.service', {'bill_document', 'thermal_text', 'escpos'}),
    'realtime': ('orsquare.realtime.service', {'token'}),
    'sync': ('orsquare.sync.service', {'bootstrap', 'delta', 'flush'}),
}


# ---------------------------------------------------------------------------------------------------------------
# Server-side gate (the hiding of a tab in the UI is a convenience, never the security boundary).
#
# For each service, ``'*'`` is the default and a method name overrides it. ``tabs`` is an any-of list: the caller
# needs at least one of those tabs (granted to them AND switched on for the shop AND allowed by the plan). Calls
# that several screens share (a customer picker, the stock position, bill printing) list every screen that uses
# them, so a cashier with only Sales is not locked out of the customer list. ``feature`` additionally needs that
# shop feature on. A service/method with no entry here is open to any signed-in staff (the role checks inside the
# service still apply).
# ---------------------------------------------------------------------------------------------------------------
_ACCOUNTS_READ = ('accounts', 'sales', 'purchases', 'cashflow', 'reports')

API_GATES = {
    'sales': {'*': {'tabs': ('sales',)}},
    'purchases': {
        '*': {'tabs': ('purchases',)},
        'list_bills': {'tabs': ('purchases', 'accounts', 'reports', 'dashboard')},
        'bill_detail': {'tabs': ('purchases', 'accounts', 'reports', 'dashboard')},
        'summary': {'tabs': ('purchases', 'accounts', 'reports', 'dashboard')},
    },
    'stock': {
        '*': {'tabs': ('stock', 'products', 'purchases', 'sales', 'dashboard')},
        'set_opening_stock': {'tabs': ('stock', 'products')},
        'adjust_stock': {'tabs': ('stock',)},
        'resolve_discrepancy': {'tabs': ('stock', 'daybook')},
    },
    'bottles': {'*': {'tabs': ('sales', 'stock'), 'feature': 'open_bottle'}},
    'accounts': {
        '*': {'tabs': _ACCOUNTS_READ},
        'receive_payment': {'tabs': ('accounts', 'sales', 'cashflow')},
        'pay_supplier': {'tabs': ('accounts', 'purchases', 'cashflow')},
        'employee_voucher': {'tabs': ('accounts',)},
        'employee_advance_balance': {'tabs': ('accounts',)},
    },
    'cashflow': {'*': {'tabs': ('cashflow', 'daybook', 'dashboard')}},
    'reports': {
        '*': {'tabs': ('reports',)},
        'dashboard': {'tabs': ('dashboard', 'daybook', 'calendar', 'sales', 'reports')},
        'calendar': {'tabs': ('calendar', 'daybook', 'reports')},
        'day_detail': {'tabs': ('calendar', 'daybook', 'reports')},
    },
    'catalog': {
        '*': {'tabs': ('products', 'sales', 'purchases', 'stock', 'settings')},
        'save_product': {'tabs': ('products',)},
        'set_margin_rule': {'tabs': ('products', 'settings')},
        'set_regime_tax_rate': {'tabs': ('settings', 'products')},
        'set_regime_tcs_rate': {'tabs': ('settings', 'products')},
        'floors': {'tabs': ('settings', 'sales'), 'feature': 'tables'},
        'create_floor': {'tabs': ('settings',), 'feature': 'tables'},
        'bulk_create_tables': {'tabs': ('settings',), 'feature': 'tables'},
    },
    'wipe': {'*': {'tabs': ('settings',)}},
    'day': {
        '*': {'tabs': ('daybook', 'sales', 'dashboard')},
        'transfer': {'tabs': ('stock', 'sales')},
        'open_bottle': {'tabs': ('sales', 'stock'), 'feature': 'open_bottle'},
        'finish_bottle': {'tabs': ('sales', 'stock'), 'feature': 'open_bottle'},
        'discrepancies': {'tabs': ('stock', 'daybook')},
        'bill_lookup': {'tabs': ('sales', 'daybook', 'accounts')},
        'bill_detail': {'tabs': ('sales', 'daybook', 'accounts')},
    },
    'tabs': {'*': {'tabs': ('sales',), 'feature': 'tables'}},
    'promos': {
        '*': {'tabs': ('sales', 'settings')},
    },
    'bills': {'*': {'tabs': ('sales', 'purchases', 'daybook', 'accounts')}},
}

# Offline outbox mutation kind -> the tab that may produce it (checked on the server when the outbox is flushed).
MUTATION_TABS = {
    'sale': ('sales',),
    'purchase': ('purchases',),
    'stock_transfer': ('stock', 'sales'),
    'open_bottle': ('sales', 'stock'),
    'finish_bottle': ('sales', 'stock'),
    'cash_entry': ('cashflow', 'daybook'),
    'khata_receipt': ('accounts', 'sales', 'cashflow'),
}
