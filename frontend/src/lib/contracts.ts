export interface PProduct {
  stockValue?: number;
  id: string;
  code: string;
  barcode: string;
  name: string;
  brand?: string;
  alias?: string;
  parentId?: string;
  parentName?: string;
  flavour?: string;
  category: string;      // category name (display)
  categoryId?: string;
  unit: string;          // unit name (display)
  unitId?: string;
  mrp: number;
  rate: number;          // sale rate = MRP fallback (backend has no "Sales Rate")
  costPrice?: number;    // undefined for cashier/stockkeeper
  piecesPerBox: number;
  godownPcs: number;
  counterPcs: number;
  lowLevel: number;
  active: boolean;
  isKitchen?: boolean;
  soldCount?: number;
  /** Units sold over the rolling 4-business-day window including today. The
   *  single ordering signal for every product list in the app. */
  sold4d?: number;
  /** ISO timestamp of the most recent sale inside that window. */
  orderLastSoldAt?: string | null;
  createdAt?: string;
}

export type PAccountSide = 'Dr' | 'Cr' | 'Flat';

export interface PAccount {
  id: string;
  code: string;
  name: string;
  type: 'Customer' | 'Supplier' | string;
  phone: string;
  /** E.164 dial code (e.g. '+91'); needed to re-edit without corrupting it. */
  countryCode: string;
  opening: number;
  /** null when the caller's role may not see this party's money. NOT zero. */
  balance: number | null;
  balanceHidden: boolean;
  /** Authoritative from the ledger - never re-derived from the sign here. */
  side: PAccountSide | null;
  role: string | null;
  isReceivable: boolean;
  isPayable: boolean;
  isAdvance: boolean;
  isSettled: boolean;
  active: boolean;
  createdAt?: string;
}

export interface PSaleItem {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  qty: number;
  rate: number;
  discount: number;
  total: number;
  autoTransferredQty?: number;
}

export interface PSalePayment {
  id?: string;
  method: 'Cash' | 'UPI' | 'Khata';
  amount: number;
  ref?: string;
}

export interface PSale {
  id: string;
  billNo: string;
  date: string;
  /** Additive (lock-in v2): the business date this sale belongs to for this
   *  shop ('YYYY-MM-DD'). With a late-night cutoff a 2:30 AM bill carries the
   *  PREVIOUS business date here, distinct from the UTC slice of `date`. */
  businessDate?: string;
  customerName: string;
  customerId?: string;
  tableLabel: string;
  subtotal: number;
  discount: number;
  gstAmount: number;
  gstSlab?: number;
  couponCode?: string;
  tip: number;
  total: number;
  paidAmount?: number;
  status?: 'Paid' | 'Partial' | 'Unpaid';
  returnsTotal?: number;
  method: string;
  isVoid: boolean;
  hasAutoTransfer?: boolean;
  /** Compact register preview (distinct product names, capped server-side). */
  itemsPreview?: string[];
  itemCount?: number;
  items?: PSaleItem[];
  payments?: PSalePayment[];
  correctsSaleId?: string;
  createdAt: string;
}

export interface PPurchase {
  id: string;
  billNo: string;
  date: string;
  supplierId?: string;
  supplierName: string;
  /** Supplier account code — MAIN-GODOWN marks an owner distribution bill. */
  supplierCode?: string | null;
  items?: { id: string; productId: string; productName: string; qty: number; rate: number; total: number }[];
  payments?: { id: string; voucherNo: string; date: string; mode: string; ref: string; amount: number; status: string }[];
  itemCount: number;
  totalQty: number;
  amount: number;
  paidAmount: number;
  status: 'Paid' | 'Partial' | 'Unpaid' | string;
  notes?: string;
  createdAt: string;
  /** Compact register preview (distinct product names, capped server-side). */
  itemsPreview?: string[];
}

export interface PVoucher {
  id: string;
  voucherNo: string;
  date: string;
  party: string;
  mode: 'Cash' | 'UPI';
  ref: string;
  amount: number;
  status: 'Cleared' | 'Pending' | string;
  /** Server timestamp — deterministic same-day ordering + real time column. */
  createdAt?: string;
  /** Bill this payment settles (payments only, when bill-linked). */
  purchaseBillNo?: string;
}

export interface PIncExp {
  id: string;
  voucherNo: string;
  date: string;
  head: string;
  type: 'Income' | 'Expense';
  amount: number;
  narration: string;
}

export interface PTransfer {
  id: string;
  productId?: string;
  productName: string;
  from: 'godown' | 'counter';
  to: 'godown' | 'counter';
  qty: number;
  date: string;
}

export interface PSnapshot {
  id: string;
  dateKey: string;
  billsCount: number;
  itemsSoldCount?: number;
  totalSales?: number;
  cashSales?: number;
  upiSales?: number;
  discounts?: number;
  gstCollected?: number;
  grossProfit?: number;
  otherIncome?: number;
  expenses?: number;
  netProfit?: number;
  openingCash?: number | null;
  closingCash?: number | null;
  openedAt?: string;
  openedByName?: string;
  closedAt?: string;
  closedByName?: string;
  closingNote?: string;
  sealedAt: string;
  sealedByName: string;
}

export interface PEmployee {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  tabGrants: string[];
  canSeeMoney: boolean;
  canSeeValuation: boolean;
  status: 'active' | 'suspended' | 'deleted';
}

export interface PDayStatus {
  dateKey: string;
  isOpen: boolean;
  isClosed: boolean;
  status: string;
  openingCash: number;
  openedAt?: string;
  openedByName?: string;
  closingCash: number | null;
  closedAt?: string;
  closedByName?: string | null;
  expectedCash: number;
  variance: number | null;
  logs: { id: string; byName: string; text: string; createdAt: string }[];
}

export interface PageOpts {
  limit?: number;
  offset?: number;
}

export interface OnboardingIssue {
  row_id: string;
  row: number;
  name: string;
  code: string;
  message: string;
  fix: string;
}

export interface OnboardingPlanRow {
  row_id: string;
  row: number;
  name: string;
  barcode: string;
  action: 'create' | 'match';
  matched: { product_id: string; name: string; confidence: 'exact' | 'possible' } | null;
  godown: number | null;
  counter: number | null;
  opening_qty: number;
  rate: number;
  mrp: number;
  godown_after: number;
  counter_after: number;
  warnings: string[];
  error: { code: string; message: string; fix: string } | null;
}

export interface OnboardingPlan {
  rows: OnboardingPlanRow[];
  summary: {
    rows_total: number;
    rows_included: number;
    rows_create: number;
    rows_matched: number;
    rows_excluded: number;
    rows_errors: number;
    rows_with_warnings: number;
    initialize_stock: boolean;
    direct_opening_stock?: boolean;
    stock_rows: number;
    opening_qty: number;
    godown_total: number;
    counter_total: number;
    bill_amount: string;
    supplier: { id: string; name: string } | null;
    categories_used: string[];
    units_used: string[];
  };
  blocking_errors: OnboardingIssue[];
  ready: boolean;
}

export interface OnboardingResult {
  import_id: string;
  status: 'completed';
  products_created: number;
  products_matched: number;
  products_skipped: number;
  opening_products: number;
  opening_qty: number;
  godown_opening: number;
  counter_opening: number;
  direct_opening_stock?: boolean;
  bill_no: string | null;
  bill_amount: string;
  supplier: { id: string; name: string } | null;
  reconciliation: 'Passed';
  warnings: { row_id: string; row: number; name: string; messages: string[] }[];
}

export interface ShopLibraryOption {
  key: string;
  label: string;
  business_type: string;
}

export interface RepairSummary {
  matched: number;
  corrected: number;
  unmatched: number;
}

export interface PCategory {
  id: string;
  name: string;
  /** Protected essential default (preset system): server-managed, cannot be
   *  renamed/deleted while set. Cleared only by disabling the preset — the
   *  row itself is never removed. */
  isDefault: boolean;
  originPreset: string;
}

export interface PUnit {
  id: string;
  name: string;
  ml_volume: number | null;
  isDefault: boolean;
  originPreset: string;
}

export interface UnitOpts {
  mlVolume?: number | null;
}

export interface PParent {
  id: string;
  name: string;
  fullName: string;
}

export interface AccountLedgerEntry {
  id: string;
  date: string;
  time?: string;
  voucher_no: string;
  voucher_type: string;
  voucher_id?: string;
  against_account: string;
  remarks: string;
  debit: string;
  credit: string;
  running_balance: string;
  is_opening: boolean;
  /** Authoritative per-row, from accounts/selectors.py. */
  side?: PAccountSide | null;
  role?: string | null;
  source_label?: string;
  what_happened?: string;
}

export interface AccountLedgerResponse {
  account: {
    id: string;
    name: string;
    code: string;
    type: string;
    phone: string;
    country_code: string;
    opening: string;
    balance: string;
    status_label: string;
    is_active: boolean;
  };
  initial_balance: string;
  opening_side?: PAccountSide;
  total_debit: string;
  total_credit: string;
  closing_balance: string;
  /** Authoritative, from accounts/selectors.py, for the statement's closing. */
  ledger_balance?: string;
  side?: PAccountSide | null;
  role?: string | null;
  is_receivable?: boolean;
  is_payable?: boolean;
  is_advance?: boolean;
  entries: AccountLedgerEntry[];
}

export interface TrialBalanceResponse {
  as_of_date: string;
  rows: {
    account_id: string;
    name: string;
    code: string;
    type: string;
    debit: string;
    credit: string;
  }[];
  total_debit: string;
  total_credit: string;
  is_balanced: boolean;
}

export interface ProfitLossResponse {
  income: { name: string; amount: string }[];
  total_income: string;
  expenses: { name: string; amount: string }[];
  total_expenses: string;
  net_profit: string;
}

export interface BalanceSheetResponse {
  assets: { name: string; type: string; amount: string }[];
  total_assets: string;
  liabilities: { name: string; type: string; amount: string }[];
  total_liabilities: string;
  equity: { name: string; amount: string }[];
  total_equity: string;
  total_liabilities_and_equity: string;
  is_balanced: boolean;
}

export interface SaleSubmitResult {
  billNo: string;
  total: number;
  offline?: boolean;
}

export interface PSaleReturnItem {
  productId: string;
  productName: string;
  unit: string;
  qty: number;
  rate: number;
  total: number;
}

export interface PSaleReturn {
  id: string;
  billNo: string;
  saleId: string;
  saleBillNo: string;
  kind: 'return' | 'exchange' | string;
  replacementSaleId?: string | null;
  restockLocation: 'counter' | 'godown' | string;
  refundMethod: 'Cash' | 'UPI' | 'Khata' | string;
  refundRef: string;
  amount: number;
  notes: string;
  date: string;
  createdAt: string;
  items: PSaleReturnItem[];
}

export interface SaleReturnPayload {
  saleId: string;
  lines: { sale_item_id?: string; product_id?: string; qty: number }[];
  restock_location: 'counter' | 'godown';
  refund_method: 'Cash' | 'UPI' | 'Khata';
  refund_ref?: string;
  notes?: string;
  idempotency_key?: string;
  replacement?: {
    lines: { product_id: string; qty: number; rate?: number }[];
    payments: { method: 'Cash' | 'UPI' | 'Khata'; amount: number }[];
    customer_id?: string;
    customer_name?: string;
    coupon_code?: string;
    gst_slab?: number;
    tip?: number;
  };
}

export interface CorrectSalePayload {
  reason: string;
  lines: { product_id: string; qty: number; rate: number }[];
  payments: { method: 'Cash' | 'UPI' | 'Khata'; amount: number }[];
  customer_id?: string;
  customer_name?: string;
  coupon_code?: string;
  gst_slab?: number;
  tip?: number;
  is_tax_inclusive?: boolean;
  idempotency_key?: string;
}

export interface PPurchaseReturnItem {
  productId: string;
  productName: string;
  qty: number;
  rate: number;
  total: number;
}

export interface PPurchaseReturn {
  id: string;
  billNo: string;
  purchaseId: string;
  purchaseBillNo: string;
  kind: 'return' | 'exchange' | string;
  replacementPurchaseId?: string | null;
  stockLocation: 'godown' | 'counter' | string;
  settlement: 'payable' | 'refund' | string;
  refundMethod: 'Cash' | 'UPI' | string;
  refundRef: string;
  amount: number;
  reason: string;
  date: string;
  createdAt: string;
  items: PPurchaseReturnItem[];
}

export interface PurchaseReturnPayload {
  purchaseId: string;
  lines: { purchase_item_id?: string; product_id?: string; qty: number }[];
  stock_location: 'godown' | 'counter';
  settlement: 'payable' | 'refund';
  refund_method?: 'Cash' | 'UPI';
  refund_ref?: string;
  reason: string;
  idempotency_key?: string;
  replacement?: {
    lines: { product_id: string; qty: number; rate?: number }[];
    notes?: string;
  };
}

export interface PServerTab {
  tableLabel: string;
  customerName: string;
  gstSlab: number;
  couponCode: string;
  tipPct: number;
  draftItems: any[];
  openedAt: string;
  openedByName: string;
  updatedAt: string;
}

export interface PStockMovement {
  id: string
  productId: string
  productName: string
  qtyDelta: number
  fromLoc: string
  toLoc: string
  reason: string
  referenceId?: string
  createdAt: string
  runningCost: number | null
}

export interface ClosingRow {
  product_id: string; brand: string; name: string; size_ml: number | null; section: string;
  /** Null in a blind (rigorous) close: the operator must not be able to read the
   *  answer off the screen before committing to a number. */
  system_qty: number | null; actual_qty: number | null; skip_reason: string; variance: number | null;
  rate_paise: number | null; billed_rate_paise?: number | null;
  variance_cause?: string; variance_note?: string;
  counted_by: string; counted_at: string | null;
  /** Set when this difference has already been disposed of by a real business
   *  document. A second correction of the same count is refused server-side. */
  settled?: boolean;
  settled_movement_id?: string | null;
  settled_at?: string | null;
  settled_by?: string;
}

export type ClosingConfidence = 'proven' | 'likely' | 'check_next';

export interface ClosingSuggestion {
  kind: string; rank: number; product_id: string | null; qty?: number;
  text: string; evidence: string; confidence?: ClosingConfidence;
  /** 'over' = the drawer holds more than expected, 'short' = less, when the
   *  suggestion is about cash. Absent for stock suggestions. The client uses
   *  this to choose a directionally-correct posting rather than inferring the
   *  direction from the prose. */
  direction?: 'over' | 'short' | 'balanced';
}

export type ClosingStateKind =
  | 'not_started' | 'in_progress' | 'blocked'
  | 'counted_and_balanced' | 'counted_with_variances' | 'auto_sealed_unverified';

export interface ClosingScope {
  depth: 'simple' | 'rigorous';
  blind: boolean;
  in_scope: number;
  total_active: number;
  rules: Record<string, number>;
}

export interface ClosingState {
  date_key: string; closed: boolean; reconciliation_status: string;
  review_started: boolean; ready: boolean;
  rows: ClosingRow[]; counted: number; total: number;
  closing_state: ClosingStateKind;
  scope: ClosingScope;
  materiality_paise: number; tolerance_paise: number; within_tolerance: boolean;
  shrink_pct: number | null; stock_unresolved: number;
  expected_cash: string | null; counted_cash: string | null; cash_variance_paise: number | null;
  cash_counted: boolean;
  suggestions: ClosingSuggestion[];
  audit: { action: string; product_id: string | null; before: string; after: string; reason: string; by: string; at: string }[];
}

export interface ClosingAuditProduct {
  product_id: string; name: string; brand: string; size_ml: number | null;
  variance: number; rate_paise: number; rate_source: string; value_paise: number;
  actual_qty: number | null; system_qty: number | null;
  variance_cause: string; variance_note: string; settled: boolean;
}

export interface ClosingAuditFact {
  id: string; label: string; detail: string; ok: boolean;
  value?: string | number; value_paise?: number;
  material?: boolean; within_tolerance?: boolean;
  products?: ClosingAuditProduct[]; hidden_products?: number;
  settled_count?: number; unsettled_count?: number;
}

export type ClosingAuditAction =
  | { kind: 'record_sale'; label: string; confirmation: string; product_id: string; qty: number; rate_paise: number }
  | { kind: 'record_expense'; label: string; confirmation: string; amount_paise: number }
  | { kind: 'record_correction'; label: string; confirmation: string; product_id: string; qty: number; cause: string }

export interface ClosingAuditFinding {
  id: string; title: string; confidence: ClosingConfidence;
  narrative: string; evidence: string;
  products: ClosingAuditProduct[];
  value_paise: number; cash_paise: number; residual_paise: number | null;
  action?: ClosingAuditAction | null;
  unavailable?: { kind: string; label: string; detail: string } | null;
}

export interface ClosingAudit {
  date_key: string; closed: boolean; sealed_at: string | null; closed_by: string;
  counted_cash: string | null; expected_cash: string | null; cash_counted: boolean;
  /** Where the counted figure was read from: the sealed day, the daybook entry,
   *  the still-open review, or nowhere. Reported so the audit never claims a
   *  count is missing when the operator is looking at one they just typed. */
  counted_cash_source: 'sealed' | 'daybook' | 'open review' | 'none';
  closing_state: ClosingStateKind;
  facts: ClosingAuditFact[]; findings: ClosingAuditFinding[];
  all_clear: boolean; blocking: string[]; disposition_note: string;
}

export interface PSealedDay {
  dateKey: string;
  lockInTime: string;
  sealedAt: string | null;
}

export interface PBusinessDayInfo {
  shopId: string;
  lockInTime: string;
  timezone: string;
  currentCalendarDate: string;
  currentBusinessDate: string;
  windowStart: string;
  windowEnd: string;
  nextCutoffAt: string;
  today: { businessDate: string; bills: number; total: number };
  sealedDays: PSealedDay[];
}

export interface PFeatureState {
  enabled: boolean;
  owner_only: boolean;
  /** Optional behaviour selector, e.g. quick discount 'manual' | 'auto'. */
  mode?: string;
}

export interface PFeatureCatalogEntry {
  key: string;
  label: string;
  group: string;
  description: string;
  owner_only_capable: boolean;
  modes?: string[];
  default: PFeatureState;
}

export interface ShopClosingSettings {
  shop_id: string;
  materiality: string;
  materiality_paise: number;
  depth: 'simple' | 'rigorous';
}

export interface StockOverviewShop {
  id: string;
  name: string;
  code: string;
}

export interface StockOverviewRow {
  code: string;
  name: string;
  mrp: string;
  total: number;
  per_shop: Record<string, { godown: number; counter: number; total: number }>;
}

export interface StockOverview {
  shops: StockOverviewShop[];
  products: StockOverviewRow[];
}

export interface RetailerOutstandingRow {
  shop_id: string;
  shop_name: string;
  shop_code: string;
  balance: string;
  customer_account_id: string | null;
}

export interface DistributionRecord {
  id: string;
  from_shop_id: string;
  from_shop_name: string;
  to_shop_id: string;
  to_shop_name: string;
  sale_id: string;
  sale_bill_no: string;
  sale_total: string;
  purchase_id: string;
  purchase_bill_no: string;
  payment_mode: string;
  total: string;
  item_count: number;
  total_qty: number;
  notes: string;
  created_at: string;
}

export interface DistributeLineInput {
  product_id: string;
  qty: number;
  rate?: string;
  gst_rate?: string;
}

export interface OwnerSummaryShopRow {
  shop_id: string;
  code: string;
  name: string;
  collection: number;
  bills: number;
  avg_bill: number;
  items_sold: number;
  cash: number;
  upi: number;
  khata: number;
  purchases: number;
  income: number;
  expenses: number;
  receivables_customers: number;
  receivables_retailers: number;
}

export interface OwnerSummary {
  from: string;
  to: string;
  mode: 'network' | 'shop';
  shops: StockOverviewShop[];
  totals: {
    collection: number;
    bills: number;
    avg_bill: number;
    items_sold: number;
    cash: number;
    upi: number;
    khata: number;
    purchases: number;
    income: number;
    expenses: number;
    receivables_customers: number;
    receivables_retailers: number;
  };
  per_shop: OwnerSummaryShopRow[];
  daily: { date: string; collection: number; bills: number }[];
  top_products: { name: string; quantity: number; amount: number }[];
  recent_bills: {
    bill_no: string;
    shop_id: string;
    shop_name: string;
    customer: string;
    total: number;
    methods: string;
    created_at: string;
  }[];
}

export interface RetailerShopCreateResult {
  shop: { id: string; name: string; code: string; phone: string; address: string; gstin: string };
  login: { id: string; email: string; name: string };
}

export interface UserPrefsPayload {
  data: Record<string, unknown>;
  version: number;
  updated_at: string;
}

export interface SheetCell {
  opn: number;
  inw: number;
  out: number;
  sld: number;
  cls: number;
  rate_min_paise?: number;
  rate_max_paise?: number;
  rate_display?: string;
  amt_paise?: number;
  product_count: number;
  product_ids: string[];
  returned_to_godown_units: number;
  size_ml?: number | null;
  /** Distinct non-empty `Product.flavour` values in this cell. A RATE range is
   *  shown only when this is 2 or more. */
  flavour_count?: number;
}

export interface SheetRow {
  id?: string;
  row_id?: string;
  code?: string;
  product_rows?: SheetRow[];
  last_sale_at?: string | null;
  rate_source?: string;
  selling_rate_paise?: number;
  brand: string;
  name?: string;
  is_unbranded: boolean;
  parent_id?: string | null;
  parent_name?: string;
  flavour?: string;
  has_flavours?: boolean;
  is_flavour_parent?: boolean;
  /** Ordering signal: units sold over the rolling 4-business-day window
   *  including today (apps.catalog.ordering). The app-wide default order. */
  sold_4d?: number;
  /** Ordering signal: units sold in the current business day. Live order. */
  sold_today?: number;
  /** ISO timestamp of the most recent sale inside the ordering window. */
  order_last_sold_at?: string | null;
  /** True when the row has products whose unit size is not one of the
   *  register's configured size columns (kept in row_totals, shown in the
   *  row's items dropdown). */
  has_unmapped?: boolean;
  /** True when the row's items dropdown should open: flavours and/or
   *  non-standard units. */
  is_item_parent?: boolean;
  /** Non-standard-unit cells for this row, keyed the same way as `cells`.
   *  These are NOT size columns. */
  unmapped?: Record<string, SheetCell>;
  /** Per-flavour breakdown (parent row aggregates the same cells). */
  children?: SheetRow[];
  /** Distinct product names contributing to this row (for search). Absent
   *  from legacy sealed snapshots; treat as optional. */
  product_names?: string[];
  cells: Record<string, SheetCell>;
  row_totals: {
    opn: number;
    inw: number;
    out: number;
    sld: number;
    cls: number;
    amt_paise?: number;
  };
}

export interface SheetTotals {
  opn: number;
  inw: number;
  out: number;
  sld: number;
  cls: number;
  amt_paise?: number;
}

export interface SheetRegister {
  key: string;
  label: string;
  sizes_ml: number[];
  size_headers: string[];
  rows: SheetRow[];
  totals_by_size: Record<string, SheetTotals>;
  totals: SheetTotals;
}

export interface SheetAllRow {
  brand: string;
  is_unbranded: boolean;
  categories: string[];
  opn: number;
  inw: number;
  out: number;
  sld: number;
  cls: number;
  /** Present only when the caller may see money (the server masks it otherwise). */
  amt_paise?: number;
}

export interface SheetAllRegister {
  label: string;
  rows: SheetAllRow[];
  totals: SheetTotals;
}

export interface SheetExpenseLine {
  label: string;
  amount_paise: number;
}

export interface SheetResponse {
  meta: {
    date: string;
    window?: { start: string; end: string };
    sealed?: boolean;
    reconstructed?: boolean;
    as_of?: string;
    schema_version?: number;
    settings_version?: number;
    /** Inclusive business-day window this payload covers (additive, 2026-09-17). */
    from?: string;
    to?: string;
    days_total?: number;
    days_sealed?: number;
    all_sealed?: boolean;
  };
  registers: SheetRegister[];
  grand_totals: SheetTotals;
  /** Virtual combined register; absent only from pre-range cached payloads. */
  all_register?: SheetAllRegister;
  audit: {
    rate_card_margin_paise: number;
    expenses_paise: number;
    rate_card_net_paise: number;
    turnover_paise: number;
    cost_based_gross_profit_paise?: number;
    cost_based_net_profit_paise?: number;
    expense_lines?: SheetExpenseLine[];
  } | null;
  reconciliation: {
    status: 'Reconciled' | 'Discrepancy' | 'Blocked';
    discrepancies: string[];
    blocked_reason: string | null;
  };
  /** Drawer reconciliation for a single business day (money-visible only). */
  cash?: {
    opening_cash_paise: number;
    closing_cash_paise: number | null;
    expected_cash_paise: number;
    variance_paise: number | null;
    is_closed: boolean;
  } | null;
  diagnostics?: {
    products_without_brand_count: number;
    unbranded_product_names: string[];
  };
}

export interface SheetQuery {
  date?: string;
  from?: string;
  to?: string;
}

export interface CatalogCapability {
  key: string;
  kind: 'surface' | 'variant' | 'feature';
  surface_key?: string | null;
  is_default_variant?: boolean;
  label: string;
  description: string;
  sort_order: number;
}

export interface ShopExperienceData {
  version: number;
  profile: string;
  surfaces: Record<string, boolean>;
  variants: Record<string, string>;
  settings: Record<string, any>;
}

export interface ShopMemberGrantInfo {
  id: string;
  user_id: string;
  email: string;
  name: string;
  role: string;
  grants: string[];
}

export interface ShopExperienceResponse {
  shop_id: string;
  experience: ShopExperienceData;
  catalog: CatalogCapability[];
  profiles: string[];
  members: ShopMemberGrantInfo[];
  product_count: number;
}

export interface ShopExperienceUpdatePayload {
  version?: number;
  profile?: string;
  surfaces?: Record<string, boolean>;
  variants?: Record<string, string>;
  settings?: Record<string, any>;
  member_grants?: Record<string, string[]>;
}

export interface LibrarySummary {
  key: string;
  label: string;
  description: string;
  business_type: string;
  parents: number;
  products: number;
  needs_review: number;
  category_options?: string[];
  unit_options?: string[];
}

export interface LibraryParentRow {
  id: string;
  name: string;
  full_name: string;
  category: string;
  aliases: string[];
  needs_review: boolean;
  is_active: boolean;
  product_count: number;
}

export interface LibraryProductRow {
  id: string;
  barcode: string;
  name: string;
  parent_id: string;
  parent_name: string;
  category: string;
  size_ml: number | null;
  unit_label: string;
  mrp_ref: string;
  pcs_per_box: number;
  needs_review: boolean;
  is_active: boolean;
  is_locked: boolean;
  locked_at: string | null;
  locked_by_name: string;
}

export interface LibraryListResponse {
  libraries: LibrarySummary[];
  selected: string;
  parents: LibraryParentRow[];
  categories: string[];
  category_options: string[];
  unit_options: string[];
}

export interface LibraryProductPage {
  total: number;
  offset: number;
  limit: number;
  products: LibraryProductRow[];
}

export type LibraryProductPatch = Omit<Partial<LibraryProductRow>, 'parent_id'> & {
  parent_id?: string | null
}

export interface LibraryBulkProductUpdatePayload {
  product_ids: string[];
  parent_id?: string | null;
  parent_name?: string;
  category?: string;
  clear_review?: boolean;
}

export interface LibraryBulkProductUpdateResponse {
  status: string;
  updated_count: number;
}

export interface LibraryOptionsPatch {
  category_options?: string[];
  unit_options?: string[];
}

export interface ActiveSession {
  sid: string;
  kind: string;
  platform: string;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export interface ImpersonationPayload {
  access: string;
  refresh?: string;
  expires_in: number;
  user: { id: string; email: string; name: string };
  shop: { id: string; name: string };
}
