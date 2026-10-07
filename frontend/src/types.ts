export type ID = string

export type AccountType = 'Customer' | 'Supplier' | 'Employee' | 'Retailer'

export interface Account {
  id: ID
  code: string
  name: string
  type: AccountType
  phone: string
  opening: number
  balance: number
  active: boolean
  createdAt?: number
}

export interface Product {
  id: ID
  code: string
  barcode: string
  name: string
  brand?: string
  category: string
  unit: string
  mrp: number
  rate: number
  piecesPerBox: number
  godownPcs: number
  counterPcs: number
  lowLevel: number
  /** Units sold all-time: write-time counter, lets the POS rank "popular"
   *  quick-add items without subscribing to the whole sales ledger. */
  soldCount?: number
  isKitchen?: boolean
  createdAt?: number
}

export type PayStatus = 'Paid' | 'Partial' | 'Unpaid'
export type PayMethod = 'Cash' | 'UPI'

export interface PurchaseItem {
  productId: ID | null
  name: string
  qty: number
  rate: number
}

export interface Purchase {
  id: ID
  billNo: string
  date: number
  supplierId: ID | null
  supplierName: string
  /** Supplier account code (e.g. MAIN-GODOWN) — the structural marker that a
   *  purchase originated from an owner distribution. */
  supplierCode?: string | null
  items: PurchaseItem[]
  itemCount: number
  totalQty: number
  amount: number
  paidAmount: number
  status: PayStatus
  notes?: string
  createdAt?: number
}

/** One human-readable before → after line in a purchase edit's audit trail. */
export interface PurchaseChangeLine {
  label: string
  before: string
  after: string
}

/** An immutable record of one edit to a purchase bill. Written in the same
 *  transaction that updates the bill, so the audit trail can never drift from
 *  the bill it describes. `changes` is the rendered diff; `before`/`after`
 *  carry the full snapshots for a detail view. */
export interface PurchaseChange {
  id: ID
  purchaseId: ID
  billNo: string
  editedAt: number
  editedBy: string
  before: { amount: number; totalQty: number; supplierName: string; items: PurchaseItem[] }
  after: { amount: number; totalQty: number; supplierName: string; items: PurchaseItem[] }
  changes: PurchaseChangeLine[]
  createdAt?: number
}

export interface SaleItem {
  productId: ID | null
  name: string
  unit: string
  qty: number
  rate: number
}

export interface Sale {
  id: ID
  billNo: string
  date: number
  customerName: string
  items: SaleItem[]
  subtotal: number
  discount: number
  gstSlab: number
  gstAmount: number
  /** Service tip added on top of tax, restaurant/bar bills only. */
  tip?: number
  /** Display label of the floor table the bill was rung against. */
  tableLabel?: string
  total: number
  paidAmount?: number
  status?: PayStatus
  method: PayMethod
  staffName: string
  createdAt?: number
}

export interface PaymentVoucher {
  id: ID
  voucherNo: string
  date: number
  paidTo: string
  mode: PayMethod
  ref: string
  amount: number
  status: 'Cleared' | 'Pending'
  /** Set when the voucher is linked to a supplier/customer ledger account,
   *  settlePaymentVoucher uses it to apply the ledger move on clearing. */
  accountId?: string | null
  createdAt?: number
}

export type IncExpType = 'Income' | 'Expense'

export interface IncExp {
  id: ID
  voucherNo: string
  date: number
  head: string
  type: IncExpType
  narration: string
  amount: number
  createdAt?: number
}

export type Coll = 'accounts' | 'products' | 'purchases' | 'sales' | 'payments' | 'incexp' | 'transfers' | 'purchaseedits' | 'tabs'

// ---------------- Restaurant floor tables ----------------

/** How table cells are named on the floor grid. 'grid' = row letter + seat
 *  number (A1, A2, B1…), 'custom' = prefix + running number (BAR-1…). */
export type TablePattern = 'numeric' | 'letters' | 'grid' | 'custom'

export interface TablesConfig {
  enabled: boolean
  /** Service-tip selector on checkout (independent of the floor grid). */
  tips: boolean
  rows: number
  cols: number
  pattern: TablePattern
  prefix: string
}

/** One open tab parked on a floor table, the running order between ringing
 *  items and settling the bill. Doc id = the table's label id, so a second
 *  device (or the next shift) sees exactly the same open tabs live. */
export interface TableTab {
  id: ID
  label: string
  items: SaleItem[]
  customerName: string
  gstSlab: number
  couponCode: string
  tipPct: number
  /** Custom-₹ tip state parked with the tab (vs the % chip selector). */
  useCustomTip?: boolean
  customTip?: number
  openedAt: number
  openedBy: string
  updatedAt: number
}

export type AccountRole = 'supplier' | 'retailer' | 'employee'
export type AccountStatus = 'active' | 'suspended'

export interface StatusEvent {
  status: AccountStatus
  at: number
  by: string
  reason?: string
}

// One global doc per provisioned account, the single source of truth for who
// may sign in, what kind of account they are, and whether access is active.
// Accounts are never deleted; suspension flips status and appends history.
export interface AccountRecord {
  id?: ID
  uid: string
  name: string
  email: string
  role: AccountRole
  status: AccountStatus
  /** Employees only: the uid of the retailer workspace they belong to. */
  workspace?: string
  createdAt?: number
  statusChangedAt?: number
  statusChangedBy?: string
  reason?: string
  history?: StatusEvent[]
}

// ---------------- Staff (employee) access control ----------------

/** Modules a staff member can be granted. 'rates' is a field-level flag:
 *  without it, cost rates ("Sales Rate") never reach the device, they live in
 *  a rules-protected doc, not just hidden columns. */
export type PermKey =
  | 'dashboard' | 'sales' | 'accounts' | 'products'
  | 'purchases' | 'stock' | 'daybook' | 'cashflow' | 'reports' | 'rates'

export const PERMS: { key: PermKey; label: string; hint: string }[] = [
  { key: 'dashboard', label: 'Dashboard', hint: "Today's numbers and quick actions" },
  { key: 'sales', label: 'Sales counter', hint: 'Billing at POS. Includes customer ledger access for khata bills' },
  { key: 'accounts', label: 'Accounts & ledgers', hint: 'Customer/supplier balances and history' },
  { key: 'products', label: 'Products', hint: 'Catalogue management' },
  { key: 'purchases', label: 'Purchases', hint: 'Supplier bills and stock intake' },
  { key: 'stock', label: 'Stock & transfers', hint: 'Godown ⇄ counter movement' },
  { key: 'daybook', label: 'Day book', hint: 'Open & close the counter. Cash entries only, no sales figures' },
  { key: 'cashflow', label: 'Cash flow', hint: 'Payments, income & expense vouchers' },
  { key: 'reports', label: 'Calendar & analytics', hint: 'Day calendar, day reports and CSV exports' },
  { key: 'rates', label: 'See "Sales Rate"', hint: 'Cost prices, enforced in the database and not just hidden on screen' },
]

export type MemberRole = 'Cashier' | 'Stockkeeper' | 'Manager' | 'Custom'

/** Permission presets shown in the Team drawer. */
export const MEMBER_PRESETS: Record<Exclude<MemberRole, 'Custom'>, PermKey[]> = {
  Cashier: ['dashboard', 'sales', 'daybook'],
  Stockkeeper: ['stock'],
  Manager: ['dashboard', 'sales', 'accounts', 'products', 'purchases', 'stock', 'daybook', 'cashflow', 'reports', 'rates'],
}

/** Perms that imply seeing rupee amounts (tiles, MRP/value columns, CSV money).
 *  A member holding NONE of these, e.g. a Stockkeeper, gets every money
 *  surface hidden: stock pages show pieces and transfers only. */
export const MONEY_PERMS: PermKey[] = [
  'dashboard', 'sales', 'accounts', 'purchases', 'cashflow', 'reports', 'rates',
]

/** Narrower: perms that imply seeing INVENTORY VALUATION (stock value tiles,
 *  per-row stock ₹, value-by-location). Billing prices at the counter are one
 *  thing: what the whole inventory is worth is owner/manager insight, so
 *  'sales' and 'dashboard' deliberately do NOT unlock it. */
export const VALUATION_PERMS: PermKey[] = [
  'accounts', 'purchases', 'cashflow', 'reports', 'rates',
]

/** One doc per staff login under workspaces/{ownerUid}/members/{uid}. */
export interface Member {
  id?: ID
  uid: string
  name: string
  email: string
  role: MemberRole
  perms: PermKey[]
  status: AccountStatus
  createdAt?: number
  createdBy?: string
  statusChangedAt?: number
  statusChangedBy?: string
}

export interface Transfer {
  id: ID
  productId: ID | null
  /** Human label: product name for moves, supplier/customer for in/out rows. */
  productName: string
  from: string
  to: string
  qty: number
  date: number
  /** Movement kind: legacy rows without one are godown⇄counter moves. */
  kind?: 'in' | 'move' | 'out'
  /** Source document reference (INV-xxxx / PUR-xxxx). */
  ref?: string
  createdAt?: number
}

export interface AppMeta {
  units: string[]
  categories: string[]
  /** Floor-plan configuration (Settings → Tables): workspace-wide. */
  tables?: TablesConfig
}

/**
 * Sales summary from GET /api/sales/summary/: server-computed SQL aggregates
 * over the authoritative ledger (voids excluded). Keys are local-time
 * ('YYYY-MM-DD' / 'YYYY-MM') in Asia/Kolkata; a mismatched dayKey/monthKey
 * means the window rolled over and the client must fall back to its list math.
 * Money arrives as strings (DRF Decimal rendering).
 */
export interface SalesSummary {
  dayKey: string
  todayTotal: string
  todayBills: number
  cashToday: string
  upiToday: string
  billsCount: number
  monthKey: string
  monthTotal: string
  monthBills: number
  weekKey: string
  weekTotal: string
  weekBills: number
  /** 7 entries, oldest → today, each a Kolkata day. */
  weekDaily: { date: string; total: string; bills: number }[]
  monthCash: string
  monthUpi: string
  /** T5 server-side rollups (money arrives as strings; profit fields are
   *  omitted by the server for sessions without valuation rights). */
  yestTotal?: string
  yestBills?: number
  todayIncome?: string
  todayExpense?: string
  todayPaid?: string
  pendingOut?: string
  monthPurchases?: string
  monthPaid?: string
  monthExpenses?: string
  todayNetProfit?: string
  monthNetProfit?: string
  kitchenTodaySales?: string
  kitchenTodayCount?: number
  kitchenTodayBills?: number
  retailTodaySales?: string
}

/**
 * Server-computed report aggregates from GET /api/sales/reports-summary/ over
 * a Kolkata-day [from, to) range. For sessions without valuation rights the
 * server omits the money-sensitive fields (totals.grossProfit/netProfit,
 * pnl.cogs/netProfit), the UI must tolerate their absence.
 */
export interface ReportsSummary {
  from: string
  to: string
  totals: {
    sales: string
    returns_total?: string
    net_sales?: string
    purchases: string
    expenses: string
    income?: string
    grossProfit?: string
    netProfit?: string
    /** Every cleared payment voucher (suppliers, staff, anyone): counted as a cost in profit. */
    paymentsOut?: string
    /** Profit cost basis: MRP value of the goods sold (ex-GST). */
    mrpValue?: string
    itemsSold?: number
    discounts: string
    gst: string
    kitchenSales?: string
    retailSales?: string
  }
  kitchen?: {
    sales: string
    count: number
    topProducts: { name: string; quantity: number; amount: string }[]
  }
  retail?: {
    sales: string
    count: number
  }
  categoryMix: { name: string; amount: string; count: number }[]
  topProducts: { name: string; quantity: number; amount: string }[]
  paymentMix: { method: string; amount: string; count: number }[]
  pnl: { sales: string; cogs?: string; income?: string; expenses: string; netProfit?: string }
}

/**
 * One page of the monotonic change_id delta sync from GET /api/sync/.
 * `cursor` is the highest change_id this page fully covers; `has_more` means
 * further pages exist beyond the per-table page cap (client pages until false).
 */
export interface SyncDelta {
  cursor: string
  has_more: boolean
  products: any[]
  categories: any[]
  customers: any[]
  /** Authoritative capability/permission version for the active shop
   *  membership; drives live capability refresh (see src/lib/sync.ts). */
  perms_version?: number
}

/** One permanently-locked business day (manual Z-report close). Lives at
 *  workspaces/{uid}/summary/d/{YYYY-MM-DD}. Survives the realtime bill
 *  window, so the calendar keeps full history for every closed day.
 *  Written by a session that could read the day's sales at close time. */
export interface DaySnapshot {
  id: string
  total: number
  bills: number
  cash: number
  cashBills: number
  upi: number
  upiBills: number
  qty: number
  discount: number
  gst: number
  /** Amount by category (product.category → ₹). */
  cats: Record<string, number>
  /** Pieces by category (product.category → pcs), pairs with `cats`. */
  catQty: Record<string, number>
  top: { name: string; qty: number; amt: number }[]
  profit: number
  /** Expense vouchers dated inside this day, net = profit − expenses.
   *  Optional: snapshots locked before expenses were tracked carry none. */
  expenses?: number
  /** Income vouchers dated inside this day, net = profit + income − expenses. */
  income?: number
  mrpValue: number
  toCounter: number
  toGodown: number
  /** Purchase intake pcs that day (kind 'in' movements). */
  addedPcs?: number
  /** Sold pcs that day (kind 'out' movements). */
  soldPcs?: number
  first: number
  last: number
  peakHour: number
  godownPcs: number
  counterPcs: number
  totalPcs: number
  closedAt: number
  closedBy: string
}

/** One staff note in the day-book log, free text, no sums. Timestamped and
 *  attributed so shifts can hand over context ("transferred stock to counter",
 *  "scanner acting up", "customer waiting on an order"). */
export interface DayLogEntry {
  at: number
  by: string
  text: string
}

/** One counter day's sheet (opening/closing cash log + staff notes). Lives at
 *  workspaces/{uid}/daybook/{YYYY-MM-DD}. Deliberately carries NO sales or
 *  profit figures: staff with the 'daybook' perm record drawer cash and
 *  operational notes only, never money totals. */
export interface DayBookEntry {
  id: string
  openedAt: number
  openedBy: string
  openingCash: number
  closedAt?: number
  closedBy?: string
  closingCash?: number
  note?: string
  /** Day-log entries appended through the shift (newest first). */
  log?: DayLogEntry[]
}

export const ACCOUNT_TYPES: AccountType[] = ['Customer', 'Supplier', 'Employee']
export const OWNER_ACCOUNT_TYPES: AccountType[] = ['Customer', 'Supplier', 'Employee', 'Retailer']

export interface OpenBill {
  id: string
  bill_no: string
  date: string
  original_amount: number
  paid_amount: number
  outstanding_amount: number
  status: 'Paid' | 'Partial' | 'Unpaid'
  type: 'sale' | 'purchase'
}

export const GST_SLABS = [0, 5, 12, 18, 28]

export const UNITS = ['PCS', '90 ML', '180 ML', '250 ML', '330 ML', '375 ML', '500 ML', '650 ML', '750 ML', '1 L']

export const DEFAULT_UNITS = UNITS

/**
 * Server-authoritative checkout discount/coupon scheme (Bug B fix, these
 * used to be a hardcoded client-only COUPONS list; the backend now owns the
 * list and the discount math, GET /api/sales/discount-schemes/). `kind`
 * matches the backend's DiscountScheme.kind choices exactly.
 */
export interface DiscountScheme {
  id: ID
  code: string
  label: string
  kind: 'percentage' | 'flat'
  value: number
}
