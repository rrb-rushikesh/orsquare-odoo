import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import * as repo from '@/lib/repo'
import type { PIncExp, PPurchase, PSale, PVoucher } from '@/lib/repo'
import { formatDate, money } from '@/lib/utils'
import { fuzzyMatch } from '@/lib/search'
import { todayKey } from '@/lib/clock'
import { NoAccess, Btn, Drawer, EmptyState, Field, NumInput, Panel, Tag, useToast } from '@/components/ui'
import { DataTable, type DTCol } from '@/components/DataTable'
import { DateRangeFilter, useDateRange, ddisplay } from '@/components/DateRangeFilter'

type Filter = 'all' | 'sales' | 'purchase' | 'payments' | 'income' | 'expense'

interface Move {
  key: string
  date: string
  time?: string
  rawCreatedAt?: string
  voucher: string
  particulars: string
  kind: string
  kindLabel: string
  inflow: number
  outflow: number
  pending: boolean
  mode?: string
  ref?: string
  detail: [string, string][]
  /** Everything this row should match on: voucher, party, product names,
   *  head/narration, ref. Product names come from the server-side register
   *  preview, so a brand search finds the invoice that contains it. */
  searchText?: string
  /** Underlying document ids so the drawer can open the FULL invoice. */
  saleId?: string
  purchaseId?: string
}

const FILTERS: { v: Filter; label: string }[] = [
  { v: 'all', label: 'All moves' },
  { v: 'sales', label: 'Sales only' },
  { v: 'purchase', label: 'Purchases only' },
  { v: 'payments', label: 'Supplier payments' },
  { v: 'income', label: 'Income only' },
  { v: 'expense', label: 'Expenses only' },
]

const FILTER_TOTAL_LABEL: Record<Filter, string> = {
  all: '',
  sales: 'Sales total',
  purchase: 'Purchases total (billed)',
  payments: 'Supplier payments & customer receipts',
  income: 'Income total',
  expense: 'Expense total',
}

const HEADS = [
  'Shop Rent',
  'Electricity',
  'Staff Salary',
  'Transport / Freight',
  'Licence Fees',
  'Cold Storage Rent',
  'Scrap / Empty Bottles',
  'Misc. Income',
]

const PAGE = 50

const dayOf = (k: string): string => formatDate(k)

type MoveRow = Move & { balance: number | null }

const moveCols: DTCol<MoveRow>[] = [
  { key: 'voucher', label: 'Voucher', sortValue: (m) => m.voucher, hideMobile: true, render: (m) => <span className="mono-tag" style={{ color: 'var(--ink)' }}>{m.voucher}</span> },
  {
    key: 'date', label: 'Date', sortValue: (m) => m.date,
    render: (m) => (<><span style={{ color: 'var(--ink)' }}>{dayOf(m.date)}</span>{m.time && <span className="td-muted" style={{ marginLeft: 6 }}>{m.time}</span>}</>),
  },
  { key: 'particulars', label: 'Particulars', sortValue: (m) => m.particulars.toLowerCase(), mobile: { primary: true }, render: (m) => <span className="cell-main" style={{ fontWeight: 600 }}>{m.particulars}</span> },
  { key: 'type', label: 'Type', sortValue: (m) => m.kindLabel, render: (m) => <Tag kind={m.kind}>{m.kindLabel}</Tag> },
  { key: 'mode', label: 'Mode', sortValue: (m) => m.mode ?? '', hideMobile: true, render: (m) => m.mode ? <Tag kind={m.mode === 'UPI' ? 'blue' : 'gray'}>{m.mode}</Tag> : <span className="td-muted">—</span> },
  { key: 'in', label: 'In', align: 'right', sortValue: (m) => m.inflow, render: (m) => <span className="num">{m.inflow ? money(m.inflow) : '—'}</span> },
  { key: 'out', label: 'Out', align: 'right', sortValue: (m) => m.outflow, render: (m) => <span className="num">{m.outflow ? money(m.outflow) : '—'}</span> },
  { key: 'balance', label: 'Balance', align: 'right', sortValue: (m) => m.balance ?? Number.NEGATIVE_INFINITY, render: (m) => m.balance === null ? <span className="td-muted">pending</span> : <span className="num" style={{ fontWeight: 600 }}>{money(m.balance)}</span> },
]

function CashFlowPage() {
  const { wsUid, isEmployee, featureOn } = useAuth()
  const shopId = wsUid
  const d = useData()
  const toast = useToast()
  const showSummary = featureOn('cashflow_summary')

  const [receipts, setReceipts] = useState<PVoucher[]>([])
  const [purchases, setPurchases] = useState<PPurchase[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [partyQuery, setPartyQuery] = useState('')
  const [serverQuery, setServerQuery] = useState('')
  const [dateState, setDateState, effRange] = useDateRange('all')
  const [empDate, setEmpDate] = useState<string>(() => todayKey())
  const [empMode, setEmpMode] = useState<'today' | 'custom'>('today')

  // Dashboard drill-down: ?range=today|custom&from&to&day scopes the register
  // to the period the clicked metric represented (employees stay Today-only).
  const [searchParams] = useSearchParams()
  useEffect(() => {
    if (isEmployee) return
    const rangeParam = searchParams.get('range')
    const day = searchParams.get('day')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (rangeParam === 'today') {
      const d = day || todayKey()
      setDateState({ mode: 'today', from: d, to: d })
    } else if (rangeParam === 'custom' && from && to) {
      setDateState({ mode: 'custom', from, to })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Server-side search results (invoices containing a product/brand, vouchers
  // by party/number). Distinct from the instant client filter below: this one
  // reaches past the loaded 1000-row window, so "Surf Excel" finds every bill
  // even in a busy month.
  const [searched, setSearched] = useState<{ sales: PSale[]; purchases: PPurchase[] } | null>(null)

  useEffect(() => {
    const q = partyQuery.trim()
    if (!q) {
      setServerQuery('')
      setSearched(null)
      return
    }
    const t = window.setTimeout(() => setServerQuery(q), 300)
    return () => window.clearTimeout(t)
  }, [partyQuery])

  useEffect(() => {
    if (!shopId || !serverQuery) return
    let alive = true
    Promise.all([
      repo.listSales(shopId, { search: serverQuery, limit: 200 }),
      repo.listPurchases(shopId, { search: serverQuery, limit: 200 }),
    ])
      .then(([sales, purchases]) => { if (alive) setSearched({ sales, purchases }) })
      .catch(() => { if (alive) setSearched(null) })
    return () => { alive = false }
  }, [shopId, serverQuery])

  const [reloadTick, setReloadTick] = useState(0)
  const [viewing, setViewing] = useState<Move | null>(null)
  const [saleDoc, setSaleDoc] = useState<PSale | null>(null)
  const [purchaseDoc, setPurchaseDoc] = useState<PPurchase | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [entryType, setEntryType] = useState<'payment' | 'income' | 'expense'>('payment')
  const [form, setForm] = useState({
    partyId: '',
    mode: 'Cash' as 'Cash' | 'UPI',
    ref: '',
    amount: 0,
    head: '',
    narration: '',
    entryDate: '',   // optional backdate for income/expense vouchers
  })
  // One idempotency key per payment intent, reused on retry.
  const [formIdemKey, setFormIdemKey] = useState(() => crypto.randomUUID())

  // Effective [from, to] day keys for the register.
  const range = useMemo<{ from: string; to: string } | null>(() => {
    // Employees get a deliberately simple scope: Today, or one custom date —
    // no ranges. Owners keep the full All time / Today / Custom range control.
    if (isEmployee) {
      const day = empMode === 'today' ? todayKey() : empDate
      return day ? { from: day, to: day } : null
    }
    if (effRange.from && effRange.to) return { from: effRange.from, to: effRange.to }
    return null
  }, [isEmployee, empMode, empDate, effRange])
  const rangeKey = range ? `${range.from}..${range.to}` : 'all'

  // Purchase bills aren't part of this route's DataProvider prefetch (see
  // ROUTE_COLLS in src/data/DataProvider.tsx), fetched directly here, same
  // pattern as the receipts fetch above, so the Cash Flow register can show
  // supplier bills alongside sales/payments/receipts/income-expense.
  const loadPurchases = () => {
    repo.listPurchases(shopId, range ?? undefined).then((p) => setPurchases(p)).catch(() => {})
  }

  // Unified parallel fetch across all 5 financial streams whenever shopId, rangeKey, or reloadTick changes.
  const [ranged, setRanged] = useState<{
    sales: PSale[]; purchases: PPurchase[]; payments: PVoucher[]; receipts: PVoucher[]; incexp: PIncExp[]
  } | null>(null)

  useEffect(() => {
    if (!shopId) return
    let alive = true
    Promise.all([
      repo.listSales(shopId, range ?? undefined),
      repo.listPurchases(shopId, range ?? undefined),
      repo.listVouchers(shopId, 'payments', range ?? undefined),
      repo.listVouchers(shopId, 'receipts', range ?? undefined),
      repo.listIncExp(shopId, range ?? undefined),
    ])
      .then(([sales, purchases, payments, receipts, incexp]) => {
        if (!alive) return
        setRanged({ sales, purchases, payments, receipts, incexp })
        setPurchases(purchases)
        setReceipts(receipts)
      })
      .catch(() => {
        if (alive) {
          setRanged(null)
          toast('Could not load financial records for that period.', 'err')
        }
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, rangeKey, reloadTick])

  const salesSrc = searched ? searched.sales : (ranged ? ranged.sales : d.sales)
  const purchasesSrc = searched ? searched.purchases : (ranged ? ranged.purchases : purchases)
  const paymentsSrc = ranged ? ranged.payments : d.payments
  const receiptsSrc = ranged ? ranged.receipts : receipts
  const incexpSrc = ranged ? ranged.incexp : d.incexp

  const cfMetrics = useMemo(() => {
    const liveSales = salesSrc.filter((s) => !s.isVoid)
    const salesTotal = liveSales.reduce((a, s) => a + s.total, 0)
    const salesCount = liveSales.length

    const purTotal = purchasesSrc.reduce((a, p) => a + p.amount, 0)
    const purchasesCount = purchasesSrc.length

    const settledPayments = paymentsSrc.filter((p) => p.status !== 'Pending')
    const paymentsTotal = settledPayments.reduce((a, p) => a + p.amount, 0)

    const incomeTotal = incexpSrc.filter((v) => v.type === 'Income').reduce((a, v) => a + v.amount, 0)
    const expenseTotal = incexpSrc.filter((v) => v.type === 'Expense').reduce((a, v) => a + v.amount, 0)

    const clearedReceipts = receiptsSrc.filter((r) => r.status !== 'Pending').reduce((a, r) => a + r.amount, 0)
    const immediateCashSales = liveSales.filter((s) => s.method !== 'Khata').reduce((a, s) => a + s.total, 0)

    const totalRealInflow = immediateCashSales + clearedReceipts + incomeTotal
    const totalRealOutflow = paymentsTotal + expenseTotal
    const net = totalRealInflow - totalRealOutflow

    return {
      sales: salesTotal,
      salesCount,
      purchases: purTotal,
      purchasesCount,
      payments: paymentsTotal,
      income: incomeTotal,
      expense: expenseTotal,
      net,
    }
  }, [salesSrc, purchasesSrc, paymentsSrc, receiptsSrc, incexpSrc])

  const suppliers = useMemo(() => d.accounts.filter((a) => a.type === 'Supplier'), [d.accounts])

  const moves = useMemo<Move[]>(() => {
    const rows: Move[] = [
      ...salesSrc.map((s) => {
        const count = s.items?.length || (s as any).itemCount || 1
        const tMs = s.createdAt ? Date.parse(s.createdAt) : NaN
        const time = !Number.isNaN(tMs) ? new Date(tMs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : undefined
        return {
          key: `s${s.id}`,
          date: s.date,
          time,
          rawCreatedAt: s.createdAt,
          voucher: `INV-${s.billNo}`,
          particulars: `${(s.customerName || 'WALK IN CUSTOMER').toUpperCase()} · ${count} item${count === 1 ? '' : 's'}`,
          kind: 'green',
          kindLabel: 'Sale',
          inflow: s.total,
          outflow: 0,
          // Bug fix (2026-08-30): a Khata (credit) sale moves no cash at the
          // moment of sale: the shop is owed the money, not holding it.
          // Marking it pending (same convention PaymentVoucher/ReceiptVoucher
          // already use via `status`) excludes it from the running balance
          // and Cash in/out totals until the customer actually pays, which
          // is when the later ReceiptVoucher row (already handled below)
          // becomes the real cash inflow. Without this, every Khata sale was
          // counted twice: once here at sale time, once again at receipt.
          pending: s.method === 'Khata',
          mode: s.method,
          saleId: s.id,
          searchText: [`INV-${s.billNo}`, s.billNo, s.customerName, s.method, ...(s.itemsPreview || [])].join(' '),
          detail: [
            ['Customer', s.customerName || 'WALK IN CUSTOMER'],
            ['Payment method', s.method],
            ['Total', money(s.total)],
          ] as [string, string][],
        }
      }),
      ...receipts.map((p) => {
        const tMs = (p as any).createdAt ? Date.parse((p as any).createdAt) : NaN
        const time = !Number.isNaN(tMs) ? new Date(tMs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : undefined
        return {
          key: `r${p.id}`,
          date: p.date,
          time,
          rawCreatedAt: (p as any).createdAt,
          voucher: p.voucherNo,
          particulars: p.party,
          kind: 'blue',
          kindLabel: 'Receipt',
          inflow: p.amount,
          outflow: 0,
          pending: p.status === 'Pending',
          mode: p.mode,
          ref: p.ref,
          searchText: [p.voucherNo, p.party, p.mode, p.ref].join(' '),
          detail: [
            ['Received from', p.party],
            ['Mode', p.mode],
            ['Reference', p.ref || '—'],
            ['Status', p.status],
            ['Amount', money(p.amount)],
          ] as [string, string][],
        }
      }),
      ...paymentsSrc.map((p) => {
        const tMs = (p as any).createdAt ? Date.parse((p as any).createdAt) : NaN
        const time = !Number.isNaN(tMs) ? new Date(tMs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : undefined
        return {
          key: `y${p.id}`,
          date: p.date,
          time,
          rawCreatedAt: (p as any).createdAt,
          voucher: p.voucherNo,
          // Show WHICH supplier bill this payment settles, the register is
          // the reconciliation surface for "payment recorded but bill unpaid"
          // reports.
          particulars: p.purchaseBillNo ? `${p.party} · Bill ${p.purchaseBillNo}` : p.party,
          kind: 'red',
          kindLabel: 'Payment',
          inflow: 0,
          outflow: p.amount,
          pending: p.status === 'Pending',
          mode: p.mode,
          ref: p.ref,
          searchText: [p.voucherNo, p.party, p.mode, p.ref, p.purchaseBillNo || ''].join(' '),
          detail: [
            ['Paid to', p.party],
            ['Mode', p.mode],
            ['Reference', p.ref || '—'],
            ['Settles bill', p.purchaseBillNo || '— (on-account credit)'],
            ['Status', p.status],
            ['Amount', money(p.amount)],
          ] as [string, string][],
        }
      }),
      ...purchasesSrc.map((p) => {
        const tMs = p.createdAt ? Date.parse(p.createdAt) : NaN
        const time = !Number.isNaN(tMs) ? new Date(tMs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : undefined
        return {
          key: `pu${p.id}`,
          date: p.date,
          time,
          rawCreatedAt: p.createdAt,
          voucher: p.billNo,
          particulars: `${p.supplierName} · Bill ${p.billNo}`,
          kind: 'gray',
          kindLabel: 'Purchase',
          // A purchase bill received on credit is not itself a cash
          // movement: only the PaymentVoucher rows above (created at
          // intake or later via "Settle this bill") represent real cash
          // paid to the supplier. This row is informational (an "owed to
          // supplier" event, mirroring the Khata-sale treatment above) and
          // is excluded from the running balance / Cash in-out totals via
          // pending: true, so it can never double-count with the payments.
          // outflow is the bill's remaining OUTSTANDING balance, not its
          // full amount: the already-paid portion is already represented
          // for real by a separate, settled PaymentVoucher row (either from
          // intake payment or "Settle this bill"), so using the full amount
          // here would overstate the "Pending out" tile for partially-paid
          // bills by counting the paid portion twice.
          inflow: 0,
          outflow: Math.max(0, p.amount - p.paidAmount),
          pending: true,
          purchaseId: p.id,
          searchText: [p.billNo, p.supplierName, p.status, ...(p.itemsPreview || [])].join(' '),
          detail: [
            ['Supplier', p.supplierName],
            ['Bill no.', p.billNo],
            ['Total amount', money(p.amount)],
            ['Paid so far', money(p.paidAmount)],
            ['Status', p.status],
          ] as [string, string][],
        }
      }),
      ...incexpSrc.map((e) => {
        const tMs = (e as any).createdAt ? Date.parse((e as any).createdAt) : NaN
        const time = !Number.isNaN(tMs) ? new Date(tMs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : undefined
        return {
          key: `i${e.id}`,
          date: e.date,
          time,
          rawCreatedAt: (e as any).createdAt,
          voucher: e.voucherNo,
          particulars: e.head + (e.narration ? ` · ${e.narration}` : ''),
          kind: e.type === 'Income' ? 'purple' : 'warn',
          kindLabel: e.type === 'Income' ? 'Income' : 'Expense',
          inflow: e.type === 'Income' ? e.amount : 0,
          outflow: e.type === 'Expense' ? e.amount : 0,
          pending: false,
          searchText: [e.voucherNo, e.head, e.narration, e.type].join(' '),
          detail: [
            ['Head', e.head],
            ['Type', e.type],
            ['Narration', e.narration || '—'],
            ['Amount', money(e.amount)],
          ] as [string, string][],
        }
      }),
    ]
    return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.rawCreatedAt || '').localeCompare(a.rawCreatedAt || ''))
  }, [salesSrc, receipts, paymentsSrc, incexpSrc, purchasesSrc])

  const withBalance = useMemo<MoveRow[]>(() => {
    let bal = 0
    const balMap = new Map<string, number>()
    for (const m of [...moves].reverse()) {
      if (!m.pending) {
        bal += m.inflow - m.outflow
        balMap.set(m.key, bal)
      }
    }
    return moves.map((m) => ({ ...m, balance: m.pending ? null : balMap.get(m.key) ?? 0 }))
  }, [moves])

  const filtered = useMemo(() => {
    let rows = withBalance
    if (filter === 'sales') rows = rows.filter((m) => m.kindLabel === 'Sale')
    else if (filter === 'purchase') rows = rows.filter((m) => m.kindLabel === 'Purchase')
    else if (filter === 'payments') rows = rows.filter((m) => m.kindLabel === 'Payment' || m.kindLabel === 'Receipt')
    else if (filter === 'income') rows = rows.filter((m) => m.kindLabel === 'Income')
    else if (filter === 'expense') rows = rows.filter((m) => m.kindLabel === 'Expense')
    // Party / supplier / customer / product / voucher search. Rows now carry a
    // `searchText` that includes the server-side product preview, so typing a
    // brand name finds the sale or purchase invoice that contains it — even
    // when the party text never mentions the product.
    const q = partyQuery.trim().toLowerCase()
    if (q) rows = rows.filter((m) => fuzzyMatch([m.searchText || m.particulars], q))
    return rows
  }, [withBalance, filter, partyQuery])

  // Category total: shown ONLY while a category filter is active (never on
  // "All"), over exactly the rows currently shown in the table.
  const categoryTotal = useMemo(() => {
    const inflow = filtered.reduce((a, m) => a + m.inflow, 0)
    const outflow = filtered.reduce((a, m) => a + m.outflow, 0)
    const pending = filtered.filter((m) => m.pending).reduce((a, m) => a + (m.inflow || m.outflow), 0)
    return { inflow, outflow, pending }
  }, [filtered])

  // Load the full underlying document when a register row is opened, so the
  // drawer shows real items/rates/payments rather than a summary pane.
  useEffect(() => {
    if (!viewing) {
      setSaleDoc(null)
      setPurchaseDoc(null)
      return
    }
    let alive = true
    if (viewing.saleId) {
      setDetailLoading(true)
      setSaleDoc(null)
      repo
        .getSale(shopId, viewing.saleId)
        .then((doc) => { if (alive) setSaleDoc(doc) })
        .catch(() => { if (alive) setSaleDoc(null) })
        .finally(() => { if (alive) setDetailLoading(false) })
    } else if (viewing.purchaseId) {
      setDetailLoading(true)
      setPurchaseDoc(null)
      repo
        .getPurchase(shopId, viewing.purchaseId)
        .then((doc) => { if (alive) setPurchaseDoc(doc) })
        .catch(() => { if (alive) setPurchaseDoc(null) })
        .finally(() => { if (alive) setDetailLoading(false) })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing?.key, shopId])

  function openEntry(t: 'payment' | 'income' | 'expense') {
    setEntryType(t)
    setCreating(true)
  }

  async function save() {
    const amt = Math.round(form.amount * 100) / 100
    if (!(amt > 0)) return toast('Enter an amount above zero.', 'err')
    setBusy(true)
    try {
      if (entryType === 'payment') {
        if (!form.partyId) return toast('Pick a supplier to pay.', 'err')
        const v = await repo.recordPayment(shopId, {
          supplier_id: form.partyId,
          amount: amt,
          mode: form.mode,
          ref: form.ref.trim(),
          // Reused across retries of the same intent; rotated on success.
          idempotency_key: formIdemKey,
        })
        toast(`Payment ${v.voucherNo} recorded.`)
        setFormIdemKey(crypto.randomUUID())
        loadPurchases()
      } else {
        const head = form.head.trim()
        if (!head) return toast('Enter a category head for the entry.', 'err')
        const v = await repo.createVoucher(shopId, {
          head,
          type: entryType === 'income' ? 'Income' : 'Expense',
          amount: amt,
          narration: form.narration.trim(),
          ...(form.entryDate ? { date: form.entryDate } : {}),
        })
        toast(`Voucher ${v.voucherNo} posted.`)
      }
      setCreating(false)
      setForm({ partyId: '', mode: 'Cash', ref: '', amount: 0, head: '', narration: '', entryDate: '' })
      d.refresh()
      // Re-run the period reads so a newly posted entry lands in the
      // active date window immediately.
      setReloadTick((t) => t + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {showSummary && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 1,
            background: 'var(--line)',
            border: '1px solid var(--line)',
            marginBottom: 20,
          }}
        >
          <div style={{ padding: '10px 14px', background: 'var(--canvas)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Sales</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>{money(cfMetrics.sales)}</div>
            <div className="t-caption">{cfMetrics.salesCount} bills</div>
          </div>
          <div style={{ padding: '10px 14px', background: 'var(--canvas)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Purchase</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>{money(cfMetrics.purchases)}</div>
            <div className="t-caption">{cfMetrics.purchasesCount} bills</div>
          </div>
          <div style={{ padding: '10px 14px', background: 'var(--canvas)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Supplier Payments</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 600, color: 'var(--err)' }}>{money(cfMetrics.payments)}</div>
            <div className="t-caption">Settled to suppliers</div>
          </div>
          <div style={{ padding: '10px 14px', background: 'var(--canvas)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Income</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ok-fg)' }}>{money(cfMetrics.income)}</div>
            <div className="t-caption">Direct income</div>
          </div>
          <div style={{ padding: '10px 14px', background: 'var(--canvas)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Expense</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 600, color: 'var(--err)' }}>{money(cfMetrics.expense)}</div>
            <div className="t-caption">Operating costs</div>
          </div>
          <div style={{ padding: '10px 14px', background: 'var(--canvas)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>Net Movement</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 600, color: cfMetrics.net >= 0 ? 'var(--ok-fg)' : 'var(--err)' }}>
              {cfMetrics.net >= 0 ? `+${money(cfMetrics.net)}` : money(cfMetrics.net)}
            </div>
            <div className="t-caption">{cfMetrics.net >= 0 ? 'Net surplus' : 'Net deficit'}</div>
          </div>
        </div>
      )}

      <Panel>
        <div className="panel-head">
          <div className="panel-title-group">
            <h3 className="panel-title" style={{ margin: 0 }}>Register</h3>
            <span className="t-caption">
              {range
                ? `${ddisplay(range.from)}${range.from !== range.to ? ` – ${ddisplay(range.to)}` : ''} · ${filtered.length} shown`
                : `${filtered.length} shown`}
            </span>
          </div>
          <div className="panel-actions">
            <div className="toolbar-grow search-box">
              <input
                className="field-control"
                placeholder="Search bill, party, product, voucher…"
                aria-label="Search cash flow"
                value={partyQuery}
                onChange={(e) => setPartyQuery(e.target.value)}
              />
            </div>
            <select
              className="field-control"
              style={{ width: 130 }}
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              aria-label="Filter by transaction type"
            >
              {FILTERS.map((f) => (
                <option key={f.v} value={f.v}>
                  {f.label}
                </option>
              ))}
            </select>
            {isEmployee ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="seg" role="group" aria-label="Date scope">
                  <button
                    type="button"
                    className={`seg-btn ${empMode === 'today' ? 'active' : ''}`}
                    onClick={() => setEmpMode('today')}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${empMode === 'custom' ? 'active' : ''}`}
                    onClick={() => setEmpMode('custom')}
                  >
                    Custom date
                  </button>
                </div>
                {empMode === 'custom' && (
                  <input
                    type="date"
                    className="field-control"
                    style={{ width: 150 }}
                    value={empDate}
                    max={todayKey()}
                    onChange={(e) => setEmpDate(e.target.value)}
                    aria-label="Custom date"
                  />
                )}
              </div>
            ) : (
              <DateRangeFilter state={dateState} onChange={setDateState} align="right" />
            )}
            <Btn variant="primary" onClick={() => openEntry('payment')}>
              + New entry
            </Btn>
          </div>
        </div>

        {filter !== 'all' && (
          <div className="cf-cat-total" role="status">
            <span className="cf-cat-label">{FILTER_TOTAL_LABEL[filter]}</span>
            <span className="cf-cat-val num">
              {filter === 'payments'
                ? `${money(categoryTotal.inflow)} in · ${money(categoryTotal.outflow)} out`
                : money(filter === 'sales' || filter === 'income' ? categoryTotal.inflow : categoryTotal.outflow)}
            </span>
            <span className="t-caption">
              {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
              {categoryTotal.pending > 0 ? ` · ${money(categoryTotal.pending)} pending/credit` : ''}
            </span>
          </div>
        )}

        <DataTable
          cols={moveCols}
          rows={filtered}
          pageSize={PAGE}
          defaultSort={{ key: 'date', dir: 'desc' }}
          onRowClick={(m) => setViewing(m)}
          rowKey={(m) => m.key}
          empty={
            <EmptyState title="Nothing here yet" hint="Record a sale, payment or voucher to see it in the flow." />
          }
        />
      </Panel>

      <Drawer open={!!viewing} title={viewing ? `Voucher ${viewing.voucher}` : ''} onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <div className="kv-list">
              {viewing.detail.map(([k, v]) => (
                <div className="kv-row" key={k}>
                  <span className="kv-key">{k}</span>
                  <span className="kv-val num">{v}</span>
                </div>
              ))}
            </div>

            {/* Full underlying document: the register row is a summary, so the
                drawer loads the real invoice with its items, rates, totals and
                payment breakdown instead of a partial key/value pane. */}
            {viewing.saleId && detailLoading && <div className="skeleton" style={{ height: 120, marginTop: 16 }} />}
            {viewing.saleId && !detailLoading && saleDoc && (
              <div style={{ marginTop: 16 }}>
                <div className="micro-label">Items</div>
                <table className="tbl">
                  <thead>
                    <tr><th>Item</th><th className="td-right">Qty</th><th className="td-right">Rate</th><th className="td-right">Amount</th></tr>
                  </thead>
                  <tbody>
                    {(saleDoc.items || []).map((it) => (
                      <tr key={it.id}>
                        <td>{it.productName}{it.discount ? <span className="td-muted"> · disc {money(it.discount)}</span> : null}</td>
                        <td className="td-right num">{it.qty} {it.unit}</td>
                        <td className="td-right num">{money(it.rate)}</td>
                        <td className="td-right num">{money(it.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="kv-list" style={{ marginTop: 12 }}>
                  <div className="kv-row"><span className="kv-key">Subtotal</span><span className="kv-val num">{money(saleDoc.subtotal)}</span></div>
                  {saleDoc.discount > 0 && <div className="kv-row"><span className="kv-key">Discount{saleDoc.couponCode ? ` (${saleDoc.couponCode})` : ''}</span><span className="kv-val num">− {money(saleDoc.discount)}</span></div>}
                  {saleDoc.gstAmount > 0 && <div className="kv-row"><span className="kv-key">GST</span><span className="kv-val num">{money(saleDoc.gstAmount)}</span></div>}
                  {saleDoc.tip > 0 && <div className="kv-row"><span className="kv-key">Tip</span><span className="kv-val num">{money(saleDoc.tip)}</span></div>}
                  <div className="kv-row"><span className="kv-key">Total</span><span className="kv-val num">{money(saleDoc.total)}</span></div>
                </div>
                {saleDoc.payments && saleDoc.payments.length > 0 && (
                  <>
                    <div className="micro-label" style={{ marginTop: 12 }}>Payments</div>
                    <div className="kv-list">
                      {saleDoc.payments.map((p, i) => (
                        <div className="kv-row" key={p.id || i}>
                          <span className="kv-key">{p.method}{p.ref ? ` · ${p.ref}` : ''}</span>
                          <span className="kv-val num">{money(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {viewing.purchaseId && detailLoading && <div className="skeleton" style={{ height: 120, marginTop: 16 }} />}
            {viewing.purchaseId && !detailLoading && purchaseDoc && (
              <div style={{ marginTop: 16 }}>
                <div className="micro-label">Bill items</div>
                <table className="tbl">
                  <thead>
                    <tr><th>Item</th><th className="td-right">Qty</th><th className="td-right">Rate</th><th className="td-right">Amount</th></tr>
                  </thead>
                  <tbody>
                    {(purchaseDoc.items || []).map((it) => (
                      <tr key={it.id}>
                        <td>{it.productName}</td>
                        <td className="td-right num">{it.qty}</td>
                        <td className="td-right num">{money(it.rate)}</td>
                        <td className="td-right num">{money(it.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(purchaseDoc.payments || []).length > 0 && (
                  <>
                    <div className="micro-label" style={{ marginTop: 12 }}>Payments recorded</div>
                    <div className="kv-list">
                      {(purchaseDoc.payments || []).map((p, i) => (
                        <div className="kv-row" key={p.id || i}>
                          <span className="kv-key">{p.voucherNo} · {p.mode}{p.ref ? ` · ${p.ref}` : ''}</span>
                          <span className="kv-val num">{money(p.amount)} </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {viewing.pending && (
              <p className="t-caption" style={{ marginTop: 16 }}>
                Pending vouchers are excluded from the running balance and Cash in/out until settled by the owner.
              </p>
            )}
          </>
        )}
      </Drawer>

      <Drawer
        open={creating}
        title="New cash entry"
        onClose={() => setCreating(false)}
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            <Btn variant="primary" block disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Confirm & record entry'}</Btn>
            <Btn variant="ghost" block onClick={() => setCreating(false)}>Cancel</Btn>
          </div>
        }
      >
        <Field label="Entry type">
          <div className="seg" style={{ width: '100%' }}>
            {([
              { v: 'payment', label: 'Payment' },
              { v: 'income', label: 'Income' },
              { v: 'expense', label: 'Expense' },
            ] as const).map((o) => (
              <button
                key={o.v}
                type="button"
                className={`seg-btn ${entryType === o.v ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setEntryType(o.v)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>

        {entryType === 'payment' ? (
          <>
            <Field label="Pay to" help="Pick a supplier — the payment settles their ledger.">
              <select
                className="field-control"
                value={form.partyId}
                onChange={(e) => setForm({ ...form, partyId: e.target.value })}
              >
                <option value="">Select a supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            {suppliers.length === 0 && (
              <p className="t-caption">No suppliers yet — add one under Accounts first.</p>
            )}
            <div className="form-grid">
              <Field label="Mode">
                <select
                  className="field-control"
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value as 'Cash' | 'UPI' })}
                >
                  <option>Cash</option>
                  <option>UPI</option>
                </select>
              </Field>
              <Field label="Reference no." help="UTR / receipt number for UPI.">
                <input className="field-control num" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} placeholder="Optional" />
              </Field>
              <Field label="Amount (₹)">
                <NumInput
                  className="field-control num"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(n) => setForm({ ...form, amount: n })}
                />
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Category head" help={entryType === 'income' ? 'Where this money came from.' : 'What this money was spent on.'}>
              <input
                className="field-control"
                list="cf-heads"
                value={form.head}
                onChange={(e) => setForm({ ...form, head: e.target.value })}
                placeholder={entryType === 'income' ? 'e.g. Scrap / Empty Bottles' : 'e.g. Shop Rent'}
              />
              <datalist id="cf-heads">
                {HEADS.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
            </Field>
            <div className="form-grid">
              <Field label="Amount (₹)">
                <NumInput
                  className="field-control num"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(n) => setForm({ ...form, amount: n })}
                />
              </Field>
              <Field label="Date" help="Leave blank for today — pick an earlier date to backdate this entry.">
                <input
                  className="field-control"
                  type="date"
                  value={form.entryDate}
                  max={todayKey()}
                  onChange={(e) => setForm({ ...form, entryDate: e.target.value })}
                />
              </Field>
              <Field label="Narration">
                <input
                  className="field-control"
                  value={form.narration}
                  onChange={(e) => setForm({ ...form, narration: e.target.value })}
                  placeholder="Optional note"
                />
              </Field>
            </div>
          </>
        )}
      </Drawer>
    </>
  )
}

export default function CashFlowPageGuarded() {
  const { can } = useAuth()
  if (!can('cashflow')) return <NoAccess what="Cash Flow" />
  return <CashFlowPage />
}