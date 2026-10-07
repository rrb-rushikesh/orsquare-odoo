import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import * as repo from '@/lib/repo'
import type { OwnerSummary } from '@/lib/repo'
import type { PDayStatus, PIncExp, PSale, PSnapshot, PTransfer, PVoucher } from '@/lib/repo'
import type { ReportsSummary } from '@/types'
import { compact, dayKeyOfValue, dayKeyShift, dt, money, num0, round2, tm } from '@/lib/utils'
import { currentBusinessDateKey, saleBusinessDayKey, useCurrentBusinessDate } from '@/lib/businessDay'
import { ddisplay } from '@/components/DateRangeFilter'
import { useSaleDetails } from '@/lib/saleDetails'
import { Btn, ConfirmDialog, EmptyState, Panel, Tag, useToast } from '@/components/ui'

const PALETTE = ['var(--blue)', 'var(--ok)', 'var(--warn-fg)', 'var(--purple-fg)', 'var(--subtle)']

/** Server analytics window (apps/sales/selectors.py caps reports-summary). */
const MAX_RANGE_DAYS = 92

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

const dayLabel = (k: string): string => {
  const d = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

const spanDays = (a: string, b: string): number => {
  const da = new Date(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)))
  const db = new Date(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)))
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

const numv = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

interface DayAgg { total: number; bills: number; cash: number; upi: number; khata: number; locked: boolean }

/** Additive `days` metadata on reports-summary (lock-in v2): once a shop's
 *  business-day cutoff has passed, that date is marked sealed with the cutoff
 *  time that sealed it. */
type SummaryWithDays = ReportsSummary & {
  days?: Record<string, { sealed?: boolean; lock_in_time?: string }>
}

interface MonthRows {
  sales: PSale[]
  transfers: PTransfer[]
  incexp: PIncExp[]
  payments: PVoucher[]
  receipts: PVoucher[]
}

/**
 * Calendar: a month grid of daily totals plus the selected period's report.
 * Day mode is the silent default (click a day -> its report). `Range` and
 * `All time` are explicit toggle buttons, mutually exclusive, self-off.
 * Range report is one server reports-summary GET (COGS-costed, never a
 * client-side list reduction). All time is clamped to the server's 92-day
 * analytics window with an honest caption.
 */
export default function ReportCalendar() {
  const d = useData()
  const { wsUid, seesValuation, user, isOwner, featureOn, activeShop } = useAuth()
  const toast = useToast()
  const kitchenOn = featureOn('kitchen')
  const [subTab, setSubTab] = useState<'all' | 'retail' | 'kitchen'>('all')
  // Owner = control layer: a multi-shop owner gets the standardized
  // All Retailers <-> Individual Retailer scope filter. "All Retailers" is a
  // consolidated business-wide view fed by the server owner-summary endpoint;
  // picking one retailer drills down to that shop's normal calendar.
  const isMultiShopOwner = isOwner && (user?.shops?.length ?? 0) > 1
  const [scopeShopId, setScopeShopId] = useState<string | null>(null)
  const consolidated = isMultiShopOwner && scopeShopId === null
  const shopId = consolidated ? wsUid : (scopeShopId ?? wsUid)

  const [view, setView] = useState(() => {
    // Corrected clock: never the raw device clock (see src/lib/clock.ts).
    const [ty, tm] = currentBusinessDateKey(activeShop?.lockInTime).split('-').map(Number)
    return { y: ty, m: tm - 1 }
  })
  type CalMode = 'day' | 'range' | 'all'
  const [mode, setMode] = useState<CalMode>('day')
  const [selPick, setSelPick] = useState<{ from: string; to: string } | null>(null)
  const [didPick, setDidPick] = useState(false)
  const allTime = mode === 'all'
  // "Today" is the shop's current BUSINESS date - it rolls over at the shop's
  // lock-in (default 02:00 IST), exactly where the server seals the day. It
  // used to roll over at IST midnight (useDayTick), so between 00:00 and the
  // cutoff the Calendar called the still-open business day "yesterday", and at
  // the cutoff itself nothing happened on the client at all.
  const shopLockIn = (user?.shops?.find((sh) => sh.id === shopId) ?? activeShop)?.lockInTime
  const calToday = useCurrentBusinessDate(shopLockIn)

  // Live refresh. The current business day must keep calculating while the page
  // is open, and a day that has just ended must flip to its frozen snapshot
  // without a reload. Every server read below used to be fetched ONCE per
  // navigation, so today's totals went stale the moment the next bill was
  // rung and a rolled-over day never froze. `liveRev` changes when today's
  // bills or vouchers change, when the business day rolls over, and on a slow
  // heartbeat (the sealer runs server-side, so the client cannot observe a
  // seal any other way). A sealed day's figures never change, so refetching
  // them is harmless; it is skipped for a day that already has a snapshot.
  const [heartbeat, setHeartbeat] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') setHeartbeat((n) => n + 1)
    }, 60_000)
    return () => clearInterval(id)
  }, [])
  const liveSig = useMemo(() => {
    let voids = 0
    for (const sl of d.sales) if (sl.isVoid) voids++
    return `${d.sales.length}:${d.sales[0]?.id ?? ''}:${voids}:${d.incexp.length}:${d.incexp[0]?.id ?? ''}`
  }, [d.sales, d.incexp])
  const [liveRev, setLiveRev] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setLiveRev((n) => n + 1), 600)
    return () => clearTimeout(t)
  }, [liveSig, calToday, heartbeat])

  const [snaps, setSnaps] = useState<PSnapshot[]>([])
  useEffect(() => {
    if (consolidated) { setSnaps([]); return }
    let alive = true
    repo.listSnapshots(shopId).then((s) => { if (alive) setSnaps(s) }).catch(() => {})
    return () => { alive = false }
  }, [shopId, consolidated, liveRev])
  const snapsByKey = useMemo(() => new Map(snaps.map((s) => [s.dateKey, s])), [snaps])

  const ym = `${view.y}-${pad(view.m + 1)}`

  const [mrows, setMrows] = useState<MonthRows | null>(null)
  const mrowsShopRef = useRef<string>('')
  useEffect(() => {
    if (!shopId || consolidated) { setMrows(null); mrowsShopRef.current = ''; return }
    let alive = true
    setMrows(null)
    mrowsShopRef.current = shopId
    const last = new Date(view.y, view.m + 1, 0).getDate()
    const from = keyOf(view.y, view.m, 1)
    const to = keyOf(view.y, view.m, last)
    Promise.all([
      repo.listSales(shopId, { from, to }),
      repo.listTransfers(shopId, { from, to }),
      repo.listIncExp(shopId, { from, to }),
      repo.listVouchers(shopId, 'payments', { from, to }),
      repo.listVouchers(shopId, 'receipts', { from, to }),
    ])
      .then(([sales, transfers, incexp, payments, receipts]) => { if (alive) setMrows({ sales, transfers, incexp, payments, receipts }) })
      .catch((e) => console.error('[reports] month fetch:', e))
    return () => { alive = false }
  }, [shopId, view.y, view.m, consolidated])

  // Silent refresh of the OPEN month's registers (today's income/expense
  // vouchers and payments are not in the live bill window). Past months never
  // change, and the current rows stay on screen until the new ones land.
  useEffect(() => {
    if (!shopId || consolidated || liveRev === 0 || ym !== calToday.slice(0, 7) || mrowsShopRef.current !== shopId) return
    let alive = true
    const last = new Date(view.y, view.m + 1, 0).getDate()
    const from = keyOf(view.y, view.m, 1)
    const to = keyOf(view.y, view.m, last)
    Promise.all([
      repo.listSales(shopId, { from, to }),
      repo.listTransfers(shopId, { from, to }),
      repo.listIncExp(shopId, { from, to }),
      repo.listVouchers(shopId, 'payments', { from, to }),
      repo.listVouchers(shopId, 'receipts', { from, to }),
    ])
      .then(([sales, transfers, incexp, payments, receipts]) => { if (alive) setMrows({ sales, transfers, incexp, payments, receipts }) })
      .catch(() => { /* keep the rows already on screen */ })
    return () => { alive = false }
  }, [liveRev]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stale-guard: while a month read is in flight — or when the selected shop
  // is not the live active shop — the register fallbacks (d.*) belong to a
  // DIFFERENT shop, so they must never render here.
  // The month header's profit figure is a pure projection of the server
  // summary, for the same reason rangeView is (below): the server is
  // COGS-costed, void-filtered, return-netted and business-day-bucketed.
  //
  // It used to be re-derived on the client from the capped sales list, and
  // that re-derivation could not see cost at all - list rows carry
  // itemsPreview/itemCount, never `items` - so dayCost was structurally 0
  // and the "net profit" on screen was turnover, not profit. It also counted
  // voided bills, ignored returns, bucketed income/expense by calendar day
  // instead of the shop's business day, and clamped a loss-making day to 0.
  // Four definitions of "net profit" in one screen; the server has one.
  const [monthRep, setMonthRep] = useState<ReportsSummary | null>(null)
  const [monthRepErr, setMonthRepErr] = useState('')
  useEffect(() => { setMonthRep(null); setMonthRepErr('') }, [shopId, view.y, view.m, consolidated])
  useEffect(() => {
    if (!shopId || consolidated) return
    let alive = true
    const last = new Date(view.y, view.m + 1, 0).getDate()
    const from = keyOf(view.y, view.m, 1)
    const to = keyOf(view.y, view.m, last)
    repo.reportsSummary(shopId, from, to)
      .then((r) => { if (alive) { setMonthRep(r as ReportsSummary); setMonthRepErr('') } })
      .catch((e) => {
        console.error('[calendar] month summary:', e)
        if (alive) setMonthRepErr('Could not load the month summary - check the connection and try again.')
      })
    return () => { alive = false }
  }, [shopId, view.y, view.m, consolidated, liveRev])

  const fallbackOk = !consolidated && shopId === wsUid && !!mrows && mrowsShopRef.current === shopId
  // While a month is open, TODAY's slice always comes from the live window
  // (d.sales), every new counter bill shows up without a refetch; the rest
  // of the month comes from the complete range read.
  const salesSrc = useMemo(() => {
    if (!mrows) return fallbackOk ? d.sales : []
    if (calToday.slice(0, 7) !== ym) return mrows.sales
    // A shop that is not the live active shop has no live window (d.sales is a
    // different shop's). Dropping today's rows and merging nothing in their place
    // made every bill of the open day vanish when an owner drilled into a retailer.
    if (!fallbackOk) return mrows.sales
    // Bug fix (2026-08-31): list rows carry a full ISO timestamp under
    // `date`: compare the DAY KEY, or today's bills never matched the
    // live window merge. Lock-in v2: prefer the server `business_date` so
    // late-night bills land on their business day in every shop.
    return [...mrows.sales.filter((s) => saleBusinessDayKey(s) !== calToday), ...(fallbackOk ? d.sales.filter((s) => saleBusinessDayKey(s) === calToday) : [])]
  }, [mrows, fallbackOk, d.sales, ym, calToday])
  const transfersSrc = fallbackOk ? (mrows?.transfers ?? d.transfers) : (mrows?.transfers ?? [])
  const incexpSrc = fallbackOk ? (mrows?.incexp ?? d.incexp) : (mrows?.incexp ?? [])
  const paymentsSrc = fallbackOk ? (mrows?.payments ?? d.payments) : (mrows?.payments ?? [])
  const receiptsSrc = fallbackOk ? (mrows?.receipts ?? []) : (mrows?.receipts ?? [])

  // ----- Consolidated (All Retailers) month grid data: server owner-summary.
  // `to` on owner-summary is INCLUSIVE (unlike reports-summary).
  const [netMonthRep, setNetMonthRep] = useState<OwnerSummary | null>(null)
  const [netMonthErr, setNetMonthErr] = useState('')
  useEffect(() => {
    if (!consolidated || !wsUid) { setNetMonthRep(null); setNetMonthErr(''); return }
    let alive = true
    const first = keyOf(view.y, view.m, 1)
    const last = keyOf(view.y, view.m, new Date(view.y, view.m + 1, 0).getDate())
    repo.fetchOwnerSummary(first, last, null)
      .then((r) => { if (alive) { setNetMonthRep(r); setNetMonthErr('') } })
      // A live refresh that fails keeps the figures already on screen.
      .catch(() => { if (alive) setNetMonthErr('Could not load the consolidated month — check the connection and try again.') })
    return () => { alive = false }
  }, [consolidated, wsUid, view.y, view.m, liveRev])
  useEffect(() => { setNetMonthRep(null); setNetMonthErr('') }, [consolidated, wsUid, view.y, view.m])

  const netByDay = useMemo(() => {
    const map = new Map<string, DayAgg>()
    for (const row of netMonthRep?.daily ?? []) {
      map.set(row.date, {
        total: Number(row.collection) || 0,
        bills: Number(row.bills) || 0,
        cash: 0, upi: 0, khata: 0, locked: false,
      })
    }
    return map
  }, [netMonthRep])

  const byDay = useMemo(() => {
    const map = new Map<string, DayAgg>()
    if (consolidated) {
      // All Retailers view: daily buckets come straight from the server's
      // cross-shop owner-summary — never reduced from per-shop client lists.
      for (const [k, v] of netByDay) map.set(k, { ...v })
      return map
    }
    for (const s of salesSrc) {
      // A voided bill is not a sale. The server excludes it (is_void=False)
      // everywhere, and the sealed snapshot below overwrites a sealed day
      // wholesale - so an unfiltered row here inflated the grid, the month
      // total and the day panel for every correction ever made.
      if (s.isVoid) continue
      const dk = saleBusinessDayKey(s)
      const cur = map.get(dk) ?? { total: 0, bills: 0, cash: 0, upi: 0, khata: 0, locked: false }
      cur.total += s.total
      cur.bills++
      // 3-branch counting: Khata credit was silently labelled "UPI" before.
      if (s.method === 'Cash') cur.cash += s.total
      else if (s.method === 'Khata') cur.khata += s.total
      else cur.upi += s.total
      map.set(dk, cur)
    }
    for (const sn of snaps) {
      if ((sn.totalSales ?? 0) === 0 && (sn.billsCount ?? 0) === 0) {
        if (!map.has(sn.dateKey)) continue
      }
      const cur = map.get(sn.dateKey) ?? { total: 0, bills: 0, cash: 0, upi: 0, khata: 0, locked: false }
      cur.total = sn.totalSales ?? 0
      cur.bills = sn.billsCount
      cur.cash = sn.cashSales ?? 0
      cur.upi = sn.upiSales ?? 0
      cur.khata = Math.max(0, (sn.totalSales ?? 0) - (sn.cashSales ?? 0) - (sn.upiSales ?? 0))
      cur.locked = true
      map.set(sn.dateKey, cur)
    }
    return map
  }, [salesSrc, snaps, consolidated, netByDay])

  const daysInView = useMemo(
    () => [...byDay.keys()].filter((k) => k.slice(0, 7) === ym).sort(),
    [byDay, ym]
  )

  const [didFocus, setDidFocus] = useState(false)
  useEffect(() => {
    if (didFocus) return
    const keys = [...byDay.keys(), ...snaps.map((s) => s.dateKey)]
    if (keys.length === 0) return
    setDidFocus(true)
    const latest = keys.sort().pop()!
    setSelPick({ from: latest, to: latest })
    const [y, m] = latest.split('-').map(Number)
    setView({ y, m: m - 1 })
  }, [byDay, snaps, didFocus])

  function go(delta: number) {
    if (mode === 'day') {
      setSelPick(null)
    }
    setView((v) => (v.m + delta < 0
      ? { y: v.y - 1, m: 11 }
      : v.m + delta > 11
        ? { y: v.y + 1, m: 0 }
        : { y: v.y, m: v.m + delta }))
  }
  function goToday() {
    // Anchor to the corrected-clock "today" key, not the raw device clock.
    const k = calToday
    setView({ y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)) - 1 })
  }

  // Day mode (default, no button): click a day -> its report; click the
  // active day again -> deselect (report falls back to the latest trading
  // day). Range mode (explicit toggle): click the start day, then the end
  // day -> inclusive range report; clicking again starts a new range.
  // All time mode: month grid is a plain heatmap; clicking a day drops back
  // to day mode. Spans beyond the server's 92-day analytics window are
  // refused with a hint, never silently clamped.
  function pickDay(k: string) {
    setRangeHint('')
    if (mode === 'all') {
      setMode('day')
      setDidPick(true)
      setSelPick({ from: k, to: k })
      return
    }
    if (mode === 'day') {
      if (didPick && selPick && selPick.from === k && selPick.to === k) {
        clearPick()
        return
      }
      setDidPick(true)
      setSelPick({ from: k, to: k })
      return
    }
    // range mode
    setDidPick(true)
    if (!selPick || selPick.from !== selPick.to) {
      // no anchor yet, or a completed range -> start a fresh one
      setSelPick({ from: k, to: k })
      return
    }
    const from = k < selPick.from ? k : selPick.from
    const to = k < selPick.from ? selPick.from : k
    if (spanDays(from, to) > MAX_RANGE_DAYS - 1) {
      setRangeHint('Range capped at 92 days — pick a closer end date.')
      setSelPick({ from: k, to: k })
      return
    }
    setSelPick({ from, to })
  }

  // Range / All time are manual, mutually exclusive toggles over the silent
  // day default. Entering Range seeds the anchor with the current day
  // selection (if any) so the next click completes the range.
  function toggleMode(target: 'range' | 'all') {
    setRangeHint('')
    if (mode === target) {
      setMode('day')
      return
    }
    setMode(target)
    if (target === 'range') {
      setSelPick((cur) => (cur && cur.from === cur.to ? cur : null))
    }
  }

  function clearPick() {
    setSelPick(null)
    setMode('day')
    setDidPick(false)
    setRangeHint('')
  }

  const effectiveDay = useMemo(() => {
    if (mode === 'day') {
      if (selPick?.from && selPick.from.slice(0, 7) === ym) {
        return selPick.from
      }
      return daysInView.length > 0 ? daysInView[daysInView.length - 1] : null
    }
    return selPick?.from ?? (daysInView.length > 0 ? daysInView[daysInView.length - 1] : null)
  }, [mode, selPick, ym, daysInView])
  const isRange = mode === 'range' && !!selPick && selPick.from !== selPick.to
  const isToday = (k: string) => k === calToday

  // Dynamic guidance for the current mode (the old static caption made the
  // two-click workflow confusing: mode now comes from an explicit button).
  const pickHint = mode === 'day'
    ? 'Click a day for its report'
    : mode === 'all'
      ? 'All time — click any day to jump back to day reports'
      : !selPick
        ? 'Range — click the start day'
        : selPick.from === selPick.to
          ? `Range — click the end day (start: ${ddisplay(selPick.from)})`
          : 'Range active — click any day to start a new range'

  // All time = earliest trading day → today through the same server summary.
  // The selector caps at 92 days, so older history is clamped and labelled.
  const earliestKey = useMemo(() => {
    const keys = [...snaps.map((s) => s.dateKey), ...d.sales.map((s) => dayKeyOfValue(s.date))].filter(Boolean).sort()
    return keys[0] ?? calToday
  }, [snaps, d.sales, calToday])

  const rangeFrom = allTime
    ? (spanDays(earliestKey, calToday) > MAX_RANGE_DAYS - 1 ? dayKeyShift(calToday, -(MAX_RANGE_DAYS - 1)) : earliestKey)
    : isRange
      ? selPick!.from
      : null
  const rangeTo = allTime || isRange ? (allTime ? calToday : selPick!.to) : null
  const rangeClamped = allTime && spanDays(earliestKey, calToday) > MAX_RANGE_DAYS - 1

  // Range / All time / Day report for the consolidated view.
  const [netRep, setNetRep] = useState<OwnerSummary | null>(null)
  const [netLoading, setNetLoading] = useState(false)
  const [netErr, setNetErr] = useState('')
  const netFrom = allTime ? rangeFrom : (isRange ? rangeFrom : effectiveDay)
  const netTo = allTime ? rangeTo : (isRange ? rangeTo : effectiveDay)
  useEffect(() => {
    if (!consolidated || !wsUid || !netFrom || !netTo) {
      if (!consolidated) { setNetRep(null); setNetErr('') }
      return
    }
    let alive = true
    setNetLoading(true)
    setNetErr('')
    repo.fetchOwnerSummary(netFrom, netTo, null)
      .then((r) => { if (alive) { setNetRep(r); setNetLoading(false) } })
      .catch(() => {
        if (alive) { setNetRep(null); setNetErr('Could not load the consolidated report — check the connection and try again.'); setNetLoading(false) }
      })
    return () => { alive = false }
  }, [consolidated, wsUid, netFrom, netTo])

  const [rangeRep, setRangeRep] = useState<ReportsSummary | null>(null)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [rangeErr, setRangeErr] = useState('')
  const [rangeHint, setRangeHint] = useState('')

  useEffect(() => {
    if (!rangeFrom || !rangeTo || !shopId || consolidated) {
      setRangeRep(null)
      return
    }
    let alive = true
    setRangeLoading(true)
    setRangeErr('')
    // Backend get_reports_summary bounds range_end to the business window of rangeTo
    repo.reportsSummary(shopId, rangeFrom, rangeTo)
      .then((r) => { if (alive) { setRangeRep(r as ReportsSummary); setRangeLoading(false) } })
      .catch((e) => {
        console.error('[calendar] range summary:', e)
        if (alive) { setRangeRep(null); setRangeErr('Could not load the range summary — check the connection and try again.'); setRangeLoading(false) }
      })
    return () => { alive = false }
  }, [shopId, rangeFrom, rangeTo, consolidated])

  const daySales = useMemo(() => {
    if (!effectiveDay) return []
    return salesSrc.filter((s) => saleBusinessDayKey(s) === effectiveDay).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  }, [salesSrc, effectiveDay])

  // Line-item hydration is only needed for the single-day report, the range
  // report is server-computed (one summary GET), so skip the per-bill fetches.
  // Consolidated mode uses the server owner-summary — no per-bill hydration.
  const { rows: dayRows, loading: dayLoading } = useSaleDetails(shopId, daySales, { enabled: !isRange && !allTime && !consolidated })

  // Purchases feeding the godown for the selected day (single pass; the old
  // version filtered d.purchases twice inline on every render).
  const dayPurchaseQty = useMemo(() => {
    if (!effectiveDay) return 0
    let qty = 0
    for (const p of d.purchases) {
      if (dayKeyOfValue(p.date) !== effectiveDay) continue
      qty += p.totalQty || p.items?.reduce((is, it) => is + it.qty, 0) || 0
    }
    return qty
  }, [d.purchases, effectiveDay])

  const dayVouchers = useMemo(() => {
    if (!effectiveDay) return { expenses: 0, income: 0 }
    let expenses = 0
    let income = 0
    for (const e of incexpSrc) {
      if (dayKeyOfValue(e.date) !== effectiveDay) continue
      if (e.type === 'Expense') expenses += e.amount
      else income += e.amount
    }
    return { expenses: round2(expenses), income: round2(income) }
  }, [incexpSrc, effectiveDay])

  const dayMoves = useMemo(() => {
    if (!effectiveDay) return { toCounter: 0, toGodown: 0 }
    let toCounter = 0
    let toGodown = 0
    for (const t of transfersSrc) {
      if (dayKeyOfValue(t.date) !== effectiveDay) continue
      if (t.from === 'godown' && t.to === 'counter') toCounter += t.qty
      else if (t.from === 'counter' && t.to === 'godown') toGodown += t.qty
    }
    return { toCounter, toGodown }
  }, [transfersSrc, effectiveDay])

  const [dayStatus, setDayStatus] = useState<PDayStatus | null>(null)
  useEffect(() => {
    if (!effectiveDay || consolidated) return
    let alive = true
    setDayStatus(null)
    repo.dayStatus(shopId, effectiveDay).then((s) => { if (alive) setDayStatus(s) }).catch(() => { if (alive) setDayStatus(null) })
    return () => { alive = false }
  }, [shopId, effectiveDay])

  // Single-day server summary — the SAME reports-summary call Range mode uses,
  // scoped to one business day.
  //
  // Parity fix (2026-09-16): the day panel's money used to be reduced from the
  // client's bill rows, bucketed by `Sale.method`. A Split (part cash, part
  // UPI) bill has method 'Split', so its WHOLE total landed in the UPI column,
  // and refunds posted that day were never netted out of the total — an open
  // day therefore disagreed with the Dashboard, with Reports, and with its own
  // sealed snapshot once the day closed. Gross profit was worse: it used
  // (rate − cost) × qty against the LIVE cost price and a GST-inclusive rate,
  // not taxable − COGS. Money now comes from the server (payment rows, returns
  // netted, COGS from the immutable stock ledger); the client rows still supply
  // the descriptive detail (categories, top items, first/last bill, quantities)
  // which carries no money definition.
  //
  // This one call also carries the sealed-day `days` metadata, so it REPLACES
  // the previous metadata-only fetch rather than adding a request.
  const [daySummary, setDaySummary] = useState<ReportsSummary | null>(null)
  const [sealedCutoff, setSealedCutoff] = useState<string | null>(null)
  useEffect(() => {
    if (!effectiveDay || !shopId || isRange || allTime || consolidated) {
      setDaySummary(null)
      setSealedCutoff(null)
      return
    }
    let alive = true
    repo.reportsSummary(shopId, effectiveDay, effectiveDay)
      .then((r) => {
        if (!alive) return
        setDaySummary(r as ReportsSummary)
        const meta = (r as SummaryWithDays).days?.[effectiveDay]
        if (meta?.sealed) setSealedCutoff(meta.lock_in_time ?? '')
      })
      .catch(() => { if (alive) { setDaySummary(null); setSealedCutoff(null) } })
    return () => { alive = false }
  }, [shopId, effectiveDay, isRange, allTime, consolidated, liveRev])
  // A different day is a different report: clear, but never on a live refresh.
  useEffect(() => { setDaySummary(null); setSealedCutoff(null) }, [shopId, effectiveDay])

  const dayReport = useMemo(() => {
    if (!effectiveDay) return null
    const snap = snapsByKey.get(effectiveDay)
    const catOf = new Map(d.products.map((p) => [p.id, p.category || 'Other']))
    const prodById = new Map(d.products.map((p) => [p.id, p]))
    const amtByCat = new Map<string, number>()
    const qtyByCat = new Map<string, number>()
    const qtyById = new Map<string, number>()
    const amtById = new Map<string, number>()
    let total = 0, cash = 0, upi = 0, khata = 0, cashBills = 0, upiBills = 0, khataBills = 0
    let discount = 0, gst = 0, qty = 0, profit = 0, mrpValue = 0, paymentsOut = 0
    let kitchenSales = 0, kitchenQty = 0, retailSales = 0, retailQty = 0
    const kitchenMap = new Map<string, { name: string; qty: number; amt: number }>()
    const retailMap = new Map<string, { name: string; qty: number; amt: number }>()
    let first = '', last = ''
    for (const s of dayRows) {
      total += s.total
      discount += s.discount
      gst += s.gstAmount
      // 3-branch counting: Khata credit was silently labelled "UPI" before.
      if (s.method === 'Cash') { cash += s.total; cashBills++ }
      else if (s.method === 'Khata') { khata += s.total; khataBills++ }
      else { upi += s.total; upiBills++ }
      const c = s.createdAt || ''
      if (!first || c < first) first = c
      if (c > last) last = c
      for (const it of s.items ?? []) {
        qty += it.qty
        const itemRate = Number(it.rate) || 0
        const itemAmt = it.qty * itemRate
        const cat = (it.productId && catOf.get(it.productId)) || 'Other'
        amtByCat.set(cat, (amtByCat.get(cat) ?? 0) + itemAmt)
        qtyByCat.set(cat, (qtyByCat.get(cat) ?? 0) + it.qty)
        if (it.productId) {
          qtyById.set(it.productId, (qtyById.get(it.productId) ?? 0) + it.qty)
          amtById.set(it.productId, (amtById.get(it.productId) ?? 0) + itemAmt)
          const p = prodById.get(it.productId)
          if (p && p.mrp > 0) mrpValue += p.mrp * it.qty
          const cost = typeof p?.costPrice === 'number' && p.costPrice > 0 ? p.costPrice : 0
          profit += (itemRate - cost) * it.qty

          if (p?.isKitchen) {
            kitchenSales += itemAmt
            kitchenQty += it.qty
            const cur = kitchenMap.get(it.productId) ?? { name: p.name, qty: 0, amt: 0 }
            cur.qty += it.qty
            cur.amt += itemAmt
            kitchenMap.set(it.productId, cur)
          } else {
            retailSales += itemAmt
            retailQty += it.qty
            const cur = retailMap.get(it.productId) ?? { name: p?.name || 'Product', qty: 0, amt: 0 }
            cur.qty += it.qty
            cur.amt += itemAmt
            retailMap.set(it.productId, cur)
          }
        }
      }
    }
    // Server money for the day (payment rows, returns netted, ledger COGS).
    // Applied BEFORE the sealed snapshot so a sealed day still wins with its
    // frozen figures — the two agree by construction (close_day and
    // reports-summary read the same selectors), the snapshot is simply the
    // authoritative frozen copy.
    const dsum = daySummary?.totals
    if (dsum) {
      const serverNet = dsum.net_sales ?? dsum.sales
      if (serverNet != null) total = numv(serverNet)
      let sCash = 0, sUpi = 0, sKhata = 0, sCashB = 0, sUpiB = 0, sKhataB = 0
      let sawMix = false
      for (const p of daySummary?.paymentMix ?? []) {
        sawMix = true
        const amt = numv(p.amount)
        const cnt = Number(p.count) || 0
        if (p.method === 'Cash') { sCash += amt; sCashB += cnt }
        else if (p.method === 'Khata') { sKhata += amt; sKhataB += cnt }
        else { sUpi += amt; sUpiB += cnt }
      }
      if (sawMix) {
        cash = round2(sCash); upi = round2(sUpi); khata = round2(sKhata)
        cashBills = sCashB; upiBills = sUpiB; khataBills = sKhataB
      }
      if (dsum.discounts != null) discount = numv(dsum.discounts)
      if (dsum.gst != null) gst = numv(dsum.gst)
      // Profit fields are omitted by the server for non-valuation roles.
      if (dsum.grossProfit != null) profit = numv(dsum.grossProfit)
      // Items, MRP basis and payments come from the server: the loaded bill list can be partial.
      if (dsum.itemsSold != null) qty = Number(dsum.itemsSold) || 0
      if (dsum.mrpValue != null) mrpValue = numv(dsum.mrpValue)
      if (dsum.paymentsOut != null) paymentsOut = numv(dsum.paymentsOut)
      if (dsum.kitchenSales != null) kitchenSales = numv(dsum.kitchenSales)
      if (dsum.retailSales != null) retailSales = numv(dsum.retailSales)
    }
    if (daySummary?.kitchen) {
      if (daySummary.kitchen.sales != null) kitchenSales = numv(daySummary.kitchen.sales)
      if (daySummary.kitchen.count != null) kitchenQty = daySummary.kitchen.count
    }
    if (snap) {
      if (snap.totalSales != null) total = snap.totalSales
      if (snap.cashSales != null) cash = snap.cashSales
      if (snap.upiSales != null) upi = snap.upiSales
      khata = Math.max(0, total - cash - upi)
      if (snap.discounts != null) discount = snap.discounts
      if (snap.gstCollected != null) gst = snap.gstCollected
      if (snap.grossProfit != null) profit = snap.grossProfit
    }
    const { toCounter, toGodown } = dayMoves
    const totalAmt = [...amtByCat.values()].reduce((a, v) => a + v, 0) || 1
    const srvCats = daySummary?.categoryMix ?? []
    const srvTotal = srvCats.reduce((a, c) => a + numv(c.amount), 0) || 1
    const cats = srvCats.length
      ? srvCats.map((c, i) => ({ cat: c.name, amt: round2(numv(c.amount)), qty: Number(c.count) || 0, share: numv(c.amount) / srvTotal, color: PALETTE[i % PALETTE.length] }))
      : [...amtByCat.entries()].sort((a, b) => b[1] - a[1]).map(([cat, amt], i) => ({
        cat, amt: round2(amt), qty: qtyByCat.get(cat) ?? 0, share: amt / totalAmt, color: PALETTE[i % PALETTE.length],
      }))
    const top = daySummary?.topProducts?.length
      ? daySummary.topProducts.slice(0, 5).map((t) => ({ name: t.name, qty: Number(t.quantity) || 0, amt: round2(numv(t.amount)) }))
      : [...qtyById.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({
        name: prodById.get(id)?.name ?? 'Item', qty: n, amt: round2(amtById.get(id) ?? 0),
      }))
    const effectiveBills = snap?.billsCount != null ? snap.billsCount : daySales.length
    const effExpenses = snap?.expenses != null
      ? snap.expenses
      : (dsum?.expenses != null ? numv(dsum.expenses) : dayVouchers.expenses)
    const effIncome = snap?.otherIncome != null
      ? snap.otherIncome
      : (dsum?.income != null ? numv(dsum.income) : dayVouchers.income)
    const effGross = snap?.grossProfit != null
      ? snap.grossProfit
      : (dsum?.grossProfit != null ? numv(dsum.grossProfit) : round2(profit))
    const effNet = snap?.netProfit != null
      ? snap.netProfit
      : round2(effGross + effIncome - effExpenses - paymentsOut)

    const finalKitchenSales = round2(kitchenSales)
    const finalRetailSales = round2(retailSales || Math.max(0, total - finalKitchenSales))

    return {
      fromSnap: !!snap,
      bills: effectiveBills,
      total: round2(total),
      cash: round2(cash),
      upi: round2(upi),
      khata: round2(khata),
      cashBills, upiBills, khataBills,
      avg: effectiveBills ? total / effectiveBills : 0,
      qty,
      discount: round2(discount),
      gst: round2(gst),
      profit: round2(effGross),
      expenses: round2(effExpenses),
      income: round2(effIncome),
      net: round2(effNet),
      mrpValue: round2(mrpValue),
      paymentsOut: round2(paymentsOut),
      kitchenSales: finalKitchenSales,
      kitchenQty,
      kitchenTop: [...kitchenMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 10),
      retailSales: finalRetailSales,
      retailQty: retailQty || Math.max(0, qty - kitchenQty),
      retailTop: [...retailMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 10),
      cats, top, toCounter, toGodown,
      first, last,
      sealedAt: snap?.sealedAt ?? '',
      sealedByName: snap?.sealedByName ?? '',
    }
  }, [dayRows, daySales.length, effectiveDay, snapsByKey, daySummary, dayVouchers, dayMoves, d.products])

  const cashAudit = useMemo(() => {
    if (!effectiveDay || !dayReport) return null
    let supplierPaid = 0
    for (const p of paymentsSrc) {
      if (dayKeyOfValue(p.date) !== effectiveDay || p.status !== 'Cleared' || p.mode !== 'Cash') continue
      supplierPaid += p.amount
    }
    supplierPaid = round2(supplierPaid)

    let customerReceived = 0
    for (const r of receiptsSrc) {
      if (dayKeyOfValue(r.date) !== effectiveDay || r.status !== 'Cleared' || r.mode !== 'Cash') continue
      customerReceived += r.amount
    }
    customerReceived = round2(customerReceived)

    const otherIn = round2(dayVouchers.income)
    const expenseOut = round2(dayVouchers.expenses)
    const opened = dayStatus != null && (dayStatus.isOpen || dayStatus.isClosed)
    const opening = opened ? dayStatus!.openingCash : null
    const counted = opened && dayStatus!.closingCash != null ? dayStatus!.closingCash : null
    const expected = opening != null ? round2(opening + dayReport.cash + customerReceived + otherIn - supplierPaid - expenseOut) : null
    const variance = expected != null && counted != null ? round2(counted - expected) : null
    return {
      collected: dayReport.cash,
      customerReceived,
      supplierPaid,
      otherIn,
      expenseOut,
      hasActivity: dayReport.cash > 0 || customerReceived > 0 || supplierPaid > 0 || otherIn > 0 || expenseOut > 0,
      opening,
      counted,
      expected,
      variance,
      today: effectiveDay === calToday,
    }
  }, [effectiveDay, dayReport, paymentsSrc, receiptsSrc, dayVouchers, dayStatus, calToday])

  const month = useMemo(() => {
    const days = new Date(view.y, view.m + 1, 0).getDate()
    const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7
    let total = 0, bills = 0, max = 1
    for (const k of daysInView) {
      const a = byDay.get(k)!
      total += a.total
      bills += a.bills
      if (a.total > max) max = a.total
    }
    return { days, lead, total, bills, max }
  }, [daysInView, byDay, view])

  // Month profit: read the server's figure, do not rebuild it. `net` is null
  // until the summary lands (and for a role that may not see valuation), and
  // the header says so rather than showing a number it cannot stand behind.
  //
  // The day-grid bookkeeping (which days had sales, which are sealed) stays
  // local - that is presentation state, not money, and it must stay available
  // while the summary is in flight so the grid can paint immediately.
  const monthNet = useMemo(() => {
    let locked = 0
    let daysWithSales = 0
    for (const k of daysInView) {
      const sn = snapsByKey.get(k)
      if (sn && sn.netProfit != null && ((sn.totalSales ?? 0) > 0 || (sn.billsCount ?? 0) > 0)) locked++
      if ((byDay.get(k)?.bills ?? 0) > 0) daysWithSales++
    }
    const t = monthRep?.totals ?? ({} as ReportsSummary['totals'])
    const gross = t.grossProfit != null ? numv(t.grossProfit) : null
    const inc = numv(t.income)
    const exp = numv(t.expenses)
    const net = t.netProfit != null ? numv(t.netProfit) : (gross != null ? round2(gross + inc - exp - numv(t.paymentsOut)) : null)
    return { net, locked, daysWithSales }
  }, [daysInView, snapsByKey, byDay, monthRep])

  const reportDayLabel = effectiveDay ? dayLabel(effectiveDay) : ''

  // Re-Audit: a one-time correction of history written by the old logic. It
  // restates the stored figures of CLOSED days only and leaves them closed; the
  // normal live/frozen flow above is untouched. Scope follows the view: the
  // picked range, else the selected day, else the month on screen.
  const [reauditOpen, setReauditOpen] = useState(false)
  const [reauditBusy, setReauditBusy] = useState(false)
  const reauditScope = useMemo(() => {
    let from: string, to: string, label: string
    if (isRange && selPick) { from = selPick.from; to = selPick.to; label = `${dayLabel(from)} to ${dayLabel(to)}` }
    else if (mode === 'day' && selPick?.from && selPick.from.slice(0, 7) === ym) { from = selPick.from; to = selPick.from; label = dayLabel(from) }
    else {
      from = keyOf(view.y, view.m, 1); to = keyOf(view.y, view.m, new Date(view.y, view.m + 1, 0).getDate())
      label = new Date(view.y, view.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    }
    let sealed = 0
    for (const k of snapsByKey.keys()) if (k >= from && k <= to) sealed++
    return { from, to, label, sealed }
  }, [isRange, selPick, mode, ym, view, snapsByKey])
  const runReaudit = async () => {
    setReauditBusy(true)
    try {
      const r = await repo.reauditSnapshots(shopId, reauditScope.from, reauditScope.to)
      setReauditOpen(false)
      toast(r.corrected > 0
        ? `Re-audited ${r.audited} closed day${r.audited === 1 ? '' : 's'}; ${r.corrected} restated. They remain closed.`
        : `Re-audited ${r.audited} closed day${r.audited === 1 ? '' : 's'}; nothing needed correcting.`)
      setLiveRev((n) => n + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Re-audit failed.', 'err')
    } finally {
      setReauditBusy(false)
    }
  }

  // Range / All-time view: pure projection of the server summary. The server
  // is COGS-costed and money-authoritative; nothing is reduced from capped
  // client lists here.
  const rangeView = useMemo(() => {
    if (!rangeRep) return null
    const t = rangeRep.totals ?? ({} as ReportsSummary['totals'])
    const sales = numv(t.sales)
    const netSales = numv(t.net_sales ?? t.sales)
    let cash = 0, upi = 0, khata = 0, cashBills = 0, upiBills = 0, khataBills = 0
    for (const p of rangeRep.paymentMix ?? []) {
      const amt = Number(p.amount) || 0
      const cnt = Number(p.count) || 0
      if (p.method === 'Cash') { cash += amt; cashBills += cnt }
      else if (p.method === 'Khata') { khata += amt; khataBills += cnt }
      else { upi += amt; upiBills += cnt }
    }
    const bills = cashBills + upiBills + khataBills
    const totalAmt = (rangeRep.categoryMix ?? []).reduce((a, c) => a + (Number(c.amount) || 0), 0)
    const grossVal = t.grossProfit != null ? numv(t.grossProfit) : null
    const expVal = numv(t.expenses)
    const incVal = numv(t.income)
    const payVal = numv(t.paymentsOut)
    const netVal = t.netProfit != null ? numv(t.netProfit) : (grossVal != null ? round2(grossVal + incVal - expVal - payVal) : null)
    const kitchenSales = numv(rangeRep.kitchen?.sales ?? t.kitchenSales)
    const kitchenCount = Number(rangeRep.kitchen?.count ?? 0)
    const retailSales = numv(rangeRep.retail?.sales ?? t.retailSales ?? Math.max(0, netSales - kitchenSales))
    const retailCount = Number(rangeRep.retail?.count ?? 0)

    return {
      sales,
      netSales,
      bills,
      avg: bills ? sales / bills : 0,
      cash: round2(cash), upi: round2(upi), khata: round2(khata),
      cashBills, upiBills, khataBills,
      qty: (rangeRep.categoryMix ?? []).reduce((a, c) => a + (Number(c.count) || 0), 0),
      gross: grossVal,
      expenses: expVal,
      paymentsOut: payVal,
      income: incVal,
      net: netVal,
      gst: numv(t.gst),
      discount: numv(t.discounts),
      kitchenSales: round2(kitchenSales),
      kitchenCount,
      kitchenTop: (rangeRep.kitchen?.topProducts ?? []).map((p) => ({ name: p.name, qty: Number(p.quantity) || 0, amt: numv(p.amount) })),
      retailSales: round2(retailSales),
      retailCount,
      cats: (rangeRep.categoryMix ?? [])
        .map((c, i) => ({ cat: c.name, amt: numv(c.amount), qty: Number(c.count) || 0, share: 0, color: PALETTE[i % PALETTE.length] }))
        .sort((a, b) => b.amt - a.amt)
        .map((c) => ({ ...c, share: totalAmt ? c.amt / totalAmt : 0 })),
      top: (rangeRep.topProducts ?? []).slice(0, 5).map((p) => ({ name: p.name, qty: Number(p.quantity) || 0, amt: numv(p.amount) })),
    }
  }, [rangeRep])

  return (
    <div className="cal-split">
      <ConfirmDialog
        open={reauditOpen}
        onClose={() => { if (!reauditBusy) setReauditOpen(false) }}
        onConfirm={runReaudit}
        title="Re-Audit closed days"
        confirmLabel="Re-Audit"
        busy={reauditBusy}
      >
        <p>
          Recalculate {reauditScope.sealed} closed day{reauditScope.sealed === 1 ? '' : 's'} in {reauditScope.label} with
          the corrected logic and overwrite their stored figures.
        </p>
        <p className="t-caption" style={{ marginTop: 8 }}>
          The days stay closed. Drawer counts and closing stock are not changed, and each restatement is logged on the day.
          Use this once to correct history written by the old logic.
        </p>
      </ConfirmDialog>
      <Panel
        title={new Date(view.y, view.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        bodyPad
      >
        {/* Owner control layer: the standardized All Retailers <-> Individual
            Retailer scope picker — a dropdown so it stays compact no matter
            how many retailers the business runs. */}
        {isMultiShopOwner && (
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="field-control"
              style={{ minWidth: 240 }}
              value={scopeShopId ?? ''}
              aria-label="Analytics scope — all retailers or one shop"
              onChange={(e) => {
                const v = e.target.value
                setScopeShopId(v === '' ? null : v)
                setDidPick(false)
                setSelPick(null)
                setMode('day')
              }}
            >
              <option value="">All Retailers — combined business</option>
              {(user?.shops ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.is_primary ? `${s.name} (Owner · godown)` : s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Dedicated toolbar row: five controls cannot fit the narrow panel
            head, so this row wraps instead of overflowing, and centres +
            shares width evenly on phones (no horizontal scroll). */}
        <div className="cal-toolbar">
          <Btn sm variant="ghost" onClick={() => go(-1)}>← Prev</Btn>
          <Btn sm variant="ghost" onClick={goToday}>Today</Btn>
          <Btn sm variant="ghost" onClick={() => go(1)}>Next →</Btn>
          <Btn
            sm
            variant={mode === 'range' ? 'secondary' : 'ghost'}
            onClick={() => toggleMode('range')}
            aria-pressed={mode === 'range'}
            title="Toggle range mode — pick a start day, then an end day"
          >
            Range
          </Btn>
          <Btn
            sm
            variant={allTime ? 'secondary' : 'ghost'}
            onClick={() => toggleMode('all')}
            aria-pressed={allTime}
            title="Toggle whole-history report (analytics window capped at 92 days)"
          >
            All time
          </Btn>
          {isOwner && !consolidated && !allTime && (
            <Btn
              sm
              variant="ghost"
              onClick={() => setReauditOpen(true)}
              disabled={reauditScope.sealed === 0}
              title={reauditScope.sealed === 0
                ? 'No closed day in view to re-audit'
                : `Recalculate ${reauditScope.label} with the corrected logic - the days stay closed`}
            >
              Re-Audit
            </Btn>
          )}
        </div>
        {daysInView.length === 0 ? (
          <>
            <EmptyState
              title={consolidated && netMonthErr ? 'Consolidated month unavailable' : `No sales in ${new Date(view.y, view.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`}
              hint={consolidated
                ? (netMonthErr || 'No business-wide sales this month. Use ← Prev to look at an earlier month.')
                : 'Use ← Prev to look at an earlier month. Every day\'s figures are read from this month\'s complete records, not a recent-bills window.'}
            />
            {!consolidated && (
              <p className="t-caption" style={{ marginTop: 8 }}>
                {mrows
                  ? `Full month read straight from the database — 0 bills dated in this month.`
                  : 'Reading the full month from the database…'}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="cal-summary num">
              <span><b>{compact(month.total)}</b> this month</span>
              <span className="t-caption"> · {month.bills} bill{month.bills === 1 ? '' : 's'}</span>
              {seesValuation && (
                <span className="t-caption">
                  {' '}· {monthRepErr
                    ? <>net profit unavailable</>
                    : monthNet.net === null
                      ? <>net profit -</>
                      : monthNet.net !== 0 || monthNet.daysWithSales > 0
                        ? <><b style={{ color: monthNet.net < 0 ? 'var(--err-fg)' : 'var(--ok-fg)' }}>{compact(monthNet.net)}</b> net profit{monthNet.locked > 0 ? ` · ${monthNet.locked} locked day${monthNet.locked === 1 ? '' : 's'}` : ''}</>
                        : <>net profit -</>}
                </span>
              )}
            </div>
            <div className="cal-grid" role="grid" aria-label="Sales by day">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
                <div key={w} className="cal-wd">{w}</div>
              ))}
              {Array.from({ length: month.lead }).map((_, i) => (
                <div key={`lead-${i}`} className="cal-cell cal-empty" />
              ))}
              {Array.from({ length: month.days }, (_, i) => i + 1).map((day) => {
                const key = keyOf(view.y, view.m, day)
                const agg = byDay.get(key)
                // Range mode: endpoints carry .sel, in-between days the violet
                // .rng tint; the per-day intensity tint is day-mode-only.
                const endpoint = mode === 'range' && !!selPick && (selPick.from === key || selPick.to === key)
                const inRng = mode === 'range' && !!selPick && selPick.from !== selPick.to && key > selPick.from && key < selPick.to
                const sel = endpoint || (mode === 'day' && !!selPick && effectiveDay === key)
                const today = isToday(key)
                const inten = agg && !inRng ? 0.06 + 0.28 * (agg.total / month.max) : 0
                return (
                  <button
                    key={key}
                    type="button"
                    className={`cal-cell ${sel ? 'sel' : ''} ${inRng ? 'rng' : ''} ${today ? 'today' : ''} ${agg ? 'has' : ''}`}
                    style={agg && inten > 0 ? { background: `rgba(15, 98, 254, ${inten})` } : undefined}
                    onClick={() => pickDay(key)}
                    aria-pressed={sel}
                    title={agg
                      ? `${compact(agg.total)} · ${agg.bills} bill${agg.bills === 1 ? '' : 's'}${agg.locked ? ' · locked' : ''}`
                      : undefined}
                  >
                    <span className="cal-day num">
                      {day}
                      {today && <span className="cal-today-dot" />}
                      {agg?.locked && <span className="cal-lock" title="Locked day — permanent history">✓</span>}
                    </span>
                    {agg && <span className="cal-amt num">{compact(agg.total)}</span>}
                    {agg && <span className="cal-cnt num">{agg.bills} bill{agg.bills === 1 ? '' : 's'}</span>}
                  </button>
                )
              })}
            </div>
            <p className="t-caption" style={{ marginTop: 8 }}>
              {consolidated
                ? 'Combined totals across every retailer — server-computed, never a partial recent-bills window.'
                : mrows
                  ? `Every day's total above is read from this month's complete records (${mrows.sales.length} bill${mrows.sales.length === 1 ? '' : 's'} this month) — never a partial recent-bills window.`
                  : 'Reading the full month from the database…'}
              {!consolidated && ' ✓ days are locked and never lost.'}
            </p>
            <p className="t-caption" style={{ marginTop: 2 }}>
              {pickHint}
              {rangeHint && <span style={{ color: 'var(--err-fg)' }}> · {rangeHint}</span>}
            </p>
          </>
        )}
      </Panel>

      <div>
        <div className="cal-report" key={allTime ? `all${rangeLoading ? ':load' : ''}` : isRange ? `${rangeFrom}|${rangeTo}${rangeLoading ? ':load' : ''}` : `day-${effectiveDay ?? 'none'}`}>
        {consolidated && (
          <Panel
            title={allTime
              ? 'All time · All Retailers'
              : isRange
                ? `${ddisplay(rangeFrom)} → ${ddisplay(rangeTo)} · All Retailers`
                : `${reportDayLabel} · All Retailers`}
            bodyPad
            actions={
              (isRange || allTime) ? (
                <Btn sm variant="ghost" onClick={clearPick} title="Exit the range and go back to single-day reports">
                  ✕ Clear
                </Btn>
              ) : undefined
            }
          >
            {netLoading ? (
              <div className="skeleton" style={{ height: 260 }} />
            ) : netErr ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                <div className="alert" role="alert">{netErr}</div>
                <Btn sm variant="secondary" onClick={() => { setNetErr(''); setNetLoading(true) }}>Retry</Btn>
              </div>
            ) : !netRep || (Number(netRep.totals.bills) || 0) === 0 ? (
              <EmptyState
                title="No sales in this window"
                hint="Pick a highlighted day or a different range — days with bills are highlighted blue on the calendar."
              />
            ) : (
              <>
                <div className="day-stats">
                  <div className="day-stat day-stat-hero">
                    <span className="day-stat-label">TOTAL COLLECTION</span>
                    <span className="day-stat-val num" title={money(Number(netRep.totals.collection) || 0)}>{money(Number(netRep.totals.collection) || 0)}</span>
                  </div>
                  <div className="day-stat">
                    <span className="day-stat-label">CASH</span>
                    <span className="day-stat-val num" style={{ color: 'var(--ok-fg)' }} title={money(Number(netRep.totals.cash) || 0)}>{money(Number(netRep.totals.cash) || 0)}</span>
                  </div>
                  <div className="day-stat">
                    <span className="day-stat-label">UPI</span>
                    <span className="day-stat-val num" style={{ color: 'var(--blue)' }} title={money(Number(netRep.totals.upi) || 0)}>{money(Number(netRep.totals.upi) || 0)}</span>
                  </div>
                  <div className="day-stat">
                    <span className="day-stat-label">KHATA</span>
                    <span className="day-stat-val num" style={{ color: 'var(--warn-fg)' }} title={money(Number(netRep.totals.khata) || 0)}>{money(Number(netRep.totals.khata) || 0)}</span>
                  </div>
                  <div className="day-stat">
                    <span className="day-stat-label">BILLS</span>
                    <span className="day-stat-val num">{Number(netRep.totals.bills) || 0}</span>
                  </div>
                  <div className="day-stat">
                    <span className="day-stat-label">AVG BILL</span>
                    <span className="day-stat-val num" title={money(Number(netRep.totals.avg_bill) || 0)}>{money(Number(netRep.totals.avg_bill) || 0)}</span>
                  </div>
                  <div className="day-stat">
                    <span className="day-stat-label">ITEMS SOLD</span>
                    <span className="day-stat-val num" title={`${num0(Number(netRep.totals.items_sold) || 0)} pcs`}>{num0(Number(netRep.totals.items_sold) || 0)} pcs</span>
                  </div>
                </div>

                <div className="day-sections-grid" style={{ marginTop: 12 }}>
                  <div className="day-section-col">
                    <div className="subpanel">
                      <div className="subpanel-head">
                        <h4 className="subpanel-title">Retailer comparison</h4>
                      </div>
                      <div className="subpanel-body" style={{ padding: 0 }}>
                        <div className="tbl-scroll">
                          <table className="tbl" style={{ margin: 0 }}>
                            <thead>
                              <tr>
                                <th>RETAILER</th>
                                <th className="td-right">COLLECTION</th>
                                <th className="td-right">BILLS</th>
                                <th className="td-right">AVG</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...netRep.per_shop].sort((a, b) => (Number(b.collection) || 0) - (Number(a.collection) || 0)).map((r) => (
                                <tr key={r.shop_id}>
                                  <td style={{ fontWeight: 600 }}>{r.name} <span className="mono-tag">{r.code}</span></td>
                                  <td className="td-right num">{money(Number(r.collection) || 0)}</td>
                                  <td className="td-right num td-muted">{num0(Number(r.bills) || 0)}</td>
                                  <td className="td-right num td-muted">{money(Number(r.avg_bill) || 0)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="day-section-col">
                    <div className="subpanel">
                      <div className="subpanel-head">
                        <h4 className="subpanel-title">Top sellers</h4>
                      </div>
                      <div className="subpanel-body">
                        {netRep.top_products.length === 0 ? (
                          <EmptyState title="Not enough data" />
                        ) : (
                          <div className="kv-list">
                            {netRep.top_products.slice(0, 5).map((t, i) => (
                              <div key={`${i}-${t.name}`} className="kv-row">
                                <span className="kv-key" style={{ color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>
                                  {i + 1}. {t.name}
                                </span>
                                <span className="kv-val num" style={{ flexShrink: 0, marginLeft: 8 }}>
                                  <span className="td-muted">{num0(Number(t.quantity) || 0)} pcs</span> · <strong>{money(Number(t.amount) || 0)}</strong>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <p className="t-caption" style={{ marginTop: 12 }}>
                  {allTime
                    ? `All time covers the latest ${MAX_RANGE_DAYS} days (server analytics window), combined across every retailer.`
                    : isRange
                      ? 'Combined across every retailer — server-computed over the whole range.'
                      : 'Combined across every retailer for this day. Pick a retailer above for its own report.'}
                </p>
              </>
            )}
          </Panel>
        )}
        {!consolidated && (isRange || allTime) && (
          <Panel
            title={allTime
              ? 'All time · Range report'
              : `${ddisplay(rangeFrom)} → ${ddisplay(rangeTo)} · Range report`}
            bodyPad
            actions={
              <Btn sm variant="ghost" onClick={clearPick} title="Exit range and go back to single-day reports">
                ✕ Clear
              </Btn>
            }
          >
            {rangeLoading ? (
              <div className="skeleton" style={{ height: 260 }} />
            ) : rangeErr ? (
              <EmptyState title="Couldn't load this range" hint={rangeErr} />
            ) : !rangeView || rangeView.bills === 0 ? (
              <EmptyState
                title="No sales in this range"
                hint="Pick a different window on the calendar — days with bills are highlighted blue."
              />
            ) : (
              <>
                {kitchenOn && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                    <Btn sm variant={subTab === 'all' ? 'primary' : 'ghost'} onClick={() => setSubTab('all')}>Overview (All)</Btn>
                    <Btn sm variant={subTab === 'retail' ? 'primary' : 'ghost'} onClick={() => setSubTab('retail')}>Retail Goods</Btn>
                    <Btn sm variant={subTab === 'kitchen' ? 'primary' : 'ghost'} onClick={() => setSubTab('kitchen')}>Kitchen & Dishes</Btn>
                  </div>
                )}

                {subTab === 'kitchen' && kitchenOn ? (
                  <>
                    <div className="day-stats">
                      <div className="day-stat day-stat-hero">
                        <span className="day-stat-label">KITCHEN SALES</span>
                        <span className="day-stat-val num" title={money(rangeView.kitchenSales)}>{money(rangeView.kitchenSales)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">DISHES PREPARED / SOLD</span>
                        <span className="day-stat-val num">{num0(rangeView.kitchenCount)} pcs</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">AVG DISH REVENUE</span>
                        <span className="day-stat-val num">{money(rangeView.kitchenCount > 0 ? rangeView.kitchenSales / rangeView.kitchenCount : 0)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">REVENUE SHARE</span>
                        <span className="day-stat-val num" style={{ color: 'var(--blue)' }}>
                          {rangeView.sales > 0 ? `${((rangeView.kitchenSales / rangeView.sales) * 100).toFixed(1)}%` : '0%'}
                        </span>
                      </div>
                    </div>

                    <div className="day-sections-grid" style={{ marginTop: 12 }}>
                      <div className="day-section-col" style={{ gridColumn: '1 / -1' }}>
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Dishes & Kitchen Items Sold</h4>
                          </div>
                          <div className="subpanel-body" style={{ padding: 0 }}>
                            {rangeView.kitchenTop.length === 0 ? (
                              <div style={{ padding: 12 }}><EmptyState title="No kitchen items sold in this window" /></div>
                            ) : (
                              <div className="tbl-scroll">
                                <table className="tbl" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th style={{ width: 40 }}>#</th>
                                      <th>DISH / MENU ITEM</th>
                                      <th className="td-right">QTY PREPARED</th>
                                      <th className="td-right">TOTAL SALES</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rangeView.kitchenTop.map((dish, idx) => (
                                      <tr key={`${dish.name}-${idx}`}>
                                        <td className="td-muted num">{idx + 1}</td>
                                        <td style={{ fontWeight: 600 }}>{dish.name}</td>
                                        <td className="td-right num">{num0(dish.qty)} pcs</td>
                                        <td className="td-right num" style={{ fontWeight: 600 }}>{money(dish.amt)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : subTab === 'retail' && kitchenOn ? (
                  <>
                    <div className="day-stats">
                      <div className="day-stat day-stat-hero">
                        <span className="day-stat-label">RETAIL GOODS SALES</span>
                        <span className="day-stat-val num" title={money(rangeView.retailSales)}>{money(rangeView.retailSales)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">ITEMS SOLD</span>
                        <span className="day-stat-val num">{num0(rangeView.retailCount)} pcs</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">AVG ITEM VALUE</span>
                        <span className="day-stat-val num">{money(rangeView.retailCount > 0 ? rangeView.retailSales / rangeView.retailCount : 0)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">REVENUE SHARE</span>
                        <span className="day-stat-val num" style={{ color: 'var(--ok-fg)' }}>
                          {rangeView.sales > 0 ? `${((rangeView.retailSales / rangeView.sales) * 100).toFixed(1)}%` : '0%'}
                        </span>
                      </div>
                    </div>

                    <div className="day-sections-grid" style={{ marginTop: 12 }}>
                      <div className="day-section-col">
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Sales by category</h4>
                          </div>
                          <div className="subpanel-body" style={{ padding: 0 }}>
                            {rangeView.cats.length === 0 ? (
                              <div style={{ padding: 12 }}><EmptyState title="No category data" /></div>
                            ) : (
                              <div className="tbl-scroll">
                                <table className="tbl" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>CATEGORY</th>
                                      <th className="td-right">QTY</th>
                                      <th className="td-right">AMOUNT</th>
                                      <th className="td-right" style={{ minWidth: 68 }}>SHARE</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rangeView.cats.map((c) => (
                                      <tr key={c.cat}>
                                        <td style={{ fontWeight: 600 }}>{c.cat.toUpperCase()}</td>
                                        <td className="td-right num td-muted">{num0(c.qty)}</td>
                                        <td className="td-right num" style={{ fontWeight: 500 }}>{money(c.amt)}</td>
                                        <td className="td-right">
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 60 }}>
                                            <div style={{ flex: 1, minWidth: 24, height: 4, background: 'var(--layer)', borderRadius: 0 }}>
                                              <div style={{ width: `${Math.max(2, Math.min(100, c.share * 100))}%`, height: '100%', background: c.color, borderRadius: 0 }} />
                                            </div>
                                            <span className="t-caption num" style={{ width: 28, textAlign: 'right', flexShrink: 0 }}>
                                              {(c.share * 100).toFixed(0)}%
                                            </span>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="day-section-col">
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Top retail sellers</h4>
                          </div>
                          <div className="subpanel-body">
                            {rangeView.top.length === 0 ? (
                              <EmptyState title="Not enough data" />
                            ) : (
                              <div className="kv-list">
                                {rangeView.top.map((t, i) => (
                                  <div key={t.name} className="kv-row">
                                    <span className="kv-key" style={{ color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>
                                      {i + 1}. {t.name}
                                    </span>
                                    <span className="kv-val num" style={{ flexShrink: 0, marginLeft: 8 }}>
                                      <span className="td-muted">{num0(t.qty)} pcs</span> · <strong>{money(t.amt)}</strong>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="day-stats">
                      <div className="day-stat day-stat-hero">
                        <span className="day-stat-label">TOTAL COLLECTION</span>
                        <span className="day-stat-val num" title={money(rangeView.sales)}>{money(rangeView.sales)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">CASH</span>
                        <span className="day-stat-val num" style={{ color: 'var(--ok-fg)' }} title={money(rangeView.cash)}>{money(rangeView.cash)}</span>
                        {rangeView.cashBills > 0 && <span className="day-stat-sub num">{rangeView.cashBills} cash bill{rangeView.cashBills === 1 ? '' : 's'}</span>}
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">UPI</span>
                        <span className="day-stat-val num" style={{ color: 'var(--blue)' }} title={money(rangeView.upi)}>{money(rangeView.upi)}</span>
                        {rangeView.upiBills > 0 && <span className="day-stat-sub num">{rangeView.upiBills} UPI bill{rangeView.upiBills === 1 ? '' : 's'}</span>}
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">KHATA</span>
                        <span className="day-stat-val num" style={{ color: 'var(--warn-fg)' }} title={money(rangeView.khata)}>{money(rangeView.khata)}</span>
                        {rangeView.khataBills > 0 && <span className="day-stat-sub num">{rangeView.khataBills} credit bill{rangeView.khataBills === 1 ? '' : 's'}</span>}
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">BILLS</span>
                        <span className="day-stat-val num">{rangeView.bills}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">AVG BILL</span>
                        <span className="day-stat-val num" title={money(rangeView.avg)}>{money(rangeView.avg)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">ITEMS SOLD</span>
                        <span className="day-stat-val num" title={`${num0(rangeView.qty)} pcs`}>{num0(rangeView.qty)} pcs</span>
                      </div>
                    </div>

                    <div className="coll-split" style={{ marginTop: 12 }}>
                      <div className="split-bar" role="img" aria-label={`Cash ${money(rangeView.cash)}, UPI ${money(rangeView.upi)}, Khata ${money(rangeView.khata)}`}>
                        <div style={{ flex: Math.max(1, rangeView.cash), background: 'var(--ok)', borderRadius: 0 }} title={`Cash ${money(rangeView.cash)}`} />
                        <div style={{ flex: Math.max(1, rangeView.upi), background: 'var(--blue)', borderRadius: 0 }} title={`UPI ${money(rangeView.upi)}`} />
                        {rangeView.khata > 0 && (
                          <div style={{ flex: Math.max(1, rangeView.khata), background: 'var(--warn-fg)', borderRadius: 0 }} title={`Khata (credit) ${money(rangeView.khata)}`} />
                        )}
                      </div>
                      <div className="coll-legend">
                        <span><span className="dot" style={{ background: 'var(--ok)' }} /> Cash · {money(rangeView.cash)}</span>
                        <span><span className="dot" style={{ background: 'var(--blue)' }} /> UPI · {money(rangeView.upi)}</span>
                        {rangeView.khata > 0 && (
                          <span><span className="dot" style={{ background: 'var(--warn-fg)' }} /> Khata (credit) · {money(rangeView.khata)}</span>
                        )}
                      </div>
                    </div>

                    {kitchenOn && (rangeView.retailSales > 0 || rangeView.kitchenSales > 0) && (
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--layer)', padding: '6px 12px', marginTop: 10, fontSize: '0.82rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Channel Split:</span>
                        <span>Retail Goods: <b>{money(rangeView.retailSales)}</b> ({rangeView.sales > 0 ? ((rangeView.retailSales / rangeView.sales) * 100).toFixed(0) : 0}%)</span>
                        <span>·</span>
                        <span>Kitchen: <b>{money(rangeView.kitchenSales)}</b> ({rangeView.sales > 0 ? ((rangeView.kitchenSales / rangeView.sales) * 100).toFixed(0) : 0}%)</span>
                      </div>
                    )}

                    {seesValuation && (
                      <div className="pl-list" style={{ marginTop: 12 }}>
                        <div className="pl-row">
                          <span className="pl-key">Sales <span className="t-caption">(billed at Sales Rate, net of returns)</span></span>
                          <span className="pl-val num">{money(rangeView.netSales)}</span>
                        </div>
                        <div className="pl-row">
                          <span className="pl-key">Gross profit <span className="t-caption">(Sales − goods at MRP{rangeView.netSales > 0 && rangeView.gross != null ? `, ${(rangeView.gross / rangeView.netSales * 100).toFixed(1)}% of sales` : ''})</span></span>
                          <span className={`pl-val num ${rangeView.gross != null && rangeView.gross < 0 ? 'neg' : 'pos'}`}>{rangeView.gross != null ? money(rangeView.gross) : '—'}</span>
                        </div>
                        {rangeView.income > 0 && (
                          <div className="pl-row">
                            <span className="pl-key">Plus · other income</span>
                            <span className="pl-val num pos">+ {money(rangeView.income)}</span>
                          </div>
                        )}
                        {rangeView.expenses > 0 && (
                          <div className="pl-row">
                            <span className="pl-key">Less · expenses</span>
                            <span className="pl-val num neg">− {money(rangeView.expenses)}</span>
                          </div>
                        )}
                        {rangeView.paymentsOut > 0 && (
                          <div className="pl-row">
                            <span className="pl-key">Less · payments <span className="t-caption">(suppliers, staff)</span></span>
                            <span className="pl-val num neg">− {money(rangeView.paymentsOut)}</span>
                          </div>
                        )}
                        <div className="pl-row pl-strong pl-net">
                          <span className="pl-key">Net profit <span className="t-caption">(after income, expenses & payments{rangeView.netSales > 0 && rangeView.net != null ? `, ${(rangeView.net / rangeView.netSales * 100).toFixed(1)}% of sales` : ''})</span></span>
                          <span className={`pl-val num ${rangeView.net != null && rangeView.net < 0 ? 'neg' : 'pos'}`}>{rangeView.net != null ? money(rangeView.net) : '—'}</span>
                        </div>
                      </div>
                    )}

                    <div className="day-sections-grid">
                      <div className="day-section-col">
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Sales by category</h4>
                          </div>
                          <div className="subpanel-body" style={{ padding: 0 }}>
                            {rangeView.cats.length === 0 ? (
                              <div style={{ padding: 12 }}><EmptyState title="No category data" /></div>
                            ) : (
                              <div className="tbl-scroll">
                                <table className="tbl" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>CATEGORY</th>
                                      <th className="td-right">QTY</th>
                                      <th className="td-right">AMOUNT</th>
                                      <th className="td-right" style={{ minWidth: 68 }}>SHARE</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rangeView.cats.map((c) => (
                                      <tr key={c.cat}>
                                        <td style={{ fontWeight: 600 }}>{c.cat.toUpperCase()}</td>
                                        <td className="td-right num td-muted">{num0(c.qty)}</td>
                                        <td className="td-right num" style={{ fontWeight: 500 }}>{money(c.amt)}</td>
                                        <td className="td-right">
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 60 }}>
                                            <div style={{ flex: 1, minWidth: 24, height: 4, background: 'var(--layer)', borderRadius: 0 }}>
                                              <div style={{ width: `${Math.max(2, Math.min(100, c.share * 100))}%`, height: '100%', background: c.color, borderRadius: 0 }} />
                                            </div>
                                            <span className="t-caption num" style={{ width: 28, textAlign: 'right', flexShrink: 0 }}>
                                              {(c.share * 100).toFixed(0)}%
                                            </span>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="day-section-col">
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Top sellers</h4>
                          </div>
                          <div className="subpanel-body">
                            {rangeView.top.length === 0 ? (
                              <EmptyState title="Not enough data" />
                            ) : (
                              <div className="kv-list">
                                {rangeView.top.map((t, i) => (
                                  <div key={t.name} className="kv-row">
                                    <span className="kv-key" style={{ color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>
                                      {i + 1}. {t.name}
                                    </span>
                                    <span className="kv-val num" style={{ flexShrink: 0, marginLeft: 8 }}>
                                      <span className="td-muted">{num0(t.qty)} pcs</span> · <strong>{money(t.amt)}</strong>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {(rangeView.gst > 0 || rangeView.discount > 0) && (
                          <div className="subpanel">
                            <div className="subpanel-head">
                              <h4 className="subpanel-title">Tax & discounts</h4>
                            </div>
                            <div className="subpanel-body">
                              <div className="kv-list">
                                {rangeView.discount > 0 && (
                                  <div className="kv-row">
                                    <span className="kv-key">Discounts given</span>
                                    <span className="kv-val num neg">− {money(rangeView.discount)}</span>
                                  </div>
                                )}
                                {rangeView.gst > 0 && (
                                  <div className="kv-row">
                                    <span className="kv-key">GST collected</span>
                                    <span className="kv-val num">{money(rangeView.gst)}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <p className="t-caption" style={{ marginTop: 12 }}>
                  {allTime
                    ? rangeClamped
                      ? `All time covers the latest ${MAX_RANGE_DAYS} days (server analytics window). Locked Z-report days inside it are exact.`
                      : 'All time — every recorded day, server-computed.'
                    : 'Server-computed over the range — exact even for days with more bills than the register window holds.'}
                  {' '}Press ✕ Clear to go back to single-day reports.
                </p>
              </>
            )}
          </Panel>
        )}
        {!consolidated && !isRange && !allTime && (!effectiveDay || daysInView.length === 0) && (
          <Panel title={`${new Date(view.y, view.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · Day report`} bodyPad>
            <EmptyState
              title={`No records for ${new Date(view.y, view.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`}
              hint="No sales or transactions have been recorded yet for this month."
            />
          </Panel>
        )}
        {!consolidated && !isRange && !allTime && dayReport && effectiveDay && daysInView.length > 0 && (
          <Panel
            title={`${reportDayLabel} · Day report`}
            bodyPad
            actions={
              dayReport.fromSnap ? (
                <Tag kind="green">
                  Locked · {dayReport.sealedAt ? `${dt(Date.parse(dayReport.sealedAt))} ${tm(Date.parse(dayReport.sealedAt))}` : '—'} · {dayReport.sealedByName || 'shop'}
                </Tag>
              ) : undefined
            }
          >
            {dayReport.bills === 0 ? (
              <EmptyState title="No sales on this day" hint="Pick a highlighted day — non-billing days simply have no summary." />
            ) : (
              <>
                {kitchenOn && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                    <Btn sm variant={subTab === 'all' ? 'primary' : 'ghost'} onClick={() => setSubTab('all')}>Overview (All)</Btn>
                    <Btn sm variant={subTab === 'retail' ? 'primary' : 'ghost'} onClick={() => setSubTab('retail')}>Retail Goods</Btn>
                    <Btn sm variant={subTab === 'kitchen' ? 'primary' : 'ghost'} onClick={() => setSubTab('kitchen')}>Kitchen & Dishes</Btn>
                  </div>
                )}

                {subTab === 'kitchen' && kitchenOn ? (
                  <>
                    <div className="day-stats">
                      <div className="day-stat day-stat-hero">
                        <span className="day-stat-label">KITCHEN SALES</span>
                        <span className="day-stat-val num" title={money(dayReport.kitchenSales)}>{money(dayReport.kitchenSales)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">DISHES PREPARED / SOLD</span>
                        <span className="day-stat-val num">{num0(dayReport.kitchenQty)} pcs</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">AVG DISH REVENUE</span>
                        <span className="day-stat-val num">{money(dayReport.kitchenQty > 0 ? dayReport.kitchenSales / dayReport.kitchenQty : 0)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">REVENUE SHARE</span>
                        <span className="day-stat-val num" style={{ color: 'var(--blue)' }}>
                          {dayReport.total > 0 ? `${((dayReport.kitchenSales / dayReport.total) * 100).toFixed(1)}%` : '0%'}
                        </span>
                      </div>
                    </div>

                    <div className="day-sections-grid" style={{ marginTop: 12 }}>
                      <div className="day-section-col" style={{ gridColumn: '1 / -1' }}>
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Dishes & Kitchen Items Sold Today</h4>
                          </div>
                          <div className="subpanel-body" style={{ padding: 0 }}>
                            {dayReport.kitchenTop.length === 0 ? (
                              <div style={{ padding: 12 }}><EmptyState title="No kitchen items sold today" /></div>
                            ) : (
                              <div className="tbl-scroll">
                                <table className="tbl" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th style={{ width: 40 }}>#</th>
                                      <th>DISH / MENU ITEM</th>
                                      <th className="td-right">QTY PREPARED</th>
                                      <th className="td-right">TOTAL SALES</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dayReport.kitchenTop.map((dish, idx) => (
                                      <tr key={`${dish.name}-${idx}`}>
                                        <td className="td-muted num">{idx + 1}</td>
                                        <td style={{ fontWeight: 600 }}>{dish.name}</td>
                                        <td className="td-right num">{num0(dish.qty)} pcs</td>
                                        <td className="td-right num" style={{ fontWeight: 600 }}>{money(dish.amt)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : subTab === 'retail' && kitchenOn ? (
                  <>
                    <div className="day-stats">
                      <div className="day-stat day-stat-hero">
                        <span className="day-stat-label">RETAIL GOODS SALES</span>
                        <span className="day-stat-val num" title={money(dayReport.retailSales)}>{money(dayReport.retailSales)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">ITEMS SOLD</span>
                        <span className="day-stat-val num">{num0(dayReport.retailQty)} pcs</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">AVG ITEM VALUE</span>
                        <span className="day-stat-val num">{money(dayReport.retailQty > 0 ? dayReport.retailSales / dayReport.retailQty : 0)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">REVENUE SHARE</span>
                        <span className="day-stat-val num" style={{ color: 'var(--ok-fg)' }}>
                          {dayReport.total > 0 ? `${((dayReport.retailSales / dayReport.total) * 100).toFixed(1)}%` : '0%'}
                        </span>
                      </div>
                    </div>

                    <div className="day-sections-grid" style={{ marginTop: 12 }}>
                      <div className="day-section-col">
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Sales by category</h4>
                          </div>
                          <div className="subpanel-body" style={{ padding: 0 }}>
                            {dayReport.cats.length === 0 ? (
                              <div style={{ padding: 12 }}><EmptyState title="No category data" /></div>
                            ) : (
                              <div className="tbl-scroll">
                                <table className="tbl" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>CATEGORY</th>
                                      <th className="td-right">QTY</th>
                                      <th className="td-right">AMOUNT</th>
                                      <th className="td-right" style={{ minWidth: 68 }}>SHARE</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dayReport.cats.map((c) => (
                                      <tr key={c.cat}>
                                        <td style={{ fontWeight: 600 }}>{c.cat.toUpperCase()}</td>
                                        <td className="td-right num td-muted">{num0(c.qty)}</td>
                                        <td className="td-right num" style={{ fontWeight: 500 }}>{money(c.amt)}</td>
                                        <td className="td-right">
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 60 }}>
                                            <div style={{ flex: 1, minWidth: 24, height: 4, background: 'var(--layer)', borderRadius: 0 }}>
                                              <div style={{ width: `${Math.max(2, Math.min(100, c.share * 100))}%`, height: '100%', background: c.color, borderRadius: 0 }} />
                                            </div>
                                            <span className="t-caption num" style={{ width: 28, textAlign: 'right', flexShrink: 0 }}>
                                              {(c.share * 100).toFixed(0)}%
                                            </span>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="day-section-col">
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Top retail sellers</h4>
                          </div>
                          <div className="subpanel-body">
                            {(dayReport.retailTop.length > 0 ? dayReport.retailTop : dayReport.top).length === 0 ? (
                              <EmptyState title="Not enough data" />
                            ) : (
                              <div className="kv-list">
                                {(dayReport.retailTop.length > 0 ? dayReport.retailTop : dayReport.top).map((t, i) => (
                                  <div key={t.name} className="kv-row">
                                    <span className="kv-key" style={{ color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>
                                      {i + 1}. {t.name}
                                    </span>
                                    <span className="kv-val num" style={{ flexShrink: 0, marginLeft: 8 }}>
                                      <span className="td-muted">{num0(t.qty)} pcs</span> · <strong>{money(t.amt)}</strong>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="day-stats">
                      <div className="day-stat day-stat-hero">
                        <span className="day-stat-label">TOTAL COLLECTION</span>
                        <span className="day-stat-val num" title={money(dayReport.total)}>{money(dayReport.total)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">CASH</span>
                        <span className="day-stat-val num" style={{ color: 'var(--ok-fg)' }} title={money(dayReport.cash)}>{money(dayReport.cash)}</span>
                        {dayReport.cashBills > 0 && <span className="day-stat-sub num">{dayReport.cashBills} cash bill{dayReport.cashBills === 1 ? '' : 's'}</span>}
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">UPI</span>
                        <span className="day-stat-val num" style={{ color: 'var(--blue)' }} title={money(dayReport.upi)}>{money(dayReport.upi)}</span>
                        {dayReport.upiBills > 0 && <span className="day-stat-sub num">{dayReport.upiBills} UPI bill{dayReport.upiBills === 1 ? '' : 's'}</span>}
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">KHATA</span>
                        <span className="day-stat-val num" style={{ color: 'var(--warn-fg)' }} title={money(dayReport.khata)}>{money(dayReport.khata)}</span>
                        {dayReport.khataBills > 0 && <span className="day-stat-sub num">{dayReport.khataBills} credit bill{dayReport.khataBills === 1 ? '' : 's'}</span>}
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">BILLS</span>
                        <span className="day-stat-val num" title={String(dayReport.bills)}>{dayReport.bills}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">AVG BILL</span>
                        <span className="day-stat-val num" title={money(dayReport.avg)}>{money(dayReport.avg)}</span>
                      </div>
                      <div className="day-stat">
                        <span className="day-stat-label">ITEMS SOLD</span>
                        <span className="day-stat-val num" title={`${num0(dayReport.qty)} pcs`}>{num0(dayReport.qty)} pcs</span>
                      </div>
                    </div>

                    {dayReport.fromSnap && (
                      <p className="t-caption" style={{ marginTop: 8 }}>
                        Sealed day{sealedCutoff ? ` · business cutoff ${sealedCutoff}` : ''}
                      </p>
                    )}

                    {dayReport.total > 0 && (
                      <div className="coll-split" style={{ marginTop: 12 }}>
                        <div className="split-bar" role="img" aria-label={`Cash ${money(dayReport.cash)}, UPI ${money(dayReport.upi)}, Khata ${money(dayReport.khata)}`}>
                          <div style={{ flex: Math.max(1, dayReport.cash), background: 'var(--ok)', borderRadius: 0 }} title={`Cash ${money(dayReport.cash)}`} />
                          <div style={{ flex: Math.max(1, dayReport.upi), background: 'var(--blue)', borderRadius: 0 }} title={`UPI ${money(dayReport.upi)}`} />
                          {dayReport.khata > 0 && (
                            <div style={{ flex: Math.max(1, dayReport.khata), background: 'var(--warn-fg)', borderRadius: 0 }} title={`Khata (credit) ${money(dayReport.khata)}`} />
                          )}
                        </div>
                        <div className="coll-legend">
                          <span><span className="dot" style={{ background: 'var(--ok)' }} /> Cash · {money(dayReport.cash)}</span>
                          <span><span className="dot" style={{ background: 'var(--blue)' }} /> UPI · {money(dayReport.upi)}</span>
                          {dayReport.khata > 0 && (
                            <span><span className="dot" style={{ background: 'var(--warn-fg)' }} /> Khata (credit) · {money(dayReport.khata)}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {kitchenOn && (dayReport.retailSales > 0 || dayReport.kitchenSales > 0) && (
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--layer)', padding: '6px 12px', marginTop: 10, fontSize: '0.82rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Channel Split:</span>
                        <span>Retail Goods: <b>{money(dayReport.retailSales)}</b> ({dayReport.total > 0 ? ((dayReport.retailSales / dayReport.total) * 100).toFixed(0) : 0}%)</span>
                        <span>·</span>
                        <span>Kitchen: <b>{money(dayReport.kitchenSales)}</b> ({dayReport.total > 0 ? ((dayReport.kitchenSales / dayReport.total) * 100).toFixed(0) : 0}%)</span>
                      </div>
                    )}

                    {seesValuation && (
                      <div className="pl-list" style={{ marginTop: 12 }}>
                        <div className="pl-row">
                          <span className="pl-key">Sales <span className="t-caption">(billed at Sales Rate)</span></span>
                          <span className="pl-val num">{money(dayReport.total)}</span>
                        </div>
                        {dayReport.mrpValue > 0 && (
                          <div className="pl-row">
                            <span className="pl-key">Same goods at MRP <span className="t-caption">(cost basis)</span></span>
                            <span className="pl-val num">{money(dayReport.mrpValue)}</span>
                          </div>
                        )}
                        <div className="pl-row">
                          <span className="pl-key">Gross profit <span className="t-caption">(Sales − goods at MRP{dayReport.total > 0 ? `, ${(dayReport.profit / dayReport.total * 100).toFixed(1)}% of sales` : ''})</span></span>
                          <span className={`pl-val num ${dayReport.profit < 0 ? 'neg' : 'pos'}`}>{money(dayReport.profit)}</span>
                        </div>
                        {dayReport.income > 0 && (
                          <div className="pl-row">
                            <span className="pl-key">Plus · other income</span>
                            <span className="pl-val num pos">+ {money(dayReport.income)}</span>
                          </div>
                        )}
                        {dayReport.expenses > 0 && (
                          <div className="pl-row">
                            <span className="pl-key">Less · expenses</span>
                            <span className="pl-val num neg">− {money(dayReport.expenses)}</span>
                          </div>
                        )}
                        {dayReport.paymentsOut > 0 && (
                          <div className="pl-row">
                            <span className="pl-key">Less · payments <span className="t-caption">(suppliers, staff)</span></span>
                            <span className="pl-val num neg">− {money(dayReport.paymentsOut)}</span>
                          </div>
                        )}
                        <div className="pl-row pl-strong pl-net">
                          <span className="pl-key">Net profit <span className="t-caption">(after income, expenses & payments{dayReport.total > 0 ? `, ${(dayReport.net / dayReport.total * 100).toFixed(1)}% of sales` : ''})</span></span>
                          <span className={`pl-val num ${dayReport.net < 0 ? 'neg' : 'pos'}`}>{money(dayReport.net)}</span>
                        </div>
                      </div>
                    )}

                    <div className="day-sections-grid">
                      <div className="day-section-col">
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Sales by category</h4>
                          </div>
                          <div className="subpanel-body" style={{ padding: 0 }}>
                            {dayReport.cats.length === 0 ? (
                              <div style={{ padding: 12 }}><EmptyState title="No category data" /></div>
                            ) : (
                              <div className="tbl-scroll">
                                <table className="tbl" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>CATEGORY</th>
                                      <th className="td-right">QTY</th>
                                      <th className="td-right">AMOUNT</th>
                                      <th className="td-right" style={{ minWidth: 68 }}>SHARE</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dayReport.cats.map((c) => (
                                      <tr key={c.cat}>
                                        <td style={{ fontWeight: 600 }}>{c.cat.toUpperCase()}</td>
                                        <td className="td-right num td-muted">{num0(c.qty)}</td>
                                        <td className="td-right num" style={{ fontWeight: 500 }}>{money(c.amt)}</td>
                                        <td className="td-right">
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 60 }}>
                                            <div style={{ flex: 1, minWidth: 24, height: 4, background: 'var(--layer)', borderRadius: 0 }}>
                                              <div style={{ width: `${Math.max(2, Math.min(100, c.share * 100))}%`, height: '100%', background: c.color, borderRadius: 0 }} />
                                            </div>
                                            <span className="t-caption num" style={{ width: 28, textAlign: 'right', flexShrink: 0 }}>
                                              {(c.share * 100).toFixed(0)}%
                                            </span>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>

                      {cashAudit && (cashAudit.hasActivity || cashAudit.opening != null) && (
                        <div className="subpanel">
                          <div className="subpanel-head">
                            <h4 className="subpanel-title">Cash audit</h4>
                          </div>
                          <div className="subpanel-body">
                            <div className="kv-list">
                              {cashAudit.opening != null && (
                                <div className="kv-row">
                                  <span className="kv-key">Opening · counter start</span>
                                  <span className="kv-val num">{money(cashAudit.opening)}</span>
                                </div>
                              )}
                              <div className="kv-row">
                                <span className="kv-key">+ Collected by software <span className="t-caption">(cash bills)</span></span>
                                <span className="kv-val num pos">{money(cashAudit.collected)}</span>
                              </div>
                              {cashAudit.customerReceived > 0 && (
                                <div className="kv-row">
                                  <span className="kv-key">+ Customer receipts <span className="t-caption">(Khata repaid in cash)</span></span>
                                  <span className="kv-val num" style={{ color: 'var(--fin-rec, #2d6b3f)' }}>+ {money(cashAudit.customerReceived)}</span>
                                </div>
                              )}
                              {cashAudit.otherIn > 0 && (
                                <div className="kv-row">
                                  <span className="kv-key">+ Other cash in <span className="t-caption">(income vouchers)</span></span>
                                  <span className="kv-val num">+ {money(cashAudit.otherIn)}</span>
                                </div>
                              )}
                              {(cashAudit.supplierPaid > 0 || cashAudit.expenseOut > 0) && (
                                <div className="kv-row">
                                  <span className="kv-key">− Paid out <span className="t-caption">(supplier + expenses)</span></span>
                                  <span className="kv-val num neg">− {money(round2(cashAudit.supplierPaid + cashAudit.expenseOut))}</span>
                                </div>
                              )}
                              {cashAudit.expected != null && (
                                <div className="kv-row pl-strong" style={{ borderTop: '1px solid var(--ink)', marginTop: 4, paddingTop: 8 }}>
                                  <span className="kv-key" style={{ fontWeight: 600, color: 'var(--ink)' }}>= Expected in drawer</span>
                                  <span className="kv-val num" style={{ fontWeight: 600 }}>{money(cashAudit.expected)}</span>
                                </div>
                              )}
                              <div className="kv-row">
                                <span className="kv-key">Counted at close</span>
                                {cashAudit.counted != null
                                  ? <span className="kv-val num">{money(cashAudit.counted)}</span>
                                  : cashAudit.today
                                    ? <span className="kv-val t-caption">Awaiting close</span>
                                    : <span className="kv-val t-caption">No record</span>}
                              </div>
                              {cashAudit.variance != null && (() => {
                                const v = cashAudit.variance!
                                const abs = Math.abs(v)
                                const kind = abs <= 50 ? 'green' : abs <= 500 ? 'warn' : 'red'
                                const label = v === 0 ? 'Tallied ✓' : `${v > 0 ? 'Over' : 'Short'} ${money(abs)}`
                                return (
                                  <div className="kv-row" style={{ alignItems: 'center' }}>
                                    <span className="kv-key" style={{ fontWeight: 600, color: 'var(--ink)' }}>Difference</span>
                                    <Tag kind={kind}>{label}</Tag>
                                  </div>
                                )
                              })()}
                            </div>
                            <p className="t-caption" style={{ marginTop: 8 }}>
                              {cashAudit.variance != null
                                ? 'Positive = extra cash in the drawer; negative = shortage. Supplier payments count when Cleared · Cash; income & expense vouchers are treated as physical cash.'
                                : cashAudit.today
                                  ? 'Counter hasn\'t closed yet — tonight\'s closing cash completes this audit.'
                                  : 'Old record — cash count wasn\'t tracked back then.'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="day-section-col">
                      <div className="subpanel">
                        <div className="subpanel-head">
                          <h4 className="subpanel-title">Top sellers</h4>
                        </div>
                        <div className="subpanel-body">
                          {dayReport.top.length === 0 ? (
                            <EmptyState title="Not enough data" />
                          ) : (
                            <div className="kv-list">
                              {dayReport.top.map((t, i) => (
                                <div key={t.name} className="kv-row">
                                  <span className="kv-key" style={{ color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>
                                    {i + 1}. {t.name}
                                  </span>
                                  <span className="kv-val num" style={{ flexShrink: 0, marginLeft: 8 }}>
                                    <span className="td-muted">{num0(t.qty)} pcs</span> · <strong>{money(t.amt)}</strong>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="subpanel">
                        <div className="subpanel-head">
                          <h4 className="subpanel-title">Stock moved</h4>
                        </div>
                        <div className="subpanel-body">
                          <div className="kv-list">
                            {dayPurchaseQty > 0 && (
                              <div className="kv-row">
                                <span className="kv-key">Added · supplier → godown</span>
                                <span className="kv-val num">{num0(dayPurchaseQty)} pcs</span>
                              </div>
                            )}
                            <div className="kv-row">
                              <span className="kv-key">Godown → counter</span>
                              <span className="kv-val num">{num0(dayReport.toCounter)} pcs</span>
                            </div>
                            {dayReport.toGodown > 0 && (
                              <div className="kv-row">
                                <span className="kv-key">Counter → godown</span>
                                <span className="kv-val num">{num0(dayReport.toGodown)} pcs</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="subpanel">
                        <div className="subpanel-head">
                          <h4 className="subpanel-title">Session</h4>
                        </div>
                        <div className="subpanel-body">
                          <div className="kv-list">
                            {dayReport.fromSnap ? (
                              <div className="kv-row">
                                <span className="kv-key">Day closed</span>
                                <span className="kv-val num">{dayReport.sealedAt ? tm(Date.parse(dayReport.sealedAt)) : '—'}</span>
                              </div>
                            ) : (
                              <>
                                <div className="kv-row">
                                  <span className="kv-key">First bill</span>
                                  <span className="kv-val num">{dayReport.first ? tm(Date.parse(dayReport.first)) : '—'}</span>
                                </div>
                                <div className="kv-row">
                                  <span className="kv-key">Last bill</span>
                                  <span className="kv-val num">{dayReport.last ? tm(Date.parse(dayReport.last)) : '—'}</span>
                                </div>
                              </>
                            )}
                            {dayReport.discount > 0 && (
                              <div className="kv-row">
                                <span className="kv-key">Discounts given</span>
                                <span className="kv-val num neg">− {money(dayReport.discount)}</span>
                              </div>
                            )}
                            {dayReport.gst > 0 && (
                              <div className="kv-row">
                                <span className="kv-key">GST collected</span>
                                <span className="kv-val num">{money(dayReport.gst)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

                {dayLoading && (
                  <p className="t-caption" style={{ marginTop: 12 }}>
                    Loading this day's bill details for category & seller breakdown…
                  </p>
                )}
                {daySales.length > 0 && !dayLoading && (
                  <p className="t-caption" style={{ marginTop: 12 }}>
                    {daySales.length} bill{daySales.length === 1 ? '' : 's'} this day. Full invoices live in Sales → Bill history.
                  </p>
                )}
              </>
            )}
          </Panel>
        )}
        </div>
      </div>
    </div>
  )
}