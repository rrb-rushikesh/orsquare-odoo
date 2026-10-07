import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import { compact, dayKeyOfValue, downloadCsv, money, monthKeyOf, num0, payablesOf, receivablesOf, tsToMs } from '@/lib/utils'
import { keyToMs, now, todayKey, useDayTick, APP_TIMEZONE } from '@/lib/clock'
import * as repo from '@/lib/repo'
import { NoAccess, EmptyState, Panel, Tag, Tile } from '@/components/ui'
import { DataTable, type DTCol } from '@/components/DataTable'
import {
  IconPOS,
  IconTruck,
  IconTransfer,
  IconPlus,
  IconDownload,
  IconCheckCircle,
  IconChevronRight,
  IconBox,
  IconBook,
  IconSheet,
} from '@/components/icons'

const ProductImportDrawer = lazy(() => import('@/components/ProductImport').then((m) => ({ default: m.ProductImportDrawer })))

const BAR = { blue: 'var(--blue)', green: 'var(--ok)' }

const PALETTE = ['var(--blue)', 'var(--ok)', 'var(--warn-fg)', 'var(--purple-fg)', 'var(--subtle)']

type CatInsight = { cat: string; amt: number; qty: number; share: number; color: string }

const CAT_COLS: DTCol<CatInsight>[] = [
  { key: 'cat', label: 'Category', sortValue: (r) => r.cat.toLowerCase(), render: (r) => <span style={{ fontWeight: 600 }}>{r.cat.toUpperCase()}</span> },
  { key: 'qty', label: 'Qty', align: 'right', sortValue: (r) => r.qty, render: (r) => <span className="num td-muted">{num0(r.qty)}</span> },
  { key: 'amt', label: 'Amount', align: 'right', sortValue: (r) => r.amt, render: (r) => <span className="num">{money(Math.round(r.amt * 100) / 100)}</span> },
  {
    key: 'share', label: 'Share', sortValue: (r) => r.share,
    render: (r) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 6, background: 'var(--layer)' }}>
          <div style={{ width: `${Math.max(2, r.share * 100)}%`, height: '100%', background: r.color }} />
        </div>
        <span className="t-caption num" style={{ width: 42, textAlign: 'right' }}>{(r.share * 100).toFixed(1)}%</span>
      </div>
    ),
  },
]

function DashboardPage() {
  const { can, seesValuation, seesMoney, wsUid, featureOn } = useAuth()
  const kitchenOn = featureOn('kitchen')
  const d = useData()
  const nav = useNavigate()
  const [importOpen, setImportOpen] = useState(false)

  // Drill-down: metrics are live doorways, not dead-end numbers. Each helper
  // carries the exact date window / filter the number represents so the target
  // register opens already scoped to the records that produced it.
  const drill = (path: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString()
    nav(qs ? `${path}?${qs}` : path)
  }

  // One corrected "today" for the whole render. The day tick re-renders the
  // dashboard shortly after midnight, so every number below (Today's sales,
  // cash in/out, profit, week chart) rolls over to the FRESH new day
  // automatically: no manual reload.
  const dayKey = useDayTick()
  const day0 = keyToMs(dayKey)
  const monthStartKey = `${dayKey.slice(0, 7)}-01`
  const yesterday0 = day0 - 86400000
  const month0 = (() => {
    const m0 = new Date(day0)
    m0.setDate(1)
    return m0.getTime()
  })()

  // Write-time summary keeps Today/month totals exact even after bills scroll
  // past the realtime listener window; the window math is the fallback until
  // the first summary doc exists (or for keys that don't match, i.e. clock skew).
  const dkey = dayKey
  const mkey = monthKeyOf(day0)
  const sum = d.salesSummary

  const stats = useMemo(() => {
    // Server summary is authoritative for Today / cash split / month; the
    // window reductions below are fallbacks ONLY for a mismatched dayKey/monthKey
    // (clock skew / fresh day). When a fallback runs it is bounded by the
    // register list (~1000 newest bills), so a >1000-bill day would under-report
    // it: the UI shows a "latest 1000" marker (stats.truncated) when that path
    // is in use, per the DATA-1 lesson: a partial figure must never look like a total.
    const keyOk = !!(sum && sum.dayKey === dkey)
    const monthKeyOk = !!(sum && sum.monthKey === mkey)

    let todaySales = 0
    let billsToday = 0
    let yesterdaySales = 0
    let billsYesterday = 0
    let monthSales = 0
    let cashToday = 0
    let khataToday = 0

    if (keyOk && monthKeyOk) {
      todaySales = Number(sum.todayTotal) || 0
      billsToday = Number(sum.todayBills) || 0
      yesterdaySales = Number(sum.yestTotal) || 0
      billsYesterday = Number(sum.yestBills) || 0
      monthSales = Number(sum.monthTotal) || 0
      cashToday = Number(sum.cashToday) || 0
    } else {
      for (const s of d.sales) {
        const ms = tsToMs(s.date)
        if (ms >= day0) {
          todaySales += s.total
          billsToday += 1
          if (s.method === 'Cash') cashToday += s.total
          else if (s.method === 'Khata') khataToday += s.total
        } else if (ms >= yesterday0 && ms < day0) {
          yesterdaySales += s.total
          billsYesterday += 1
        }
        if (ms >= month0) {
          monthSales += s.total
        }
      }
      if (keyOk) {
        todaySales = Number(sum.todayTotal) || 0
        billsToday = Number(sum.todayBills) || 0
        yesterdaySales = Number(sum.yestTotal) || 0
        billsYesterday = Number(sum.yestBills) || 0
        cashToday = Number(sum.cashToday) || 0
      }
      if (monthKeyOk) {
        monthSales = Number(sum.monthTotal) || 0
      }
    }

    const lowStock = d.products.filter((p) => p.godownPcs + p.counterPcs <= p.lowLevel && p.lowLevel > 0).length
    const upiToday = keyOk ? Number(sum.upiToday) || 0 : Math.max(0, todaySales - cashToday - khataToday)
    const deltaPct = yesterdaySales > 0 ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100) : (todaySales > 0 ? 100 : 0)
    const cashShare = todaySales > 0 ? Math.round((cashToday / todaySales) * 100) : (cashToday > 0 ? 100 : 50)
    let kitchenTodaySales = Number(sum?.kitchenTodaySales) || 0
    let kitchenTodayCount = Number(sum?.kitchenTodayCount) || 0
    let kitchenTodayBills = Number(sum?.kitchenTodayBills) || 0
    if (!kitchenTodaySales && d.sales.length > 0) {
      for (const s of d.sales) {
        if (dayKeyOfValue(s.date) === dkey) {
          let hasKitchen = false
          for (const it of s.items ?? []) {
            const p = d.products.find((prod) => prod.id === it.productId)
            if (p?.isKitchen) {
              hasKitchen = true
              kitchenTodaySales += (it.qty * (Number(it.rate) || 0))
              kitchenTodayCount += it.qty
            }
          }
          if (hasKitchen) kitchenTodayBills++
        }
      }
    }
    const retailTodaySales = sum?.retailTodaySales != null ? Number(sum.retailTodaySales) : Math.max(0, todaySales - kitchenTodaySales)
    const upiShare = Math.max(0, 100 - cashShare)
    return {
      todaySales, yesterdaySales, billsYesterday, billsToday, aov: billsToday ? todaySales / billsToday : 0,
      monthSales, lowStock, cashToday, upiToday, deltaPct, cashShare, upiShare, truncated: !keyOk,
      kitchenTodaySales, kitchenTodayCount, kitchenTodayBills, retailTodaySales,
    }
  }, [d.sales, d.products, d.salesSummary, day0, yesterday0, month0, dkey, mkey, sum])

  // Net profit: server-computed (COGS from the immutable stock ledger + income
  // − expenses). The client list rows carry NO line items, so a client-side
  // fallback would always report a wrong 0, when the summary key mismatches
  // (clock skew / fresh day) the tile shows an em-dash instead.
  // Profit fields are omitted by the server for non-valuation roles.
  const netProfit = useMemo(() => {
    const today = sum && sum.dayKey === dkey && sum.todayNetProfit != null
      ? Number(sum.todayNetProfit) || 0
      : null
    const month = sum && sum.monthKey === mkey && sum.monthNetProfit != null
      ? Number(sum.monthNetProfit) || 0
      : null
    return { today, month }
  }, [sum, dkey, mkey])

  // Cash-flow widget: money in vs out today (settled cash only, like the register).
  // Server fields when the summary key matches; client reductions only on a
  // clock-skew/fresh-day mismatch (bounded by the ~1000-row register cap).
  const moneyFlow = useMemo(() => {
    const keyOk = !!(sum && sum.dayKey === dkey)
    const isToday = (dateVal: string | number) => {
      const k = dayKeyOfValue(dateVal)
      if (k) return k === dkey
      const ms = tsToMs(dateVal)
      return ms >= day0 && ms < day0 + 86400000
    }
    const salesIn = keyOk ? Number(sum.todayTotal) || 0 : d.sales.filter((s) => isToday(s.date)).reduce((a, s) => a + s.total, 0)
    const incomeIn = keyOk ? Number(sum.todayIncome) || 0 : d.incexp.filter((e) => e.type === 'Income' && isToday(e.date)).reduce((a, e) => a + e.amount, 0)
    const payOut = keyOk ? Number(sum.todayPaid) || 0 : d.payments.filter((v) => v.status === 'Cleared' && isToday(v.date)).reduce((a, v) => a + v.amount, 0)
    const expOut = keyOk ? Number(sum.todayExpense) || 0 : d.incexp.filter((e) => e.type === 'Expense' && isToday(e.date)).reduce((a, e) => a + e.amount, 0)
    const pendingOut = keyOk ? Number(sum.pendingOut) || 0 : d.payments.filter((v) => v.status === 'Pending').reduce((a, v) => a + v.amount, 0)
    const inToday = salesIn + incomeIn
    const outToday = payOut + expOut
    return { inToday, outToday, pendingOut }
  }, [d.sales, d.payments, d.incexp, sum, day0, dkey])

  // Basic stats: this month so far (exact via the server summary). The
  // month cash/UPI split comes from the summary too (no dedicated tile, the
  // hero split is Today's; kept here for parity with the server contract).
  const month = useMemo(() => {
    const keyOk = !!(sum && sum.monthKey === mkey)
    const sales =
      keyOk ? Number(sum.monthTotal) || 0 : d.sales.filter((s) => tsToMs(s.date) >= month0).reduce((a, s) => a + s.total, 0)
    const monthCash = keyOk ? Number(sum.monthCash) || 0 : d.sales.filter((s) => tsToMs(s.date) >= month0 && s.method === 'Cash').reduce((a, s) => a + s.total, 0)
    const monthUpi = keyOk ? Number(sum.monthUpi) || 0 : Math.max(0, sales - monthCash)
    const purchases = keyOk ? Number(sum.monthPurchases) || 0 : d.purchases.filter((p) => tsToMs(p.date) >= month0).reduce((a, p) => a + p.amount, 0)
    const paid = keyOk ? Number(sum.monthPaid) || 0 : d.payments.filter((v) => v.status === 'Cleared' && tsToMs(v.date) >= month0).reduce((a, v) => a + v.amount, 0)
    const exp = keyOk ? Number(sum.monthExpenses) || 0 : d.incexp.filter((e) => e.type === 'Expense' && tsToMs(e.date) >= month0).reduce((a, e) => a + e.amount, 0)
    // Type-aware money owed (server convention: customer +ve = owes the shop;
    // supplier +ve = the shop owes them). Sign-only branching miscounts
    // supplier payables as receivables.
    const receivables = receivablesOf(d.accounts)
    const payables = payablesOf(d.accounts)
    return { sales, monthCash, monthUpi, purchases, paid, exp, receivables, payables, monthName: new Date(now()).toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE, month: 'long' }) }
  }, [d.sales, d.purchases, d.payments, d.incexp, d.accounts, d.salesSummary, month0, mkey, sum, dayKey])

  // Needs attention: the four things an owner acts on, in one place.
  const attention = useMemo(() => {
    const pending = d.payments.filter((v) => v.status === 'Pending')
    const receivables = receivablesOf(d.accounts)
    const payables = payablesOf(d.accounts)
    const rows: { label: string; val: string; to: string; kind: 'warn' | 'blue' }[] = []
    if (stats.lowStock > 0) rows.push({ label: 'Low stock', val: `${stats.lowStock} product${stats.lowStock === 1 ? '' : 's'} at or below reorder level`, to: '/stock', kind: 'warn' })
    if (pending.length > 0) rows.push({ label: 'Pending vouchers', val: `${money(pending.reduce((a, v) => a + v.amount, 0))} · ${pending.length} voucher${pending.length === 1 ? '' : 's'} awaiting clearance`, to: '/cashflow', kind: 'warn' })
    if (receivables > 0) rows.push({ label: 'Customers owe', val: money(receivables), to: '/accounts', kind: 'blue' })
    if (payables > 0) rows.push({ label: 'You owe suppliers', val: money(payables), to: '/accounts', kind: 'blue' })
    return { rows, clear: rows.length === 0 }
  }, [d.payments, d.accounts, stats.lowStock])

  // Context: 7-day sales trend (bars) + godown/counter value split.
  const week = useMemo(() => {
    const bars: { label: string; fullDate: string; value: number }[] = []
    // Server week window (oldest → today) when the summary matches today's
    // key: exact even if bills scrolled past the register window.
    if (sum && sum.weekKey === dkey && Array.isArray(sum.weekDaily) && sum.weekDaily.length === 7) {
      for (const day of sum.weekDaily) {
        const dayStart = keyToMs(day.date)
        bars.push({
          label: dayStart ? new Date(dayStart).toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE, weekday: 'short' }) : '—',
          fullDate: dayStart ? new Date(dayStart).toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE, weekday: 'long', day: 'numeric', month: 'short' }) : day.date,
          value: Number(day.total) || 0,
        })
      }
    } else {
      // Fallback: client window over the capped register list.
      // Step via setDate, not fixed 86400000ms, DST locales would mislabel days.
      for (let i = 6; i >= 0; i--) {
        const dayStart = new Date(day0)
        dayStart.setDate(dayStart.getDate() - i)
        const dayEnd = new Date(dayStart)
        dayEnd.setDate(dayEnd.getDate() + 1)
        const v = d.sales.filter((s) => tsToMs(s.date) >= dayStart.getTime() && tsToMs(s.date) < dayEnd.getTime()).reduce((a, s) => a + s.total, 0)
        bars.push({
          label: dayStart.toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE, weekday: 'short' }),
          fullDate: dayStart.toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE, weekday: 'long', day: 'numeric', month: 'short' }),
          value: v,
        })
      }
    }
    const max = Math.max(1, ...bars.map((b) => b.value))
    const godownValue = d.products.reduce((a, p) => a + p.godownPcs * p.mrp, 0)
    const counterValue = d.products.reduce((a, p) => a + p.counterPcs * p.mrp, 0)
    return { bars, max, godownValue, counterValue }
  }, [d.sales, d.products, day0, dkey, sum])

  const delta = stats.deltaPct

  // What sells best: server-computed category mix + top sellers over the
  // whole trading history up to today (the same authoritative aggregate the
  // Overview used; no client-side reductions). Hidden without the money
  // grant, like every other money surface.
  const insightFrom = useMemo(() => {
    const days = d.sales.map((s) => dayKeyOfValue(s.date)).sort()
    return days.length ? days[0] : dayKey
  }, [d.sales, dayKey])

  const [insight, setInsight] = useState<{ categories: CatInsight[]; top: { name: string; qty: number }[] } | null>(null)
  const [insightLoading, setInsightLoading] = useState(true)

  useEffect(() => {
    if (!seesMoney || !wsUid) return
    let alive = true
    setInsightLoading(true)
    // get_reports_summary server-side bounds range_end to the business window of to_date
    repo.reportsSummary(wsUid, insightFrom, dayKey)
      .then((r) => {
        if (!alive) return
        const categories: CatInsight[] = ((r as any).categoryMix ?? []).map((c: any, i: number) => ({
          cat: c.name,
          amt: Number(c.amount) || 0,
          qty: Number(c.count) || 0,
          share: 0,
          color: PALETTE[i % PALETTE.length],
        }))
        const totalAmt = categories.reduce((a, x) => a + x.amt, 0)
        for (const x of categories) x.share = totalAmt ? x.amt / totalAmt : 0
        setInsight({
          categories,
          top: ((r as any).topProducts ?? []).slice(0, 5).map((t: any) => ({ name: t.name, qty: Number(t.quantity) || 0 })),
        })
        setInsightLoading(false)
      })
      .catch(() => {
        if (alive) {
          setInsight(null)
          setInsightLoading(false)
        }
      })
    return () => { alive = false }
  }, [seesMoney, wsUid, insightFrom, dayKey])

  const exportCategoryCsv = () => {
    if (!insight) return
    downloadCsv(
      `sales-by-category-${todayKey()}.csv`,
      insight.categories.map((r) => ({ Category: r.cat, Qty: r.qty, Amount: Math.round(r.amt * 100) / 100 }))
    )
  }

  return (
    <>
      <div className="page-head">
        <div className="page-eyebrow">
          <span>{new Date(now()).toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      </div>

      {/* Quick actions: one tap into daily workflows with Carbon icons. */}
      <div className="quick-actions" role="toolbar" aria-label="Daily quick actions">
        <Link className="qa qa-primary" to="/sales">
          <span className="qa-ic" style={{ color: 'var(--canvas)' }}><IconPOS size={16} /></span>
          <span>New sale</span>
        </Link>
        <Link className="qa" to="/purchases">
          <span className="qa-ic" style={{ color: 'var(--ink)' }}><IconTruck size={16} /></span>
          <span>Record purchase</span>
        </Link>
        <Link className="qa" to="/stock">
          <span className="qa-ic" style={{ color: 'var(--ink)' }}><IconTransfer size={16} /></span>
          <span>Transfer stock</span>
        </Link>
        <Link className="qa" to="/cashflow">
          <span className="qa-ic" style={{ color: 'var(--ok)' }}><IconPlus size={16} /></span>
          <span>New entry</span>
        </Link>
        {can('products') && (
          <button className="qa" onClick={() => setImportOpen(true)}>
            <span className="qa-ic" style={{ color: 'var(--muted)' }}><IconDownload size={16} /></span>
            <span>Import products (Excel)</span>
          </button>
        )}
      </div>

      {!d.ready ? (
        <Panel><div className="skeleton" style={{ height: 200 }} /></Panel>
      ) : (
        <>
          {/* Hero: today in one card: sales, cash/UPI mix, and running cash position. */}
          <div className="dash-hero">
            <div className="hero-main">
              <div className="hero-head">
                <span className="micro-label">Today's sales</span>
                {stats.truncated && <Tag kind="warn">latest 1000</Tag>}
              </div>
              <div className="hero-num num">{money(stats.todaySales)}</div>
              {stats.billsToday > 0 ? (
                <div className="hero-sub">
                  <span className={`hero-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral'}`}>
                    {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {Math.abs(delta)}% vs yesterday
                  </span>
                  <span className="hero-meta">
                    · <strong className="num">{stats.billsToday}</strong> bill{stats.billsToday === 1 ? '' : 's'}
                    · avg <strong className="num">{money(stats.aov)}</strong>
                    {seesValuation && <> · <span className="pos num">{netProfit.today != null ? money(netProfit.today) : '—'}</span> net profit</>}
                  </span>
                </div>
              ) : (
                <div className="hero-sub hero-sub-empty">
                  No bills recorded yet today · Yesterday: <strong className="num">{money(stats.yesterdaySales)}</strong> ({stats.billsYesterday} bill{stats.billsYesterday === 1 ? '' : 's'})
                </div>
              )}
              <div className="coll-split">
                <div className="split-bar" role="img" aria-label={stats.todaySales > 0 ? `Cash ${money(stats.cashToday)} (${stats.cashShare}%), UPI ${money(stats.upiToday)} (${stats.upiShare}%)` : 'No collections yet today'}>
                  {stats.todaySales > 0 ? (
                    <>
                      <div style={{ flex: Math.max(1, stats.cashToday), background: BAR.green }} title={`Cash ${money(stats.cashToday)} (${stats.cashShare}%)`} />
                      <div style={{ flex: Math.max(1, stats.upiToday), background: BAR.blue }} title={`UPI ${money(stats.upiToday)} (${stats.upiShare}%)`} />
                    </>
                  ) : (
                    <div style={{ flex: 1, background: 'var(--layer-2)' }} title="No collections recorded today" />
                  )}
                </div>
                <div className="coll-legend">
                  <span className="num">
                    <span className="dot" style={{ background: stats.todaySales > 0 && stats.cashToday > 0 ? BAR.green : 'var(--subtle)' }} />
                    Cash {money(stats.cashToday)}
                    {stats.todaySales > 0 && <small style={{ color: 'var(--subtle)', marginLeft: 4 }}>({stats.cashShare}%)</small>}
                  </span>
                  <span className="num">
                    <span className="dot" style={{ background: stats.todaySales > 0 && stats.upiToday > 0 ? BAR.blue : 'var(--subtle)' }} />
                    UPI {money(stats.upiToday)}
                    {stats.todaySales > 0 && <small style={{ color: 'var(--subtle)', marginLeft: 4 }}>({stats.upiShare}%)</small>}
                  </span>
                </div>
              </div>
            </div>
            <div className="hero-side" style={{ justifyContent: 'center' }}>
              <div className="hero-kv" style={{ marginTop: 0 }}>
                <div className="hero-kv-row">
                  <span>In · sales + other income</span>
                  <b className="num pos">+{money(moneyFlow.inToday)}</b>
                </div>
                <div className="hero-kv-row">
                  <span>Out · payments + expenses</span>
                  <b className="num neg">-{money(moneyFlow.outToday)}</b>
                </div>
              </div>
              {moneyFlow.pendingOut > 0 && (
                <div className="hero-pending">
                  <Tag kind="warn">{money(moneyFlow.pendingOut)} pending</Tag>
                  <span>in vouchers not yet cleared</span>
                </div>
              )}
              <Link className="hero-link" to="/cashflow?range=today">
                <span>Open cash flow register</span>
                <span aria-hidden>→</span>
              </Link>
              <Link className="hero-link" to="/sales?range=today">
                <span>View today's bills</span>
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>

          {/* Month strip: core financial and operational KPI metrics.
              Every tile drills into the real records behind the number. */}
          <div className="tiles">
            <Tile
              label={`${month.monthName} sales`}
              value={compact(month.sales)}
              note="So far this month"
              onClick={() => drill('/sales', { range: 'custom', from: monthStartKey, to: dayKey })}
              ariaLabel={`${month.monthName} sales: open sales history for this month`}
            />
            {seesValuation && (
              <Tile
                label="Profit"
                value={netProfit.month != null ? compact(netProfit.month) : '—'}
                note="Gross profit − expenses"
                onClick={() => drill('/calendar', { day: dayKey })}
                ariaLabel="Profit: open the calendar report for today"
              />
            )}
            <Tile
              label="Paid out"
              value={compact(month.paid + month.exp)}
              note="Supplier payments + expenses"
              onClick={() => drill('/cashflow', { range: 'custom', from: monthStartKey, to: dayKey })}
              ariaLabel="Paid out: open cash flow for this month"
            />
            <Tile
              label="Customers owe"
              value={compact(month.receivables)}
              note="Outstanding receivables"
              onClick={() => drill('/accounts', { filter: 'receivables' })}
              ariaLabel="Customers owe: open customer ledgers"
            />
            <Tile
              label="You owe suppliers"
              value={compact(month.payables)}
              note="Outstanding payables"
              onClick={() => drill('/accounts', { filter: 'payables' })}
              ariaLabel="You owe suppliers: open supplier ledgers"
            />
          </div>

          {kitchenOn && (
            <div style={{ marginBottom: 16 }}>
              <Panel title="Kitchen Orders & Performance" bodyPad>
                <div className="grid-3" style={{ gap: 12, marginBottom: 12 }}>
                  <Tile
                    label="Today's Kitchen Sales"
                    value={money(stats.kitchenTodaySales)}
                    note={`${stats.kitchenTodayCount} dishes / food items sold`}
                    onClick={() => drill('/sales')}
                    ariaLabel="View kitchen sales in sales register"
                  />
                  <Tile
                    label="Sales Breakdown"
                    value={stats.todaySales > 0 ? `${Math.round((stats.kitchenTodaySales / stats.todaySales) * 100)}% Kitchen` : '—'}
                    note={stats.todaySales > 0 ? `${money(stats.retailTodaySales)} Retail · ${money(stats.kitchenTodaySales)} Kitchen` : 'No sales today yet'}
                    ariaLabel="Retail vs Kitchen revenue share"
                  />
                  <Tile
                    label="Active Kitchen Menu"
                    value={`${d.products.filter((p) => p.isKitchen && p.active !== false).length} Dishes`}
                    note="Dishes ready for billing"
                    onClick={() => drill('/products')}
                    ariaLabel="Open kitchen dishes in products catalog"
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--layer)', border: '1px solid var(--line)' }}>
                  <span className="t-caption" style={{ color: 'var(--ink)' }}>
                    <b>Retail vs Kitchen Today:</b> {stats.todaySales > 0 ? (
                      <>Retail: <b>{money(stats.retailTodaySales)}</b> ({((stats.retailTodaySales / stats.todaySales) * 100).toFixed(1)}%) · Kitchen: <b>{money(stats.kitchenTodaySales)}</b> ({((stats.kitchenTodaySales / stats.todaySales) * 100).toFixed(1)}%)</>
                    ) : 'No transactions recorded today.'}
                  </span>
                  <Link className="link-btn" to="/sales" style={{ fontSize: 12 }}>Open Sales Register</Link>
                </div>
              </Panel>
            </div>
          )}

          {/* Two balanced columns: the insight panels live INSIDE the
              columns so neither side leaves a hole when the other is taller. */}
          <div className="grid-2">
            <div className="rail">
              <Panel title="Needs attention" bodyPad>
                {attention.clear ? (
                  <EmptyState
                    icon={<IconCheckCircle size={36} style={{ color: 'var(--ok-fg)' }} />}
                    title="All operational indicators clear"
                    hint="No low stock alerts, pending vouchers, or unpaid balances require action."
                  />
                ) : (
                  <div className="kv-list">
                    {attention.rows.map((r) => (
                      <Link key={r.label} className="att-row" to={r.to}>
                        <span className="att-tag"><Tag kind={r.kind}>{r.label}</Tag></span>
                        <span className="att-val">{r.val}</span>
                        <span className="att-arrow" aria-hidden><IconChevronRight size={14} /></span>
                      </Link>
                    ))}
                  </div>
                )}
              </Panel>

              {seesMoney && (
                <Panel
                  title="Sales by category"
                  actions={insight && insight.categories.length > 0 ? (
                    <button className="btn-icon" style={{ width: 40, height: 40 }} aria-label="Export to spreadsheet" data-tooltip="Export to spreadsheet" onClick={exportCategoryCsv}>
                      <IconSheet size={16} />
                    </button>
                  ) : undefined}
                  bodyPad
                >
                  {insightLoading ? (
                    <div className="skeleton" style={{ height: 180 }} />
                  ) : (
                    <DataTable
                      cols={CAT_COLS}
                      rows={insight?.categories ?? []}
                      defaultSort={{ key: 'amt', dir: 'desc' }}
                      empty={<EmptyState title="No sales yet" hint="Category insights appear after the first bills are recorded." />}
                    />
                  )}
                </Panel>
              )}
            </div>

            <div className="rail">
              <Panel title="Sales this week" bodyPad>
                <div className="week-chart">
                  {week.bars.map((b, idx) => {
                    const isToday = idx === week.bars.length - 1
                    const heightVal = week.max > 0 ? Math.max(4, Math.round((b.value / week.max) * 80)) : 4
                    return (
                      <div key={b.label + idx} className={`week-col ${isToday ? 'is-today' : ''}`} title={`${b.fullDate}: ${money(b.value)}`}>
                        <span className="week-val num">{b.value > 0 ? compact(b.value).replace('₹ ', '') : '—'}</span>
                        <div className="week-bar-wrap">
                          <div
                            className={`week-bar ${isToday ? 'is-today' : ''}`}
                            style={{ height: `${heightVal}px`, background: 'var(--blue)' }}
                          />
                        </div>
                        <span className="week-label">{isToday ? 'Today' : b.label}</span>
                      </div>
                    )
                  })}
                </div>
              </Panel>

              {seesValuation && (
                <Panel title="Stock value by location" bodyPad>
                  <div className="kv-list">
                    <div className="kv-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                      <span className="kv-key" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted)' }}>
                        <span className="dot" style={{ background: 'var(--blue)' }} /> Counter (sell-ready)
                      </span>
                      <span className="kv-val num" style={{ fontWeight: 600, color: 'var(--ink)' }}>{compact(week.counterValue)}</span>
                    </div>
                    <div className="kv-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                      <span className="kv-key" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted)' }}>
                        <span className="dot" style={{ background: 'var(--subtle)' }} /> Godown (bulk reserve)
                      </span>
                      <span className="kv-val num" style={{ fontWeight: 600, color: 'var(--ink)' }}>{compact(week.godownValue)}</span>
                    </div>
                    <div className="split-bar" style={{ height: '8px', display: 'flex', gap: '2px', marginTop: '10px' }} role="img" aria-label={`Counter ${compact(week.counterValue)}, Godown ${compact(week.godownValue)}`}>
                      <div style={{ flex: Math.max(1, week.counterValue), background: 'var(--blue)' }} title={`Counter: ${compact(week.counterValue)}`} />
                      <div style={{ flex: Math.max(1, week.godownValue), background: 'var(--subtle)' }} title={`Godown: ${compact(week.godownValue)}`} />
                    </div>
                    <div style={{ marginTop: '12px' }}>
                      {stats.lowStock > 0 ? (
                        <Tag kind="warn">{stats.lowStock} product{stats.lowStock === 1 ? '' : 's'} at or below minimum</Tag>
                      ) : (
                        <Tag kind="green">All stock healthy</Tag>
                      )}
                    </div>
                  </div>
                </Panel>
              )}

              {seesMoney && (
                <Panel title="Top sellers" bodyPad>
                  {insightLoading ? (
                    <div className="skeleton" style={{ height: 140 }} />
                  ) : !insight || insight.top.length === 0 ? (
                    <EmptyState title="Not enough data" hint="Best-selling products appear here once bills are recorded." />
                  ) : (
                    <div className="kv-list">
                      {insight.top.map((t, i) => (
                        <div key={`${i}-${t.name}`} className="kv-row">
                          <span className="kv-key">{i + 1}. {t.name}</span>
                          <span className="kv-val num">{num0(t.qty)} pcs</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              )}
            </div>
          </div>
        </>
      )}

      {importOpen && (
        <Suspense fallback={null}>
          <ProductImportDrawer open={importOpen} onClose={() => setImportOpen(false)} />
        </Suspense>
      )}
    </>
  )
}

export default function DashboardPageGuarded() {
  const { can, seesMoney, isEmployee } = useAuth()
  if (!can('dashboard')) return <NoAccess what="Dashboard" />
  // Employees without the money grant get the operational dashboard, no sales
  // totals, no cash position. Employees WITH the money switch see the full view.
  if (isEmployee && !seesMoney) return <StaffDashboard />
  return <DashboardPage />
}

/**
 * Employee dashboard: used when an employee lacks the Money grant. STRICT RULE: no sales
 * totals, no stock value, no cash position, no profit, no money anywhere.
 * Operational only: day status, low-stock alerts, quick actions, piece counts.
 */
export function StaffDashboard() {
  const { can, wsUid } = useAuth()
  const d = useData()
  const dayKey = useDayTick()
  const [dayStatus, setDayStatus] = useState<{ isOpen: boolean; isClosed: boolean; openedByName?: string; openedAt?: string } | null>(null)

  useEffect(() => {
    let alive = true
    if (!wsUid) return
    repo.dayStatus(wsUid, dayKey)
      .then((s) => { if (alive) setDayStatus({ isOpen: s.isOpen, isClosed: s.isClosed, openedByName: s.openedByName, openedAt: s.openedAt }) })
      .catch(() => { if (alive) setDayStatus(null) })
    return () => { alive = false }
  }, [wsUid, dayKey])

  const lowStock = useMemo(() => {
    return d.products
      .filter((p) => p.godownPcs + p.counterPcs <= p.lowLevel && p.lowLevel > 0)
      .sort((a, b) => (a.godownPcs + a.counterPcs) - (b.godownPcs + b.counterPcs))
      .slice(0, 12)
  }, [d.products])

  const counterPcs = useMemo(() => d.products.reduce((a, p) => a + p.counterPcs, 0), [d.products])
  const godownPcs = useMemo(() => d.products.reduce((a, p) => a + p.godownPcs, 0), [d.products])


  const dayState = dayStatus?.isClosed ? 'closed' : dayStatus?.isOpen ? 'open' : 'not-started'
  const dayTone = (dayState === 'open' ? 'green' : dayState === 'closed' ? 'blue' : 'neutral') as 'green' | 'blue' | 'neutral'
  const dayText = dayState === 'open' ? 'Day is open' : dayState === 'closed' ? 'Day closed' : 'Day not started yet'

  return (
    <>
      <div className="page-head">
        <div className="page-eyebrow">
          <span>{new Date(now()).toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      </div>

      <div className="quick-actions" role="toolbar" aria-label="Quick actions">
        {can('sales') && (
          <Link className="qa qa-primary" to="/sales">
            <span className="qa-ic" style={{ color: 'var(--canvas)' }}><IconPOS size={16} /></span>
            <span>New sale</span>
          </Link>
        )}
        {can('stock') && (
          <Link className="qa" to="/stock">
            <span className="qa-ic" style={{ color: 'var(--ink)' }}><IconBox size={16} /></span>
            <span>Stock &amp; transfers</span>
          </Link>
        )}
        {can('daybook') && (
          <Link className="qa" to="/daybook">
            <span className="qa-ic" style={{ color: 'var(--muted)' }}><IconBook size={16} /></span>
            <span>{dayState === 'open' ? 'Close the day' : 'Open the day'}</span>
          </Link>
        )}
      </div>

      {!d.ready ? (
        <Panel><div className="skeleton" style={{ height: 180 }} /></Panel>
      ) : (
        <>
          <div className="tiles">
            <Tile label="Day status" value={dayText} note={dayState === 'open' ? `Opened by ${dayStatus?.openedByName ?? 'staff'}` : dayState === 'closed' ? 'Counter is closed' : 'Ask the owner to open'} tone={dayTone} />
            <Tile label="At the counter" value={num0(counterPcs)} note="Pieces ready to sell" />
            <Tile label="In godown" value={num0(godownPcs)} note="Pieces in storage" />
            <Tile label="Low stock" value={lowStock.length} note={lowStock.length ? 'At or below minimum' : 'All healthy'} tone={lowStock.length ? 'amber' : 'green'} />
          </div>

          <Panel title="Low stock alerts" actions={lowStock.length > 0 ? <Link className="link-btn" to="/stock">Open stock</Link> : undefined} bodyPad>
            {lowStock.length === 0 ? (
              <EmptyState
                icon={<IconCheckCircle size={36} style={{ color: 'var(--ok-fg)' }} />}
                title="Stock is healthy"
                hint="No products are at or below their minimum level."
              />
            ) : (
              <div className="kv-list">
                {lowStock.map((p) => {
                  const total = p.godownPcs + p.counterPcs
                  return (
                    <div className="kv-row" key={p.id}>
                      <span className="kv-key">
                        <span className="dot" style={{ background: total === 0 ? 'var(--err)' : 'var(--warn-fg)' }} />
                        <strong>{p.name}</strong>
                        {p.category && p.category !== '-' && <span className="t-caption" style={{ marginLeft: 6 }}>{p.category}</span>}
                      </span>
                      <span className="kv-val num">
                        {total} pcs
                        <span className="cell-sub">minimum {p.lowLevel}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  )
}