/**
 * ORSQUARE Intelligence Layer: the single data-access surface for every tab.
 *
 * All retailer pages talk ONLY to this module (never to `api` directly).
 * It maps the DRF backend's snake_case rows into the 01-era frontend shapes
 * (camelCase, snapshotted names) so pages stay clean and portable.
 *
 * Mutations throw ApiError with friendly messages; offline sales are routed
 * through the Dexie queue automatically.
 */
import { api, ApiError } from './api';
import { enqueueOfflineSale } from './sync';
import type { OfflineSalePayload } from './db';
import type { OpenBill } from '../types';

// ---------------------------------------------------------------------------
// Domain shapes (01-era, camelCase: what pages consume)
// ---------------------------------------------------------------------------

export interface PProduct {
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

/** The accounting side of a balance, decided server-side. */
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));

/** Page opts for list registers. The server caps every register at 1000 rows
 *  and defaults to 200: callers pass nothing and still get the full page. */
export interface PageOpts {
  limit?: number;
  offset?: number;
}

const REGISTER_LIMIT = 1000;

const pageParams = (opts?: PageOpts): { limit: number; offset?: number } => ({
  limit: opts?.limit ?? REGISTER_LIMIT,
  offset: opts?.offset,
});

/** Decimal strings (Django DecimalField serialized as JSON strings) → number,
 *  null-safe. */
export const decNum = (v: any): number | null =>
  v === null || v === undefined || v === '' ? null : num(v);

function mapProduct(raw: any): PProduct {
  return {
    id: raw.id,
    code: raw.code,
    barcode: raw.barcode || '',
    name: raw.name,
    brand: raw.brand || '',
    parentId: raw.parent_id || undefined,
    parentName: raw.parent_name || undefined,
    flavour: raw.flavour || '',
    category: raw.category_name || '-',
    categoryId: raw.category_id,
    unit: raw.unit_name || '-',
    unitId: raw.unit_id,
    mrp: num(raw.mrp),
    rate: num(raw.rate ?? raw.mrp),
    costPrice: raw.cost_price !== undefined ? num(raw.cost_price) : undefined,
    piecesPerBox: num(raw.pieces_per_box),
    godownPcs: num(raw.godown_pcs),
    counterPcs: num(raw.counter_pcs),
    lowLevel: num(raw.low_level),
    soldCount: num(raw.sold_count),
    // App-wide ordering standard (CONVENTIONS §3.3): rolling 4-business-day
    // sold quantity including today. `soldCount` stays the lifetime counter
    // and is NOT the ordering key any more.
    sold4d: num(raw.sold_4d),
    orderLastSoldAt: raw.order_last_sold_at || null,
    active: raw.is_active !== false,
    isKitchen: Boolean(raw.is_kitchen),
    createdAt: raw.created_at,
  };
}

function mapAccount(a: any): PAccount {
  // `balance` is null when the caller's role may not see supplier money. It
  // must stay null all the way to the screen: `num()` turned it into 0, and
  // the UI then rendered a supplier with a real payable as "Settled" with a
  // zero balance, and cached that lie offline. decNum() preserves the
  // difference between "square" and "not allowed to know".
  const balance = decNum(a.balance);
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    phone: a.phone || '',
    countryCode: a.country_code || '+91',
    opening: decNum(a.opening) ?? 0,
    balance,
    balanceHidden: a.balance_hidden === true || balance === null,
    // Authoritative, computed server-side from the ledger. The client used to
    // re-derive these from the sign of `balance` in five different places
    // with five different account-type lists, and got Dr/Cr backwards between
    // the statement and the trial balance. Nothing in src/ branches on a sign
    // now; it renders what the server said.
    side: (a.side as PAccountSide) ?? null,
    role: a.role ?? null,
    isReceivable: a.is_receivable === true,
    isPayable: a.is_payable === true,
    isAdvance: a.is_advance === true,
    isSettled: a.is_settled === true,
    active: a.is_active !== false,
    createdAt: a.created_at,
  };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function listProducts(shopId: string, opts?: { search?: string; categoryId?: string; is_kitchen?: boolean | string }): Promise<PProduct[]> {
  const rows = await api.get<any[]>('/api/catalog/products/', {
    shop_id: shopId,
    search: opts?.search,
    category_id: opts?.categoryId,
    is_kitchen: opts?.is_kitchen !== undefined ? opts.is_kitchen : undefined,
  });
  return rows.map(mapProduct);
}

export async function createProduct(shopId: string, input: Record<string, any>): Promise<PProduct> {
  const p = await api.post('/api/catalog/products/', {
    shop_id: shopId,
    ...input,
    is_kitchen: input.is_kitchen ?? input.isKitchen,
  });
  return mapProduct(p);
}

export async function updateProduct(shopId: string, id: string, input: Record<string, any>): Promise<PProduct> {
  const p = await api.put(`/api/catalog/products/${id}/`, {
    shop_id: shopId,
    ...input,
    is_kitchen: input.is_kitchen ?? input.isKitchen,
  });
  return mapProduct(p);
}

export async function deleteProduct(shopId: string, productId: string): Promise<void> {
  await api.delete(`/api/catalog/products/${productId}/?shop_id=${shopId}`);
}

/** One atomic bulk import. `products` rows carry category/unit NAMES (the
 *  server upserts those masters by name); `categories`/`units` are the unique
 *  names collected from the file. Returns {created: uuid[], errors: [{row, error}]}
 *  where `row` indexes the products array (-1 = whole-batch failure). */
export async function importProducts(
  shopId: string,
  payload: { products: Record<string, any>[]; categories?: { name: string }[]; units?: { name: string; ml_volume?: number | null }[] }
): Promise<{ created: string[]; errors: { row: number; error: string }[] }> {
  return api.post('/api/catalog/products/bulk/', { shop_id: shopId, ...payload });
}

/* --- Fast Onboarding 2.0 -------------------------------------------------
 * Upload → Parse → Normalize → Interpret → Validate → Preview → Commit.
 * previewOnboarding is a pure read-only simulation; commitOnboarding is one
 * atomic, idempotent operation (products → opening purchase → counter
 * transfers → verification). The import_id the client generates IS the
 * operation identity — replaying a commit never duplicates anything. */

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

export async function previewOnboarding(
  shopId: string,
  payload: { products: Record<string, any>[]; initialize_stock: boolean; direct_opening_stock?: boolean; supplier_id?: string | null; library_key?: string }
): Promise<OnboardingPlan> {
  return api.post('/api/catalog/onboarding/preview/', { shop_id: shopId, ...payload });
}

export interface ShopLibraryOption {
  key: string;
  label: string;
  business_type: string;
}

export async function listShopLibraries(shopId: string): Promise<ShopLibraryOption[]> {
  return api.get('/api/catalog/libraries/', { shop_id: shopId });
}

export interface RepairSummary {
  matched: number;
  corrected: number;
  unmatched: number;
}

/** Optional, opt-in import repair against a reference library. */
export async function repairImportRows(
  shopId: string,
  libraryKey: string,
  rows: Record<string, any>[]
): Promise<{ rows: Record<string, any>[]; summary: RepairSummary }> {
  return api.post('/api/catalog/onboarding/repair/', { shop_id: shopId, library_key: libraryKey, rows });
}

export async function commitOnboarding(
  shopId: string,
  payload: {
    import_id: string;
    products: Record<string, any>[];
    initialize_stock: boolean;
    direct_opening_stock?: boolean;
    supplier_id?: string | null;
    source_file?: string;
  }
): Promise<{ already_completed?: boolean; result: OnboardingResult }> {
  return api.post('/api/catalog/onboarding/commit/', { shop_id: shopId, ...payload });
}

/** Recovery: learn whether an import whose response was lost actually
 *  completed, without ever re-running it. 404 = never committed. */
export async function getOnboardingOperation(shopId: string, importId: string): Promise<{
  import_id: string;
  status: 'processing' | 'completed' | 'failed';
  source_file: string;
  bill_no: string;
  result: OnboardingResult | null;
  error: Record<string, any> | null;
}> {
  return api.get(`/api/catalog/onboarding/operations/${importId}/`, { shop_id: shopId });
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

const mapCategory = (c: any): PCategory => ({
  id: c.id,
  name: c.name,
  isDefault: Boolean(c.is_default),
  originPreset: c.origin_preset || '',
});

const mapUnit = (u: any): PUnit => ({
  id: u.id,
  name: u.name,
  ml_volume: decNum(u.ml_volume),
  isDefault: Boolean(u.is_default),
  originPreset: u.origin_preset || '',
});

export async function listCategories(shopId: string): Promise<PCategory[]> {
  const rows = await api.get<any[]>('/api/catalog/categories/', { shop_id: shopId });
  return rows.map(mapCategory);
}

/** Bug B fix: active checkout discount schemes for this shop, replaces the
 *  hardcoded COUPONS list that used to live in src/types.ts. */
export async function listDiscountSchemes(
  shopId: string
): Promise<{ id: string; code: string; label: string; kind: 'percentage' | 'flat'; value: string | number }[]> {
  return api.get('/api/sales/discount-schemes/', { shop_id: shopId });
}

export async function createDiscountScheme(
  shopId: string,
  data: { code: string; label?: string; kind: 'percentage' | 'flat'; value: number }
): Promise<{ id: string; code: string; label: string; kind: 'percentage' | 'flat'; value: string | number }> {
  return api.post('/api/sales/discount-schemes/', { shop_id: shopId, ...data });
}

export async function updateDiscountScheme(
  shopId: string,
  id: string,
  data: { label?: string; kind?: 'percentage' | 'flat'; value?: number; is_active?: boolean }
): Promise<{ id: string; code: string; label: string; kind: 'percentage' | 'flat'; value: string | number }> {
  return api.patch(`/api/sales/discount-schemes/${id}/`, { shop_id: shopId, ...data });
}

export async function deleteDiscountScheme(shopId: string, id: string): Promise<void> {
  await api.delete(`/api/sales/discount-schemes/${id}/?shop_id=${shopId}`);
}

export async function createCategory(shopId: string, name: string): Promise<PCategory> {
  return mapCategory(await api.post('/api/catalog/categories/', { shop_id: shopId, name }));
}

export async function updateCategory(shopId: string, id: string, name: string): Promise<void> {
  await api.patch(`/api/catalog/items/categories/${id}/`, { shop_id: shopId, name });
}

export async function deleteCategory(shopId: string, id: string): Promise<void> {
  await api.delete(`/api/catalog/items/categories/${id}/?shop_id=${shopId}`);
}

export async function listUnits(shopId: string): Promise<PUnit[]> {
  const rows = await api.get<any[]>('/api/catalog/units/', { shop_id: shopId });
  return rows.map(mapUnit);
}

export interface UnitOpts {
  mlVolume?: number | null;
}

export interface PParent {
  id: string;
  name: string;
  fullName: string;
}

export async function listParents(shopId: string): Promise<PParent[]> {
  const rows = await api.get<any[]>('/api/catalog/parents/', { shop_id: shopId });
  return rows.map((p) => ({ id: p.id, name: p.name, fullName: p.full_name || '' }));
}

export async function createParent(shopId: string, name: string, fullName = ''): Promise<PParent> {
  const p = await api.post<any>('/api/catalog/parents/', { shop_id: shopId, name, full_name: fullName });
  return { id: p.id, name: p.name, fullName: p.full_name || '' };
}

export async function updateParent(shopId: string, id: string, name: string, fullName = ''): Promise<void> {
  await api.patch(`/api/catalog/parents/${id}/`, { shop_id: shopId, name, full_name: fullName });
}

export async function deleteParent(shopId: string, id: string): Promise<void> {
  await api.delete(`/api/catalog/parents/${id}/?shop_id=${shopId}`);
}

export async function createUnit(shopId: string, name: string, opts?: UnitOpts): Promise<PUnit> {
  const body: Record<string, any> = { shop_id: shopId, name };
  if (opts && 'mlVolume' in opts && opts.mlVolume != null) body.ml_volume = opts.mlVolume;
  return mapUnit(await api.post('/api/catalog/units/', body));
}

export async function updateUnit(shopId: string, id: string, name: string, opts?: { mlVolume?: number | null }): Promise<void> {
  const body: Record<string, any> = { shop_id: shopId, name };
  if (opts && 'mlVolume' in opts && opts.mlVolume != null) body.ml_volume = opts.mlVolume;
  await api.patch(`/api/catalog/items/units/${id}/`, body);
}

export async function deleteUnit(shopId: string, id: string): Promise<void> {
  await api.delete(`/api/catalog/items/units/${id}/?shop_id=${shopId}`);
}

export async function seedDefaultCatalogMaster(shopId: string): Promise<{
  created_categories: string[];
  created_units: string[];
  all_categories: PCategory[];
  all_units: PUnit[];
}> {
  const res = await api.post<any>('/api/catalog/seed-defaults/', { shop_id: shopId });
  return {
    created_categories: res.created_categories,
    created_units: res.created_units,
    all_categories: (res.all_categories || []).map(mapCategory),
    all_units: (res.all_units || []).map(mapUnit),
  };
}

// ---------------------------------------------------------------------------
// Accounts & Khata
// ---------------------------------------------------------------------------

export async function listAccounts(shopId: string, opts?: { type?: string; search?: string; includeSystem?: boolean }): Promise<PAccount[]> {
  const rows = await api.get<any[]>('/api/accounts/', {
    shop_id: shopId,
    type: opts?.type,
    search: opts?.search,
    ...(opts?.includeSystem ? { include_system: 'true' } : {}),
  });
  return rows.map(mapAccount);
}

export async function createAccount(shopId: string, data: Record<string, any>): Promise<PAccount> {
  const a = await api.post('/api/accounts/', { shop_id: shopId, ...data });
  return mapAccount(a);
}

export async function updateAccount(shopId: string, accountId: string, data: Record<string, any>): Promise<PAccount> {
  const a = await api.patch(`/api/accounts/${accountId}/`, { shop_id: shopId, ...data });
  return mapAccount(a);
}

export async function deleteAccount(shopId: string, accountId: string): Promise<void> {
  await api.delete(`/api/accounts/${accountId}/?shop_id=${shopId}`);
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

export async function getAccountLedger(
  shopId: string,
  accountId: string,
  opts?: { from?: string; to?: string }
): Promise<AccountLedgerResponse> {
  return api.get<AccountLedgerResponse>(`/api/accounts/${accountId}/ledger/`, {
    shop_id: shopId,
    from: opts?.from,
    to: opts?.to,
  });
}

export async function setAccountOpeningBalance(
  shopId: string,
  accountId: string,
  data: { amount: number; balance_type: 'Debit' | 'Credit'; date?: string }
): Promise<PAccount> {
  const res = await api.post(`/api/accounts/${accountId}/opening-balance/`, {
    shop_id: shopId,
    ...data,
  });
  return mapAccount(res);
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

export async function getTrialBalance(shopId: string, opts?: { as_of?: string }): Promise<TrialBalanceResponse> {
  return api.get<TrialBalanceResponse>('/api/accounts/reports/trial-balance/', {
    shop_id: shopId,
    as_of: opts?.as_of,
  });
}

export interface ProfitLossResponse {
  income: { name: string; amount: string }[];
  total_income: string;
  expenses: { name: string; amount: string }[];
  total_expenses: string;
  net_profit: string;
}

export async function getProfitLoss(shopId: string, opts?: { from?: string; to?: string }): Promise<ProfitLossResponse> {
  return api.get<ProfitLossResponse>('/api/accounts/reports/profit-loss/', {
    shop_id: shopId,
    from: opts?.from,
    to: opts?.to,
  });
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

export async function getBalanceSheet(shopId: string, opts?: { as_of?: string }): Promise<BalanceSheetResponse> {
  return api.get<BalanceSheetResponse>('/api/accounts/reports/balance-sheet/', {
    shop_id: shopId,
    as_of: opts?.as_of,
  });
}

// Idempotency keys must be minted ONCE per user intent and reused on retry.
// Generating a fresh key inside the request meant that if the POST committed
// server-side but the response was lost (timeout, tab closed, flaky POS
// network), the cashier's natural reaction - tap Save again - created a SECOND
// payment. The server was fully idempotent; the client kept defeating it. The
// caller must pass the same key for the same attempt (see AccountPaymentModal,
// which mints one key per form-open and clears it only on success).
export async function recordPayment(shopId: string, data: { supplier_id: string; amount: number; mode?: string; ref?: string; purchase_id?: string; idempotency_key: string }): Promise<PVoucher> {
  const { idempotency_key, ...rest } = data;
  const v = await api.post('/api/accounts/payments/', { shop_id: shopId, ...rest, idempotency_key });
  return { id: v.id, voucherNo: v.voucher_no, date: v.created_at, party: v.paid_to, mode: v.mode, ref: v.ref || '', amount: num(v.amount), status: v.status };
}

export async function recordReceipt(shopId: string, data: { customer_id: string; amount: number; mode?: string; ref?: string; sale_id?: string; idempotency_key: string }): Promise<PVoucher> {
  const { idempotency_key, ...rest } = data;
  const v = await api.post('/api/accounts/receipts/', { shop_id: shopId, ...rest, idempotency_key });
  return { id: v.id, voucherNo: v.voucher_no, date: v.created_at, party: v.received_from, mode: v.mode, ref: v.ref || '', amount: num(v.amount), status: v.status };
}

export async function fetchOpenBills(shopId: string, accountId: string): Promise<OpenBill[]> {
  return api.get<OpenBill[]>(`/api/accounts/${accountId}/open-bills/`, { shop_id: shopId });
}

export async function listVouchers(shopId: string, kind: 'payments' | 'receipts', opts?: { from?: string; to?: string; account_id?: string; search?: string } & PageOpts): Promise<PVoucher[]> {
  const rows = await api.get<any[]>('/api/accounts/vouchers/', { shop_id: shopId, kind, from: opts?.from, to: opts?.to, account_id: opts?.account_id, search: opts?.search || undefined, ...pageParams(opts) });
  return rows.map((v) => ({
    id: v.id,
    voucherNo: v.voucher_no,
    date: v.date,
    createdAt: v.created_at || undefined,
    party: v.party,
    mode: v.mode,
    ref: v.ref || '',
    amount: num(v.amount),
    status: v.status,
    purchaseBillNo: v.purchase_bill_no || undefined,
  }));
}

// ---------------------------------------------------------------------------
// Sales (POS)
// ---------------------------------------------------------------------------

export interface SaleSubmitResult {
  billNo: string;
  total: number;
  offline?: boolean;
}

/**
 * Submits a sale. Online → authoritative server; offline → Dexie queue for
 * later sync. Never throws for offline enqueue.
 */
export async function createSale(shopId: string, payload: Omit<OfflineSalePayload, 'shop_id'> & { shop_id?: string }): Promise<SaleSubmitResult> {
  const full: OfflineSalePayload = { ...payload, shop_id: shopId } as OfflineSalePayload;
  if (navigator.onLine) {
    try {
      const s = await api.post('/api/sales/', full);
      return { billNo: s.bill_no, total: num(s.total) };
    } catch (err: any) {
      // Transport errors, aborts, and ANY 5xx fall back to the offline queue so a
      // money-collected bill is never dropped on a server hiccup. Only business
      // rejections (4xx validation/conflict/insufficient stock) surface to the caller.
      const transportOrServer = (err instanceof Error && /network error/i.test(err.message)) || (typeof err?.status === 'number' && (err.status >= 500 || err.status === 408 || err.status === 429));
      if (!transportOrServer) throw err;
      await enqueueOfflineSale(full);
      return { billNo: 'OFFLINE-QUEUED', total: num(full.payments.reduce((a, p) => a + num(p.amount), 0)), offline: true };
    }
  }
  await enqueueOfflineSale(full);
  return { billNo: 'OFFLINE-QUEUED', total: num(full.payments.reduce((a, p) => a + num(p.amount), 0)), offline: true };
}

export async function listSales(shopId: string, opts?: { from?: string; to?: string; search?: string } & PageOpts): Promise<PSale[]> {
  const rows = await api.get<any[]>('/api/sales/list/', { shop_id: shopId, from: opts?.from, to: opts?.to, search: opts?.search || undefined, ...pageParams(opts) });
  return rows.map((s) => ({
    id: s.id,
    billNo: s.bill_no,
    date: s.date,
    businessDate: s.business_date || undefined,
    customerName: s.customer_name_snapshot,
    tableLabel: s.table_label,
    subtotal: num(s.subtotal),
    discount: num(s.discount),
    gstAmount: num(s.gst_amount),
    tip: num(s.tip),
    total: num(s.total),
    paidAmount: s.paid_amount != null ? num(s.paid_amount) : undefined,
    status: s.status || undefined,
    returnsTotal: s.returns_total != null ? num(s.returns_total) : undefined,
    method: s.method,
    isVoid: s.is_void,
    hasAutoTransfer: Boolean(s.has_auto_transfer),
    correctsSaleId: s.corrects_sale_id ? String(s.corrects_sale_id) : undefined,
    createdAt: s.created_at,
    itemsPreview: Array.isArray(s.items_preview) ? s.items_preview : undefined,
    itemCount: typeof s.item_count === 'number' ? s.item_count : undefined,
    payments: Array.isArray(s.payments) ? s.payments.map((p: any) => ({
      id: p.id,
      method: p.method as PSalePayment['method'],
      amount: num(p.amount),
      ref: p.ref || '',
    })) : undefined,
  }));
}

export async function getSale(_shopId: string, saleId: string): Promise<PSale> {
  const s = await api.get(`/api/sales/${saleId}/`);
  return {
    id: s.id,
    billNo: s.bill_no,
    date: s.date,
    customerName: s.customer_name_snapshot,
    customerId: s.customer_id ? String(s.customer_id) : undefined,
    tableLabel: s.table_label,
    subtotal: num(s.subtotal),
    discount: num(s.discount),
    gstAmount: num(s.gst_amount),
    gstSlab: num(s.gst_slab),
    couponCode: s.coupon_code || '',
    tip: num(s.tip),
    total: num(s.total),
    paidAmount: s.paid_amount != null ? num(s.paid_amount) : undefined,
    status: s.status || undefined,
    method: s.method,
    isVoid: s.is_void,
    hasAutoTransfer: Boolean(s.has_auto_transfer),
    correctsSaleId: s.corrects_sale_id ? String(s.corrects_sale_id) : undefined,
    createdAt: s.created_at,
    items: (s.items || []).map((i: any) => ({
      id: i.id,
      productId: i.product_id,
      productName: i.product_name_snapshot,
      unit: i.unit_snapshot || '',
      qty: num(i.qty),
      rate: num(i.rate),
      discount: num(i.discount),
      total: num(i.total),
      autoTransferredQty: num(i.auto_transferred_qty || 0),
    })),
    payments: (s.payments || []).map((p: any) => ({
      id: p.id,
      method: p.method as PSalePayment['method'],
      amount: num(p.amount),
      ref: p.ref || '',
    })),
  };
}

export async function voidSale(shopId: string, saleId: string, reason: string): Promise<void> {
  await api.post(`/api/sales/${saleId}/void/`, { shop_id: shopId, reason });
}

// ---------------------------------------------------------------------------
// Sales Returns & Exchanges (F6)
// ---------------------------------------------------------------------------

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

function mapSaleReturn(r: any): PSaleReturn {
  return {
    id: r.id,
    billNo: r.bill_no,
    saleId: String(r.sale_id),
    saleBillNo: r.sale_bill_no,
    kind: r.kind,
    replacementSaleId: r.replacement_sale_id ? String(r.replacement_sale_id) : null,
    restockLocation: r.restock_location,
    refundMethod: r.refund_method,
    refundRef: r.refund_ref || '',
    amount: num(r.amount),
    notes: r.notes || '',
    date: r.date,
    createdAt: r.created_at,
    items: (r.items || []).map((i: any) => ({
      productId: i.product_id,
      productName: i.product_name_snapshot,
      unit: i.unit_snapshot || '',
      qty: num(i.qty),
      rate: num(i.rate),
      total: num(i.total),
    })),
  };
}

export async function listSaleReturns(shopId: string, opts?: { saleId?: string; limit?: number; offset?: number }): Promise<PSaleReturn[]> {
  const rows = await api.get<any[]>('/api/sales/returns/', {
    shop_id: shopId,
    sale_id: opts?.saleId,
    limit: opts?.limit,
    offset: opts?.offset,
  });
  return rows.map(mapSaleReturn);
}

export async function createSaleReturn(shopId: string, payload: SaleReturnPayload): Promise<PSaleReturn> {
  const { saleId, ...rest } = payload;
  const idempotency_key = payload.idempotency_key || crypto.randomUUID();
  const r = await api.post('/api/sales/returns/', { shop_id: shopId, sale_id: saleId, idempotency_key, ...rest });
  return mapSaleReturn(r);
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

/** Owner-only correction: unwinds the original sale and posts a corrected
 *  replacement bill. Server recomputes every money value; the client only
 *  supplies the corrected lines/payments and a reason. */
export async function correctSale(shopId: string, saleId: string, payload: CorrectSalePayload): Promise<PSale> {
  const idempotency_key = payload.idempotency_key || crypto.randomUUID();
  const s = await api.post(`/api/sales/${saleId}/correct/`, { shop_id: shopId, idempotency_key, ...payload });
  return {
    id: s.id,
    billNo: s.bill_no,
    date: s.date,
    customerName: s.customer_name_snapshot,
    customerId: s.customer_id ? String(s.customer_id) : undefined,
    tableLabel: s.table_label,
    subtotal: num(s.subtotal),
    discount: num(s.discount),
    gstAmount: num(s.gst_amount),
    gstSlab: num(s.gst_slab),
    couponCode: s.coupon_code || '',
    tip: num(s.tip),
    total: num(s.total),
    method: s.method,
    isVoid: s.is_void,
    correctsSaleId: s.corrects_sale_id ? String(s.corrects_sale_id) : undefined,
    createdAt: s.created_at,
  };
}

export async function salesSummary(shopId: string, date?: string): Promise<Record<string, any>> {
  return api.get('/api/sales/summary/', { shop_id: shopId, date });
}

export async function liveSalesTotal(shopId: string, date?: string): Promise<{ gross_sales: number; returns_total: number; net_sales: number }> {
  const d = await api.get<any>('/api/sales/live-total/', { shop_id: shopId, date });
  return {
    gross_sales: num(d.gross_sales),
    returns_total: num(d.returns_total),
    net_sales: num(d.net_sales),
  };
}

/** Server-computed report aggregates over a Kolkata-day [from, to) range,
 *  category mix, top products, payment mix, totals and P&L. Money-sensitive
 *  fields are absent for sessions without valuation rights. */
export async function reportsSummary(shopId: string, from: string, to: string): Promise<Record<string, any>> {
  return api.get('/api/sales/reports-summary/', { shop_id: shopId, from, to });
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export async function listPurchases(shopId: string, opts?: { status?: string; from?: string; to?: string; search?: string } & PageOpts): Promise<PPurchase[]> {
  const rows = await api.get<any[]>('/api/purchases/list/', { shop_id: shopId, status: opts?.status, from: opts?.from, to: opts?.to, search: opts?.search || undefined, ...pageParams(opts) });
  return rows.map((p) => ({
    id: p.id,
    billNo: p.bill_no,
    date: p.date,
    supplierId: p.supplier_id,
    supplierName: p.supplier_name_snapshot,
    supplierCode: p.supplier_code ?? null,
    itemCount: num(p.item_count),
    totalQty: num(p.total_qty),
    amount: num(p.amount),
    paidAmount: num(p.paid_amount),
    status: p.status,
    createdAt: p.created_at,
    itemsPreview: Array.isArray(p.items_preview) ? p.items_preview : undefined,
  }));
}

/** Server-authoritative purchase aggregates: UI tiles must not reduce
 *  capped client-side lists (they silently undercount past 1000 bills). */
export async function purchasesSummary(shopId: string, opts?: { from?: string; to?: string }): Promise<{ total: number; paid: number; outstanding: number; qty: number; bills: number; returnsTotal?: number; netIntake?: number }> {
  const s = await api.get<any>('/api/purchases/summary/', { shop_id: shopId, from: opts?.from, to: opts?.to });
  return {
    total: num(s.total_amount),
    paid: num(s.total_paid),
    outstanding: num(s.outstanding_payables),
    qty: num(s.total_qty_pieces),
    bills: num(s.bills_count),
    returnsTotal: s.returns_total !== undefined ? num(s.returns_total) : undefined,
    netIntake: s.net_intake !== undefined ? num(s.net_intake) : undefined,
  };
}

function mapPurchaseDetail(p: any): PPurchase {
  return {
    id: p.id,
    billNo: p.bill_no,
    date: p.date,
    supplierId: p.supplier_id,
    supplierName: p.supplier_name_snapshot,
    itemCount: num(p.item_count),
    totalQty: num(p.total_qty),
    amount: num(p.amount),
    paidAmount: num(p.paid_amount),
    status: p.status,
    notes: p.notes || '',
    createdAt: p.created_at,
    items: (p.items || []).map((i: any) => ({
      id: i.id,
      productId: i.product_id,
      productName: i.product_name_snapshot,
      qty: num(i.qty),
      rate: num(i.rate),
      total: num(i.total),
    })),
    payments: (p.payments || []).map((v: any) => ({
      id: v.id,
      voucherNo: v.voucher_no,
      date: v.date,
      mode: v.mode,
      ref: v.ref || '',
      amount: num(v.amount),
      status: v.status,
    })),
  };
}

export async function getPurchase(shopId: string, purchaseId: string): Promise<PPurchase> {
  const p = await api.get(`/api/purchases/${purchaseId}/`, { shop_id: shopId });
  return mapPurchaseDetail(p);
}

export async function createPurchase(shopId: string, data: Record<string, any>): Promise<PPurchase> {
  // Client-generated UUID: a retried POST can never double-post the bill
  // (the service re-verifies the key inside the sequence lock).
  const p = await api.post('/api/purchases/', { shop_id: shopId, ...data, idempotency_key: crypto.randomUUID() });
  return mapPurchaseDetail(p);
}

export async function editPurchase(shopId: string, purchaseId: string, data: Record<string, any>): Promise<PPurchase> {
  // Same idempotency contract as create: a retried PUT returns the already
  // edited bill instead of restating stock and ledger twice.
  const p = await api.put(`/api/purchases/${purchaseId}/edit/`, { shop_id: shopId, ...data, idempotency_key: crypto.randomUUID() });
  return mapPurchaseDetail(p);
}

export async function listPurchaseEdits(shopId: string): Promise<any[]> {
  return api.get('/api/purchases/edits/', { shop_id: shopId });
}

// ---------------------------------------------------------------------------
// Purchase Returns & Exchanges (F7)
// ---------------------------------------------------------------------------

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

function mapPurchaseReturn(r: any): PPurchaseReturn {
  return {
    id: r.id,
    billNo: r.bill_no,
    purchaseId: String(r.purchase_id),
    purchaseBillNo: r.purchase_bill_no,
    kind: r.kind,
    replacementPurchaseId: r.replacement_purchase_id ? String(r.replacement_purchase_id) : null,
    stockLocation: r.stock_location,
    settlement: r.settlement,
    refundMethod: r.refund_method || '',
    refundRef: r.refund_ref || '',
    amount: num(r.amount),
    reason: r.reason || '',
    date: r.date,
    createdAt: r.created_at,
    items: (r.items || []).map((i: any) => ({
      productId: i.product_id,
      productName: i.product_name_snapshot,
      qty: num(i.qty),
      rate: num(i.rate),
      total: num(i.total),
    })),
  };
}

export async function listPurchaseReturns(shopId: string, opts?: { purchaseId?: string; limit?: number; offset?: number }): Promise<PPurchaseReturn[]> {
  const rows = await api.get<any[]>('/api/purchases/returns/', {
    shop_id: shopId,
    purchase_id: opts?.purchaseId,
    limit: opts?.limit,
    offset: opts?.offset,
  });
  return rows.map(mapPurchaseReturn);
}

export async function createPurchaseReturn(shopId: string, payload: PurchaseReturnPayload): Promise<PPurchaseReturn> {
  const { purchaseId, ...rest } = payload;
  const idempotency_key = payload.idempotency_key || crypto.randomUUID();
  const r = await api.post('/api/purchases/returns/', { shop_id: shopId, purchase_id: purchaseId, idempotency_key, ...rest });
  return mapPurchaseReturn(r);
}

// ---------------------------------------------------------------------------
// Server-backed seating tabs (multi-device floor plan)
// CROSS-DEVICE TAB FIX (2026-08-31): parked seating tabs used to live only in
// device localStorage: two devices could bill the SAME seating table at the
// same time with no conflict detection. Tabs now persist server-side; the
// PUT returns 409 {error:'occupied', tab} when another user holds a live tab,
// which the POS surfaces as an explicit takeover confirm.
// ---------------------------------------------------------------------------

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

const mapServerTab = (t: any): PServerTab => ({
  tableLabel: t.table_label,
  customerName: t.customer_name || '',
  gstSlab: num(t.gst_slab),
  couponCode: t.coupon_code || '',
  tipPct: num(t.tip_pct),
  draftItems: t.draft_items || [],
  openedAt: t.opened_at,
  openedByName: t.opened_by_name || '',
  updatedAt: t.updated_at,
});

export async function listServerTabs(shopId: string): Promise<PServerTab[]> {
  const rows = await api.get<any[]>('/api/sales/tabs/', { shop_id: shopId });
  return (rows || []).map(mapServerTab);
}

export async function saveServerTab(
  shopId: string,
  tableLabel: string,
  tab: { customerName: string; gstSlab: number; couponCode: string; tipPct: number; draftItems: any[] },
  force = false,
): Promise<{ ok: true; tab: PServerTab } | { ok: false; conflict: PServerTab | null }> {
  try {
    const t = await api.put(`/api/sales/tabs/${encodeURIComponent(tableLabel)}/`, {
      shop_id: shopId,
      customer_name: tab.customerName,
      gst_slab: tab.gstSlab,
      coupon_code: tab.couponCode,
      tip_pct: tab.tipPct,
      draft_items: tab.draftItems,
      force,
    });
    return { ok: true, tab: mapServerTab(t) };
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 409) {
      const raw = (e.data && (e.data as any).tab) || null;
      return { ok: false, conflict: raw ? mapServerTab(raw) : null };
    }
    throw e;
  }
}

export async function releaseServerTab(shopId: string, tableLabel: string): Promise<void> {
  await api.delete(`/api/sales/tabs/${encodeURIComponent(tableLabel)}/?shop_id=${shopId}`);
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export async function transferStock(shopId: string, data: { product_id: string; from_loc: 'godown' | 'counter'; to_loc: 'godown' | 'counter'; qty: number }): Promise<void> {
  await api.post('/api/inventory/transfers/', { shop_id: shopId, ...data, idempotency_key: crypto.randomUUID() });
}

export async function listTransfers(shopId: string, opts?: { from?: string; to?: string } & PageOpts): Promise<PTransfer[]> {
  const rows = await api.get<any[]>('/api/inventory/transfers/', { shop_id: shopId, from: opts?.from, to: opts?.to, ...pageParams(opts) });
  return rows.map((t) => ({
    id: t.id,
    productId: t.product_id ? String(t.product_id) : undefined,
    productName: t.product_name_snapshot,
    from: t.from_loc,
    to: t.to_loc,
    qty: num(t.qty),
    date: t.date,
  }));
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

export async function listStockMovements(shopId: string, opts?: { from?: string; to?: string; reason?: string } & PageOpts): Promise<PStockMovement[]> {
  const rows = await api.get<any[]>('/api/inventory/movements/', { shop_id: shopId, from: opts?.from, to: opts?.to, reason: opts?.reason, ...pageParams(opts) });
  return rows.map((m) => ({
    id: m.id,
    productId: m.product_id,
    productName: m.product_name_snapshot,
    qtyDelta: num(m.qty_delta),
    fromLoc: m.from_loc,
    toLoc: m.to_loc,
    reason: m.reason,
    referenceId: m.reference_id ? String(m.reference_id) : undefined,
    createdAt: m.created_at,
    runningCost: m.running_cost === null || m.running_cost === undefined ? null : num(m.running_cost),
  }));
}

// ---------------------------------------------------------------------------
// Cash Flow
// ---------------------------------------------------------------------------

export async function createVoucher(shopId: string, data: { head: string; type: 'Income' | 'Expense'; amount: number; narration?: string; date?: string }): Promise<PIncExp> {
  const v = await api.post('/api/cashflow/', { shop_id: shopId, ...data, idempotency_key: crypto.randomUUID() });
  return { id: v.id, voucherNo: v.voucher_no, date: v.date, head: v.head, type: v.type, amount: num(v.amount), narration: v.narration || '' };
}

export async function cashflowSummary(
  shopId: string,
  date?: string,
  from?: string,
  to?: string
): Promise<Record<string, any>> {
  // Range mode (from/to) returns server totals for the whole window,
  // total_inflow/total_outflow/net_flow mirror the register's money movement.
  return api.get('/api/cashflow/summary/', { shop_id: shopId, date, from, to });
}

export async function listIncExp(shopId: string, opts?: { from?: string; to?: string } & PageOpts): Promise<PIncExp[]> {
  const rows = await api.get<any[]>('/api/cashflow/', { shop_id: shopId, from: opts?.from, to: opts?.to, ...pageParams(opts) });
  return rows.map((v) => ({
    id: v.id,
    voucherNo: v.voucher_no,
    date: v.date,
    head: v.head,
    type: v.type,
    amount: num(v.amount),
    narration: v.narration || '',
  }));
}

// ---------------------------------------------------------------------------
// Day Book
// ---------------------------------------------------------------------------

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
/** `proven` means the arithmetic shows it; `likely` means it fits but is not
 *  exclusive; `check_next` means the engine is out of evidence and is saying so. */
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
/** What kind of closed day this is. `auto_sealed_unverified` means nobody
 *  counted — the 15-minute sealer closed it at expected cash, which is
 *  indistinguishable from a reconciled day unless something says so. */
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
export async function closingState(shopId: string, date: string): Promise<ClosingState> {
  return api.get('/api/daybook/closing/', { shop_id: shopId, date });
}
export async function saveClosingCount(
  shopId: string, dateKey: string, productId: string, actualQty: number | null,
  skipReason = '', varianceCause = '', varianceNote = '',
): Promise<void> {
  await api.post('/api/daybook/closing/count/', {
    shop_id: shopId, date_key: dateKey, product_id: productId,
    actual_qty: actualQty, skip_reason: skipReason,
    variance_cause: varianceCause, variance_note: varianceNote,
  });
}
export async function saveClosingCash(shopId: string, dateKey: string, amount: number): Promise<void> {
  await api.post('/api/daybook/closing/cash/', { shop_id: shopId, date_key: dateKey, amount });
}
export async function recordClosingSale(shopId: string, dateKey: string, productId: string, qty: number, key: string): Promise<{ bill_no: string }> {
  return api.post('/api/daybook/closing/sale/', { shop_id: shopId, date_key: dateKey, product_id: productId, qty, idempotency_key: key });
}
export async function recordClosingExpense(shopId: string, dateKey: string, amount: number, category: string, note: string, key: string): Promise<void> {
  await api.post('/api/daybook/closing/expense/', { shop_id: shopId, date_key: dateKey, amount, category, note, idempotency_key: key });
}
export async function recordClosingIncome(shopId: string, dateKey: string, amount: number, category: string, note: string, key: string): Promise<{ voucher_no: string }> {
  return api.post('/api/daybook/closing/income/', { shop_id: shopId, date_key: dateKey, amount, category, note, idempotency_key: key });
}
export async function recordClosingCorrection(shopId: string, dateKey: string, productId: string, cause: string, qty: number, note: string, idempotencyKey?: string): Promise<{ qty_delta: number; movement_id?: string }> {
  return api.post('/api/daybook/closing/correction/', { shop_id: shopId, date_key: dateKey, product_id: productId, cause, qty, note, idempotency_key: idempotencyKey ?? null });
}
export async function abandonClosingReview(shopId: string, dateKey: string, reason: string): Promise<{ discarded_counts: number }> {
  return api.post('/api/daybook/closing/abandon/', { shop_id: shopId, date_key: dateKey, reason });
}

/* ---------------------------------------------------------------------------
 * The Closing Stock Audit: a sealed-day reconciliation. Read-only - it returns
 * proposed actions for the operator to confirm, and posting one goes through the
 * same settlement calls above, so a confirmed action is a real business document
 * with the same audit trail as any other.
 * ------------------------------------------------------------------------ */

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
/** A proposed corrective posting. A discriminated union rather than one shape
 *  with optional fields, so the client cannot read a field the kind does not
 *  carry — the engine decides which document fits, and the client must post that
 *  one and nothing else. */
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

export async function closingAudit(shopId: string, date: string): Promise<ClosingAudit> {
  return api.get('/api/daybook/closing/audit/', { shop_id: shopId, date });
}

export async function dayStatus(shopId: string, date?: string): Promise<PDayStatus> {
  const s = await api.get('/api/daybook/status/', { shop_id: shopId, date });
  return {
    dateKey: s.date_key,
    isOpen: s.is_open,
    isClosed: s.is_closed,
    status: s.status,
    openingCash: num(s.opening_cash),
    openedAt: s.opened_at,
    openedByName: s.opened_by_name,
    closingCash: s.closing_cash !== null && s.closing_cash !== undefined ? num(s.closing_cash) : null,
    closedAt: s.closed_at,
    closedByName: s.closed_by_name,
    expectedCash: num(s.expected_cash),
    variance: s.variance !== null && s.variance !== undefined ? num(s.variance) : null,
    logs: (s.logs || []).map((l: any) => ({ id: l.id, byName: l.by_name, text: l.text, createdAt: l.created_at })),
  };
}

export async function openDay(shopId: string, data: { opening_cash: number; date_key?: string; note?: string }): Promise<void> {
  await api.post('/api/daybook/open/', { shop_id: shopId, ...data });
}

export async function closeDay(shopId: string, data: { date_key: string; closing_cash: number; closing_note?: string }): Promise<void> {
  await api.post('/api/daybook/close/', { shop_id: shopId, ...data });
}

export async function addDayLog(shopId: string, data: { date_key: string; text: string }): Promise<void> {
  await api.post('/api/daybook/logs/', { shop_id: shopId, ...data });
}

// ---------------------------------------------------------------------------
// Business-day cutoff (lock-in): Settings → Data Control
// ---------------------------------------------------------------------------

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

/** Server-computed, lock-in-aware business-day state (as observed by the
 *  backend, so the panel never re-derives IST/cutoff math client-side). */
export async function businessDayInfo(shopId: string): Promise<PBusinessDayInfo> {
  const d = await api.get<any>(`/api/console/shops/${shopId}/business-day/`);
  return {
    shopId: d.shop_id,
    lockInTime: d.lock_in_time,
    timezone: d.timezone,
    currentCalendarDate: d.current_calendar_date,
    currentBusinessDate: d.current_business_date,
    windowStart: d.window_start,
    windowEnd: d.window_end,
    nextCutoffAt: d.next_cutoff_at,
    today: { businessDate: d.today.business_date, bills: num(d.today.bills), total: num(d.today.total) },
    sealedDays: (d.sealed_days || []).map((s: any) => ({
      dateKey: s.date_key,
      lockInTime: s.lock_in_time,
      sealedAt: s.sealed_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Shop features (Settings → Features)
// ---------------------------------------------------------------------------

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

export async function getShopFeatures(shopId: string): Promise<{ features: Record<string, PFeatureState>; catalog: PFeatureCatalogEntry[] }> {
  const d = await api.get<any>(`/api/console/shops/${shopId}/features/`);
  return { features: d.features || {}, catalog: d.catalog || [] };
}

export async function updateShopFeatures(shopId: string, patch: Record<string, Partial<PFeatureState>>): Promise<Record<string, PFeatureState>> {
  const d = await api.patch<any>(`/api/console/shops/${shopId}/features/`, { features: patch });
  return d.features || {};
}

/* The two shop-level rules of the closing ritual. `close_day` refuses a drawer
   that is out by more than the materiality limit and tells the operator to raise
   it here, so this has to exist and be writable. `materiality` is typed in
   rupees; the API stores paise. */
export interface ShopClosingSettings {
  shop_id: string;
  materiality: string;
  materiality_paise: number;
  depth: 'simple' | 'rigorous';
}
export async function getShopClosingSettings(shopId: string): Promise<ShopClosingSettings> {
  return api.get(`/api/console/shops/${shopId}/closing-settings/`);
}
export async function updateShopClosingSettings(
  shopId: string, patch: { materiality?: string; depth?: 'simple' | 'rigorous' },
): Promise<ShopClosingSettings> {
  return api.patch(`/api/console/shops/${shopId}/closing-settings/`, patch);
}

/** One-time historical correction (owner only): recompute the CLOSED days in
 *  [from, to] with the current logic and overwrite their stored snapshot. The
 *  days stay closed. */
export async function reauditSnapshots(shopId: string, from: string, to: string): Promise<{ audited: number; corrected: number }> {
  const r = await api.post<any>('/api/daybook/reaudit/', { shop_id: shopId, from, to });
  return { audited: num(r.audited), corrected: num(r.corrected) };
}

export async function listSnapshots(shopId: string): Promise<PSnapshot[]> {
  const resp = await api.get<any>('/api/daybook/snapshots/', { shop_id: shopId, limit: 1000 });
  const rows: any[] = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.results) ? resp.results : []);
  return rows.map((s) => ({
    id: s.id,
    dateKey: s.date_key,
    billsCount: num(s.bills_count),
    itemsSoldCount: s.items_sold_count !== undefined ? num(s.items_sold_count) : undefined,
    totalSales: s.total_sales !== undefined ? num(s.total_sales) : undefined,
    cashSales: s.cash_sales !== undefined ? num(s.cash_sales) : undefined,
    upiSales: s.upi_sales !== undefined ? num(s.upi_sales) : undefined,
    discounts: s.discounts !== undefined ? num(s.discounts) : undefined,
    gstCollected: s.gst_collected !== undefined ? num(s.gst_collected) : undefined,
    grossProfit: s.gross_profit !== undefined ? num(s.gross_profit) : undefined,
    otherIncome: s.other_income !== undefined ? num(s.other_income) : undefined,
    expenses: s.expenses !== undefined ? num(s.expenses) : undefined,
    netProfit: s.net_profit !== undefined ? num(s.net_profit) : undefined,
    openingCash: s.opening_cash !== null && s.opening_cash !== undefined ? num(s.opening_cash) : null,
    closingCash: s.closing_cash !== null && s.closing_cash !== undefined ? num(s.closing_cash) : null,
    openedAt: s.opened_at,
    openedByName: s.opened_by_name,
    closedAt: s.closed_at,
    closedByName: s.closed_by_name,
    closingNote: s.closing_note,
    sealedAt: s.sealed_at,
    sealedByName: s.sealed_by_name,
  }));
}

// ---------------------------------------------------------------------------
// Employees (Settings → Team)
// ---------------------------------------------------------------------------

export async function listEmployees(shopId: string): Promise<{ cap: number | null; count: number; employees: PEmployee[] }> {
  const d = await api.get('/api/employees/', { shop_id: shopId });
  return {
    cap: d.cap,
    count: d.count,
    employees: (d.employees || []).map((e: any) => ({
      id: e.id,
      userId: e.user_id,
      name: e.name,
      email: e.email,
      role: e.role,
      isActive: e.is_active,
      tabGrants: Array.isArray(e.tab_grants) ? e.tab_grants : [],
      canSeeMoney: !!e.can_see_money,
      canSeeValuation: !!e.can_see_valuation,
      status: e.status === 'deleted' || e.status === 'suspended' ? e.status : e.is_active ? 'active' : 'suspended',
    })),
  };
}

export async function createEmployee(
  shopId: string,
  data: { name: string; email: string; password: string; tabGrants: string[]; canSeeMoney: boolean; canSeeValuation: boolean }
): Promise<void> {
  await api.post('/api/employees/', {
    shop_id: shopId,
    tab_grants: data.tabGrants,
    can_see_money: data.canSeeMoney,
    can_see_valuation: data.canSeeValuation,
    name: data.name,
    email: data.email,
    password: data.password,
  });
}

export async function updateEmployeeAccess(
  shopId: string,
  userId: string,
  data: { tabGrants: string[]; canSeeMoney: boolean; canSeeValuation: boolean }
): Promise<void> {
  await api.post(`/api/employees/${userId}/access/`, {
    shop_id: shopId,
    tab_grants: data.tabGrants,
    can_see_money: data.canSeeMoney,
    can_see_valuation: data.canSeeValuation,
  });
}

export async function deleteEmployee(shopId: string, userId: string): Promise<void> {
  await api.request(`/api/employees/${userId}/`, { method: 'DELETE', body: JSON.stringify({ shop_id: shopId }) });
}

export async function suspendEmployee(shopId: string, userId: string): Promise<void> {
  await api.post(`/api/employees/${userId}/suspend/`, { shop_id: shopId });
}

export async function reactivateEmployee(shopId: string, userId: string): Promise<void> {
  await api.post(`/api/employees/${userId}/reactivate/`, { shop_id: shopId });
}

export async function resetEmployeePassword(shopId: string, userId: string, newPassword: string): Promise<void> {
  await api.post(`/api/employees/${userId}/reset-password/`, { shop_id: shopId, new_password: newPassword });
}

/* ==========================================================================
 * Distribution (multi-shop owner: central godown -> retailer shops)
 * ========================================================================== */

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

export async function distributeStock(input: {
  fromShopId: string;
  toShopId: string;
  lines: DistributeLineInput[];
  paymentMode: 'Cash' | 'UPI' | 'Credit';
  paymentRef?: string;
  gstSlab?: number;
  notes?: string;
  idempotencyKey: string;
}): Promise<DistributionRecord> {
  return api.post('/api/distribution/', {
    from_shop_id: input.fromShopId,
    to_shop_id: input.toShopId,
    lines: input.lines,
    payment_mode: input.paymentMode,
    payment_ref: input.paymentRef ?? '',
    gst_slab: input.gstSlab ?? 0,
    notes: input.notes ?? '',
    idempotency_key: input.idempotencyKey,
  });
}

export async function listDistributions(shopId: string, limit = 50): Promise<DistributionRecord[]> {
  const data = await api.get<{ distributions: DistributionRecord[] }>('/api/distribution/list/', {
    shop_id: shopId,
    limit,
  });
  return data.distributions;
}

export async function fetchStockOverview(shopId: string): Promise<StockOverview> {
  return api.get<StockOverview>('/api/distribution/stock-overview/', { shop_id: shopId });
}

export async function fetchRetailerOutstanding(shopId: string): Promise<RetailerOutstandingRow[]> {
  const data = await api.get<{ retailers: RetailerOutstandingRow[] }>('/api/distribution/outstanding/', {
    shop_id: shopId,
  });
  return data.retailers;
}

/* ==========================================================================
 * Owner (network) summary — cross-shop analytics for the enterprise Owner.
 * The Owner is the control/management layer: one request answers "how is my
 * entire business performing?" with combined totals, per-retailer
 * comparison, daily trend and live bill activity. `shopId = null` asks for
 * the consolidated All Retailers view; a shop id drills down to one retailer.
 * ========================================================================== */

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

export async function fetchOwnerSummary(from: string, to: string, shopId: string | null): Promise<OwnerSummary> {
  return api.get<OwnerSummary>('/api/sales/owner-summary/', {
    from,
    to,
    ...(shopId ? { shop_id: shopId } : {}),
  });
}

/* ==========================================================================
 * Multi-shop owner: retailer shop + its own login creation
 * ========================================================================== */

/** Owner-side credential reset for an existing retailer shop login.
 *  Shop creation stays developer-only; this is the one owner action. */
export async function resetShopLogin(shopId: string, newPassword: string): Promise<{ ok: boolean; login_email: string }> {
  return api.post(`/api/console/shops/${shopId}/reset-login/`, { new_password: newPassword });
}

export interface RetailerShopCreateResult {
  shop: { id: string; name: string; code: string; phone: string; address: string; gstin: string };
  login: { id: string; email: string; name: string };
}

export async function createRetailerShop(
  tenantId: string,
  input: {
    name?: string;
    code?: string;
    phone?: string;
    address?: string;
    gstin?: string;
    owner_name: string;
    owner_email: string;
    owner_password: string;
    existing_shop_id?: string;
  },
): Promise<RetailerShopCreateResult> {
  return api.post(`/api/console/tenants/${tenantId}/retailer-shops/`, {
    name: input.name ?? '',
    code: input.code ?? '',
    phone: input.phone ?? '',
    address: input.address ?? '',
    gstin: input.gstin ?? '',
    owner_name: input.owner_name,
    owner_email: input.owner_email,
    owner_password: input.owner_password,
    existing_shop_id: input.existing_shop_id ?? null,
  });
}

/* ==========================================================================
 * Account-synced user preferences (GET/PATCH /api/auth/prefs/)
 * ========================================================================== */

export interface UserPrefsPayload {
  data: Record<string, unknown>;
  version: number;
  updated_at: string;
}

export async function fetchUserPrefs(): Promise<UserPrefsPayload> {
  return api.get<UserPrefsPayload>('/api/auth/prefs/');
}

/** QZ Tray trust: the public signing certificate and per-request signatures (server holds the private key). */
export async function fetchQzCertificate(): Promise<string> {
  return (await api.get<{ certificate: string }>('/api/print/qz/certificate/')).certificate;
}

export async function signQzRequest(request: string): Promise<string> {
  return (await api.post<{ signature: string }>('/api/print/qz/sign/', { request })).signature;
}

export async function patchUserPrefs(data: Record<string, unknown>): Promise<UserPrefsPayload> {
  return api.patch<UserPrefsPayload>('/api/auth/prefs/', { data });
}

/* ==========================================================================
 * Sheet register & audit API
 * ========================================================================== */

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

/** Bucket totals shared by registers, size groups and the virtual All register. */
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

/** A row of the virtual `All` register: one merged row per brand across every
 *  register, carrying the distinct contributing category names. */
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

/** One expense voucher head inside the window's audit block. */
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

/** Either the single-day `date` form or an inclusive `{ from, to }` range
 *  (max 92 business days, `to` defaults to `from` server-side). */
export interface SheetQuery {
  date?: string;
  from?: string;
  to?: string;
}

/** `getSheet(shopId, '2026-09-17')` stays the single-day call. Pass
 *  `{ from, to }` for a range read; the response additively carries
 *  `all_register` plus `meta.from/to/days_total/days_sealed/all_sealed`
 *  in both forms. */
export async function getSheet(shopId: string, query: string | SheetQuery): Promise<SheetResponse> {
  if (typeof query === 'string') {
    return api.get<SheetResponse>('/api/sheet/', { shop_id: shopId, date: query });
  }
  return api.get<SheetResponse>('/api/sheet/', {
    shop_id: shopId,
    date: query.date,
    from: query.from,
    to: query.to,
  });
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

export async function getShopExperience(shopId: string): Promise<ShopExperienceResponse> {
  return api.get<ShopExperienceResponse>(`/api/console/shops/${shopId}/experience/`);
}

export async function putShopExperience(
  shopId: string,
  payload: ShopExperienceUpdatePayload,
  version: number
): Promise<{ status: string; experience: ShopExperienceData }> {
  return api.put<{ status: string; experience: ShopExperienceData }>(
    `/api/console/shops/${shopId}/experience/`,
    payload,
    {
      headers: {
        'If-Match': `"${version}"`,
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Product library (Dev Console -> Library). Reference data only; a shop's own
// products, stock and prices are never touched by these calls.
// ---------------------------------------------------------------------------

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

export async function getLibraries(library?: string): Promise<LibraryListResponse> {
  return api.get<LibraryListResponse>('/api/console/libraries/', library ? { library } : undefined);
}

export interface LibraryProductPage {
  total: number;
  offset: number;
  limit: number;
  products: LibraryProductRow[];
}

export async function listLibraryProducts(
  key: string,
  params: {
    search?: string;
    category?: string;
    parent?: string;
    review?: string;
    unit_kind?: 'ml' | 'pieces';
    offset?: number;
    limit?: number;
  } = {}
): Promise<LibraryProductPage> {
  return api.get<LibraryProductPage>(`/api/console/libraries/${key}/products/`, params as any);
}

export type LibraryProductPatch = Omit<Partial<LibraryProductRow>, 'parent_id'> & {
  parent_id?: string | null
}

export async function createLibraryProduct(
  key: string,
  body: LibraryProductPatch & { name: string }
): Promise<LibraryProductRow> {
  return api.post<LibraryProductRow>(`/api/console/libraries/${key}/products/`, body);
}

export async function updateLibraryProduct(
  key: string,
  id: string,
  patch: LibraryProductPatch
): Promise<LibraryProductRow> {
  return api.patch<LibraryProductRow>(`/api/console/libraries/${key}/products/${id}/`, patch);
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

export async function bulkUpdateLibraryProducts(
  key: string,
  payload: LibraryBulkProductUpdatePayload
): Promise<LibraryBulkProductUpdateResponse> {
  return api.post<LibraryBulkProductUpdateResponse>(`/api/console/libraries/${key}/products/bulk/`, payload);
}

export async function deleteLibraryProduct(key: string, id: string): Promise<void> {
  await api.delete(`/api/console/libraries/${key}/products/${id}/`);
}

export async function createLibraryParent(
  key: string,
  body: Partial<LibraryParentRow>
): Promise<LibraryParentRow> {
  return api.post<LibraryParentRow>(`/api/console/libraries/${key}/parents/`, body);
}

export async function updateLibraryParent(
  key: string,
  id: string,
  patch: Partial<LibraryParentRow>
): Promise<LibraryParentRow> {
  return api.patch<LibraryParentRow>(`/api/console/libraries/${key}/parents/${id}/`, patch);
}

export async function deleteLibraryParent(key: string, id: string): Promise<void> {
  await api.delete(`/api/console/libraries/${key}/parents/${id}/`);
}

export interface LibraryOptionsPatch {
  category_options?: string[];
  unit_options?: string[];
}

/**
 * PATCH the managed option lists for a library. Removing an option that
 * products still use is rejected by the server (409 `{error}`).
 */
export async function updateLibraryOptions(
  key: string,
  patch: LibraryOptionsPatch
): Promise<LibrarySummary> {
  return api.patch<LibrarySummary>(`/api/console/libraries/${key}/options/`, patch);
}


// --- Group C: concurrent session management ---------------------------------

export interface ActiveSession {
  sid: string;
  kind: string;
  platform: string;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export async function fetchActiveSessions(): Promise<{ sessions: ActiveSession[]; limit: number }> {
  return api.get<{ sessions: ActiveSession[]; limit: number }>('/api/auth/sessions/');
}

export async function revokeSession(sid: string): Promise<void> {
  await api.post(`/api/auth/sessions/${encodeURIComponent(sid)}/revoke/`);
}

export async function logoutAllSessions(): Promise<{ revoked: number }> {
  return api.post<{ revoked: number }>('/api/auth/sessions/logout-all/');
}

// --- Group D: developer impersonation ("Login as User") ---------------------

export interface ImpersonationPayload {
  access: string;
  refresh?: string;
  expires_in: number;
  user: { id: string; email: string; name: string };
  shop: { id: string; name: string };
}

export async function startImpersonation(userId: string, shopId?: string): Promise<ImpersonationPayload> {
  return api.post<ImpersonationPayload>(
    '/api/console/impersonate/',
    shopId ? { user_id: userId, shop_id: shopId } : { user_id: userId }
  );
}

export async function endImpersonation(body: { target_user?: string; target_name?: string }): Promise<void> {
  await api.post('/api/console/impersonate/end/', body);
}


