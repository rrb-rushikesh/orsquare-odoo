import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import * as repo from '@/lib/repo'
import type { PProduct, PSale, PSaleItem, PSalePayment, PSaleReturn } from '@/lib/repo'
import { downloadCsv, formatDate, money } from '@/lib/utils'
import { fuzzyMatch } from '@/lib/search'
import { allocatePaise, divRoundHalfUp, fromPaise, gstSplitPaise, toPaise } from '@/lib/money'
import { todayKey } from '@/lib/clock'
import { useCurrentBusinessDate } from '@/lib/businessDay'
import { receiptToDoc, saleToReceipt } from '@/lib/receipt'
import { beginPrint, outcomeMessage } from '@/lib/printing/service'
import { loadPrefs } from '@/lib/prefs'
import type { DiscountScheme } from '@/types'
import { GST_SLABS } from '@/types'
import {
  Btn,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  NumInput,
  Panel,
  SearchField,
  Tag,
  ToolbarSelect,
  useToast,
} from '@/components/ui'
import { DataTable, type DTCol } from '@/components/DataTable'
import { DateRangeFilter, dateRowMatches, useDateRange } from '@/components/DateRangeFilter'
import { searchProducts } from '@/lib/search'
import { IconBoxReturn, IconEdit, IconSheet } from '@/components/icons'

const dayOf = (k: string): string => formatDate(k)

// Bill register columns; the trailing action cell prints the bill and, when
// a return handler is wired (owner), offers Return/Exchange for live bills.
const makeSaleCols = (onPrint: (s: PSale) => void, onReturn?: (s: PSale) => void): DTCol<PSale>[] => [
  {
    key: 'bill',
    label: 'Bill',
    sortValue: (s) => s.billNo,
    render: (s) => (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="cell-main" style={s.isVoid ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
            {s.billNo}
          </span>
          {s.hasAutoTransfer && (
            <Tag kind="purple">FROM GODOWN</Tag>
          )}
        </div>
        {s.correctsSaleId && <span className="cell-sub">corrected copy</span>}
      </>
    ),
  },
  { key: 'date', label: 'Date', sortValue: (s) => s.date, render: (s) => <span className="num td-muted">{dayOf(s.date)}</span> },
  { key: 'cust', label: 'Customer', sortValue: (s) => s.customerName.toLowerCase(), render: (s) => s.customerName },
  {
    // Compact, server-capped product preview. A fixed max-width with ellipsis
    // keeps long product names from distorting the table's column scaling.
    key: 'items',
    label: 'Items',
    hideMobile: true,
    sortValue: (s) => (s.itemsPreview || []).join(' ').toLowerCase(),
    render: (s) => {
      const names = s.itemsPreview || []
      if (!names.length && !s.itemCount) return <span className="td-muted">—</span>
      const extra = (s.itemCount || names.length) - names.length
      return (
        <span className="items-preview" title={names.join(', ')}>
          {names.join(', ')}
          {extra > 0 ? <span className="td-muted"> +{extra} more</span> : null}
        </span>
      )
    },
  },
  { key: 'method', label: 'Method', sortValue: (s) => s.method, render: (s) => <Tag kind={s.method === 'UPI' ? 'blue' : s.method === 'Khata' ? 'amber' : 'gray'}>{s.method}</Tag> },
  {
    key: 'total',
    label: 'Total',
    align: 'right',
    sortValue: (s) => s.total,
    render: (s) => {
      const isKhata = s.method === 'Khata' || (s.payments && s.payments.some((p) => p.method === 'Khata'))
      const hasReturns = (s.returnsTotal ?? 0) > 0
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span className="num" style={{ fontWeight: 600 }}>{money(s.total)}</span>
          {hasReturns && (
            <span className="num" style={{ fontSize: 11, color: 'var(--warn-fg)' }}>
              Ret: −{money(s.returnsTotal!)}
            </span>
          )}
          {isKhata && s.status && s.status !== 'Paid' && (
            <span className="num" style={{ fontSize: 10, color: s.status === 'Partial' ? 'var(--blue)' : 'var(--fin-rec)' }}>
              {s.status === 'Partial' ? `Due: ${money(s.total - (s.paidAmount || 0) - (s.returnsTotal || 0))}` : 'Due'}
            </span>
          )}
        </div>
      )
    },
  },
  { key: 'state', label: 'State', sortValue: (s) => (s.isVoid ? '2' : s.correctsSaleId ? '1' : '0'), render: (s) => (s.isVoid ? <Tag kind="red">Voided</Tag> : s.correctsSaleId ? <Tag kind="amber">Corrected</Tag> : <Tag kind="green">Live</Tag>) },
  {
    key: 'print', label: 'Print', align: 'right', sortValue: () => 0,
    render: (s) => (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
        {onReturn && !s.isVoid && !s.correctsSaleId && (
          <Btn
            variant="ghost"
            className="btn-icon"
            style={{ width: 32, height: 32 }}
            aria-label={`Return or Exchange bill ${s.billNo}`}
            title="Return or Exchange"
            onClick={(e) => { e.stopPropagation(); onReturn(s) }}
          >
            <IconBoxReturn size={14} />
          </Btn>
        )}
        <Btn
          sm
          variant="ghost"
          disabled={s.isVoid}
          aria-label={`Print bill ${s.billNo}`}
          title={s.isVoid ? 'Voided bill — reprint disabled' : `Print bill ${s.billNo}`}
          onClick={(e) => { e.stopPropagation(); onPrint(s) }}
        >
          Print
        </Btn>
      </div>
    ),
  },
]

// Bill-line columns; when a per-product returned-qty map is supplied, each
// qty cell shows a muted "Returned n" sub-line for partially returned items.
// Shows "Discounted" or "Markup" tag when sold rate differs from standard catalog rate.
const makeItemCols = (
  returnedByProduct?: Map<string, number>,
  productsById?: Map<string, PProduct>
): DTCol<PSaleItem>[] => [
  {
    key: 'item',
    label: 'Item',
    sortValue: (it) => it.productName.toLowerCase(),
    render: (it) => {
      const p = productsById?.get(it.productId)
      const stdRate = p ? (p.rate > 0 ? p.rate : p.mrp) : 0
      const isDiscounted = stdRate > 0 && it.rate < stdRate
      const isMarkup = stdRate > 0 && it.rate > stdRate
      return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="cell-main">{it.productName}</span>
            {it.autoTransferredQty && it.autoTransferredQty > 0 ? (
              <Tag kind="purple">{it.autoTransferredQty} from godown</Tag>
            ) : null}
            {isDiscounted && (
              <span title={`Catalog rate: ${money(stdRate)} (disc −${money(stdRate - it.rate)})`}>
                <Tag kind="green">Discounted</Tag>
              </span>
            )}
            {isMarkup && (
              <span title={`Catalog rate: ${money(stdRate)} (markup +${money(it.rate - stdRate)})`}>
                <Tag kind="purple">Markup</Tag>
              </span>
            )}
          </div>
          {it.unit && <span className="cell-sub">{it.unit}</span>}
        </>
      )
    },
  },
  {
    key: 'qty',
    label: 'Qty',
    align: 'right',
    sortValue: (it) => it.qty,
    render: (it) => {
      const n = returnedByProduct?.get(it.productId) ?? 0
      return (
        <>
          <span className="num">{it.qty}</span>
          {n > 0 && <span className="cell-sub">Returned {n}</span>}
        </>
      )
    },
  },
  {
    key: 'rate',
    label: 'Rate',
    align: 'right',
    sortValue: (it) => it.rate,
    render: (it) => {
      const p = productsById?.get(it.productId)
      const stdRate = p ? (p.rate > 0 ? p.rate : p.mrp) : 0
      const diff = stdRate > 0 ? it.rate - stdRate : 0
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span className="num">{money(it.rate)}</span>
          {diff < 0 && (
            <span className="cell-sub" style={{ color: 'var(--semantic-success)', fontSize: 11 }}>
              −{money(Math.abs(diff))}
            </span>
          )}
          {diff > 0 && (
            <span className="cell-sub" style={{ color: 'var(--blue)', fontSize: 11 }}>
              +{money(diff)}
            </span>
          )}
        </div>
      )
    },
  },
  {
    key: 'amount',
    label: 'Amount',
    align: 'right',
    sortValue: (it) => it.qty * it.rate,
    render: (it) => <span className="num" style={{ fontWeight: 600 }}>{money(it.qty * it.rate)}</span>,
  },
]

const NO_COUPON: DiscountScheme = { id: '', code: '', label: 'No coupon', kind: 'percentage', value: 0 }

function CorrectSaleDrawer({
  sale,
  shopId,
  onClose,
  onDone,
}: {
  sale: PSale | null
  shopId: string
  onClose: () => void
  onDone: (corrected: PSale) => void
}) {
  const toast = useToast()
  const d = useData()
  const [reason, setReason] = useState('')
  const [schemes, setSchemes] = useState<DiscountScheme[]>([NO_COUPON])
  const [couponCode, setCouponCode] = useState('')
  const [gstSlab, setGstSlab] = useState(0)
  const [customerName, setCustomerName] = useState('')
  const [lines, setLines] = useState<{ productId: string; productName: string; qty: number; rate: number }[]>([])
  const [payments, setPayments] = useState<PSalePayment[]>([])
  const [busy, setBusy] = useState(false)
  const [prodSearch, setProdSearch] = useState('')
  const [prodOpen, setProdOpen] = useState(false)

  // Hydrate the editable fields from the bill being corrected each time a
  // new bill is opened.
  useEffect(() => {
    if (!sale) return
    setReason('')
    setCouponCode(sale.couponCode ?? '')
    setGstSlab(sale.gstSlab ?? 0)
    setCustomerName(sale.customerName && sale.customerName !== 'WALK IN CUSTOMER' ? sale.customerName : '')
    setLines(
      (sale.items ?? []).map((i) => ({
        productId: i.productId,
        productName: i.productName,
        qty: i.qty,
        rate: i.rate,
      }))
    )
    const fromPayments = sale.payments && sale.payments.length > 0
      ? sale.payments
      : [{ method: (sale.method === 'Split' ? 'Cash' : sale.method) as PSalePayment['method'], amount: sale.total }]
    setPayments(fromPayments.map((p) => ({ method: p.method, amount: p.amount })))
    setProdSearch('')
    setProdOpen(false)
  }, [sale])

  // Coupon scheme for the client-side preview only, the server recomputes
  // the discount authoritatively on submit.
  useEffect(() => {
    if (!shopId) return
    let cancelled = false
    repo
      .listDiscountSchemes(shopId)
      .then((rows) => {
        if (cancelled) return
        setSchemes([
          NO_COUPON,
          ...rows.map((r) => ({ id: r.id, code: r.code, label: r.label, kind: r.kind, value: Number(r.value) })),
        ])
      })
      .catch(() => {
        if (!cancelled) setSchemes([NO_COUPON])
      })
    return () => {
      cancelled = true
    }
  }, [shopId])

  // Preview mirrors the POS register's tax-EXCLUSIVE math exactly (the
  // register submits is_tax_inclusive: false), and uses the same integer-paise
  // round-half-up arithmetic as complete_sale(), so the payment total enforced
  // by the backend is the one shown here.
  const subtotalPaise = lines.reduce((a, l) => a + toPaise(l.qty * l.rate), 0)
  const subtotal = fromPaise(subtotalPaise)
  const coupon = (couponCode ? schemes.find((c) => c.code === couponCode) : undefined) || NO_COUPON
  const discountPaise = useMemo(() => {
    if (!coupon.code || subtotalPaise <= 0) return 0
    if (coupon.kind === 'percentage') {
      const raw = divRoundHalfUp(subtotalPaise * toPaise(coupon.value), 10000)
      return Math.min(raw, subtotalPaise)
    }
    return Math.min(toPaise(coupon.value), subtotalPaise)
  }, [coupon, subtotalPaise])
  const discount = fromPaise(discountPaise)
  const { taxablePaise, gstSumPaise } = useMemo(() => {
    if (subtotalPaise <= 0) return { taxablePaise: 0, gstSumPaise: 0 }
    let allocated = 0
    let taxableSum = 0
    let gstSum = 0
    lines.forEach((l, i) => {
      const lineAmountPaise = toPaise(l.qty * l.rate)
      let lineDiscountPaise = 0
      if (discountPaise > 0) {
        lineDiscountPaise = i === lines.length - 1
          ? discountPaise - allocated
          : allocatePaise(discountPaise, lineAmountPaise, subtotalPaise)
        allocated += lineDiscountPaise
      }
      const lineTaxablePaise = lineAmountPaise - lineDiscountPaise
      taxableSum += lineTaxablePaise
      gstSum += gstSplitPaise(lineTaxablePaise, gstSlab).total
    })
    return { taxablePaise: taxableSum, gstSumPaise: gstSum }
  }, [lines, discountPaise, subtotalPaise, gstSlab])
  const gstAmount = fromPaise(gstSumPaise)

  const tip = sale?.tip ?? 0
  const grandPaise = taxablePaise + gstSumPaise + toPaise(tip)
  const grand = fromPaise(grandPaise)
  const totalPaidPaise = payments.reduce((a, p) => a + toPaise(p.amount), 0)
  const totalPaid = fromPaise(totalPaidPaise)

  async function submit() {
    if (!sale) return
    if (!reason.trim()) return toast('A reason is required to correct a bill.', 'err')
    if (lines.length === 0) return toast('Add at least one line item.', 'err')
    if (totalPaidPaise !== grandPaise) return toast(`Payments (${money(totalPaid)}) must match the bill total (${money(grand)}).`, 'err')
    setBusy(true)
    try {
      const corrected = await repo.correctSale(shopId, sale.id, {
        reason: reason.trim(),
        lines: lines.map((l) => ({ product_id: l.productId, qty: l.qty, rate: l.rate })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
        customer_id: sale.customerId || undefined,
        customer_name: sale.customerId
          ? (customerName.trim() || sale.customerName || '')
          : customerName.trim(),
        coupon_code: coupon.code || undefined,
        gst_slab: gstSlab,
        tip,
        is_tax_inclusive: false,
      })
      window.dispatchEvent(new Event('xpo:sales-total-changed'))
      toast(`Bill ${corrected.billNo} replaced original ${sale.billNo} · ${money(corrected.total)}`)
      onDone(corrected)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Correction failed.', 'err')
    } finally {
      setBusy(false)
    }
  }

  // Product picker for ADDING a line to the corrected bill.
  const prodMatches = useMemo(() => {
    const q = prodSearch.trim()
    if (!q) return []
    return searchProducts(d.products, q, { limit: 8 })
  }, [prodSearch, d.products])

  function addProductLine(p: PProduct) {
    setLines((ls) => [...ls, { productId: p.id, productName: p.name, qty: 1, rate: p.rate > 0 ? p.rate : p.mrp }])
    setProdSearch('')
    setProdOpen(false)
  }

  return (
    <Drawer
      open={!!sale}
      title={sale ? `Correct · ${sale.billNo}` : ''}
      onClose={onClose}
      wide
      footer={
        <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy || !sale}>
            {busy ? 'Posting…' : 'Post corrected bill'}
          </Btn>
        </div>
      }
    >
      {sale && (
        <>
          <p className="t-caption" style={{ marginBottom: 16 }}>
            The original bill is reversed (stock, Khata, ledger) and a fresh corrected bill replaces it. Owner-only action — every change is kept in the ledger.
          </p>

          <Field label="Reason for correction" required>
            <input
              className="field-control"
              placeholder="e.g. Wrong quantity billed, rate changed, item returned…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={255}
            />
          </Field>

          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Discount scheme">
              <select className="field-control" value={couponCode} onChange={(e) => setCouponCode(e.target.value)}>
                {schemes.map((c) => (
                  <option key={c.code || 'none'} value={c.code}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="GST slab (%)">
              <select className="field-control num" value={gstSlab} onChange={(e) => setGstSlab(Number(e.target.value))}>
                {GST_SLABS.map((sl) => (
                  <option key={sl} value={sl}>{sl === 0 ? '0 · GST exempt' : `${sl}%`}</option>
                ))}
              </select>
            </Field>
            <Field label={sale.customerId ? 'Customer (Khata-linked — account cannot change)' : 'Customer name'}>
              {sale.customerId ? (
                <input className="field-control" value={customerName} disabled readOnly />
              ) : (
                <input
                  className="field-control"
                  placeholder="WALK IN CUSTOMER"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  maxLength={120}
                />
              )}
            </Field>
          </div>

          <div style={{ marginTop: 12 }}>
            <Panel title="Items" bodyPad>
              <div className="kv-list">
                {lines.map((l, i) => (
                  <div key={`${l.productId}-${i}`} className="kv-row" style={{ alignItems: 'center', gap: 10 }}>
                    <span className="kv-key" style={{ flex: 1 }}>{l.productName}</span>
                    <NumInput
                      className="field-control num"
                      style={{ width: 72, textAlign: 'right' }}
                      aria-label={`Quantity for ${l.productName}`}
                      value={l.qty}
                      onChange={(n) => setLines(lines.map((x, xi) => (xi === i ? { ...x, qty: Math.max(0, n) } : x)))}
                    />
                    <span className="t-caption">×</span>
                    <NumInput
                      className="field-control num"
                      style={{ width: 100, textAlign: 'right' }}
                      aria-label={`Rate for ${l.productName}`}
                      value={l.rate}
                      onChange={(n) => setLines(lines.map((x, xi) => (xi === i ? { ...x, rate: Math.max(0, n) } : x)))}
                    />
                    <span className="kv-val num" style={{ width: 90, textAlign: 'right' }}>{money(l.qty * l.rate)}</span>
                    <button
                      className="icon-btn"
                      style={{ width: 28, height: 28 }}
                      aria-label={`Remove ${l.productName}`}
                      onClick={() => setLines(lines.filter((_, xi) => xi !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {lines.length === 0 && <p className="t-caption">No items — add one below.</p>}
              </div>
              <div className="search-box sug-anchor" style={{ marginTop: 10 }}>
                <input
                  className="field-control"
                  placeholder="+ Add item — type to search a product…"
                  aria-label="Search product to add"
                  value={prodSearch}
                  onChange={(e) => { setProdSearch(e.target.value); setProdOpen(true) }}
                  onFocus={() => setProdOpen(true)}
                  onBlur={() => setTimeout(() => setProdOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && prodMatches[0]) addProductLine(prodMatches[0])
                  }}
                />
                {prodOpen && prodMatches.length > 0 && (
                  <div className="menu-pop sug">
                    {prodMatches.map((p) => (
                      <button key={p.id} className="menu-item" onMouseDown={() => addProductLine(p)}>
                        <span className="sug-name">{p.name}</span>
                        <span className="t-caption num">{money(p.rate > 0 ? p.rate : p.mrp)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          </div>

          <div style={{ marginTop: 12 }}>
            <Panel title="Payments" bodyPad>
              <div className="kv-list">
                {payments.map((p, i) => (
                  <div key={`pay-${i}`} className="kv-row" style={{ alignItems: 'center', gap: 10 }}>
                    <select
                      className="field-control"
                      style={{ width: 120 }}
                      aria-label={`Method for payment ${i + 1}`}
                      value={p.method}
                      onChange={(e) => setPayments(payments.map((x, xi) => (xi === i ? { ...x, method: e.target.value as PSalePayment['method'] } : x)))}
                    >
                      <option value="Cash">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="Khata">Khata</option>
                    </select>
                    <NumInput
                      className="field-control num"
                      style={{ flex: 1, textAlign: 'right' }}
                      aria-label={`Amount for payment ${i + 1}`}
                      value={p.amount}
                      onChange={(n) => setPayments(payments.map((x, xi) => (xi === i ? { ...x, amount: Math.max(0, n) } : x)))}
                    />
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="kv-list inv-totals" style={{ marginTop: 12 }}>
            <div className="kv-row">
              <span className="kv-key">Subtotal</span>
              <span className="kv-val num">{money(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="kv-row">
                <span className="kv-key">Discount {coupon.code ? `(${coupon.code})` : ''}</span>
                <span className="kv-val num neg">− {money(discount)}</span>
              </div>
            )}
            {gstAmount > 0 && (
              <div className="kv-row">
                <span className="kv-key">GST</span>
                <span className="kv-val num">{money(gstAmount)}</span>
              </div>
            )}
            {tip > 0 && (
              <div className="kv-row">
                <span className="kv-key">Service tip</span>
                <span className="kv-val num">{money(tip)}</span>
              </div>
            )}
            <div className="kv-row inv-grand">
              <span className="kv-key">Total</span>
              <span className="kv-val num">{money(grand)}</span>
            </div>
            <div className={`kv-row ${totalPaidPaise === grandPaise ? '' : 'pay-mismatch'}`}>
              <span className="kv-key">Paid</span>
              <span className="kv-val num" style={totalPaidPaise === grandPaise ? undefined : { color: 'var(--err)' }}>{money(totalPaid)}</span>
            </div>
          </div>
        </>
      )}
    </Drawer>
  )
}

/**
 * Sales history register: the bill-by-bill record (relocated from Reports).
 * Self-contained filters, sorting, CSV export, per-row print, and the bill
 * detail drawer with the owner-only correct/void editors.
 *
 * Role rules: employees (seesMoney === false) get the same table and a
 * strictly read-only drawer, never a CSV export, and no money aggregates.
 */
export function SalesHistoryRegister({
  onReturnBill,
  showCsv,
  defaultRange = 'all',
}: {
  onReturnBill?: (sale: PSale) => void
  showCsv: boolean
  defaultRange?: 'today' | 'all'
}) {
  const d = useData()
  const { activeShop, seesMoney, isOwner } = useAuth()
  const toast = useToast()
  const shopId = activeShop?.id ?? ''
  const productsById = useMemo(() => new Map(d.products.map((p) => [p.id, p])), [d.products])

  const [salesMethod, setSalesMethod] = useState('all')
  const [salesState, setSalesState] = useState('all')
  const [saleQuery, setSaleQuery] = useState('')
  const [serverSales, setServerSales] = useState<PSale[] | null>(null)
  // "Today" is anchored on the shop's CURRENT BUSINESS date, not the calendar
  // date: rows are bucketed by the server's `business_date`, and between
  // midnight and the shop's lock-in (default 02:00) the current business day
  // is still the previous calendar date. A calendar anchor silently dropped
  // every bill of the open business day in that window (regression: bills
  // created "today" missing from Today, forcing All time).
  const todayBiz = useCurrentBusinessDate(activeShop?.lockInTime)
  const [salesDate, setSalesDate, salesDateRange] = useDateRange(defaultRange === 'today' ? 'today' : 'all', todayBiz)

  // Dashboard drill-down: honour ?range=today|custom&from&to&day so clicking a
  // metric opens the register already scoped to the period that produced it.
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const range = searchParams.get('range')
    const day = searchParams.get('day')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (range === 'today') {
      const d = day || todayKey()
      setSalesDate({ mode: 'today', from: d, to: d })
    } else if (range === 'custom' && from && to) {
      setSalesDate({ mode: 'custom', from, to })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  const [viewing, setViewing] = useState<PSale | null>(null)
  const [viewingFull, setViewingFull] = useState<PSale | null>(null)
  const viewingRef = useRef<PSale | null>(null)
  viewingRef.current = viewing
  const [viewReturns, setViewReturns] = useState<PSaleReturn[] | null>(null)
  const [correcting, setCorrecting] = useState<PSale | null>(null)
  const [voiding, setVoiding] = useState<PSale | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidBusy, setVoidBusy] = useState(false)

  const salesSorted = useMemo(
    () => [...(serverSales ?? d.sales)].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')),
    [serverSales, d.sales]
  )

  // Server-side search & date-scoped loading:
  useEffect(() => {
    if (!shopId) return
    let alive = true
    const q = saleQuery.trim()
    const from = salesDateRange.from || undefined
    const to = salesDateRange.to || undefined
    const t = window.setTimeout(() => {
      repo
        .listSales(shopId, { from, to, search: q || undefined, limit: 1000 })
        .then((rows) => { if (alive) setServerSales(rows) })
        .catch(() => { if (alive) setServerSales(null) })
    }, 250)
    return () => { alive = false; window.clearTimeout(t) }
  }, [shopId, saleQuery, salesDateRange.from, salesDateRange.to, d.sales])

  const filteredSales = useMemo(() => salesSorted.filter((s) => {
    const saleDateKey = s.businessDate || s.date
    if (!dateRowMatches(saleDateKey, salesDateRange.from, salesDateRange.to)) return false
    if (salesMethod !== 'all' && s.method !== salesMethod) return false
    if (salesState === 'godown' && !s.hasAutoTransfer) return false
    if (salesState === 'voided' && !s.isVoid) return false
    if (salesState === 'corrected' && (!s.correctsSaleId || s.isVoid)) return false
    if (salesState === 'live' && s.isVoid) return false
    const q = saleQuery.trim().toLowerCase()
    if (q) {
      const hay = [s.billNo, s.customerName, s.method, ...(s.itemsPreview || [])].join(' ').toLowerCase()
      if (serverSales) {
        // Server already matched by product/bill/party across all rows; still
        // verify so an unrelated row can never slip through the merge.
        if (!hay.includes(q) && !fuzzyMatch([hay], q)) return false
      } else if (!fuzzyMatch([hay], q)) {
        return false
      }
    }
    return true
  }), [salesSorted, salesMethod, salesState, salesDateRange, saleQuery, serverSales])

  const salesSummary = useMemo(() => {
    let totalSalesPaise = 0
    let returnsPaise = 0
    let liveCount = 0
    let voidCount = 0
    let cashPaise = 0
    let upiPaise = 0
    let khataPaise = 0
    let otherPaise = 0

    for (const s of filteredSales) {
      if (s.isVoid) {
        voidCount++
        continue
      }
      liveCount++
      const billTotalPaise = toPaise(s.total)
      totalSalesPaise += billTotalPaise
      if (s.returnsTotal && s.returnsTotal > 0) {
        returnsPaise += toPaise(s.returnsTotal)
      }

      if (s.payments && s.payments.length > 0) {
        for (const p of s.payments) {
          const pAmtPaise = toPaise(p.amount)
          if (p.method === 'Cash') cashPaise += pAmtPaise
          else if (p.method === 'UPI') upiPaise += pAmtPaise
          else if (p.method === 'Khata') khataPaise += pAmtPaise
          else otherPaise += pAmtPaise
        }
      } else {
        if (s.method === 'Cash') cashPaise += billTotalPaise
        else if (s.method === 'UPI') upiPaise += billTotalPaise
        else if (s.method === 'Khata') khataPaise += billTotalPaise
        else otherPaise += billTotalPaise
      }
    }

    const netSalesPaise = Math.max(0, totalSalesPaise - returnsPaise)

    return {
      totalSales: fromPaise(totalSalesPaise),
      returnsTotal: fromPaise(returnsPaise),
      netSales: fromPaise(netSalesPaise),
      liveCount,
      voidCount,
      totalCount: filteredSales.length,
      cashSum: fromPaise(cashPaise),
      upiSum: fromPaise(upiPaise),
      khataSum: fromPaise(khataPaise),
      otherSum: fromPaise(otherPaise),
    }
  }, [filteredSales])

  function exportSalesCsv() {
    downloadCsv(
      `sales-history-${todayKey()}.csv`,
      filteredSales.map((s) => ({
        Bill: `${s.billNo}`,
        Date: s.date,
        Customer: s.customerName,
        Discount: s.discount,
        GST: s.gstAmount,
        Tip: s.tip,
        Total: s.total,
        Method: s.method,
        'From Godown': s.hasAutoTransfer ? 'Yes' : 'No',
      }))
    )
  }

  async function openSale(s: PSale) {
    setViewing(s)
    setViewingFull(null)
    if (s.items && s.items.length > 0) {
      setViewingFull(s)
      return
    }
    const saleId = s.id
    try {
      const full = await repo.getSale(shopId, saleId)
      if (viewingRef.current?.id === saleId) setViewingFull(full)
    } catch {
      /* header-only view */
    }
  }

  // One fetch per drawer open: existing returns against the viewed bill, for
  // the per-line "Returned n" subs and the "Returned X of Y pcs" caption.
  // Failures render nothing (empty map).
  useEffect(() => {
    setViewReturns(null)
    if (!viewing || !shopId) return
    let cancelled = false
    repo
      .listSaleReturns(shopId, { saleId: viewing.id })
      .then((rows) => { if (!cancelled) setViewReturns(rows) })
      .catch(() => { if (!cancelled) setViewReturns([]) })
    return () => {
      cancelled = true
    }
  }, [viewing, shopId])

  const returnedByProduct = useMemo(() => {
    const m = new Map<string, number>()
    ;(viewReturns ?? []).forEach((r) => (r.items ?? []).forEach((ri) => m.set(ri.productId, (m.get(ri.productId) ?? 0) + ri.qty)))
    return m
  }, [viewReturns])

  function openCorrect() {
    setCorrecting(viewingFull && viewingFull.id === viewing?.id ? viewingFull : viewing)
  }

  // Reprint any past bill: fetch the full sale (list rows carry no items),
  // map it through the shared saleToReceipt builder, and reuse the same
  // popup print pattern as the POS register.
  async function printSale(s: PSale) {
    // beginPrint() runs synchronously inside the click: in browser mode it opens the popup while the
    // gesture is valid; in silent (QZ) mode it is free.
    const h = beginPrint()
    try {
      const full = (s.items && s.items.length > 0) ? s : await repo.getSale(shopId, s.id)
      const prefs = loadPrefs()
      const m = outcomeMessage(await h.submit(receiptToDoc(prefs.invoice, saleToReceipt(full), prefs.print), {
        key: `reprint:${full.billNo}`, label: `Reprint ${full.billNo}`, kind: 'reprint', repeatable: true,
      }))
      if (m) toast(m.text, m.kind)
    } catch (e) {
      h.abort()
      toast(e instanceof Error ? e.message : 'Could not load the bill for printing.', 'err')
    }
  }

  async function confirmVoid() {
    if (!voiding) return
    if (!voidReason.trim()) {
      toast('A reason is required to void a bill.', 'err')
      return
    }
    setVoidBusy(true)
    try {
      await repo.voidSale(shopId, voiding.id, voidReason.trim())
      window.dispatchEvent(new Event('xpo:sales-total-changed'))
      toast(`Bill ${voiding.billNo} voided · stock and ledger reversed.`)
      setVoiding(null)
      setVoidReason('')
      setViewing(null)
      setViewingFull(null)
      d.refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Void failed.', 'err')
    } finally {
      setVoidBusy(false)
    }
  }

  return (
    <>
      <Panel>
        <div className="panel-head">
          <div className="panel-title-group">
            <h3 className="panel-title" style={{ margin: 0 }}>Sales history</h3>
            <span className="t-caption">{filteredSales.length} of {salesSorted.length} shown</span>
          </div>
          <div className="panel-actions">
            <SearchField
              placeholder="Search or scan bill barcode…"
              aria-label="Search sales history"
              value={saleQuery}
              onChange={(e) => setSaleQuery(e.target.value)}
              onClear={() => setSaleQuery('')}
              onKeyDown={(e) => {
                // A barcode scanner types the printed bill number and presses Enter: open that bill straight away.
                if (e.key !== 'Enter') return
                const code = saleQuery.trim().toLowerCase()
                if (!code) return
                const exact = filteredSales.filter((s) => String(s.billNo).toLowerCase() === code)
                const hit = exact.length === 1 ? exact[0] : filteredSales.length === 1 ? filteredSales[0] : null
                if (hit) {
                  e.preventDefault()
                  void openSale(hit)
                } else {
                  // Outside the date filter (an older bill scanned from a customer's receipt): look it up across all dates.
                  e.preventDefault()
                  repo.listSales(shopId, { search: code, limit: 5 })
                    .then((rows) => {
                      const one = rows.filter((r) => String(r.billNo).toLowerCase() === code)
                      const found = one.length === 1 ? one[0] : rows.length === 1 ? rows[0] : null
                      if (found) void openSale(found)
                      else toast('No bill found for that code.', 'err')
                    })
                    .catch(() => toast('Could not look that bill up. Check the connection.', 'err'))
                }
              }}
            />
            <ToolbarSelect
              width="sm"
              value={salesMethod}
              onChange={(e) => setSalesMethod(e.target.value)}
              aria-label="Filter by payment method"
            >
              <option value="all">All methods</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Khata">Khata</option>
              <option value="Split">Split</option>
            </ToolbarSelect>
            <ToolbarSelect
              width="sm"
              value={salesState}
              onChange={(e) => setSalesState(e.target.value)}
              aria-label="Filter by invoice state"
            >
              <option value="all">All states</option>
              <option value="live">Live</option>
              <option value="godown">From godown</option>
              <option value="corrected">Corrected</option>
              <option value="voided">Voided</option>
            </ToolbarSelect>
            <DateRangeFilter state={salesDate} onChange={setSalesDate} todayKeyOverride={todayBiz} />
            {showCsv && seesMoney && (
              <IconButton
                label="Export to spreadsheet"
                tooltip="Export to spreadsheet"
                onClick={exportSalesCsv}
                icon={<IconSheet size={16} />}
              />
            )}
          </div>
        </div>
        {seesMoney && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 1,
              background: 'var(--line)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Total Sales</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{money(salesSummary.totalSales)}</div>
            </div>
            {salesSummary.returnsTotal > 0 && (
              <>
                <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Returns</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--warn-fg)' }}>− {money(salesSummary.returnsTotal)}</div>
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Net Sales</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ok-fg)' }}>{money(salesSummary.netSales)}</div>
                </div>
              </>
            )}
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Bills Count</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                {salesSummary.liveCount} <span className="t-caption" style={{ fontWeight: 400 }}>{salesSummary.voidCount > 0 ? `(${salesSummary.voidCount} void)` : 'bills'}</span>
              </div>
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Cash</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ok-fg)' }}>{money(salesSummary.cashSum)}</div>
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>UPI</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--blue)' }}>{money(salesSummary.upiSum)}</div>
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Khata (Credit)</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--warn-fg)' }}>{money(salesSummary.khataSum)}</div>
            </div>
          </div>
        )}
        <DataTable
          cols={makeSaleCols(printSale, seesMoney ? onReturnBill : undefined)}
          rows={filteredSales}
          defaultSort={{ key: 'date', dir: 'desc' }}
          onRowClick={openSale}
          empty={
            <EmptyState title="No sales yet" hint="Confirmed counter bills will appear here." />
          }
        />
      </Panel>

      <Drawer open={!!viewing} title={viewing ? `Invoice ${viewing.billNo}` : ''} onClose={() => setViewing(null)} wide>
        {(viewingFull ?? viewing) && (
          <>
            {(() => {
              const s = viewingFull ?? viewing!
              const canReturn = !!onReturnBill && !s.isVoid && !s.correctsSaleId
              const totalReturned = (viewReturns ?? []).reduce((a, r) => a + (r.items ?? []).reduce((x, ri) => x + ri.qty, 0), 0)
              const totalPcs = (s.items ?? []).reduce((a, it) => a + it.qty, 0)
              return (
                <>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <span className="t-caption num">
                      {totalReturned > 0 && totalPcs > 0 ? `Returned ${totalReturned} of ${totalPcs} pcs` : 'Bill details'}
                    </span>
                    {canReturn && (
                      <Btn
                        variant="secondary"
                        onClick={() => { const v = viewing!; setViewing(null); setViewingFull(null); onReturnBill(v) }}
                      >
                        <IconBoxReturn size={14} /> Return or Exchange
                      </Btn>
                    )}
                  </div>

                  <div className="inv-meta">
                    <div className="kv-row">
                      <span className="kv-key">Date</span>
                      <span className="kv-val num">{dayOf(s.date)}</span>
                    </div>
                    <div className="kv-row">
                      <span className="kv-key">Customer</span>
                      <span className="kv-val">{s.customerName}</span>
                    </div>
                    {s.tableLabel && (
                      <div className="kv-row">
                        <span className="kv-key">Table</span>
                        <span className="kv-val">{s.tableLabel}</span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span className="kv-key">Payment</span>
                      <span className="kv-val"><Tag kind={s.method === 'UPI' ? 'blue' : 'gray'}>{s.method}</Tag></span>
                    </div>
                  </div>

                  {s.isVoid && (
                    <div style={{ marginTop: 12 }}>
                      <Tag kind="red">VOIDED — this bill was cancelled; stock and ledger were reversed.</Tag>
                    </div>
                  )}
                  {s.hasAutoTransfer && (
                    <div style={{ marginTop: 12 }}>
                      <Tag kind="purple">FROM GODOWN — stock shortfall was auto-transferred from godown to counter for this sale.</Tag>
                    </div>
                  )}
                  {s.correctsSaleId && (
                    <div style={{ marginTop: 12 }}>
                      <Tag tone="amber">Corrected bill — replaces an earlier invoice</Tag>
                    </div>
                  )}
                  {isOwner && !s.isVoid && !s.correctsSaleId && (
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Btn variant="secondary" sm onClick={openCorrect}>
                        <IconEdit style={{ width: 14, height: 14 }} /> Correct this bill
                      </Btn>
                      <Btn variant="danger" sm onClick={() => setVoiding(s)}>
                        Void bill
                      </Btn>
                      <span className="t-caption">Owner-only. Correct replaces the bill; Void cancels it and restocks the items.</span>
                    </div>
                  )}

                  {s.items && s.items.length > 0 ? (
                    <DataTable cols={makeItemCols(returnedByProduct.size > 0 ? returnedByProduct : undefined, productsById)} rows={s.items} pageSize={50} />
                  ) : (
                    <p className="t-caption" style={{ marginTop: 12 }}>Loading bill lines…</p>
                  )}

                  <div className="kv-list inv-totals">
                    <div className="kv-row">
                      <span className="kv-key">Subtotal</span>
                      <span className="kv-val num">{money(s.subtotal)}</span>
                    </div>
                    {s.discount > 0 && (
                      <div className="kv-row">
                        <span className="kv-key">Discount</span>
                        <span className="kv-val num neg">− {money(s.discount)}</span>
                      </div>
                    )}
                    {s.gstAmount > 0 && (
                      <div className="kv-row">
                        <span className="kv-key">GST</span>
                        <span className="kv-val num">{money(s.gstAmount)}</span>
                      </div>
                    )}
                    {s.tip > 0 && (
                      <div className="kv-row">
                        <span className="kv-key">Service tip</span>
                        <span className="kv-val num">{money(s.tip)}</span>
                      </div>
                    )}
                    <div className="kv-row inv-grand">
                      <span className="kv-key">Total</span>
                      <span className="kv-val num">{money(s.total)}</span>
                    </div>
                    {s.paidAmount !== undefined && (s.paidAmount > 0 || (s.status && s.status !== 'Paid')) && (
                      <>
                        <div className="kv-row">
                          <span className="kv-key">Settled / Paid Amount</span>
                          <span className="kv-val num" style={{ color: 'var(--ok-fg)', fontWeight: 600 }}>{money(s.paidAmount)}</span>
                        </div>
                        {s.total - s.paidAmount > 0 && (
                          <div className="kv-row">
                            <span className="kv-key">Remaining Balance Due</span>
                            <span className="kv-val num" style={{ color: 'var(--warn-fg)', fontWeight: 600 }}>
                              {money(s.total - s.paidAmount)} ({s.status || 'Unpaid'})
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Payment breakdown from the detail payload: a Split bill
                      settles across multiple methods and the register used to
                      hide that behind a single tag. */}
                  {(s.payments?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="micro-label">Payments</div>
                      <div className="kv-list">
                        {(s.payments ?? []).map((p: PSalePayment, i: number) => (
                          <div className="kv-row" key={p.id || i}>
                            <span className="kv-key">{p.method}{p.ref ? ` · ${p.ref}` : ''}</span>
                            <span className="kv-val num">{money(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!voiding}
        title={`Void bill ${voiding?.billNo ?? ''}?`}
        confirmLabel="Void bill"
        busy={voidBusy}
        onClose={() => { setVoiding(null); setVoidReason('') }}
        onConfirm={confirmVoid}
        message={
          <div className="stack" style={{ gap: 10 }}>
            <p>
              Voiding cancels <b>{voiding?.billNo}</b> ({money(voiding?.total ?? 0)}) permanently:
            </p>
            <ul className="warn-list">
              <li>Every item returns to the counter stock.</li>
              <li>Any Khata due on this bill is removed from the customer's ledger.</li>
              <li>Reversing ledger entries are posted — nothing is deleted.</li>
              <li>The bill stays visible in history, marked VOIDED.</li>
            </ul>
            <Field label="Reason for void" required>
              <input
                className="field-control"
                placeholder="e.g. Duplicate bill, customer cancelled order…"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                maxLength={255}
              />
            </Field>
          </div>
        }
      />

      <CorrectSaleDrawer
        sale={correcting}
        shopId={shopId}
        onClose={() => setCorrecting(null)}
        onDone={() => {
          setCorrecting(null)
          setViewing(null)
          setViewingFull(null)
          d.refresh()
        }}
      />
    </>
  )
}


