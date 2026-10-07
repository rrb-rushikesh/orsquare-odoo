import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useWorkspace, type CounterProduct } from '@/data/workspace'
import { ApiError, call } from '@/lib/api'
import { submitSale } from '@/lib/sync'
import { estimateTotal, type BillDiscount } from '@/lib/estimate'
import { searchProductsCached } from '@/lib/search'
import { attachScannerCapture, beep } from '@/lib/scanner'
import { money } from '@/lib/utils'
import { Btn, EmptyState, NumInput, Panel, Tag, useToast } from '@/components/ui'
import { IconX } from '@/components/icons'

/**
 * The counter.
 *
 * This screen only collects what the cashier does (items, quantities, who is paying and how) and shows what Odoo
 * answers.  Tax, discounts and totals come from `sales.quote` while building the bill and from `sales.settle`
 * when it is billed; stock is enforced by the server.  Offline, a clearly labelled estimate stands in
 * (lib/estimate.ts) and the real numbers arrive when the bill syncs.
 */

type Method = 'cash' | 'upi' | 'khata'

interface BillLine {
  productId: number
  qty: number
  /** Only set when the cashier overrides the shelf rate. */
  rate?: number
}

interface Quote {
  subtotal: number
  discount: number
  tax: number
  total: number
  payable: number
  lines: { product_id: number; total: number }[]
}

const DRAFT_KEY = 'or2.billDraft.v2'
const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000

function loadDraft(): BillLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (!raw || Date.now() - raw.at > DRAFT_MAX_AGE_MS) return []
    return Array.isArray(raw.lines) ? raw.lines : []
  } catch {
    return []
  }
}

const newRef = () => `bill-${crypto.randomUUID()}`

export default function SalesPage() {
  const nav = useNavigate()
  const toast = useToast()
  const { featureOn, me } = useAuth()
  const ws = useWorkspace()
  const autoGodown = featureOn('auto_godown_transfer')
  const kitchenOn = featureOn('kitchen')

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
  const searchRef = useRef<HTMLInputElement>(null)
  // One idempotency key per bill: a retry after a dropped connection is answered, never billed twice.
  const clientRef = useRef(newRef())

  const products = useMemo(
    () => ws.counterProducts.filter((p) => p.active && (kitchenOn || !p.isKitchen)),
    [ws.counterProducts, kitchenOn],
  )
  const barcodeMap = useMemo(() => new Map(products.filter((p) => p.barcode).map((p) => [p.barcode, p])), [products])

  const discount: BillDiscount | null = !promo && discountValue > 0 ? { kind: discountKind, value: discountValue } : null
  const priced = useMemo(
    () => lines.map((l) => ({ ...l, p: ws.productById.get(l.productId) })).filter((l): l is typeof l & { p: CounterProduct } => !!l.p),
    [lines, ws.productById],
  )

  // ---- persist the open bill so a refresh or crash never loses it
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), lines })) } catch { /* ignore */ }
  }, [lines])

  // ---- live price from Odoo (debounced); an offline estimate only when the server cannot be reached
  const payloadForQuote = useMemo(() => ({
    lines: priced.map((l) => ({ product_id: l.productId, qty: l.qty, price: l.rate ?? l.p.rate })),
    bill_discount: discount,
    promo_code: promo || undefined,
    partner_id: customerId ?? undefined,
  }), [priced, discount, promo, customerId])

  useEffect(() => {
    if (!priced.length) { setQuote(null); setQuoteError(null); return }
    let stale = false
    const t = window.setTimeout(async () => {
      try {
        const q = await call<Quote>('sales', 'quote', { payload: payloadForQuote })
        if (stale) return
        setQuote(q); setQuoteError(null); setOfflineQuote(false)
      } catch (e) {
        if (stale) return
        if (e instanceof ApiError && e.network) { setOfflineQuote(true); setQuoteError(null) } else {
          setQuote(null); setQuoteError(e instanceof Error ? e.message : 'Could not price the bill.')
        }
      }
    }, 180)
    return () => { stale = true; window.clearTimeout(t) }
  }, [payloadForQuote, priced.length])

  const estimate = useMemo(
    () => estimateTotal(priced.map((l) => ({ qty: l.qty, rate: l.rate ?? l.p.rate })), discount),
    [priced, discount],
  )
  const payable = offlineQuote || !quote ? estimate : quote.payable
  const totalPcs = priced.reduce((a, l) => a + l.qty, 0)

  // ---- adding items
  const available = useCallback(
    (p: CounterProduct) => (p.isKitchen ? Infinity : autoGodown ? p.counterPcs + p.godownPcs : p.counterPcs),
    [autoGodown],
  )

  const addProduct = useCallback((p: CounterProduct) => {
    setArmed(null)
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.productId)
      if (i >= 0) return prev.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l))
      return [...prev, { productId: p.productId, qty: 1 }]
    })
    setQuery('')
    searchRef.current?.focus()
  }, [])

  const onScan = useCallback((code: string) => {
    const p = barcodeMap.get(code)
    if (p) { beep('ok'); addProduct(p) } else { beep('err'); toast('No product matches that scan.', 'err') }
  }, [barcodeMap, addProduct, toast])

  useEffect(() => {
    const cap = attachScannerCapture(onScan)
    return () => cap.detach()
  }, [onScan])

  const results = useMemo(
    () => (query.trim() ? searchProductsCached(products, query, { limit: 8 }) : []),
    [products, query],
  )

  const setQty = (productId: number, qty: number) =>
    setLines((prev) => prev.flatMap((l) => (l.productId !== productId ? [l] : qty > 0 ? [{ ...l, qty }] : [])))

  const clearBill = useCallback(() => {
    setLines([]); setDiscountValue(0); setPromo(''); setCustomerId(null); setMethod('cash'); setArmed(null)
    setQuote(null); setQuoteError(null)
    clientRef.current = newRef()
  }, [])

  // ---- billing
  const overStock = priced.find((l) => l.qty > available(l.p))
  const customers = ws.customers

  const settle = useCallback(async (m: Method) => {
    if (busy || !priced.length) return
    if (m === 'khata' && !customerId) { toast('Choose the customer whose account this goes on.', 'warn'); return }
    setBusy(true)
    try {
      const res = await submitSale({
        client_ref: clientRef.current,
        lines: payloadForQuote.lines,
        bill_discount: payloadForQuote.bill_discount,
        promo_code: payloadForQuote.promo_code,
        partner_id: customerId ?? undefined,
        payments: [{ method: m, amount: payable }],
      })
      if (res.queued) toast('Saved on this device. It will be billed when the connection returns.', 'info')
      else toast(`Billed ${res.result?.name ?? ''} · ${money(res.result?.total ?? payable)}`, 'ok')
      clearBill()
    } catch (e) {
      beep('err')
      toast(e instanceof Error ? e.message : 'Could not bill this sale.', 'err')
    } finally {
      setBusy(false)
    }
  }, [busy, priced.length, customerId, payloadForQuote, payable, toast, clearBill])

  // First press arms a payment, the second confirms it: no accidental one-key bills.
  const fastPay = useCallback((m: Method) => {
    if (!priced.length || busy || overStock) return
    if (armed === m) { setArmed(null); void settle(m) } else { setArmed(m); setMethod(m) }
  }, [priced.length, busy, overStock, armed, settle])

  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(null), 4000)
    return () => window.clearTimeout(t)
  }, [armed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F8') { e.preventDefault(); fastPay('cash') }
      else if (e.key === 'F9') { e.preventDefault(); fastPay('upi') }
      else if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fastPay])

  const canBill = priced.length > 0 && !busy && !overStock && !quoteError
  const lineTotal = (l: (typeof priced)[number]) =>
    !offlineQuote && quote ? quote.lines.find((q) => q.product_id === l.productId)?.total : undefined

  return (
    <div className="pos-grid">
      <Panel>
        <div className="panel-body pos-left">
          <div style={{ position: 'relative' }}>
            <input
              ref={searchRef}
              className="field-control"
              autoFocus
              value={query}
              placeholder="Scan barcode or type product name to add to bill…"
              aria-label="Scan barcode or search products"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results[0]) { e.preventDefault(); addProduct(results[0]) }
                if (e.key === 'Escape') setQuery('')
              }}
            />
            {results.length > 0 && (
              <div className="menu-pop" style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20 }}>
                {results.map((p) => (
                  <button key={p.productId} type="button" className="menu-item" onClick={() => addProduct(p)}>
                    <span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span>
                    <span className="num t-caption">{p.isKitchen ? 'kitchen' : `${p.counterPcs} at counter`}</span>
                    <span className="num">{money(p.rate)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {overStock && (
            <div className="alert" role="alert">
              <strong>{overStock.p.name}</strong>: only {available(overStock.p)} available{' '}
              {autoGodown ? '(counter and godown)' : 'at the counter'}. Reduce the quantity to bill.{' '}
              <button className="link-btn" onClick={() => nav('/stock')}>View stock</button>
            </div>
          )}

          {priced.length === 0 ? (
            <EmptyState icon={<IconX size={16} />} title="Bill is empty" hint="Scan a barcode or press Enter on a search result to start the bill." />
          ) : (
            <div className="tbl-scroll">
              <table className="tbl bill-tbl">
                <thead>
                  <tr>
                    <th className="td-center" style={{ width: 44 }}>Sr.</th>
                    <th>Item description</th>
                    <th className="td-right" style={{ width: 112 }}>Rate (₹)</th>
                    <th className="td-center" style={{ width: 150 }}>Qty</th>
                    <th className="td-right" style={{ width: 104 }}>Total (₹)</th>
                    <th style={{ width: 44 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {priced.map((l, i) => {
                    const rate = l.rate ?? l.p.rate
                    const short = l.qty > available(l.p)
                    const t = lineTotal(l)
                    return (
                      <tr key={l.productId}>
                        <td className="td-center td-muted num">{i + 1}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span className="cell-main">{l.p.name}</span>
                            {l.p.isKitchen && <Tag kind="blue">KITCHEN</Tag>}
                            {short && <Tag kind="red">OUT OF STOCK</Tag>}
                            {!short && autoGodown && !l.p.isKitchen && l.qty > l.p.counterPcs && <Tag kind="red">IN GODOWN</Tag>}
                          </div>
                          <div className="t-caption">{l.p.barcode ? `Barcode: ${l.p.barcode}` : l.p.code ? `Code: ${l.p.code}` : ''}</div>
                        </td>
                        <td className="td-right">
                          <NumInput
                            className="field-control"
                            style={{ width: 92, textAlign: 'right' }}
                            value={rate}
                            aria-label={`Rate for ${l.p.name}`}
                            onChange={(n) => setLines((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, rate: n } : x)))}
                          />
                        </td>
                        <td className="td-center">
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Btn sm onClick={() => setQty(l.productId, l.qty - 1)} aria-label="Decrease quantity">−</Btn>
                            <NumInput
                              className="field-control"
                              style={{ width: 56, textAlign: 'center' }}
                              value={l.qty}
                              aria-label={`Quantity of ${l.p.name}`}
                              onChange={(n) => setQty(l.productId, n)}
                            />
                            <Btn sm onClick={() => setQty(l.productId, l.qty + 1)} aria-label="Increase quantity">+</Btn>
                          </div>
                        </td>
                        <td className="td-right num">{t !== undefined ? money(t) : money(l.qty * rate)}</td>
                        <td>
                          <button className="icon-btn" aria-label={`Remove ${l.p.name}`} onClick={() => setQty(l.productId, 0)}>×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>

      <div className="pos-checkout-column">
        <section className="panel co-panel" aria-label="Checkout">
          <header className="panel-head">
            <h3 className="panel-title" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Checkout</h3>
          </header>
          <div className="co-body">
            <div>
              <div className="micro-label">Customer (needed for Khata)</div>
              <select
                className="field-control"
                style={{ marginTop: 8 }}
                value={customerId ?? ''}
                aria-label="Customer"
                onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Walk-in customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <div className="micro-label">Discount</div>
              <div className="form-grid" style={{ marginTop: 8 }}>
                {ws.promos.length > 0 ? (
                  <select className="field-control" value={promo} aria-label="Promo code" onChange={(e) => setPromo(e.target.value)}>
                    <option value="">No promo</option>
                    {ws.promos.map((p) => <option key={p.id} value={p.code}>{p.code}{p.name ? ` · ${p.name}` : ''}</option>)}
                  </select>
                ) : null}
                <div className="row" style={{ gap: 6 }}>
                  <select
                    className="field-control"
                    value={discountKind}
                    aria-label="Discount type"
                    disabled={!!promo}
                    onChange={(e) => setDiscountKind(e.target.value as 'percent' | 'amount')}
                  >
                    <option value="amount">₹ off</option>
                    <option value="percent">% off</option>
                  </select>
                  <NumInput className="field-control" value={discountValue} disabled={!!promo} placeholder="0" aria-label="Discount value" onChange={setDiscountValue} />
                </div>
              </div>
            </div>

            <div className="pay-box">
              <div className="pay-row num">
                <span>Items ({totalPcs} pcs)</span>
                <span>{quote && !offlineQuote ? money(quote.subtotal) : money(estimate)}</span>
              </div>
              {quote && !offlineQuote && quote.discount > 0 && (
                <div className="pay-row num"><span>Discount</span><span className="pos">− {money(quote.discount)}</span></div>
              )}
              {quote && !offlineQuote && quote.tax > 0 && (
                <div className="pay-row num"><span>of which tax</span><span>{money(quote.tax)}</span></div>
              )}
              <div className="pay-net num">
                <span>{offlineQuote ? 'Estimated payable' : 'Net payable'}</span>
                <span>{money(payable)}</span>
              </div>
            </div>
            {offlineQuote && (
              <div className="alert">Offline: this is an estimate. Odoo prices the bill exactly when it syncs.</div>
            )}
            {quoteError && <div className="alert" role="alert">{quoteError}</div>}

            <div className="fast-pay-container">
              <div className="micro-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Fast Settlement</span>
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>F8 = Cash · F9 = UPI</span>
              </div>
              <div className={`fast-pay-seg ${customerId ? 'three-col' : ''}`}>
                <button type="button" className={`fast-pay-btn ${armed === 'cash' ? 'armed' : ''} ${method === 'cash' && !armed ? 'selected' : ''}`} disabled={!canBill} onClick={() => fastPay('cash')}>
                  <span>{armed === 'cash' ? 'Press F8 to confirm' : 'Cash'}</span><span className="fast-pay-kbd">F8</span>
                </button>
                <button type="button" className={`fast-pay-btn ${armed === 'upi' ? 'armed' : ''} ${method === 'upi' && !armed ? 'selected' : ''}`} disabled={!canBill} onClick={() => fastPay('upi')}>
                  <span>{armed === 'upi' ? 'Press F9 to confirm' : 'UPI'}</span><span className="fast-pay-kbd">F9</span>
                </button>
                {customerId && (
                  <button type="button" className={`fast-pay-btn ${method === 'khata' ? 'selected' : ''}`} disabled={!canBill} onClick={() => void settle('khata')}>
                    <span>Khata (credit)</span>
                  </button>
                )}
              </div>
            </div>

            <Btn variant="tertiary" block disabled={!lines.length || busy} onClick={clearBill}>Clear bill</Btn>
            {me && ws.pending > 0 && (
              <div className="t-caption">{ws.pending} bill{ws.pending > 1 ? 's' : ''} waiting to reach the server.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

