import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useWorkspace } from '@/data/workspace'
import { ApiError, call } from '@/lib/api'
import { money } from '@/lib/utils'
import { Btn, Drawer, EmptyState, Field, NumInput, NoAccess, Panel, Tag, Tile, useToast } from '@/components/ui'

/**
 * Cash Flow: the chronological cash diary, a view over Odoo's cash and bank ledger lines.
 * Entries (expense, income, owner drawing, capital) are real Odoo payments; cash entries also feed the Daybook's
 * expected cash.  Entries are online-only: money vouchers need the server's ledger.
 */

interface Row { at: string; date: string; description: string; voucher: string; type: string; mode: 'cash' | 'bank'; in: number; out: number }
interface Register { opening: number; rows: Row[]; cash_in: number; cash_out: number; net: number; closing: number }
type Kind = 'expense' | 'income' | 'owner_drawing' | 'capital_injection'
const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: 'expense', label: 'Expense', hint: 'Tea, cleaning, electricity, transport…' },
  { key: 'income', label: 'Income', hint: 'Scrap sale, rebate, other receipts' },
  { key: 'owner_drawing', label: 'Owner drawing', hint: 'Cash taken out by the owner' },
  { key: 'capital_injection', label: 'Capital added', hint: 'Cash put in by the owner' },
]
const TYPE_LABEL: Record<string, string> = { pos_sale: 'Counter sale', payment: 'Payment / voucher', out_invoice: 'Invoice', in_invoice: 'Purchase bill', entry: 'Journal entry' }

export default function CashFlowPage() {
  const { seesMoney } = useAuth()
  const ws = useWorkspace()
  const toast = useToast()
  const [mode, setMode] = useState<'' | 'cash' | 'bank'>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<Register | null>(null)
  const [error, setError] = useState('')
  const [entry, setEntry] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      setData(await call<Register>('cashflow', 'register', { date_from: from || undefined, date_to: to || undefined, mode: mode || undefined }))
    } catch (e) {
      setData(null)
      setError(e instanceof ApiError && e.network ? 'You are offline: the cash diary needs a connection.' : e instanceof Error ? e.message : 'Could not load the cash diary.')
    }
  }, [from, to, mode])

  useEffect(() => { if (seesMoney) void load() }, [load, seesMoney, ws.seq])

  if (!seesMoney) return <NoAccess what="Cash Flow figures" />

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="tile-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Tile label="Cash in" value={data ? money(data.cash_in) : '—'} tone="green" />
        <Tile label="Cash out" value={data ? money(data.cash_out) : '—'} tone="red" />
        <Tile label="Net movement" value={data ? money(data.net) : '—'} />
        <Tile label="Closing balance" value={data ? money(data.closing) : '—'} sub={data ? `Opening ${money(data.opening)}` : undefined} />
      </div>
      <Panel title="Cash diary" subtitle="Every rupee in or out of cash and bank"
        actions={<Btn sm variant="primary" disabled={!ws.online} onClick={() => setEntry(true)}>+ New entry</Btn>}>
        <div className="row" style={{ gap: 8, padding: 12, flexWrap: 'wrap' }}>
          <div className="pay-seg flow" role="group" aria-label="Account">
            {([['', 'All'], ['cash', 'Cash'], ['bank', 'Bank / UPI']] as const).map(([k, l]) => (
              <button key={k} type="button" className={`pay-seg-btn ${mode === k ? 'on' : ''}`} onClick={() => setMode(k)}>{l}</button>))}
          </div>
          <input className="field-control" type="date" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input className="field-control" type="date" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
        {error ? <div className="alert" role="alert" style={{ margin: 12 }}>{error} <button className="link-btn" onClick={() => void load()}>Retry</button></div>
          : !data ? <div className="skeleton" style={{ minHeight: 160, margin: 12 }} />
          : data.rows.length === 0 ? <EmptyState title="No cash movements" hint="Counter sales, payments and vouchers appear here." />
          : (
            <div className="tbl-scroll"><table className="tbl">
              <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Account</th><th className="td-right">In</th><th className="td-right">Out</th></tr></thead>
              <tbody>{data.rows.map((r, i) => (
                <tr key={i}><td className="td-muted">{r.date}</td>
                  <td><span className="cell-main">{r.description}</span><div className="t-caption">{r.voucher}</div></td>
                  <td className="td-muted">{TYPE_LABEL[r.type] ?? r.type}</td>
                  <td><Tag kind={r.mode === 'cash' ? 'green' : 'blue'}>{r.mode === 'cash' ? 'Cash' : 'Bank'}</Tag></td>
                  <td className="td-right num">{r.in ? money(r.in) : ''}</td><td className="td-right num">{r.out ? money(r.out) : ''}</td></tr>))}</tbody></table></div>)}
      </Panel>
      {entry && <EntryDrawer onClose={() => setEntry(false)} onDone={() => { setEntry(false); toast('Entry recorded', 'ok'); void load() }} />}
    </div>
  )
}

function EntryDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>('expense')
  const [amount, setAmount] = useState(0)
  const [mode, setMode] = useState<'cash' | 'bank'>('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async () => {
    setErr('')
    if (amount <= 0) return setErr('Enter an amount greater than zero.')
    setBusy(true)
    try { await call('cashflow', 'new_entry', { kind, amount, mode, description: note.trim() || undefined }); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not record the entry.') } finally { setBusy(false) }
  }
  return (
    <Drawer open onClose={onClose} title="New cash entry"
      footer={<Btn variant="primary" block disabled={busy} onClick={() => void submit()}>{busy ? 'Recording…' : 'Record entry'}</Btn>}>
      <div className="stack" style={{ gap: 14 }}>
        {err && <div className="alert" role="alert">{err}</div>}
        <div className="pay-seg flow" role="group" aria-label="Entry type" style={{ flexWrap: 'wrap' }}>
          {KINDS.map((k) => <button key={k.key} type="button" className={`pay-seg-btn ${kind === k.key ? 'on' : ''}`} onClick={() => setKind(k.key)}>{k.label}</button>)}
        </div>
        <div className="t-caption">{KINDS.find((k) => k.key === kind)?.hint}</div>
        <Field label="Amount (₹)"><NumInput className="field-control" autoFocus value={amount} onChange={setAmount} /></Field>
        <Field label="Paid from / received in">
          <select className="field-control" value={mode} onChange={(e) => setMode(e.target.value as 'cash' | 'bank')}><option value="cash">Cash drawer</option><option value="bank">Bank / UPI</option></select>
        </Field>
        <Field label="Note"><input className="field-control" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was this for?" /></Field>
      </div>
    </Drawer>
  )
}
