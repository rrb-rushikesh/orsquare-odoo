import type { InvoicePrefs } from './prefs'
import type { DocModel } from './printing/layout'
import type { PrintSettings } from './printing/presets'
import { dt, tm } from './utils'

export interface ReceiptLine {
  name: string
  unit?: string
  qty: number
  rate: number
}

export interface ReceiptData {
  nativeOrderId?: number;
  billNo: string | number
  date: number
  customerName: string
  /** Payment mode: optional (provisional open-bill prints carry none until one is selected). */
  method?: string
  staffName?: string
  station?: string
  items: ReceiptLine[]
  subtotal: number
  discount: number
  couponCode?: string
  gstSlab: number
  gstAmount: number
  tip?: number
  tableLabel?: string
  total: number
  /** Unpaid open-cart print: banners "PROVISIONAL: NOT PAID" and omits paid messaging. */
  provisional?: boolean
  /** F6 print variant: reframes the receipt as a CREDIT NOTE / EXCHANGE NOTE
   *  issued against an original bill. `total` stays the returned (credit)
   *  amount; the negative sign is applied by the renderer. */
  creditNote?: {
    kind: 'return' | 'exchange'
    originalBillNo: string
    replacementBillNo?: string
    /** Exchange: the replacement bill's new-items total, net = this − total. */
    replacementTotal?: number
  }
}

/** Minimal structural view of a persisted sale (see PSale in repo.ts) so the
 *  receipt builder stays decoupled from the API layer. */
export interface SaleReceiptSource {
  id?: string;
  billNo: string | number
  date: string | number
  customerName: string
  tableLabel?: string
  subtotal: number
  discount: number
  couponCode?: string
  gstSlab?: number
  gstAmount: number
  tip?: number
  total: number
  method?: string
  items?: { productName: string; unit?: string; qty: number; rate: number }[]
  payments?: { method: string; amount: number }[]
}

/** Maps a persisted sale onto the receipt renderer's shape, the single code
 *  path shared by every reprint (sales history, reprints, auto-print). */
export function saleToReceipt(s: SaleReceiptSource): ReceiptData {
  const pays = s.payments ?? []
  const method =
    s.method === 'Split' && pays.length > 0
      ? [...new Set(pays.map((p) => p.method))].join(' + ')
      : s.method
  return {
    nativeOrderId: s.id ? Number(s.id) : undefined,
    billNo: s.billNo,
    date: typeof s.date === 'number' ? s.date : new Date(s.date).getTime(),
    customerName: s.customerName,
    tableLabel: s.tableLabel || undefined,
    method: method || undefined,
    items: (s.items ?? []).map((i) => ({ name: i.productName, unit: i.unit || undefined, qty: i.qty, rate: i.rate })),
    subtotal: s.subtotal,
    discount: s.discount,
    couponCode: s.couponCode || undefined,
    gstSlab: s.gstSlab ?? 0,
    gstAmount: s.gstAmount,
    tip: s.tip && s.tip > 0 ? s.tip : undefined,
    total: s.total,
  }
}

// ---- document model adapters ---------------------------------------------
// Formatting (money, dates, labels) happens here; the layout engine only
// places strings. Money is computed once server-side and only formatted here.

const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtMoney = (n: number): string => nf2.format(Number.isFinite(n) ? n : 0)
/** Quantities: integers bare, weights/volumes up to 3 decimals without trailing zeros. */
export const fmtQty = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toFixed(3)))
}
const withCur = (cur: string, n: number) => `${cur ? cur + ' ' : ''}${fmtMoney(n)}`
const signed = (n: number, sign: '-' | '+') => `${sign}${fmtMoney(n)}`

/**
 * The bill number as printed AND as encoded in the barcode. The server already issues "INV-0012"; only a bare
 * number (offline or legacy) gets the configured prefix. Printing prefix + "INV-0012" produced "INV-INV-0012".
 */
export function formatBillNo(prefix: string, billNo: string | number): string {
  const s = String(billNo)
  return /^[0-9]+$/.test(s) ? `${prefix || 'INV-'}${s}` : s
}

/** The default anonymous customer is printed short (saves a line on narrow paper); real names are untouched. */
export function shortCustomer(name: string): string {
  const n = (name || '').trim()
  return !n || /^walk[ -]?in( customer)?$/i.test(n) ? 'Walk-in' : n
}

/**
 * The active shop's own profile (name, phone). Receipts fall back to it for any invoice field the owner left blank,
 * so a bill always carries the shop's real identity and nothing is hardcoded. Set by the app shell on shop change.
 */
export interface ShopIdentity { name: string; phone: string }
let shopIdentity: ShopIdentity = { name: '', phone: '' }
export function setShopIdentity(i: Partial<ShopIdentity> | null): void {
  shopIdentity = { name: (i?.name ?? '').trim(), phone: (i?.phone ?? '').trim() }
}
export const getShopIdentity = (): ShopIdentity => shopIdentity

/** Invoice fields with blanks filled from the shop profile. An explicit value in Settings always wins. */
export function resolveInvoice(inv: InvoicePrefs, id: ShopIdentity = shopIdentity): InvoicePrefs {
  return { ...inv, shopName: inv.shopName.trim() || id.name, phone: inv.phone.trim() || id.phone }
}

export function shopBlock(inv: InvoicePrefs): DocModel['shop'] {
  const r = resolveInvoice(inv)
  return {
    name: r.shopName,
    tagline: r.tagline,
    address: [r.addressLine, r.addressLine2].filter(Boolean),
    phone: r.phone,
    gstin: r.gstin,
  }
}

export function receiptToDoc(inv: InvoicePrefs, r: ReceiptData, s: PrintSettings): DocModel {
  const cn = r.creditNote
  const cur = s.currency
  const billNo = cn ? String(r.billNo) : formatBillNo(inv.prefix, r.billNo)
  const when = s.showTime ? `${dt(r.date)} ${tm(r.date)}` : dt(r.date)
  const meta: [string, string][] = [
    [cn ? 'Note:' : 'Bill:', billNo],
    ['Date:', when],
    ['Cust:', shortCustomer(r.customerName)],
  ]
  if (r.tableLabel) meta.push(['Table:', r.tableLabel])
  if (cn) meta.push(['Orig:', cn.originalBillNo])
  if (cn?.replacementBillNo) meta.push(['New bill:', cn.replacementBillNo])
  if (s.showStaff && r.staffName) meta.push(['By:', r.staffName])
  if (s.showStation && r.station) meta.push(['Stn:', r.station])

  const summary: DocModel['summary'] = []
  let net: DocModel['net']
  if (cn) {
    summary.push({ label: `Returned (${r.items.length})`, value: signed(r.total, '-') })
    if (cn.replacementTotal != null) {
      summary.push({ label: 'New items', value: signed(cn.replacementTotal, '+') })
      const diff = Math.round((cn.replacementTotal - r.total) * 100) / 100
      net = {
        label: diff > 0 ? 'CUSTOMER PAYS' : diff < 0 ? 'SHOP REFUNDS' : 'EVEN SWAP',
        value: withCur(cur, Math.abs(diff)),
      }
    } else {
      net = { label: 'CREDIT', value: `-${withCur(cur, r.total)}` }
    }
  } else {
    summary.push({ label: 'Subtotal', value: fmtMoney(r.subtotal) })
    if (r.discount > 0) {
      summary.push({ label: r.couponCode ? `Coupon ${r.couponCode}` : 'Discount', value: signed(r.discount, '-') })
    }
    if (r.gstSlab > 0) summary.push({ label: `GST ${r.gstSlab}%`, value: fmtMoney(r.gstAmount) })
    if (r.tip && r.tip > 0) summary.push({ label: 'Tip', value: fmtMoney(r.tip) })
    net = { label: r.provisional ? 'TOTAL' : 'NET PAID', value: withCur(cur, r.total) }
  }
  const settle: DocModel['settle'] = r.method ? [{ label: cn ? 'Settlement' : 'Paid by', value: r.method }] : []

  const banner = r.provisional ? 'PROVISIONAL - NOT PAID' : cn ? (cn.kind === 'exchange' ? 'EXCHANGE NOTE' : 'CREDIT NOTE') : undefined
  const qtySum = r.items.reduce((a, i) => a + i.qty, 0)
  return {
    shop: shopBlock(inv),
    banner,
    title: s.receiptTitle || undefined,
    meta,
    items: r.items.map((i) => ({
      name: i.name,
      unit: i.unit,
      qty: fmtQty(i.qty),
      rate: fmtMoney(i.rate),
      amount: fmtMoney(i.qty * i.rate),
    })),
    summary,
    net,
    settle,
    footer: inv.footerNote ? [inv.footerNote] : [],
    code: !cn && !r.provisional ? billNo : undefined,
    cash: !cn && !r.provisional && /cash/i.test(r.method ?? ''),
    itemCount: { lines: r.items.length, qty: fmtQty(qtySum) },
  }
}
