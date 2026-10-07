import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useWorkspace } from '@/data/workspace'
import { ApiError, call } from '@/lib/api'
import { money, num } from '@/lib/utils'
import { Btn, Panel, Tag, Tile } from '@/components/ui'

/**
 * Dashboard: a read-only projection of Odoo's own figures (today's bills, payment split, profit, stock value,
 * what needs attention).  Nothing is derived here.  It refreshes whenever the sync layer sees a change (a bill
 * settled anywhere), and money figures the role may not see arrive as null and show as a dash.
 */

interface Dash {
  today: {
    business_date: string; day_state: string; bill_count: number; total_sales: number | null
    payments: { cash: number; upi: number; khata: number } | null; gross_profit: number | null; drawer_cash: number | null
  }
  trend: { date: string; sales: number | null }[]
  stock_value: { godown: number; counter: number; opened: number } | null
  attention: Attention[]
}
type Attention =
  | { type: 'low_stock'; product: string; total: number }
  | { type: 'overdue_khata'; partner_id: number; partner: string; amount: number }
  | { type: 'stock_discrepancy'; count: number }
  | { type: 'unclosed_day'; date: string }

const dash = (n: number | null | undefined) => (n === null || n === undefined ? '—' : money(n))

/** Rolls the digits to the new value, with a brief green pulse when it goes up. */
function Ticker({ value }: { value: number | null }) {
  const [shown, setShown] = useState(value ?? 0)
  const [pulse, setPulse] = useState(false)
  const from = useRef(value ?? 0)
  useEffect(() => {
    if (value === null) return
    const start = from.current
    if (start === value) return
    setPulse(value > start)
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 600)
      setShown(start + (value - start) * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(step)
      else { from.current = value; setShown(value) }
    }
    raf = requestAnimationFrame(step)
    const off = window.setTimeout(() => setPulse(false), 1200)
    return () => { cancelAnimationFrame(raf); window.clearTimeout(off) }
  }, [value])
  if (value === null) return <>—</>
  return <span style={{ transition: 'color .4s', color: pulse ? 'var(--ok, #198038)' : undefined }}>{money(Math.round(shown * 100) / 100)}</span>
}

export default function DashboardPage() {
  const nav = useNavigate()
  const { can, seesMoney } = useAuth()
  const ws = useWorkspace()
  const [d, setD] = useState<Dash | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setD(await call<Dash>('reports', 'dashboard')); setError('') }
    catch (e) { setError(e instanceof ApiError && e.network ? 'Offline: showing the last figures.' : e instanceof Error ? e.message : 'Could not load the dashboard.') }
  }, [])
  useEffect(() => { void load() }, [load, ws.seq])

  if (!d) return error ? <div className="alert" role="alert">{error} <button className="link-btn" onClick={() => void load()}>Retry</button></div>
    : <div className="skeleton" style={{ minHeight: 320 }} />

  const t = d.today
  const max = Math.max(1, ...d.trend.map((x) => x.sales ?? 0))
  const stockTotal = d.stock_value ? d.stock_value.godown + d.stock_value.counter + d.stock_value.opened : null

  return (
    <div className="stack" style={{ gap: 16 }}>
      {error && <div className="alert" role="status">{error}</div>}
      <div className="tile-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Tile label="Today's sales" value={<Ticker value={t.total_sales} />} sub={`${t.bill_count} bill${t.bill_count === 1 ? '' : 's'} · ${t.business_date}`} tone="blue" />
        <Tile label="Cash" value={<Ticker value={t.payments?.cash ?? null} />} />
        <Tile label="UPI / online" value={<Ticker value={t.payments?.upi ?? null} />} />
        <Tile label="Khata (not collected)" value={<Ticker value={t.payments?.khata ?? null} />} tone="amber" sub="Credit, not cash" />
        <Tile label="Gross profit" value={dash(t.gross_profit)} sub={t.gross_profit === null && seesMoney ? 'Hidden for your role' : undefined} />
        <Tile label="Drawer cash (expected)" value={<Ticker value={t.drawer_cash} />} />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Panel title="Last 7 days" subtitle="Net sales per business day">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, padding: 16 }} role="img" aria-label="Sales for the last seven days">
            {d.trend.map((x) => (
              <div key={x.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`${x.date}: ${dash(x.sales)}`}>
                <div style={{ width: '100%', height: `${Math.max(2, ((x.sales ?? 0) / max) * 110)}px`, background: 'var(--blue)' }} />
                <span className="t-caption">{x.date.slice(5)}</span>
              </div>))}
          </div>
        </Panel>
        <Panel title="Stock value" subtitle="At cost, by location">
          <div className="pay-box" style={{ margin: 12 }}>
            {d.stock_value ? <>
              <div className="pay-row num"><span>Godown</span><span>{money(d.stock_value.godown)}</span></div>
              <div className="pay-row num"><span>Counter</span><span>{money(d.stock_value.counter)}</span></div>
              <div className="pay-row num"><span>Open bottles</span><span>{money(d.stock_value.opened)}</span></div>
              <div className="pay-net num"><span>Total</span><span>{money(stockTotal ?? 0)}</span></div></>
              : <div className="t-caption">Stock value is hidden for your role.</div>}
          </div>
        </Panel>
      </div>

      <Panel title="Needs attention">
        {d.attention.length === 0 ? <div className="t-caption" style={{ padding: 16 }}>Nothing needs attention right now.</div> : (
          <div className="tbl-scroll"><table className="tbl"><tbody>{d.attention.map((a, i) => (
            <tr key={i}>
              {a.type === 'low_stock' && <><td><Tag kind="amber">LOW STOCK</Tag></td><td>{a.product}</td><td className="td-right num">{num(a.total)} left</td><td className="td-right"><Btn sm onClick={() => nav('/stock')}>View</Btn></td></>}
              {a.type === 'overdue_khata' && <><td><Tag kind="red">OVERDUE KHATA</Tag></td><td>{a.partner}</td><td className="td-right num">{money(a.amount)}</td><td className="td-right"><Btn sm onClick={() => nav('/accounts')}>Collect</Btn></td></>}
              {a.type === 'stock_discrepancy' && <><td><Tag kind="red">STOCK TO VERIFY</Tag></td><td>{a.count} offline sale{a.count > 1 ? 's' : ''} exceeded stock</td><td></td><td className="td-right"><Btn sm onClick={() => nav('/stock')}>Review</Btn></td></>}
              {a.type === 'unclosed_day' && <><td><Tag kind="amber">DAY NOT CLOSED</Tag></td><td>{a.date} was never closed</td><td></td><td></td></>}
            </tr>))}</tbody></table></div>)}
      </Panel>

      <Panel title="Quick actions">
        <div className="row" style={{ gap: 8, padding: 12, flexWrap: 'wrap' }}>
          {can('sales') && <Btn variant="primary" onClick={() => nav('/sales')}>New sale</Btn>}
          {can('purchases') && <Btn variant="tertiary" onClick={() => nav('/purchases')}>Record purchase</Btn>}
          {can('stock') && <Btn variant="tertiary" onClick={() => nav('/stock')}>Transfer stock</Btn>}
          {can('cashflow') && <Btn variant="tertiary" onClick={() => nav('/cashflow')}>New cash entry</Btn>}
          {can('products') && <Btn variant="tertiary" onClick={() => nav('/products')}>Add product</Btn>}
        </div>
      </Panel>
    </div>
  )
}
