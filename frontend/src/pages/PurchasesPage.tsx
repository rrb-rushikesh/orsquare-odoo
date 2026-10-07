import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import {
  createPurchase,
  createPurchaseReturn,
  editPurchase,
  getPurchase,
  listPurchaseReturns,
  purchasesSummary,
  recordPayment,
  type PAccount,
  type PProduct,
  type PPurchase,
  type PPurchaseReturn,
} from '@/lib/repo'
import { printPurchaseBill, printPurchaseDebitNote } from '@/lib/purchasePrint'
import { beginPrint, outcomeMessage } from '@/lib/printing/service'
import { loadPrefs } from '@/lib/prefs'
import { compact, dayKeyOfValue, downloadCsv, formatDate, money } from '@/lib/utils'
import { searchProducts, searchGeneric } from '@/lib/search'
import { usePurchaseQuote } from '@/lib/quote'
import { todayKey } from '@/lib/clock'
import type { PayMethod, PayStatus } from '@/types'
import { ProductFormDrawer } from '@/components/ProductForm'
import { IconBoxReturn, IconEdit, IconFileText, IconHistory, IconSearch, IconSheet, IconAlertTriangle } from '@/components/icons'
import PurchaseEditsList from '@/components/PurchaseEditsList'
import { PurchaseReturnHistory } from '@/components/ReturnHistory'
import { BillFinder } from '@/components/BillFinder'
import {
  NoAccess,
  Btn,
  IconButton,
  SearchField,
  ToolbarSelect,
  Segmented,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  NumInput,
  Panel,
  Tag,
  Tile,
  useToast,
} from '@/components/ui'
import { DataTable, type DTCol } from '@/components/DataTable'
import { DateRangeFilter, dateRowMatches, useDateRange } from '@/components/DateRangeFilter'

const STATUS_TAG: Record<PayStatus, string> = { Paid: 'green', Partial: 'warn', Unpaid: 'red' }

const ddate = (s?: string): string => formatDate(s)
const isoToInput = (s?: string): string => {
  if (!s) return todayKey()
  const key = dayKeyOfValue(s)
  return key || todayKey()
}

interface Line {
  key: string
  productId: string | null
  name: string
  search: string
  rate: number
  boxes: number
  pcs: number
}

let lineSeq = 0

const lineBlank = (): Line => ({ key: 'L' + (++lineSeq), productId: null, name: '', search: '', rate: 0, boxes: 0, pcs: 0 })

interface ExLine {
  productId: string
  name: string
  qty: number
  rate: number
}

const MICRO: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.32px',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  margin: 0,
}

// Drawer section: micro-label header over a hairline, 16px section rhythm.
function BillSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <p style={{ ...MICRO, marginBottom: 8 }}>{label}</p>
      {children}
    </section>
  )
}

// Read-only summary cell inside the bill summary strip.
function SummaryCell({ label, right, children }: { label: string; right?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        alignItems: right ? 'flex-end' : 'flex-start',
        textAlign: right ? 'right' : 'left',
      }}
    >
      <span style={MICRO}>{label}</span>
      {children}
    </div>
  )
}

function RetSeg<T extends string>({ value, onChange, options, ariaLabel }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  ariaLabel: string
}) {
  return (
    <Segmented
      label={ariaLabel}
      value={value}
      onChange={onChange}
      options={options}
      appearance="toolbar"
    />
  )
}

/** Map stored purchase items back onto editable lines, splitting total pcs
 *  into boxes + loose pieces using the product's pieces-per-box. */
function toLines(items: { productId: string; productName: string; qty: number; rate: number }[], products: PProduct[]): Line[] {
  return items.map((it) => {
    const prod = products.find((p) => p.id === it.productId)
    const ppb = Math.max(1, prod?.piecesPerBox ?? 1)
    return {
      key: 'L' + (++lineSeq),
      productId: it.productId,
      name: it.productName,
      search: it.productName,
      rate: it.rate,
      boxes: ppb > 1 ? Math.floor(it.qty / ppb) : 0,
      pcs: ppb > 1 ? it.qty % ppb : it.qty,
    }
  })
}

function PurchasesPage() {
  const { wsUid, can } = useAuth()
  const d = useData()
  const toast = useToast()
  const shopId = wsUid
  // Purchases is an owner-only tab (backend OWNER_ONLY_TABS), so `can('purchases')`
  // (the same gate as every destructive action on this page) means owner/manager.
  const canManageReturns = can('purchases')

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [statusFilter, setStatusFilter] = useState<'All' | PayStatus>('All')
  const [creating, setCreating] = useState(false)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PPurchase | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [payAmount, setPayAmount] = useState(0)
  const [payMode, setPayMode] = useState<PayMethod>('Cash')
  // Idempotency key for the in-progress settle action; rotated per bill and
  // per success so a retry of the SAME intent is de-duplicated server-side.
  const [payIdemKey, setPayIdemKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [confirmEditId, setConfirmEditId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Server-authoritative totals: client-side reduces of the (capped) list
  // silently undercounted, which read as "numbers don't match the tally".
  const [summary, setSummary] = useState<{ total: number; paid: number; outstanding: number; bills: number; returnsTotal?: number; netIntake?: number } | null>(null)

  // ---- Return / Exchange mode ----
  const [mode, setMode] = useState<'register' | 'returns'>('register')
  // Return/Exchange flow sub-tab: the form or the posted-returns history.
  const [retTab, setRetTab] = useState<'new' | 'history'>('new')
  const [retBill, setRetBill] = useState<PPurchase | null>(null)
  const [retReturned, setRetReturned] = useState<Record<string, number>>({})
  const [retQty, setRetQty] = useState<Record<string, number>>({})
  const [retLoc, setRetLoc] = useState<'godown' | 'counter'>('godown')
  const [retSettle, setRetSettle] = useState<'payable' | 'refund'>('payable')
  const [refundMethod, setRefundMethod] = useState<'Cash' | 'UPI'>('Cash')
  const [refundRef, setRefundRef] = useState('')
  const [retReason, setRetReason] = useState('')
  const [exchange, setExchange] = useState(false)
  const [exLines, setExLines] = useState<ExLine[]>([])
  const [exSearch, setExSearch] = useState('')
  const [exActive, setExActive] = useState(false)
  const [retBusy, setRetBusy] = useState(false)
  const [lastRet, setLastRet] = useState<PPurchaseReturn | null>(null)
  const [printBusyId, setPrintBusyId] = useState<string | null>(null)
  const [detailReturns, setDetailReturns] = useState<PPurchaseReturn[] | null>(null)
  const retCache = useRef(new Map<string, PPurchaseReturn[]>())
  const viewingIdRef = useRef<string | null>(null)
  viewingIdRef.current = viewingId
  const [purDate, setPurDate, purDateRange] = useDateRange()
  const purDateRangeRef = useRef(purDateRange)
  purDateRangeRef.current = purDateRange
  const summarySeqRef = useRef(0)

  const loadSummary = useCallback((range = purDateRangeRef.current) => {
    if (!shopId) return
    const seq = ++summarySeqRef.current
    const dateOpts = range && range.from && range.to ? { from: range.from, to: range.to } : undefined
    purchasesSummary(shopId, dateOpts).then((s) => {
      if (seq === summarySeqRef.current) setSummary(s)
    }).catch(() => {})
  }, [shopId])

  useEffect(() => {
    loadSummary(purDateRange)
  }, [loadSummary, purDateRange?.from, purDateRange?.to])

  // A typed amount must never leak from one bill's drawer into the next.
  useEffect(() => { setPayAmount(0); setPayIdemKey(crypto.randomUUID()) }, [viewingId])

  const loadDetail = async (id: string) => {
    try {
      const full = await getPurchase(shopId, id)
      if (viewingIdRef.current === id) setDetail(full)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load bill.', 'err')
    }
  }

  useEffect(() => {
    if (!viewingId) {
      // Don't wipe `detail` if the edit drawer (which also reads `detail`)
      // is still open for this same bill, closing the view drawer to open
      // the edit drawer sets viewingId to null in the same batch as
      // editingId, and clearing detail here would unmount the edit drawer
      // the instant it opens.
      if (!editingId) setDetail(null)
      return
    }
    loadDetail(viewingId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingId])

  // Debit notes for the detail drawer, lazy, cached per purchase.
  useEffect(() => {
    if (!viewingId) {
      setDetailReturns(null)
      return
    }
    const cached = retCache.current.get(viewingId)
    if (cached) {
      setDetailReturns(cached)
      return
    }
    setDetailReturns(null)
    listPurchaseReturns(shopId, { purchaseId: viewingId })
      .then((rs) => {
        retCache.current.set(viewingId, rs)
        if (viewingIdRef.current === viewingId) setDetailReturns(rs)
      })
      .catch(() => setDetailReturns([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingId])

  const detailReturnsTotal = useMemo(() => {
    return (detailReturns ?? []).reduce((acc, r) => acc + (Number(r.amount) || 0), 0)
  }, [detailReturns])

  const suppliers = useMemo(() => d.accounts.filter((a) => a.type === 'Supplier'), [d.accounts])

  // Compact "no edits" state in the bill drawer, same wire-shape matching
  // PurchaseEditsList uses (purchase-id match or bill-no match).
  const billHasEdits = useMemo(() => {
    if (!detail) return false
    const billNo = d.purchases.find((p) => p.id === detail.id)?.billNo
    return d.purchaseEdits.some((e: any) => {
      const pid = e.purchase_id ?? e.purchaseId ?? e.purchase
      return pid === detail.id || (billNo != null && (e.bill_no ?? e.billNo) === billNo)
    })
  }, [detail, d.purchases, d.purchaseEdits])

  // Dashboard drill-down: ?range=today|custom&from&to&day scopes the register.
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const range = searchParams.get('range')
    const day = searchParams.get('day')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (range === 'today') {
      const d = day || todayKey()
      setPurDate({ mode: 'today', from: d, to: d })
    } else if (range === 'custom' && from && to) {
      setPurDate({ mode: 'custom', from, to })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const filtered = useMemo(() => {
    const base = d.purchases.filter((p) => {
      if (statusFilter !== 'All' && p.status !== statusFilter) return false
      if (!dateRowMatches(p.date, purDateRange.from, purDateRange.to)) return false
      return true
    })
    const q = deferredSearch.trim()
    if (!q) return base
    return searchGeneric(base, q, [
      { get: (p) => p.billNo, weight: 2.5, isCode: true },
      { get: (p) => p.supplierName, weight: 1.8 },
    ])
  }, [d.purchases, deferredSearch, statusFilter, purDateRange])

  // Popup must open synchronously inside the click gesture, before the await
  // (a window.open after an await is treated as unsolicited and blocked).
  const printBillRow = useCallback(
    async (p: PPurchase) => {
      const h = beginPrint()
      setPrintBusyId(p.id)
      try {
        const full = p.items && p.items.length > 0 ? p : await getPurchase(shopId, p.id)
        const m = outcomeMessage(await printPurchaseBill(h, full))
        if (m) toast(m.text, m.kind)
      } catch (e) {
        h.abort()
        toast(e instanceof Error ? e.message : 'Could not load the bill for printing.', 'err')
      } finally {
        setPrintBusyId(null)
      }
    },
    [shopId, toast]
  )

  const cols = useMemo<DTCol<PPurchase>[]>(
    () => [
      {
        key: 'billNo',
        label: 'Bill no.',
        sortValue: (p) => p.billNo.toLowerCase(),
        render: (p) => <span className="mono-tag">{p.billNo}</span>,
      },
      {
        key: 'date',
        label: 'Date',
        sortValue: (p) => p.date,
        render: (p) => <span className="num td-muted">{ddate(p.date)}</span>,
      },
      {
        key: 'supplier',
        label: 'Supplier',
        sortValue: (p) => p.supplierName.toLowerCase(),
        render: (p) => (
          <span className="cell-main">
            {p.supplierName}{' '}
            {(p.supplierCode === 'MAIN-GODOWN' || (!p.supplierCode && p.supplierName.startsWith('Main Godown'))) && (
              <Tag tone="blue">Distribution</Tag>
            )}
          </span>
        ),
      },
      {
        key: 'items',
        label: 'Items',
        sortValue: (p) => (p.itemsPreview || []).join(' ').toLowerCase() || String(p.itemCount),
        hideMobile: true,
        render: (p) => {
          const names = p.itemsPreview || []
          if (!names.length) return <span className="num td-muted">{p.itemCount}</span>
          const extra = p.itemCount - names.length
          return (
            <span className="items-preview" title={names.join(', ')}>
              {names.join(', ')}
              {extra > 0 ? <span className="td-muted"> +{extra} more</span> : null}
            </span>
          )
        },
      },
      {
        key: 'qty',
        label: 'Qty',
        align: 'right',
        sortValue: (p) => p.totalQty,
        hideMobile: true,
        render: (p) => <span className="num">{p.totalQty}</span>,
      },
      {
        key: 'amount',
        label: 'Amount',
        align: 'right',
        sortValue: (p) => p.amount,
        render: (p) => <span className="num" style={{ fontWeight: 600 }}>{money(p.amount)}</span>,
      },
      {
        key: 'paid',
        label: 'Paid',
        align: 'right',
        sortValue: (p) => p.paidAmount,
        hideMobile: true,
        render: (p) => <span className="num">{money(p.paidAmount)}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        sortValue: (p) => p.status,
        render: (p) => <Tag kind={STATUS_TAG[p.status as PayStatus]}>{p.status}</Tag>,
      },
      {
        key: 'print',
        label: 'Print',
        align: 'right',
        sortValue: () => 0,
        render: (p) => (
          <Btn
            sm
            variant="ghost"
            className="btn-icon"
            style={{ width: 32, height: 32 }}
            disabled={printBusyId === p.id}
            aria-label={`Print bill ${p.billNo}`}
            title={`Print bill ${p.billNo}`}
            onClick={(e) => {
              e.stopPropagation()
              void printBillRow(p)
            }}
          >
            <IconFileText size={14} />
          </Btn>
        ),
      },
    ],
    [printBusyId, printBillRow]
  )

  type PurchaseLine = NonNullable<PPurchase['items']>[number]

  const lineCols = useMemo<DTCol<PurchaseLine>[]>(
    () => [
      {
        key: 'item',
        label: 'Item',
        sortValue: (it) => it.productName.toLowerCase(),
        render: (it) => <span className="cell-main">{it.productName}</span>,
      },
      {
        key: 'qty',
        label: 'Qty',
        align: 'right',
        sortValue: (it) => it.qty,
        render: (it) => <span className="num">{it.qty}</span>,
      },
      {
        key: 'rate',
        label: 'Rate',
        align: 'right',
        sortValue: (it) => it.rate,
        render: (it) => <span className="num">{money(it.rate)}</span>,
      },
      {
        key: 'total',
        label: 'Total',
        align: 'right',
        sortValue: (it) => it.total,
        render: (it) => <span className="num" style={{ fontWeight: 600 }}>{money(it.total)}</span>,
      },
    ],
    []
  )

  const confirmEdit = detail && confirmEditId === detail.id ? detail : null
  const editing = detail && editingId === detail.id ? detail : null

  async function settle(amount: number) {
    if (!detail) return
    // The bill's own supplier_id is server-authoritative (exact, works even
    // when the supplier account is inactive and thus absent from d.accounts).
    if (!detail.supplierId) return toast('This bill has no linked supplier account — cannot record payment.', 'err')
    const supplierId = detail.supplierId
    const amt = Math.round(amount * 100) / 100
    if (!(amt > 0)) return toast('Enter an amount above zero.', 'err')
    const outstanding = Math.max(0, detail.amount - detail.paidAmount - detailReturnsTotal)
    if (amt > outstanding + 0.001) return toast(`Amount exceeds the outstanding ${money(outstanding)}.`, 'err')
    setBusy(true)
    try {
      // One key for this intent (this bill + this amount), reused on retry so
      // a lost response cannot pay the supplier twice. Rotated only on success.
      await recordPayment(shopId, {
        supplier_id: supplierId,
        amount: amt,
        mode: payMode,
        ref: '',
        purchase_id: detail.id,
        idempotency_key: payIdemKey,
      })
      toast(`Payment of ${money(amt)} recorded.`)
      setPayIdemKey(crypto.randomUUID())
      setPayAmount(0)
      await loadDetail(detail.id)
      loadSummary()
      d.refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Payment failed.', 'err')
    } finally {
      setBusy(false)
    }
  }

  function exportCsv() {
    downloadCsv(
      `purchases-${todayKey()}.csv`,
      filtered.map((p) => ({
        BillNo: p.billNo, Date: ddate(p.date), Supplier: p.supplierName, Items: p.itemCount,
        Qty: p.totalQty, Amount: p.amount, Paid: p.paidAmount, Status: p.status,
      }))
    )
  }

  // ---- Return / Exchange flow ----

  function resetReturnFlow() {
    setRetBill(null)
    setRetReturned({})
    setRetQty({})
    setRetLoc('godown')
    setRetSettle('payable')
    setRefundMethod('Cash')
    setRefundRef('')
    setRetReason('')
    setExchange(false)
    setExLines([])
    setExSearch('')
  }

  async function loadReturnContext(id: string): Promise<{ full: PPurchase; returned: Record<string, number> }> {
    const full = await getPurchase(shopId, id)
    const rets = await listPurchaseReturns(shopId, { purchaseId: id })
    const returned: Record<string, number> = {}
    for (const r of rets) for (const it of r.items) returned[it.productId] = (returned[it.productId] ?? 0) + it.qty
    return { full, returned }
  }

  const pickPurchaseSeqRef = useRef(0)

  async function pickPurchase(id: string) {
    const seq = ++pickPurchaseSeqRef.current
    setRetBusy(true)
    try {
      const { full, returned } = await loadReturnContext(id)
      if (seq !== pickPurchaseSeqRef.current) return
      setRetBill(full)
      setRetReturned(returned)
      setRetQty({})
    } catch (e) {
      if (seq !== pickPurchaseSeqRef.current) return
      toast(e instanceof Error ? e.message : 'Could not load that bill.', 'err')
    } finally {
      if (seq === pickPurchaseSeqRef.current) {
        setRetBusy(false)
      }
    }
  }

  // getPurchase needs an id; the searchable BillFinder list matches against
  // the loaded register, so no separate bill-no lookup is required.
  function addExLine(p: PProduct) {
    setExLines((ls) =>
      ls.some((l) => l.productId === p.id)
        ? ls.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l))
        : [...ls, { productId: p.id, name: p.name, qty: 1, rate: p.mrp }]
    )
    setExSearch('')
  }

  async function confirmReturn() {
    if (!retBill || retBusy) return
    if (!retReason.trim()) return toast('A reason is required.', 'err')
    if (retSettle === 'refund' && refundMethod === 'UPI' && !refundRef.trim())
      return toast('UPI refund requires a reference (UTR).', 'err')
    const lines = retLines.filter((l) => l.qty > 0).map((l) => ({ purchase_item_id: l.item.id, qty: l.qty }))
    const ex = exLines.filter((l) => l.qty > 0).map((l) => ({ product_id: l.productId, qty: l.qty, rate: l.rate }))
    // Browser mode: open the print window inside the click gesture, before the await.
    const h = beginPrint()
    setRetBusy(true)
    try {
      const ret = await createPurchaseReturn(shopId, {
        purchaseId: retBill.id,
        lines,
        stock_location: retLoc,
        settlement: retSettle,
        ...(retSettle === 'refund' ? { refund_method: refundMethod, refund_ref: refundRef.trim() || undefined } : {}),
        reason: retReason.trim(),
        // The PRET number is server-assigned; the server already stamps
        // "Exchange for PRET-xxxx" into the replacement bill, so the client
        // adds the original-bill reference as the notes suffix.
        replacement: exchange && ex.length > 0 ? { lines: ex, notes: `Against original bill ${retBill.billNo}` } : undefined,
        idempotency_key: crypto.randomUUID(),
      })
      toast(`${ret.billNo} created.`)
      retCache.current.delete(retBill.id)
      // Paperless devices (printMode 'off') print nothing automatically; the note stays reprintable.
      if (loadPrefs().printMode === 'off') h.abort()
      else {
        const m = outcomeMessage(await printPurchaseDebitNote(h, { ...ret, supplierName: retBill.supplierName }))
        if (m) toast(m.text, 'info')
      }
      setLastRet(ret)
      resetReturnFlow()
      d.refresh()
      loadSummary()
    } catch (e) {
      h.abort()
      toast(e instanceof Error ? e.message : 'Return failed.', 'err')
    } finally {
      setRetBusy(false)
    }
  }

  function openReturnFor(id: string) {
    resetReturnFlow()
    setLastRet(null)
    setMode('returns')
    setRetTab('new')
    setViewingId(null)
    void pickPurchase(id)
  }

  const retLines = useMemo(() => {
    if (!retBill) return []
    return (retBill.items ?? []).map((it) => {
      const back = retReturned[it.productId] ?? 0
      const left = Math.max(0, it.qty - back)
      const qty = Math.min(retQty[it.id] ?? 0, left)
      return { item: it, returned: back, left, qty, total: qty * it.rate }
    })
  }, [retBill, retQty, retReturned])

  const returnValue = retLines.reduce((a, l) => a + l.total, 0)
  const receiveValue = exLines.reduce((a, l) => a + l.qty * l.rate, 0)
  const anyReturn = retLines.some((l) => l.qty > 0)

  const purchaseProducts = useMemo(() => d.products.filter((p) => !p.isKitchen), [d.products])

  const exMatches = useMemo(() => {
    const q = exSearch.trim()
    if (!q) return []
    return searchProducts(purchaseProducts, q, { limit: 6 })
  }, [exSearch, purchaseProducts])

  return (
    <>
      <div className={`tiles ${(summary?.returnsTotal ?? 0) > 0 ? 'tiles-5' : 'tiles-4'}`}>
        <Tile
          label="Total purchased"
          value={compact(summary?.total ?? NaN)}
          note={`${summary ? summary.bills : filtered.length} bills`}
        />
        {(summary?.returnsTotal ?? 0) > 0 && (
          <Tile
            label="Returns · Net intake"
            value={`${compact(summary!.returnsTotal!)} · ${compact(summary!.netIntake ?? 0)}`}
            note="Debit notes and net of returns"
          />
        )}
        <Tile
          label="Settled"
          value={compact(summary?.paid ?? NaN)}
          note="Paid to suppliers"
        />
        <Tile
          label="Outstanding"
          value={compact(summary?.outstanding ?? NaN)}
          note="Not yet paid to suppliers"
        />
        <Tile
          label="Unpaid / partial"
          value={filtered.filter((p) => p.status !== 'Paid').length}
          note="Needs attention"
        />
      </div>

      {mode === 'returns' && canManageReturns ? (
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '8px 24px 0' }}>
          <div className="stack" style={{ gap: 4, marginBottom: 24 }}>
            <div>
              <Btn sm variant="ghost" onClick={() => setMode('register')}>← Back to register</Btn>
            </div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 300, color: 'var(--ink)' }}>Return or Exchange</h2>
            <span className="t-caption">Debit a supplier bill, or swap items — stock and payable adjust automatically.</span>
            <div className="seg" role="tablist" aria-label="Return flow sections" style={{ marginTop: 12, width: 'fit-content' }}>
              <button
                type="button"
                role="tab"
                aria-selected={retTab === 'new'}
                className={`seg-btn ${retTab === 'new' ? 'active' : ''}`}
                style={{ height: 38, minWidth: 120 }}
                onClick={() => setRetTab('new')}
              >
                New return
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={retTab === 'history'}
                className={`seg-btn ${retTab === 'history' ? 'active' : ''}`}
                style={{ height: 38, minWidth: 120 }}
                onClick={() => setRetTab('history')}
              >
                History
              </button>
            </div>
          </div>

          {retTab === 'history' ? (
            <PurchaseReturnHistory
              onReturnAgain={(pid) => {
                setRetTab('new')
                openReturnFor(pid)
              }}
            />
          ) : lastRet ? (
            <EmptyState
              title={`${lastRet.billNo} created`}
              hint="Stock and the supplier ledger are already updated. The debit note opened for printing (pop-ups permitting)."
              action={<Btn variant="primary" onClick={() => setLastRet(null)}>Return another bill</Btn>}
            />
          ) : !retBill ? (
            <div className="stack" style={{ gap: 8 }}>
              <p style={MICRO}>Supplier bill</p>
              <p className="t-caption" style={{ margin: 0 }}>
                Pick the supplier bill from the list — newest first. Typing a bill number or supplier name narrows it.
              </p>
              <BillFinder
                rows={d.purchases.map((p) => ({
                  id: p.id,
                  billNo: p.billNo,
                  title: p.supplierName,
                  when: ddate(p.date),
                  amount: money(p.amount),
                }))}
                loading={retBusy}
                onPick={(id) => void pickPurchase(id)}
                searchPlaceholder="Search bill no. or supplier — e.g. PUR-0007"
                emptyHint="No supplier bills in the loaded register yet — record a purchase first."
              />
              {retBusy && <p className="t-caption">Loading bill…</p>}
            </div>
          ) : (
            <div className="stack" style={{ gap: 24 }}>
              <section className="stack" style={{ gap: 8 }}>
                <p style={MICRO}>Supplier bill</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, background: 'var(--layer)', border: '1px solid var(--line)', padding: '12px 16px' }}>
                  <span className="mono-tag" style={{ fontWeight: 600 }}>{retBill.billNo}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{retBill.supplierName}</span>
                  <span className="t-caption num">{ddate(retBill.date)}</span>
                  <span className="num" style={{ marginLeft: 'auto', fontWeight: 600 }}>{money(retBill.amount)}</span>
                  <Tag kind={STATUS_TAG[retBill.status as PayStatus]}>{retBill.status}</Tag>
                  <Btn sm variant="ghost" onClick={resetReturnFlow}>Change</Btn>
                </div>
              </section>

              <section className="stack" style={{ gap: 8 }}>
                <p style={MICRO}>Items to return</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                  <span style={{ ...MICRO, flex: '1 1 180px', minWidth: 0 }}>Item</span>
                  <span style={{ ...MICRO, flex: '0 0 72px', textAlign: 'right' }}>Purchased</span>
                  <span style={{ ...MICRO, flex: '0 0 72px', textAlign: 'right' }}>Returned</span>
                  <span style={{ ...MICRO, flex: '0 0 96px', textAlign: 'right' }}>Qty back</span>
                  <span style={{ ...MICRO, flex: '0 0 96px', textAlign: 'right' }}>Value</span>
                </div>
                {retLines.map((l) => (
                  <div key={l.item.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{l.item.productName}</div>
                      <div className="t-caption num">{money(l.item.rate)} / unit</div>
                    </div>
                    <span className="num" style={{ flex: '0 0 72px', textAlign: 'right' }}>{l.item.qty}</span>
                    <span className="num td-muted" style={{ flex: '0 0 72px', textAlign: 'right' }}>{l.returned}</span>
                    <div style={{ flex: '0 0 96px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <NumInput
                        className="field-control num"
                        style={{ width: 88 }}
                        min="0"
                        step="1"
                        value={l.qty}
                        placeholder={String(l.left)}
                        aria-label={`Return qty for ${l.item.productName}`}
                        disabled={l.left === 0}
                        onChange={(n) =>
                          setRetQty((q) => ({ ...q, [l.item.id]: Math.max(0, Math.min(l.left, Math.floor(n))) }))
                        }
                      />
                      {l.left === 0 && <Tag>Fully returned</Tag>}
                    </div>
                    <span className="num" style={{ flex: '0 0 96px', textAlign: 'right', fontWeight: 600 }}>{money(l.total)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10 }}>
                  <span style={{ fontWeight: 600 }}>Return value</span>
                  <span className="num" style={{ fontWeight: 600 }}>{money(returnValue)}</span>
                </div>
              </section>

              <section className="stack" style={{ gap: 8 }}>
                <p style={MICRO}>Settlement</p>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <Field label="Remove stock from">
                    <RetSeg
                      ariaLabel="Stock removal location"
                      value={retLoc}
                      onChange={setRetLoc}
                      options={[
                        { value: 'godown', label: 'Godown' },
                        { value: 'counter', label: 'Counter' },
                      ]}
                    />
                  </Field>
                  <Field label="Settlement">
                    <RetSeg
                      ariaLabel="Settlement"
                      value={retSettle}
                      onChange={setRetSettle}
                      options={[
                        { value: 'payable', label: 'Reduce payable' },
                        { value: 'refund', label: 'Refund received' },
                      ]}
                    />
                  </Field>
                </div>
                {retSettle === 'refund' && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <RetSeg
                      ariaLabel="Refund method"
                      value={refundMethod}
                      onChange={setRefundMethod}
                      options={[
                        { value: 'Cash', label: 'Cash' },
                        { value: 'UPI', label: 'UPI' },
                      ]}
                    />
                    <input
                      className="field-control"
                      style={{ flex: '1 1 200px', maxWidth: 280 }}
                      value={refundRef}
                      placeholder={refundMethod === 'UPI' ? 'UTR / transaction id' : 'Receipt no. — optional'}
                      aria-label="Refund reference"
                      onChange={(e) => setRefundRef(e.target.value)}
                    />
                  </div>
                )}
              </section>

              <Field label="Reason" required hint="Appears on the debit note and the audit trail.">
                <textarea
                  className="field-control"
                  style={{ fontSize: 15, minHeight: 72, resize: 'vertical' }}
                  rows={3}
                  value={retReason}
                  placeholder="e.g. 2 boxes leaked in transit — returning damaged stock"
                  aria-label="Return reason"
                  onChange={(e) => setRetReason(e.target.value)}
                />
              </Field>

              <label className="check-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={exchange}
                  onChange={(e) => {
                    setExchange(e.target.checked)
                    if (!e.target.checked) {
                      setExLines([])
                      setExSearch('')
                    }
                  }}
                />
                <span>Exchange items instead (stock down + intake up)</span>
              </label>

              {exchange && (
                <section className="stack" style={{ gap: 8 }}>
                  <p style={MICRO}>Replacement items</p>
                  <div className="search-box sug-anchor" style={{ maxWidth: 420 }}>
                    <IconSearch />
                    <input
                      className="field-control"
                      placeholder="Type to search replacement products…"
                      aria-label="Search replacement products"
                      value={exSearch}
                      onChange={(e) => setExSearch(e.target.value)}
                      onFocus={() => setExActive(true)}
                      onBlur={() => setTimeout(() => setExActive(false), 150)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && exMatches[0]) addExLine(exMatches[0])
                      }}
                    />
                    {exActive && exMatches.length > 0 && (
                      <div className="menu-pop sug">
                        {exMatches.map((p) => (
                          <button key={p.id} className="menu-item" onMouseDown={() => addExLine(p)}>
                            <span className="sug-name">{p.name}</span>
                            <span className="t-caption num">MRP {money(p.mrp)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {exLines.map((l, i) => (
                    <div key={l.productId} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>{l.name}</div>
                        <div className="t-caption">Replacement intake</div>
                      </div>
                      <NumInput
                        className="field-control num"
                        style={{ width: 80 }}
                        min="0"
                        step="1"
                        value={l.qty}
                        aria-label={`Qty for ${l.name}`}
                        onChange={(n) => setExLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Math.floor(n)) } : x)))}
                      />
                      <NumInput
                        className="field-control num"
                        style={{ width: 110 }}
                        min="0"
                        step="0.01"
                        value={l.rate}
                        aria-label={`Rate for ${l.name}`}
                        onChange={(n) => setExLines((ls) => ls.map((x, j) => (j === i ? { ...x, rate: n } : x)))}
                      />
                      <span className="num" style={{ flex: '0 0 96px', textAlign: 'right', fontWeight: 600 }}>{money(l.qty * l.rate)}</span>
                      <button
                        type="button"
                        className="btn-icon"
                        style={{ width: 32, height: 32 }}
                        aria-label={`Remove ${l.name}`}
                        onClick={() => setExLines((ls) => ls.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <div style={{ background: 'var(--layer)', border: '1px solid var(--line)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="t-caption num">Returning {money(returnValue)} · Receiving {money(receiveValue)}</span>
                    <span className="num" style={{ fontWeight: 600 }}>
                      {receiveValue - returnValue > 0.005
                        ? `Payable increases ${money(receiveValue - returnValue)}`
                        : returnValue - receiveValue > 0.005
                          ? `Supplier credit ${money(returnValue - receiveValue)}`
                          : 'Even swap'}
                    </span>
                  </div>
                </section>
              )}

              <div style={{ position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'var(--canvas)', borderTop: '1px solid var(--line)', padding: '12px 0', marginTop: 8 }}>
                <Btn variant="ghost" onClick={() => setMode('register')}>← Back to register</Btn>
                <Btn
                  variant="primary"
                  disabled={retBusy || !anyReturn || !retReason.trim() || (retSettle === 'refund' && refundMethod === 'UPI' && !refundRef.trim())}
                  onClick={() => void confirmReturn()}
                >
                  {retBusy ? 'Creating…' : 'Confirm return'}
                </Btn>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Panel>
          <div className="panel-head">
            <div className="panel-title-group">
              <h3 className="panel-title" style={{ margin: 0 }}>Purchase register</h3>
              <span className="t-caption">{filtered.length} shown</span>
            </div>
            <div className="panel-actions">
              <SearchField
                placeholder="Search bill no. or supplier…"
                aria-label="Search purchase bills"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
              />
              <ToolbarSelect
                width="sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                aria-label="Filter by payment status"
              >
                <option value="All">All statuses</option>
                <option>Paid</option>
                <option>Partial</option>
                <option>Unpaid</option>
              </ToolbarSelect>
              <DateRangeFilter state={purDate} onChange={setPurDate} align="right" />
              <IconButton
                label="Export to spreadsheet"
                tooltip="Export to spreadsheet"
                onClick={exportCsv}
                icon={<IconSheet size={16} />}
              />
              {canManageReturns && (
                <IconButton
                  label="Return or Exchange items"
                  tooltip="Return or Exchange items"
                  disabled
                  title="Return or Exchange is not available yet."
                  aria-pressed={mode === 'returns'}
                  onClick={() => setMode((m) => (m === 'returns' ? 'register' : 'returns'))}
                  icon={<IconBoxReturn size={16} />}
                />
              )}
              <IconButton
                label="Purchase edit history"
                tooltip="Purchase edit history"
                disabled
                title="Purchase edit history is not available yet."
                onClick={() => setHistoryOpen(true)}
                icon={<IconHistory size={16} />}
              />
              <Btn variant="primary" onClick={() => setCreating(true)}>+ New purchase</Btn>
            </div>
          </div>

          {d.purchases.length === 0 ? (
            <EmptyState title="No purchases found" hint="Record your first supplier bill." />
          ) : (
            <DataTable
              cols={cols}
              rows={filtered}
                defaultSort={{ key: 'date', dir: 'desc' }}
                ariaLabel="Purchase register"
                onRowClick={(p) => setViewingId(p.id)}
                rowKey={(p) => p.id}
                empty={<EmptyState title="No purchases found" hint="Try clearing filters." />}
              />
          )}
        </Panel>
      )}

      <PurchaseFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        suppliers={suppliers}
        products={purchaseProducts}
        onDone={(ok, msg) => {
          toast(msg, ok ? 'ok' : 'err')
          if (ok) {
            setCreating(false)
            loadSummary()
            d.refresh()
          }
        }}
      />

      {editing && (
        <PurchaseFormDrawer
          key={editing.id}
          mode="edit"
          initial={editing}
          open
          onClose={() => setEditingId(null)}
          suppliers={suppliers}
          products={purchaseProducts}
          onDone={(ok, msg) => {
            toast(msg, ok ? 'ok' : 'err')
            if (ok) {
              setEditingId(null)
              setViewingId(null)
              loadSummary()
              d.refresh()
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmEdit}
        title="Edit purchase bill?"
        confirmLabel="Yes, edit bill"
        onClose={() => setConfirmEditId(null)}
        onConfirm={() => {
          if (confirmEdit) {
            setViewingId(null)
            setEditingId(confirmEdit.id)
            setConfirmEditId(null)
          }
        }}
        message={
          <div className="stack" style={{ gap: 10 }}>
            <p>
              You are about to correct <b>{confirmEdit?.billNo}</b>. This will recount the bill, so:
            </p>
            <ul className="warn-list">
              <li>Godown stock is restated to match the corrected quantities.</li>
              <li>The supplier's ledger balance is adjusted for the new bill amount.</li>
              <li>Any payments already recorded stay as they are.</li>
              <li>Every change is logged permanently in the purchase edit history (history icon above).</li>
            </ul>
            <p className="t-caption">This cannot be undone. Double-check the figures before saving.</p>
          </div>
        }
      />

      <Drawer
        open={!!viewingId}
        title={`Bill ${detail?.billNo ?? ''}`}
        onClose={() => setViewingId(null)}
      >
        {detail && (
          <>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span className="t-caption">Supplier bill details</span>
              <Btn variant="secondary" disabled title="Purchase edits are not available yet." onClick={() => setConfirmEditId(detail.id)}>
                <IconEdit /> Edit purchase
              </Btn>
            </div>

            <div
              style={{
                background: 'var(--layer)',
                border: '1px solid var(--line)',
                padding: '12px 14px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '12px 16px',
              }}
            >
              <SummaryCell label="Supplier">
                <span style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{detail.supplierName}</span>
              </SummaryCell>
              <SummaryCell label="Date">
                <span className="num">{ddate(detail.date)}</span>
              </SummaryCell>
              <SummaryCell label="Status">
                <Tag kind={STATUS_TAG[detail.status as PayStatus]}>{detail.status}</Tag>
              </SummaryCell>
              <SummaryCell label="Total amount" right>
                <span className="num" style={{ fontWeight: 600 }}>{money(detail.amount)}</span>
              </SummaryCell>
            </div>

            <BillSection label="Line items">
              <DataTable cols={lineCols} rows={detail.items ?? []} ariaLabel="Bill line items" />
            </BillSection>

            <BillSection label="Returns">
              {detailReturns === null ? (
                <p className="t-caption">Checking returns…</p>
              ) : detailReturns.length > 0 ? (
                <>
                  <div style={{ marginBottom: 12 }}>
                    {detailReturns.map((r) => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span className="mono-tag">{r.billNo}</span>
                            <span className="t-caption num">{ddate(r.date)}</span>
                            <Tag kind={r.kind === 'exchange' ? 'blue' : 'gray'}>{r.kind === 'exchange' ? 'Exchange' : 'Return'}</Tag>
                          </div>
                          <span className="t-caption" style={{ whiteSpace: 'normal' }}>{r.reason}</span>
                        </div>
                        <span className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>− {money(r.amount)}</span>
                      </div>
                    ))}
                  </div>
                  {canManageReturns && (
                    <Btn variant="ghost" disabled title="Returns are not available yet." onClick={() => openReturnFor(detail.id)}>
                      <IconBoxReturn size={14} /> Return items
                    </Btn>
                  )}
                </>
              ) : (
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="t-caption">Return history is not available yet.</span>
                  {canManageReturns && (
                    <Btn variant="ghost" disabled title="Returns are not available yet." onClick={() => openReturnFor(detail.id)}>
                      <IconBoxReturn size={14} /> Return items
                    </Btn>
                  )}
                </div>
              )}
            </BillSection>

            <BillSection label="Payments recorded">
              {detail.payments && detail.payments.length > 0 ? (
                <div className="kv-list">
                  {detail.payments.map((v) => (
                    <div key={v.id} className="kv-row">
                      <span className="kv-key">
                        <span className="mono-tag">{v.voucherNo}</span> · {ddate(v.date)} · {v.mode}
                        {v.status === 'Pending' ? ' · pending' : ''}
                      </span>
                      <span className="kv-val num">{money(v.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="t-caption">No payments recorded yet — this bill is fully on credit.</p>
              )}
            </BillSection>

            <BillSection label="Settle this bill">
              {(() => {
                const outstanding = Math.max(0, detail.amount - detail.paidAmount - detailReturnsTotal)
                return (
                  <>
                    <div className="stack" style={{ gap: 0 }}>
                      <div className="kv-row" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span className="kv-key">Already paid</span>
                        <span className="kv-val num">{money(detail.paidAmount)}</span>
                      </div>
                      {detailReturnsTotal > 0 && (
                        <div className="kv-row" style={{ borderBottom: '1px solid var(--line)' }}>
                          <span className="kv-key">Returns / Debit notes</span>
                          <span className="kv-val num">− {money(detailReturnsTotal)}</span>
                        </div>
                      )}
                      <div className="kv-row" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span className="kv-key">Outstanding</span>
                        <span className={`kv-val num${outstanding > 0 ? ' neg' : ''}`}>
                          {money(outstanding)}
                        </span>
                      </div>
                    </div>
                    {detail.status !== 'Paid' && outstanding > 0 ? (
                      <>
                        <div className="form-grid" style={{ marginTop: 12 }}>
                          <Field label="Payment amount (₹)">
                            <NumInput
                              className="field-control num"
                              min="0"
                              step="0.01"
                              value={payAmount}
                              placeholder={String(outstanding)}
                              onChange={setPayAmount}
                            />
                          </Field>
                          <Field label="Mode">
                            <select className="field-control" value={payMode} onChange={(e) => setPayMode(e.target.value as PayMethod)}>
                              <option>Cash</option>
                              <option>UPI</option>
                            </select>
                          </Field>
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <Btn variant="primary" block disabled={busy} onClick={() => settle(payAmount || outstanding)}>
                            Record payment & update ledger
                          </Btn>
                        </div>
                      </>
                    ) : (
                      <div style={{ marginTop: 12 }}>
                        <Tag kind="green">Fully settled</Tag>
                      </div>
                    )}
                  </>
                )
              })()}
            </BillSection>

            <BillSection label="Edit history">
              {billHasEdits ? (
                <PurchaseEditsList
                  purchaseId={detail.id}
                  compact
                  onOpenBill={(pid) => {
                    setViewingId(null)
                    setViewingId(pid)
                  }}
                />
              ) : (
                <p className="t-caption" style={{ margin: 0, padding: '8px 0' }}>Edit history is not available yet.</p>
              )}
            </BillSection>
          </>
        )}
      </Drawer>

      <Drawer open={historyOpen} title="Purchase edit history" onClose={() => setHistoryOpen(false)} wide>
        <PurchaseEditsList />
      </Drawer>
    </>
  )
}

function PurchaseFormDrawer({
  open,
  onClose,
  onDone,
  suppliers,
  products,
  mode,
  initial,
}: {
  open: boolean
  onClose: () => void
  onDone: (ok: boolean, msg: string) => void
  suppliers: PAccount[]
  products: PProduct[]
  mode: 'create' | 'edit'
  initial?: PPurchase | null
}) {
  const { wsUid } = useAuth()
  const d = useData()
  const shopId = wsUid

  const today = todayKey()
  const [supplierId, setSupplierId] = useState(() => initial?.supplierId ?? '')
  const [dateVal, setDateVal] = useState(() => (initial ? isoToInput(initial.date) : today))
  // Custom bill numbering: empty means the server's gapless PUR-#### sequence.
  const [billNo, setBillNo] = useState('')
  const [lines, setLines] = useState<Line[]>(() =>
    initial && initial.items?.length ? toLines(initial.items, products) : [lineBlank()]
  )
  // Bug fix (2026-08-31): notes were never hydrated from the bill, so every
  // edit silently WIPED the existing note.
  const [notes, setNotes] = useState(() => initial?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [newProductOpen, setNewProductOpen] = useState(false)
  const [activeLine, setActiveLine] = useState<number | null>(null)
  // Duplicate review: the first Save with flagged rows asks the user to look
  // at the highlighted lines; the second press confirms. Nothing is ever
  // auto-deleted.
  const [dupAck, setDupAck] = useState(false)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const scrollTarget = useRef<number | null>(null)

  // Scroll the newly appended line into view (smooth, nearest, the drawer
  // body is the scroll container).
  useEffect(() => {
    if (scrollTarget.current == null) return
    const el = rowRefs.current[scrollTarget.current]
    scrollTarget.current = null
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [lines.length])

  const lineQty = (l: Line): number => {
    const prod = products.find((p) => p.id === l.productId)
    const ppb = Math.max(1, prod?.piecesPerBox ?? 1)
    return (Number(l.boxes) || 0) * ppb + (Number(l.pcs) || 0)
  }

  // Suspected duplicate/conflicting lines: the same product appears on more
  // than one line with an equal (or near-equal) quantity, or an equal
  // (near-equal) line total. Flagged for review, never merged or removed
  // automatically. (The backend also merges equal-rate duplicates and
  // rejects conflicting-rate ones as a final guard.)
  const dupRows = useMemo(() => {
    const flagged = new Set<Line>()
    const byProduct = new Map<string, Line[]>()
    for (const l of lines) {
      if (!l.productId) continue
      const arr = byProduct.get(l.productId) ?? []
      arr.push(l)
      byProduct.set(l.productId, arr)
    }
    for (const arr of byProduct.values()) {
      if (arr.length < 2) continue
      for (let a = 0; a < arr.length; a++) {
        for (let b = a + 1; b < arr.length; b++) {
          const la = arr[a]
          const lb = arr[b]
          const qa = lineQty(la)
          const qb = lineQty(lb)
          const ta = qa * la.rate
          const tb = qb * lb.rate
          const qtySame = qa === qb
          const totalTol = Math.max(1, Math.max(ta, tb) * 0.01)
          const totalSame = Math.abs(ta - tb) <= totalTol
          if (qtySame || totalSame) {
            flagged.add(la)
            flagged.add(lb)
          }
        }
      }
    }
    return flagged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, products])

  useEffect(() => {
    if (dupRows.size === 0) setDupAck(false)
  }, [dupRows])

  /** Append a fresh line beneath the current last one and scroll to it. */
  function addLine(scroll = true) {
    if (scroll) scrollTarget.current = lines.length
    setLines((ls) => [...ls, lineBlank()])
  }

  /** When a product lands on the trailing line, the next line appears
   *  automatically underneath: continuous entry without clicking Add. */
  function ensureTrailingLine(i: number) {
    if (i === lines.length - 1) addLine()
  }

  const priced = usePurchaseQuote(lines.filter(l=>l.productId && lineQty(l)>0).map(l=>({product_id:l.productId!,qty:lineQty(l),rate:l.rate,uom_id:products.find(p=>p.id===l.productId)?.unitId})), supplierId)
  const amount = priced.ready ? priced.quote.total : NaN
  const totalQty = lines.reduce((a, l) => a + lineQty(l), 0)

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  }

  // Type-to-search product picker: matches name / code / barcode.
  const lineMatches = (l: Line) => {
    const q = l.search.trim()
    if (!q) return []
    return searchProducts(products, q, { limit: 6 })
  }

  function pickLine(i: number, p: PProduct) {
    setLine(i, {
      productId: p.id,
      name: p.name,
      search: p.name,
      rate: p.costPrice ?? 0,
      boxes: 0,
      pcs: 0,
    })
    setActiveLine(null)
    ensureTrailingLine(i)
  }

  function commitSearch(i: number, l: Line) {
    const q = l.search.trim()
    if (!q) return
    const m = lineMatches(l)
    const exact =
      m.find((p) => p.name.toLowerCase() === q.toLowerCase() || p.code.toLowerCase() === q.toLowerCase() || p.barcode === q) ?? m[0]
    if (exact) pickLine(i, exact)
  }

  async function save() {
    // In edit mode the supplier is locked and may even be inactive (inactive
    // accounts are filtered out of d.accounts), resolve it from the bill
    // itself; the server re-validates ownership and type anyway.
    const supplier =
      mode === 'edit'
        ? suppliers.find((s) => s.id === initial?.supplierId) ?? { id: initial?.supplierId ?? '' }
        : suppliers.find((s) => s.id === supplierId)
    if (!supplier?.id) return onDone(false, mode === 'edit' ? 'This bill has no linked supplier account.' : 'Choose a supplier first.')
    const items = lines.filter((l) => l.productId && lineQty(l) > 0)
    if (!items.length) return onDone(false, 'Add at least one product line.')
    if (dupRows.size > 0 && !dupAck) {
      setDupAck(true)
      return onDone(
        false,
        `${dupRows.size} suspected duplicate line${dupRows.size > 1 ? 's are' : ' is'} highlighted in red — review or remove one, then press Save again to confirm.`
      )
    }
    setSaving(true)
    try {
      const named = items.map((l) => ({
        product_id: l.productId!,
        qty_boxes: Math.floor(Number(l.boxes) || 0),
        qty_pieces: Math.floor(Number(l.pcs) || 0),
        qty: Math.floor(lineQty(l)),
        rate: Number(l.rate) || 0,
      }))
      if (mode === 'create') {
        const created = await createPurchase(shopId, {
          supplier_id: supplier.id,
          bill_no: billNo.trim(),
          // User-chosen bill date (YYYY-MM-DD): without it the backend
          // stamps today and backdating silently becomes today.
          date: dateVal,
          lines: named,
          paid_amount: 0,
          payment_mode: 'Cash',
          payment_ref: '',
          notes: notes.trim(),
        })
        onDone(true, `Purchase ${created.billNo} saved · stock updated.`)
        setLines([lineBlank()])
        setSupplierId('')
        setBillNo('')
        setDateVal(today)
        setNotes('')
      } else {
        if (!initial) return
        await editPurchase(shopId, initial.id, { lines: named, notes: notes.trim() })
        onDone(true, `Purchase ${initial.billNo} updated · change logged.`)
      }
    } catch (e) {
      onDone(false, e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      title={mode === 'edit' ? `Edit ${initial?.billNo ?? 'purchase'}` : 'New purchase bill'}
      onClose={onClose}
      xwide
      footer={
        <>
          <span className="t-caption num">
            {lines.filter((l) => l.productId).length} items · {totalQty} pcs
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" disabled={saving || !priced.ready} title={priced.error || undefined} onClick={save}>{saving ? 'Saving…' : mode === 'edit' ? `Save changes ${money(amount)}` : `Save ${money(amount)}`}</Btn>
          </div>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Supplier">
          {mode === 'edit' ? (
            <input className="field-control" value={initial?.supplierName ?? ''} disabled readOnly />
          ) : (
            <select className="field-control" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Bill date">
          <input className="field-control" type="date" value={dateVal} disabled={mode === 'edit'} onChange={(e) => setDateVal(e.target.value)} />
        </Field>
        <Field label={mode === 'edit' ? 'Bill no. (locked)' : 'Bill no. — optional custom number'}>
          {mode === 'edit' ? (
            <input className="field-control mono-tag" value={initial?.billNo ?? ''} disabled readOnly />
          ) : (
            <input
              className="field-control mono-tag"
              value={billNo}
              placeholder="Auto · PUR-0001, or e.g. XPR/PUR/0001"
              onChange={(e) => setBillNo(e.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="line-items">
        <div className="line-row head">
          <span style={{ textAlign: 'center' }}>#</span>
          <span>Product</span>
          <span style={{ textAlign: 'right' }}>Boxes</span>
          <span style={{ textAlign: 'right' }}>Pieces</span>
          <span style={{ textAlign: 'right' }}>Rate</span>
          <span style={{ textAlign: 'right' }}>Total</span>
          <span />
        </div>
        {lines.map((l, i) => {
          const prod = products.find((p) => p.id === l.productId)
          const ppb = Math.max(1, prod?.piecesPerBox ?? 1)
          const qty = lineQty(l)
          return (
            <div key={l.key} ref={(el) => { rowRefs.current[i] = el }} className={`line-row ${dupRows.has(l) ? 'dup' : ''}`}>
              <span className="line-no">{i + 1}</span>
              <div className="search-box sug-anchor" style={{ flex: 1, minWidth: 0 }}>
                <IconSearch />
                <input
                  className="field-control"
                  style={{ height: 36 }}
                  placeholder="Type to search product…"
                  aria-label={`Search product for line ${i + 1}`}
                  value={l.search}
                  onChange={(e) => setLine(i, { search: e.target.value, productId: null, name: '' })}
                  onFocus={() => setActiveLine(i)}
                  onBlur={() => setTimeout(() => setActiveLine((a) => (a === i ? null : a)), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitSearch(i, lines[i])
                  }}
                />
                {activeLine === i && lineMatches(l).length > 0 && (
                  <div className="menu-pop sug">
                    {lineMatches(l).map((p) => {
                      const ppb = Math.max(1, p.piecesPerBox ?? 1)
                      return (
                        <button key={p.id} className="menu-item" onMouseDown={() => pickLine(i, p)}>
                          <span className="sug-name">{p.name}</span>
                          <span className="t-caption num">
                            {ppb}/box · ₹{p.mrp}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <NumInput
                className="field-control num line-num"
                min="0"
                step="1"
                style={{ height: 36 }}
                placeholder={ppb > 1 ? `Boxes (${ppb}/box)` : '—'}
                disabled={ppb <= 1}
                value={l.boxes}
                onChange={(n) => setLine(i, { boxes: Math.max(0, n) })}
              />
              <NumInput
                className="field-control num line-num"
                min="0"
                step="1"
                style={{ height: 36 }}
                placeholder="Pieces"
                value={l.pcs}
                onChange={(n) => setLine(i, { pcs: Math.max(0, n) })}
              />
              <NumInput className="field-control num line-num" min="0" step="0.01" style={{ height: 36 }} value={l.rate} onChange={(n) => setLine(i, { rate: n })} />
              <span className="num line-total" style={{ textAlign: 'right', fontWeight: 600 }}>
                {money(priced.ready ? priced.quote.lines[lines.slice(0, i).filter(x => x.productId && lineQty(x) > 0).length]?.amount ?? 0 : NaN)}
                <span className="cell-sub num">= {qty} pcs</span>
              </span>
              <button
                className="icon-btn line-remove"
                style={{ width: 30, height: 30 }}
                aria-label="Remove line"
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [lineBlank()]))}
              >
                ×
              </button>
            </div>
          )
        })}
        {dupRows.size > 0 && (
          <div className="dup-banner" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconAlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>
              {dupRows.size} suspected duplicate line{dupRows.size > 1 ? 's' : ''} highlighted — same product with matching quantity or amount.
              Review and remove one; nothing is deleted automatically.
            </span>
          </div>
        )}
        <div className="line-add" style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Btn sm variant="ghost" onClick={() => addLine()}>
            + Add line
          </Btn>
          <Btn sm variant="tertiary" onClick={() => setNewProductOpen(true)}>
            + Add product
          </Btn>
          <span className="t-caption" style={{ marginLeft: 'auto' }}>
            Product not listed? Add it here first.
          </span>
        </div>
      </div>

      <div className="t-caption" style={{ marginTop: 8 }}>
        Enter quantities in the product’s stock unit. Box packing is not available yet.
      </div>

      <div style={{ marginTop: 12 }}>
        <Field label="Notes">
          <input className="field-control" disabled title="Purchase notes are not available yet." value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Not available yet" />
        </Field>
      </div>

      <ProductFormDrawer
        open={newProductOpen}
        initial={null}
        onClose={() => setNewProductOpen(false)}
        onSaved={(p) => {
          // Fill the first EMPTY line; only append when every line is used,
          // overwriting the last line clobbered whatever was already typed.
          setLines((ls) => {
            const idx = ls.findIndex((x) => !x.productId)
            const filled: Line = {
              ...(idx >= 0 ? ls[idx] : lineBlank()),
              productId: p.id,
              name: p.name,
              search: p.name,
              rate: p.mrp,
              boxes: 0,
              pcs: 1,
            }
            if (idx >= 0) {
              const next = [...ls]
              next[idx] = filled
              // The filled line was the trailing one, open the next line.
              if (idx === ls.length - 1) {
                scrollTarget.current = ls.length
                return [...next, lineBlank()]
              }
              return next
            }
            scrollTarget.current = ls.length
            return [...ls, filled]
          })
          setNewProductOpen(false)
          d.refresh()
        }}
      />
    </Drawer>
  )
}

export default function PurchasesPageGuarded() {
  const { can } = useAuth()
  if (!can('purchases')) return <NoAccess what="Purchases" />
  return <PurchasesPage />
}