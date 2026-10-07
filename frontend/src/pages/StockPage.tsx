import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useWorkspace, type CounterProduct } from '@/data/workspace'
import { call } from '@/lib/api'
import { refreshNow, submitQueued } from '@/lib/sync'
import { searchProducts } from '@/lib/search'
import { downloadCsv, money, num } from '@/lib/utils'
import { Btn, Drawer, EmptyState, NumInput, Panel, Tag, Tile, useToast } from '@/components/ui'

/**
 * Stock on hand, straight from Odoo's stock quants.  The screen reads the synced snapshot and sends the cashier's
 * intent (move 6 bottles to the counter); Odoo validates it, moves the stock and the new levels come back.
 */

interface Movement { date: string; kind: string; qty: number; from: string; to: string; ref: string; origin: string }
type Direction = 'godown_to_counter' | 'counter_to_godown'

const KIND_LABEL: Record<string, string> = {
  intake: 'Purchase received', transfer: 'Transfer', sale: 'Sold', return: 'Customer return', open: 'Bottle opened',
  scrap: 'Scrapped', adjustment: 'Adjustment', supplier_return: 'Returned to supplier',
}

export default function StockPage() {
  const { seesValuation, featureOn, can } = useAuth()
  const ws = useWorkspace()
  const toast = useToast()
  const kitchenEnabled = featureOn('kitchen')

  const [search, setSearch] = useState('')
  const q = useDeferredValue(search)
  const [lowOnly, setLowOnly] = useState(false)
  const [kitchenOnly, setKitchenOnly] = useState(false)
  const [category, setCategory] = useState('')
  const [value, setValue] = useState<{ godown: number; counter: number; opened: number } | null>(null)
  const [transfer, setTransfer] = useState<{ open: boolean; product?: CounterProduct }>({ open: false })
  const [history, setHistory] = useState<{ product: CounterProduct; rows: Movement[] | null } | null>(null)

  useEffect(() => { if (!kitchenEnabled) setKitchenOnly(false) }, [kitchenEnabled])

  // Valuation is only requested for roles that may see it (Odoo answers null otherwise).
  useEffect(() => {
    if (!seesValuation) return
    call('stock', 'stock_value_by_location').then(setValue).catch(() => setValue(null))
  }, [seesValuation, ws.seq])

  const stocked = useMemo(() => ws.counterProducts.filter((p) => p.active), [ws.counterProducts])
  const categories = useMemo(() => [...new Set(stocked.map((p) => p.category).filter(Boolean))].sort(), [stocked])

  const rows = useMemo(() => {
    const base = stocked.filter((p) => {
      if (p.isKitchen !== kitchenOnly) return false
      if (lowOnly && !p.lowStock) return false
      if (category && p.category !== category) return false
      return true
    })
    return q.trim() ? searchProducts(base, q) : base
  }, [stocked, kitchenOnly, lowOnly, category, q])

  const lowCount = stocked.filter((p) => !p.isKitchen && p.lowStock).length
  const outCount = stocked.filter((p) => !p.isKitchen && p.totalPcs <= 0).length

  const openHistory = async (product: CounterProduct) => {
    setHistory({ product, rows: null })
    try {
      const rows = await call<Movement[]>('stock', 'movement_history', { product_id: product.productId, limit: 100 })
      setHistory({ product, rows })
    } catch (e) {
      setHistory(null)
      toast(e instanceof Error ? e.message : 'Could not load the history.', 'err')
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="tile-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Tile label="Products" value={stocked.filter((p) => !p.isKitchen).length} />
        <Tile label="Low stock" value={lowCount} tone={lowCount ? 'amber' : 'neutral'} onClick={() => { setLowOnly(true); setKitchenOnly(false) }} />
        <Tile label="Out of stock" value={outCount} tone={outCount ? 'red' : 'neutral'} />
        {value && <Tile label="Stock value (cost)" value={money(value.godown + value.counter + value.opened)}
          sub={`Godown ${money(value.godown)} · Counter ${money(value.counter)} · Open ${money(value.opened)}`} />}
        {ws.discrepanciesOpen > 0 && <Tile label="Stock to verify" value={ws.discrepanciesOpen} tone="red" sub="Offline sales that exceeded stock" />}
      </div>

      <Panel
        title={kitchenOnly ? 'Kitchen items' : 'Stock levels'}
        subtitle="Godown = storage · Counter = ready to sell"
        actions={
          <div className="row" style={{ gap: 8 }}>
            {kitchenEnabled && (
              <Btn sm variant={kitchenOnly ? 'primary' : 'tertiary'} onClick={() => setKitchenOnly((v) => !v)}>Kitchen</Btn>
            )}
            <Btn sm variant="tertiary" onClick={() => downloadCsv('stock.csv', rows.map((p) => ({
              Product: p.name, Unit: p.unit, Godown: p.godownPcs, Counter: p.counterPcs, Total: p.totalPcs,
            })))}>Export CSV</Btn>
            {can('stock') && <Btn sm variant="primary" onClick={() => setTransfer({ open: true })}>Transfer stock</Btn>}
          </div>
        }
      >
        <div className="row" style={{ gap: 8, padding: 12, flexWrap: 'wrap' }}>
          <input className="field-control" style={{ flex: '1 1 240px' }} placeholder="Search by name, code or barcode…"
            value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search stock" />
          <select className="field-control" style={{ width: 180 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Btn sm variant={lowOnly ? 'primary' : 'tertiary'} aria-pressed={lowOnly} onClick={() => setLowOnly((v) => !v)}>Low stock only</Btn>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No products to show" hint={ws.status === 'loading' ? 'Loading stock…' : 'Try a different search or filter.'} />
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th><th>Unit</th>
                  <th className="td-right">Godown</th><th className="td-right">Counter</th>
                  {!kitchenOnly && <th className="td-right">Open (ml)</th>}
                  <th className="td-right">Total</th><th style={{ width: 150 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const total = p.totalPcs
                  return (
                    <tr key={p.productId}>
                      <td>
                        <span className="cell-main">{p.name}</span>{' '}
                        {p.lowStock && <Tag kind="amber">LOW</Tag>}{' '}
                        {!p.isKitchen && total <= 0 && <Tag kind="red">OUT</Tag>}
                        <div className="t-caption">{p.barcode || p.code}</div>
                      </td>
                      <td className="td-muted">{p.unit}</td>
                      <td className="td-right num">{p.isKitchen ? '—' : num(p.godownPcs)}</td>
                      <td className="td-right num">{p.isKitchen ? '—' : num(p.counterPcs)}</td>
                      {!kitchenOnly && <td className="td-right num">{p.openedMl > 0 ? num(p.openedMl) : '—'}</td>}
                      <td className="td-right num"><strong>{p.isKitchen ? '—' : num(total)}</strong></td>
                      <td className="td-right">
                        <Btn sm onClick={() => void openHistory(p)}>History</Btn>{' '}
                        {!p.isKitchen && <Btn sm onClick={() => setTransfer({ open: true, product: p })}>Move</Btn>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {ws.openBottles.length > 0 && !kitchenOnly && (
        <Panel title="Open bottles" subtitle="Oldest first: pour these before opening a new one">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>Bottle</th><th>Product</th><th className="td-right">Left (ml)</th><th className="td-right">Full</th></tr></thead>
              <tbody>
                {ws.openBottles.map((b) => (
                  <tr key={b.id}>
                    <td>{b.label}</td><td>{b.product}</td>
                    <td className="td-right num">{num(b.remaining_ml)} / {num(b.capacity_ml)}</td>
                    <td className="td-right num">{Math.round(b.percent)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <TransferDrawer
        open={transfer.open}
        product={transfer.product}
        products={stocked.filter((p) => !p.isKitchen)}
        onClose={() => setTransfer({ open: false })}
        onDone={() => { setTransfer({ open: false }); void refreshNow() }}
      />

      <Drawer open={!!history} onClose={() => setHistory(null)} title={history ? `${history.product.name}: stock movements` : ''} wide>
        {!history?.rows ? <div className="skeleton" style={{ minHeight: 120 }} /> : history.rows.length === 0 ? (
          <EmptyState title="No movements yet" />
        ) : (
          <table className="tbl">
            <thead><tr><th>When</th><th>What</th><th className="td-right">Qty</th><th>From → To</th><th>Ref</th></tr></thead>
            <tbody>
              {history.rows.map((m, i) => (
                <tr key={i}>
                  <td className="td-muted">{new Date(m.date).toLocaleString('en-IN')}</td>
                  <td>{KIND_LABEL[m.kind] ?? m.kind}</td>
                  <td className="td-right num">{num(m.qty)}</td>
                  <td className="td-muted">{m.from} → {m.to}</td>
                  <td className="td-muted">{m.ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Drawer>
    </div>
  )
}

function TransferDrawer({ open, product, products, onClose, onDone }: {
  open: boolean
  product?: CounterProduct
  products: CounterProduct[]
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [direction, setDirection] = useState<Direction>('godown_to_counter')
  const [productId, setProductId] = useState<number | ''>('')
  const [qty, setQty] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setProductId(product?.productId ?? ''); setQty(0); setDirection('godown_to_counter') }
  }, [open, product])

  const chosen = products.find((p) => p.productId === productId)
  const have = chosen ? (direction === 'godown_to_counter' ? chosen.godownPcs : chosen.counterPcs) : 0

  const submit = async () => {
    if (!chosen || qty <= 0) return
    setBusy(true)
    try {
      const res = await submitQueued('stock_transfer', { direction, quantities: { [chosen.productId]: qty } })
      toast(res.queued ? 'Saved on this device. The stock will move when the connection returns.' : `Moved ${qty} × ${chosen.name}`, res.queued ? 'info' : 'ok')
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not move the stock.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Transfer stock"
      footer={<Btn variant="primary" block disabled={busy || !chosen || qty <= 0 || qty > have} onClick={() => void submit()}>
        {busy ? 'Moving…' : 'Move stock'}
      </Btn>}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="pay-seg" role="group" aria-label="Direction">
          <button type="button" className={`pay-seg-btn ${direction === 'godown_to_counter' ? 'on' : ''}`} onClick={() => setDirection('godown_to_counter')}>Godown → Counter</button>
          <button type="button" className={`pay-seg-btn ${direction === 'counter_to_godown' ? 'on' : ''}`} onClick={() => setDirection('counter_to_godown')}>Counter → Godown</button>
        </div>
        <div>
          <div className="micro-label">Product</div>
          <select className="field-control" style={{ marginTop: 8 }} value={productId} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Choose a product…</option>
            {products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
          </select>
        </div>
        {chosen && <div className="t-caption">Available to move: <strong className="num">{num(have)}</strong> {chosen.unit}</div>}
        <div>
          <div className="micro-label">Quantity</div>
          <NumInput className="field-control" style={{ marginTop: 8 }} value={qty} onChange={setQty} placeholder="0" aria-label="Quantity to move" />
          {qty > have && chosen && <div className="alert" style={{ marginTop: 8 }}>Only {num(have)} available in the source location.</div>}
        </div>
      </div>
    </Drawer>
  )
}
