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

export interface UserPrefsPayload {
  data: Record<string, unknown>;
  version: number;
  updated_at: string;
}
