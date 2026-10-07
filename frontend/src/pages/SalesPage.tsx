import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useWorkspace, type CounterProduct } from '@/data/workspace'
import { ApiError, call } from '@/lib/api'
import { refreshNow, submitSale } from '@/lib/sync'
import { estimateTotal, type BillDiscount } from '@/lib/estimate'
import { searchProductsCached } from '@/lib/search'
import { attachScannerCapture, beep } from '@/lib/scanner'
import { printBill, printProvisional } from '@/lib/print'
import { loadPrefs } from '@/lib/prefs'
import { money, num } from '@/lib/utils'
import { Btn, Drawer, EmptyState, NumInput, Panel, Tag, useToast } from '@/components/ui'
import { IconX } from '@/components/icons'

/**
 * The counter.
 *
 * This screen only collects what the cashier does (items, pegs, returns, who is paying and how) and shows what
 * Odoo answers.  Tax, discounts and totals come from `sales.quote` while building the bill and from `sales.settle`
 * when it is billed; stock is enforced by the server.  Offline, a clearly labelled estimate stands in
 * (lib/estimate.ts) and the real numbers arrive when the bill syncs.  Open-bottle pegs from the cached tray can be
 * sold offline; opening a bottle, returns and restaurant tabs need the server and say so.
 */

type Method = 'cash' | 'upi' | 'khata'

/** One row of the bill.  `peg` rows pour from an open bottle; everything else is a plain item. */
interface BillLine {
  key: string
  productId: number
  qty: number
  /** Only set when the cashier overrides the standard rate. */
  rate?: number
  peg?: { bottleId: number; ml: number }
}

interface Quote {
  subtotal: number; discount: number; tax: number; total: number; payable: number
  lines: { product_id: number; total: number }[]
}
interface BillDetail {
  order_id: number; name: string; customer: string; partner_id: number | false; total: number; invoice: string
  lines: { line_id: number; product_id: number; name: string; qty: number; price_unit: number; total: number; refundable_qty: number; is_peg: boolean }[]
}
interface BillHit { order_id: number; name: string; date: string; business_date: string; customer: string; total: number; invoice: string; is_refund: boolean }
interface TabLine { key: string; product_id: number; qty: number; price: number; peg: { bottle_id: number; ml: number } | null }
interface Tab { table_id: number; table: string; covers: number; total: number; lines: TabLine[] }
interface LastBill { orderId?: number; name: string; total: number; queued: boolean; provisional?: { lines: { name: string; qty: number; rate: number }[]; total: number } }

const DRAFT_KEY = 'or2.billDraft.v3'
const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000
const newRef = () => `bill-${crypto.randomUUID()}`

function loadDraft(): BillLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (!raw || Date.now() - raw.at > DRAFT_MAX_AGE_MS) return []
    return Array.isArray(raw.lines) ? raw.lines : []
  } catch { return [] }
}

export default function SalesPage() {
  const nav = useNavigate()
  const toast = useToast()
  const { featureOn, me, canManageReturns, shopCode } = useAuth()
  const ws = useWorkspace()
  const autoGodown = featureOn('auto_godown_transfer')
  const kitchenOn = featureOn('kitchen')
  const pegsOn = featureOn('open_bottle')
  const tablesOn = featureOn('tables')

  const [lines, setLines] = useState<BillLine[]>(loadDraft)
  const [query, setQuery] = useState('')
  const [discountKind, setDiscountKind] = useState<'percent' | 'amount'>('amount')
  const [discountValue, setDiscountValue] = useState(0)
  const [promo, setPromo] = useState('')
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [method, setMethod] = useState<Method>('cash')
  const [armed, setArmed] = useState<Method | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [offlineQuote, setOfflineQuote] = useState(false)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<LastBill | null>(null)
  const [finder, setFinder] = useState(false)
  const [ret, setRet] = useState<{ bill: BillDetail; qty: Record<number, number> } | null>(null)
  const [tab, setTab] = useState<Tab | null>(null)
  const [tablesOpen, setTablesOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // One idempotency key per bill: a retry after a dropped connection is answered, never billed twice.
  const clientRef = useRef(newRef())

  const products = useMemo(() => ws.counterProducts.filter((p) => p.active && (kitchenOn || !p.isKitchen)), [ws.counterProducts, kitchenOn])
  const barcodeMap = useMemo(() => new Map(products.filter((p) => p.barcode).map((p) => [p.barcode, p])), [products])
  const bottles = useMemo(() => new Map(ws.openBottles.map((b) => [b.id as number, b])), [ws.openBottles])

  const discount = useMemo<BillDiscount | null>(() => (!promo && discountValue > 0 ? { kind: discountKind, value: discountValue } : null), [promo, discountKind, discountValue])
  const priced = useMemo(
    () => lines.map((l) => ({ ...l, p: ws.productById.get(l.productId) })).filter((l): l is typeof l & { p: CounterProduct } => !!l.p),
    [lines, ws.productById],
  )
  const returning = useMemo(() => (ret ? Object.entries(ret.qty).filter(([, q]) => q > 0) : []), [ret])

  // ---- persist the open bill so a refresh or crash never loses it (table tabs live on the server instead)
  useEffect(() => {
    if (tab) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), lines })) } catch { /* ignore */ }
  }, [lines, tab])

  // ---- the payload shared by quote, settle and table autosave
  const payloadLines = useMemo(() => {
    const out: Record<string, unknown>[] = []
    for (const l of priced) {
      if (l.peg) for (let i = 0; i < l.qty; i++) out.push({ key: i ? `${l.key}#${i}` : l.key, peg: { bottle_id: l.peg.bottleId, ml: l.peg.ml }, ...(l.rate !== undefined ? { price: l.rate } : {}) })
      else out.push({ key: l.key, product_id: l.productId, qty: l.qty, price: l.rate ?? l.p.rate })
    }
    for (const [lineId, q] of returning) out.push({ refund_of_line_id: Number(lineId), qty: q })
    return out
  }, [priced, returning])

  const quotePayload = useMemo(() => ({
    lines: payloadLines.map(({ key: _k, ...rest }) => rest),
    bill_discount: discount, promo_code: promo || undefined,
    partner_id: ret ? (ret.bill.partner_id || customerId || undefined) : (customerId ?? undefined),
  }), [payloadLines, discount, promo, customerId, ret])

  useEffect(() => {
    if (!payloadLines.length) { setQuote(null); setQuoteError(null); return }
    let stale = false
    const t = window.setTimeout(async () => {
      try {
        const q = await call<Quote>('sales', 'quote', { payload: quotePayload })
        if (stale) return
        setQuote(q); setQuoteError(null); setOfflineQuote(false)
      } catch (e) {
        if (stale) return
        if (e instanceof ApiError && e.network) { setOfflineQuote(true); setQuoteError(null) } else { setQuote(null); setQuoteError(e instanceof Error ? e.message : 'Could not price the bill.') }
      }
    }, 180)
    return () => { stale = true; window.clearTimeout(t) }
  }, [quotePayload, payloadLines.length])

  const estimateLines = useMemo(() => priced.map((l) => ({ qty: l.qty, rate: l.rate ?? (l.peg ? (l.p.pegs.find((g) => g.ml === l.peg!.ml)?.price ?? 0) : l.p.rate) })), [priced])
  const estimate = useMemo(() => estimateTotal(estimateLines, discount), [estimateLines, discount])
  const payable = offlineQuote || !quote ? estimate : quote.payable
  const isRefundOut = !!quote && !offlineQuote && quote.payable < 0
  const totalPcs = priced.reduce((a, l) => a + l.qty, 0)

  // ---- restaurant table tab: lines live on the server and are saved (debounced) as the cashier edits
  const tabLoading = useRef(false)
  const toastRef = useRef(toast)
  toastRef.current = toast
  useEffect(() => {
    if (!tab || tabLoading.current) return
    const items = payloadLines.filter((l) => !('refund_of_line_id' in l))
    if (!items.length) return   // an empty tab stays as it is; "Detach" / paying closes it
    const t = window.setTimeout(() => {
      void call('tabs', 'tab_save', { table_id: tab.table_id, lines: items, covers: tab.covers || undefined })
        .catch((e) => toastRef.current(e instanceof Error ? e.message : 'The table could not be saved.', 'err'))
    }, 500)
    return () => window.clearTimeout(t)
  }, [tab, payloadLines])

  const openTable = async (tableId: number) => {
    try {
      tabLoading.current = true
      const t = await call<Tab>('tabs', 'tab_open', { table_id: tableId })
      setTab(t)
      setLines(t.lines.map((l) => (l.peg
        ? { key: l.key, productId: l.product_id, qty: 1, peg: { bottleId: l.peg.bottle_id, ml: l.peg.ml } }
        : { key: l.key, productId: l.product_id, qty: l.qty, rate: l.price })))
      setTablesOpen(false)
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not open the table.', 'err') }
    finally { window.setTimeout(() => { tabLoading.current = false }, 50) }
  }

  // ---- adding items
  const available = useCallback((p: CounterProduct) => (p.isKitchen ? Infinity : autoGodown ? p.counterPcs + p.godownPcs : p.counterPcs), [autoGodown])
  const addProduct = useCallback((p: CounterProduct) => {
    setArmed(null)
    setLines((prev) => {
      const key = `p${p.productId}`
      const i = prev.findIndex((l) => l.key === key)
      return i >= 0 ? prev.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l)) : [...prev, { key, productId: p.productId, qty: 1 }]
    })
    setQuery(''); searchRef.current?.focus()
  }, [])
  const addPeg = (bottleId: number, productId: number, ml: number) => {
    setArmed(null)
    setLines((prev) => {
      const key = `g${bottleId}-${ml}`
      const i = prev.findIndex((l) => l.key === key)
      return i >= 0 ? prev.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l)) : [...prev, { key, productId, qty: 1, peg: { bottleId, ml } }]
    })
  }
  const onScan = useCallback((code: string) => {
    const p = barcodeMap.get(code)
    if (p) { beep('ok'); addProduct(p) } else { beep('err'); toast('No product matches that scan.', 'err') }
  }, [barcodeMap, addProduct, toast])
  useEffect(() => { const cap = attachScannerCapture(onScan); return () => cap.detach() }, [onScan])

  const results = useMemo(() => (query.trim() ? searchProductsCached(products, query, { limit: 8 }) : []), [products, query])
  const setQty = (key: string, qty: number) => setLines((prev) => prev.flatMap((l) => (l.key !== key ? [l] : qty > 0 ? [{ ...l, qty }] : [])))

  const clearBill = useCallback(() => {
    setLines([]); setDiscountValue(0); setPromo(''); setCustomerId(null); setMethod('cash'); setArmed(null)
    setQuote(null); setQuoteError(null); setRet(null); setTab(null)
    clientRef.current = newRef()
  }, [])

  // ---- billing
  const overStock = priced.find((l) => !l.peg && l.qty > available(l.p))
  const overPeg = priced.find((l) => l.peg && l.qty * l.peg.ml > (bottles.get(l.peg.bottleId)?.remaining_ml ?? 0))
  const nothingToBill = !priced.length && !returning.length

  const settle = useCallback(async (m: Method) => {
    if (busy || nothingToBill) return
    if (m === 'khata' && !(customerId || ret?.bill.partner_id)) { toast('Choose the customer whose account this goes on.', 'warn'); return }
    setBusy(true)
    const snapshot = { lines: estimateLines.map((l, i) => ({ name: priced[i].p.name, qty: l.qty, rate: l.rate })), total: payable }
    try {
      const res = await submitSale({
        client_ref: clientRef.current,
        lines: quotePayload.lines, bill_discount: quotePayload.bill_discount, promo_code: quotePayload.promo_code,
        partner_id: quotePayload.partner_id,
        ...(tab ? { table_id: tab.table_id } : {}),
        payments: [{ method: m, amount: Math.abs(payable) }],
      })
      if (res.queued) {
        setLast({ name: 'Saved offline', total: payable, queued: true, provisional: snapshot })
        toast('Saved on this device. It will be billed when the connection returns.', 'info')
      } else {
        const r = res.result
        setLast({ orderId: r.order_id, name: r.name, total: r.total, queued: false })
        toast(`${isRefundOut ? 'Refunded' : 'Billed'} ${r.name} · ${money(Math.abs(r.total))}${r.flagged ? ' · stock flagged for review' : ''}`, 'ok')
        if (loadPrefs().printMode === 'auto') void printBill(r.order_id, r.name)
      }
      clearBill()
    } catch (e) {
      beep('err')
      toast(e instanceof Error ? e.message : 'Could not bill this sale.', 'err')
    } finally { setBusy(false) }
  }, [busy, nothingToBill, customerId, ret, quotePayload, payable, tab, estimateLines, priced, isRefundOut, toast, clearBill])

  const blocked = !!overStock || !!overPeg || !!quoteError || (offlineQuote && (!!ret || !!tab))
  const canBill = !nothingToBill && !busy && !blocked
  const fastPay = useCallback((m: Method) => {
    if (!canBill) return
    if (armed === m) { setArmed(null); void settle(m) } else { setArmed(m); setMethod(m) }
  }, [canBill, armed, settle])
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(null), 4000); return () => window.clearTimeout(t) }, [armed])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F8') { e.preventDefault(); fastPay('cash') } else if (e.key === 'F9') { e.preventDefault(); fastPay('upi') } else if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [fastPay])

  const lineTotal = (l: (typeof priced)[number]) => (!offlineQuote && quote && !l.peg ? quote.lines.find((q) => q.product_id === l.productId)?.total : undefined)

  // ---- open bottles
  const openable = useMemo(() => products.filter((p) => p.canOpen && p.counterPcs > 0), [products])
  const [openPick, setOpenPick] = useState<number | ''>('')
  const openBottle = async () => {
    if (!openPick) return
    try { const r = await call<{ label: string }>('day', 'open_bottle', { product_id: openPick }); toast(`Opened ${r.label}`, 'ok'); setOpenPick(''); void refreshNow() }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not open the bottle.', 'err') }
  }
  const finishBottle = async (id: number) => {
    try { await call('day', 'finish_bottle', { bottle_id: id }); toast('Bottle finished', 'ok'); void refreshNow() } catch (e) { toast(e instanceof Error ? e.message : 'Could not finish the bottle.', 'err') }
  }

  const rePrint = async () => {
    if (!last) return
    if (last.orderId) { const r = await printBill(last.orderId, last.name); if (r === 'failed') toast('Could not print. Check the printer settings.', 'err') }
    else if (last.provisional) printProvisional(me?.company.name ?? shopCode, last.provisional.lines, last.provisional.total)
  }

  return (
    <div className="pos-grid">
      <Panel>
        <div className="panel-body pos-left">
          {tablesOn && (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <Btn sm variant={tab ? 'primary' : 'tertiary'} disabled={!ws.online} onClick={() => setTablesOpen(true)}>{tab ? `Table ${tab.table}` : 'Tables'}</Btn>
              {tab && <>
                <Btn sm onClick={async () => { try { const k = await call<{ text: string[] }>('tabs', 'tab_kot', { table_id: tab.table_id }); toast('Ticket sent to the kitchen / bar', 'ok'); void printText(k.text) } catch (e) { toast(e instanceof Error ? e.message : 'Nothing to send.', 'warn') } }}>Send KOT</Btn>
                <Btn sm variant="ghost" onClick={clearBill}>Detach</Btn></>}
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <input ref={searchRef} className="field-control" autoFocus value={query} placeholder="Scan barcode or type product name to add to bill…"
              aria-label="Scan barcode or search products" onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); addProduct(results[0]) } if (e.key === 'Escape') setQuery('') }} />
            {results.length > 0 && (
              <div className="menu-pop" style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20 }}>
                {results.map((p) => (
                  <button key={p.productId} type="button" className="menu-item" onClick={() => addProduct(p)}>
                    <span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span>
                    <span className="num t-caption">{p.isKitchen ? 'kitchen' : `${num(p.counterPcs)} at counter`}</span>
                    <span className="num">{money(p.rate)}</span>
                  </button>))}
              </div>)}
          </div>

          {ret && (
            <div className="alert" role="status">
              <strong>Return / exchange of {ret.bill.name}</strong>{ret.bill.invoice ? ` (tax invoice ${ret.bill.invoice})` : ''}: choose what comes back below, then add any replacement items above.{' '}
              <button className="link-btn" onClick={() => { setRet(null) }}>Cancel return</button>
            </div>)}
          {overStock && <div className="alert" role="alert"><strong>{overStock.p.name}</strong>: only {num(available(overStock.p))} available {autoGodown ? '(counter and godown)' : 'at the counter'}. Reduce the quantity to bill. <button className="link-btn" onClick={() => nav('/stock')}>View stock</button></div>}
          {overPeg && <div className="alert" role="alert">Not enough left in that open bottle for {overPeg.qty} × {overPeg.peg!.ml} ml.</div>}

          {priced.length === 0 && !ret ? (
            <EmptyState icon={<IconX size={16} />} title="Bill is empty" hint="Scan a barcode or press Enter on a search result to start the bill." />
          ) : (
            <div className="tbl-scroll"><table className="tbl bill-tbl">
              <thead><tr><th className="td-center" style={{ width: 44 }}>Sr.</th><th>Item description</th><th className="td-right" style={{ width: 112 }}>Rate (₹)</th><th className="td-center" style={{ width: 150 }}>Qty</th><th className="td-right" style={{ width: 104 }}>Total (₹)</th><th style={{ width: 44 }}></th></tr></thead>
              <tbody>
                {ret && ret.bill.lines.map((l) => (
                  <tr key={`r${l.line_id}`} style={{ background: 'var(--layer)' }}>
                    <td className="td-center td-muted">↩</td>
                    <td><span className="cell-main">{l.name}</span> <Tag kind="amber">RETURN</Tag><div className="t-caption">Sold at {money(l.price_unit)} · can return {num(l.refundable_qty)}</div></td>
                    <td className="td-right num">{money(l.price_unit)}</td>
                    <td className="td-center"><NumInput className="field-control" style={{ width: 80, textAlign: 'center' }} aria-label={`Return quantity of ${l.name}`} value={ret.qty[l.line_id] ?? 0}
                      onChange={(n) => setRet((r) => r && ({ ...r, qty: { ...r.qty, [l.line_id]: Math.min(n, l.refundable_qty) } }))} /></td>
                    <td className="td-right num">{(ret.qty[l.line_id] ?? 0) > 0 ? `− ${money(l.price_unit * (ret.qty[l.line_id] ?? 0))}` : ''}</td><td></td>
                  </tr>))}
                {priced.map((l, i) => {
                  const rate = l.rate ?? (l.peg ? (l.p.pegs.find((g) => g.ml === l.peg!.ml)?.price ?? 0) : l.p.rate)
                  const short = !l.peg && l.qty > available(l.p)
                  const t = lineTotal(l)
                  return (
                    <tr key={l.key}>
                      <td className="td-center td-muted num">{i + 1}</td>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className="cell-main">{l.peg ? `${l.p.name} · ${l.peg.ml} ml peg` : l.p.name}</span>
                        {l.peg && <Tag kind="blue">{bottles.get(l.peg.bottleId)?.label ?? 'OPEN BOTTLE'}</Tag>}
                        {l.p.isKitchen && <Tag kind="blue">KITCHEN</Tag>}{short && <Tag kind="red">OUT OF STOCK</Tag>}
                        {!short && !l.peg && autoGodown && !l.p.isKitchen && l.qty > l.p.counterPcs && <Tag kind="red">IN GODOWN</Tag>}</div>
                        <div className="t-caption">{l.p.barcode ? `Barcode: ${l.p.barcode}` : l.p.code ? `Code: ${l.p.code}` : ''}</div></td>
                      <td className="td-right"><NumInput className="field-control" style={{ width: 92, textAlign: 'right' }} value={rate} aria-label={`Rate for ${l.p.name}`} disabled={!!tab && !!l.peg}
                        onChange={(n) => setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, rate: n } : x)))} /></td>
                      <td className="td-center"><div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Btn sm onClick={() => setQty(l.key, l.qty - 1)} aria-label="Decrease quantity">−</Btn>
                        <NumInput className="field-control" style={{ width: 56, textAlign: 'center' }} value={l.qty} aria-label={`Quantity of ${l.p.name}`} onChange={(n) => setQty(l.key, n)} />
                        <Btn sm onClick={() => setQty(l.key, l.qty + 1)} aria-label="Increase quantity">+</Btn></div></td>
                      <td className="td-right num">{t !== undefined ? money(t) : money(l.qty * rate)}</td>
                      <td><button className="icon-btn" aria-label={`Remove ${l.p.name}`} onClick={() => setQty(l.key, 0)}>×</button></td>
                    </tr>)
                })}
              </tbody></table></div>)}

          {pegsOn && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="micro-label">Open bottles{ws.openBottles.length ? ` · oldest first` : ''}</div>
                <div className="row" style={{ gap: 6 }}>
                  <select className="field-control" style={{ width: 200 }} value={openPick} aria-label="Bottle to open" onChange={(e) => setOpenPick(e.target.value ? Number(e.target.value) : '')} disabled={!ws.online}>
                    <option value="">Open a new bottle…</option>{openable.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}</select>
                  <Btn sm disabled={!openPick || !ws.online} onClick={() => void openBottle()}>Open</Btn>
                </div>
              </div>
              {ws.openBottles.length === 0 ? <div className="t-caption">No bottle is open. Open one to sell pegs.</div> : (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
                  {ws.openBottles.map((b) => {
                    const prod = ws.productById.get(b.product_id)
                    const color = b.percent > 50 ? 'var(--ok, #198038)' : b.percent >= 25 ? '#b28600' : 'var(--err, #da1e28)'
                    return (
                      <div key={b.id} className="panel" style={{ padding: 10, minWidth: 190, flex: '0 1 230px' }}>
                        <div className="cell-main">{b.product}</div>
                        <div className="t-caption">{b.label} · <span className="num">{num(b.remaining_ml)} / {num(b.capacity_ml)} ml</span></div>
                        <div style={{ height: 6, background: 'var(--layer)', margin: '6px 0' }}><div style={{ width: `${Math.max(2, b.percent)}%`, height: '100%', background: color }} /></div>
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {(prod?.pegs ?? []).map((g) => <Btn key={g.ml} sm disabled={g.ml > b.remaining_ml} onClick={() => addPeg(b.id, b.product_id, g.ml)}>{g.ml} ml · {money(g.price)}</Btn>)}
                          {!prod?.pegs.length && <span className="t-caption">No peg rates set (Products).</span>}
                          <Btn sm variant="ghost" disabled={!ws.online} onClick={() => void finishBottle(b.id)}>Finish</Btn>
                        </div>
                      </div>)
                  })}
                </div>)}
            </div>)}
        </div>
      </Panel>

      <div className="pos-checkout-column">
        <section className="panel co-panel" aria-label="Checkout">
          <header className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="panel-title" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{ret ? 'Return / exchange' : 'Checkout'}</h3>
            <div className="row" style={{ gap: 6 }}>
              {canManageReturns && <Btn sm variant="ghost" disabled={!ws.online || !!tab} aria-pressed={!!ret} onClick={() => setFinder(true)}>Return / exchange</Btn>}
              {last && <Btn sm variant="ghost" onClick={() => void rePrint()}>{last.queued ? 'Print slip' : 'Reprint last'}</Btn>}
            </div>
          </header>
          <div className="co-body">
            {!ret && <div>
              <div className="micro-label">Customer (needed for Khata)</div>
              <select className="field-control" style={{ marginTop: 8 }} value={customerId ?? ''} aria-label="Customer" onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Walk-in customer</option>{ws.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
            {!ret && <div>
              <div className="micro-label">Discount</div>
              <div className="form-grid" style={{ marginTop: 8 }}>
                {ws.promos.length > 0 && <select className="field-control" value={promo} aria-label="Promo code" onChange={(e) => setPromo(e.target.value)}>
                  <option value="">No promo</option>{ws.promos.map((p) => <option key={p.id} value={p.code}>{p.code}{p.name ? ` · ${p.name}` : ''}</option>)}</select>}
                <div className="row" style={{ gap: 6 }}>
                  <select className="field-control" value={discountKind} aria-label="Discount type" disabled={!!promo} onChange={(e) => setDiscountKind(e.target.value as 'percent' | 'amount')}><option value="amount">₹ off</option><option value="percent">% off</option></select>
                  <NumInput className="field-control" value={discountValue} disabled={!!promo} placeholder="0" aria-label="Discount value" onChange={setDiscountValue} /></div>
              </div></div>}

            <div className="pay-box">
              <div className="pay-row num"><span>Items ({num(totalPcs)} pcs)</span><span>{quote && !offlineQuote ? money(quote.subtotal) : money(estimate)}</span></div>
              {quote && !offlineQuote && quote.discount > 0 && <div className="pay-row num"><span>Discount</span><span className="pos">− {money(quote.discount)}</span></div>}
              {quote && !offlineQuote && quote.tax > 0 && <div className="pay-row num"><span>of which tax</span><span>{money(quote.tax)}</span></div>}
              <div className="pay-net num"><span>{isRefundOut ? 'Refund to customer' : offlineQuote ? 'Estimated payable' : 'Net payable'}</span><span>{money(Math.abs(payable))}</span></div>
            </div>
            {offlineQuote && <div className="alert">Offline: this is an estimate. Odoo prices the bill exactly when it syncs.{(ret || tab) ? ' Returns and table tabs need a connection.' : ''}</div>}
            {quoteError && <div className="alert" role="alert">{quoteError}</div>}

            <div className="fast-pay-container">
              <div className="micro-label" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{isRefundOut ? 'Pay out by' : 'Fast Settlement'}</span><span style={{ color: 'var(--muted)', fontSize: 11 }}>F8 = Cash · F9 = UPI</span></div>
              <div className={`fast-pay-seg ${(customerId || ret?.bill.partner_id) && !isRefundOut ? 'three-col' : ''}`}>
                <button type="button" className={`fast-pay-btn ${armed === 'cash' ? 'armed' : ''} ${method === 'cash' && !armed ? 'selected' : ''}`} disabled={!canBill} onClick={() => fastPay('cash')}><span>{armed === 'cash' ? 'Press F8 to confirm' : 'Cash'}</span><span className="fast-pay-kbd">F8</span></button>
                <button type="button" className={`fast-pay-btn ${armed === 'upi' ? 'armed' : ''} ${method === 'upi' && !armed ? 'selected' : ''}`} disabled={!canBill} onClick={() => fastPay('upi')}><span>{armed === 'upi' ? 'Press F9 to confirm' : 'UPI'}</span><span className="fast-pay-kbd">F9</span></button>
                {(customerId || ret?.bill.partner_id) && !isRefundOut && <button type="button" className={`fast-pay-btn ${method === 'khata' ? 'selected' : ''}`} disabled={!canBill} onClick={() => void settle('khata')}><span>Khata (credit)</span></button>}
              </div>
            </div>
            <Btn variant="tertiary" block disabled={(!lines.length && !ret) || busy} onClick={clearBill}>Clear bill</Btn>
            {ws.pending > 0 && <div className="t-caption">{ws.pending} bill{ws.pending > 1 ? 's' : ''} waiting to reach the server.</div>}
            {last && !last.queued && <div className="t-caption">Last bill: <strong>{last.name}</strong> · {money(Math.abs(last.total))}</div>}
          </div>
        </section>
      </div>

      <BillFinder open={finder} onClose={() => setFinder(false)} onPick={(bill) => { setRet({ bill, qty: {} }); setLines([]); setFinder(false) }} />
      <Drawer open={tablesOpen} onClose={() => setTablesOpen(false)} title="Tables" wide>
        {ws.floors.length === 0 ? <EmptyState title="No tables yet" hint="Add floors and tables in Settings." /> : ws.tables.map((f: any) => (
          <div key={f.floor_id} style={{ marginBottom: 16 }}>
            <div className="micro-label">{f.name}</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {f.tables.map((t: any) => (
                <button key={t.table_id} type="button" className="panel" style={{ width: 96, height: 72, cursor: 'pointer', borderColor: t.state === 'occupied' ? 'var(--blue)' : undefined }} onClick={() => void openTable(t.table_id)}>
                  <div className="cell-main">{t.number}</div><div className="t-caption">{t.state === 'occupied' ? (t.total !== null ? money(t.total) : 'Occupied') : `${t.seats} seats`}</div></button>))}
            </div></div>))}
      </Drawer>
    </div>
  )
}

function printText(lines: string[]) {
  const w = window.open('', '_blank', 'width=420,height=520')
  if (!w) return
  w.document.write(`<!doctype html><title>KOT</title><style>pre{font:13px/1.3 monospace}</style><pre>${lines.join('\n').replace(/</g, '&lt;')}</pre>`)
  w.document.close(); w.print()
}

function BillFinder({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (b: BillDetail) => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<BillHit[] | null>(null)
  useEffect(() => {
    if (!open) return
    let stale = false
    const t = window.setTimeout(() => {
      call<BillHit[]>('day', 'bill_lookup', { search: q.trim() || undefined, limit: 30 }).then((r) => { if (!stale) setRows(r) }).catch((e) => { if (!stale) { setRows([]); toast(e instanceof Error ? e.message : 'Could not search bills.', 'err') } })
    }, 200)
    return () => { stale = true; window.clearTimeout(t) }
  }, [open, q, toast])
  const pick = async (h: BillHit) => {
    try { onPick(await call<BillDetail>('day', 'bill_detail', { order_id: h.order_id })) } catch (e) { toast(e instanceof Error ? e.message : 'Could not open the bill.', 'err') }
  }
  return (
    <Drawer open={open} onClose={onClose} title="Find a bill to return or exchange" wide>
      <input className="field-control" autoFocus placeholder="Bill no., customer or amount…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a bill" />
      <div style={{ marginTop: 12 }}>
        {rows === null ? <div className="skeleton" style={{ minHeight: 120 }} /> : rows.length === 0 ? <EmptyState title="No bills found" /> : (
          <table className="tbl"><thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th className="td-right">Total</th></tr></thead>
            <tbody>{rows.map((h) => <tr key={h.order_id} style={{ cursor: 'pointer' }} onClick={() => !h.is_refund && void pick(h)}>
              <td className="cell-main">{h.invoice || h.name}{h.is_refund && <> <Tag kind="amber">RETURN</Tag></>}</td><td className="td-muted">{h.business_date}</td><td>{h.customer || 'Walk-in'}</td><td className="td-right num">{money(h.total)}</td></tr>)}</tbody></table>)}
      </div>
    </Drawer>
  )
}
