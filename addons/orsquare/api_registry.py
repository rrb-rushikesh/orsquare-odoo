# -*- coding: utf-8 -*-
"""The ONLY service methods reachable over HTTP.  Anything not listed here is unreachable: the generic
dispatcher refuses unknown services/methods, so adding a model method never silently exposes it."""

API_REGISTRY = {
    'sales': ('orsquare.sale.service', {'settle', 'quote'}),
    'purchases': ('orsquare.purchase.service', {'record_bill', 'preview_bill', 'return_to_supplier', 'list_bills', 'bill_detail'}),
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
        'me', 'list_staff', 'create_staff', 'update_staff', 'get_settings', 'update_settings', 'list_presets',
        'apply_preset'}),
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
