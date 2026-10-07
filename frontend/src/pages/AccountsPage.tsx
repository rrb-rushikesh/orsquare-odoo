import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useWorkspace } from '@/data/workspace'
import { ApiError, call } from '@/lib/api'
import { money } from '@/lib/utils'
import { Btn, Drawer, EmptyState, Field, NumInput, Panel, Tag, Tile, useToast } from '@/components/ui'

/**
 * Accounts: customers (Khata), suppliers, employees and others.  A balance is always the sum of posted Odoo ledger
 * entries; this screen shows them and records settlements (receipts / supplier payments), never edits a balance.
 * Where the role may not see money, Odoo answers null and the screen shows a dash.
 */

type Kind = 'customer' | 'supplier' | 'employee' | 'other'
interface Party { id: number; name: string; mobile: string; kind: Kind; receivable: number | null; payable: number | null }
interface Directory { rows: Party[]; count: number; summary: { receivables: number | null; payables: number | null; customers: number; suppliers: number } }
interface Statement { opening: number; closing: number; rows: { date: string; voucher: string; ref: string; description: string; debit: number; credit: number; balance: number }[] }

const FILTERS: { key: 'all' | 'customers' | 'suppliers' | 'employees' | 'others'; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'customers', label: 'Customers' }, { key: 'suppliers', label: 'Suppliers' },
  { key: 'employees', label: 'Employees' }, { key: 'others', label: 'Others' },
]
const KIND_LABEL: Record<Kind, string> = { customer: 'Customer', supplier: 'Supplier', employee: 'Employee', other: 'Other' }
const dash = (n: number | null) => (n === null ? '—' : money(n))

export default function AccountsPage() {
  const { seesMoney, isOwner } = useAuth()
  const ws = useWorkspace()
  const toast = useToast()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const [search, setSearch] = useState('')
  const [dir, setDir] = useState<Directory | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Party | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try { setDir(await call<Directory>('accounts', 'directory', { kind: filter, search: search.trim() || undefined, limit: 200 })) }
    catch (e) { setDir(null); setError(e instanceof ApiError && e.network ? 'You are offline: the directory needs a connection.' : e instanceof Error ? e.message : 'Could not load accounts.') }
  }, [filter, search])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(t)
  }, [load, ws.seq])

  const sel = useMemo(() => (selected && dir?.rows.find((r) => r.id === selected.id)) || selected, [selected, dir])

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="tile-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Tile label="Customers owe you" value={dir ? dash(dir.summary.receivables) : '—'} tone="amber" sub={dir ? `${dir.summary.customers} customers` : undefined} />
        <Tile label="You owe suppliers" value={dir ? dash(dir.summary.payables) : '—'} tone="red" sub={dir ? `${dir.summary.suppliers} suppliers` : undefined} />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: sel ? 'repeat(auto-fit, minmax(380px, 1fr))' : '1fr', alignItems: 'start' }}>
        <Panel title="Accounts" subtitle="Everyone you do business with"
          actions={<Btn sm variant="primary" disabled={!ws.online} onClick={() => setAdding(true)}>+ Add account</Btn>}>
          <div className="row" style={{ gap: 8, padding: 12, flexWrap: 'wrap' }}>
            <input className="field-control" style={{ flex: '1 1 220px' }} placeholder="Search by name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search accounts" />
            <div className="pay-seg flow" role="group" aria-label="Type" style={{ flexWrap: 'wrap' }}>
              {FILTERS.map((f) => <button key={f.key} type="button" className={`pay-seg-btn ${filter === f.key ? 'on' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>)}
            </div>
          </div>
          {error ? <div className="alert" role="alert" style={{ margin: 12 }}>{error} <button className="link-btn" onClick={() => void load()}>Retry</button></div>
            : !dir ? <div className="skeleton" style={{ minHeight: 160, margin: 12 }} />
            : dir.rows.length === 0 ? <EmptyState title="No accounts found" hint="Add a customer, supplier or employee." />
            : <div className="tbl-scroll"><table className="tbl">
              <thead><tr><th>Name</th><th>Type</th><th className="td-right">Balance</th></tr></thead>
              <tbody>{dir.rows.map((p) => {
                const bal = p.kind === 'supplier' ? p.payable : p.receivable
                return (
                  <tr key={p.id} style={{ cursor: 'pointer', background: sel?.id === p.id ? 'var(--layer)' : undefined }} onClick={() => setSelected(p)}>
                    <td><span className="cell-main">{p.name}</span><div className="t-caption">{p.mobile}</div></td>
                    <td><Tag kind="gray">{KIND_LABEL[p.kind]}</Tag></td>
                    <td className="td-right num">{bal === null ? '—' : bal === 0 ? 'Settled' : `${money(bal)} ${p.kind === 'supplier' ? 'payable' : 'due'}`}</td>
                  </tr>)
              })}</tbody></table></div>}
        </Panel>

        {sel && <Dossier party={sel} canSee={seesMoney} owner={isOwner} online={ws.online} onClose={() => setSelected(null)}
          onChanged={() => { void load() }} />}
      </div>

      {adding && <AddDrawer onClose={() => setAdding(false)} onDone={(name) => { setAdding(false); toast(`${name} added`, 'ok'); void load() }} />}
    </div>
  )
}

function Dossier({ party, canSee, owner, online, onClose, onChanged }: { party: Party; canSee: boolean; owner: boolean; online: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const [st, setSt] = useState<Statement | null>(null)
  const [err, setErr] = useState('')
  const [pay, setPay] = useState(false)
  const [advance, setAdvance] = useState<number | null>(null)
  const isEmployee = party.kind === 'employee'

  const load = useCallback(async () => {
    setErr(''); setSt(null)
    if (!canSee) return
    try {
      if (isEmployee) setAdvance(await call<number>('accounts', 'employee_advance_balance', { employee_partner_id: party.id }))
      else setSt(await call<Statement>('accounts', 'statement', { partner_id: party.id }))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load the statement.') }
  }, [party.id, canSee, isEmployee])
  useEffect(() => { void load() }, [load])

  const settleLabel = party.kind === 'supplier' ? 'Pay supplier' : isEmployee ? 'Advance / wage' : 'Receive payment'
  return (
    <Panel title={party.name} subtitle={`${KIND_LABEL[party.kind]}${party.mobile ? ` · ${party.mobile}` : ''}`}
      actions={<div className="row" style={{ gap: 8 }}>
        {(party.kind === 'customer' || party.kind === 'supplier' || (isEmployee && owner)) && canSee &&
          <Btn sm variant="primary" disabled={!online} onClick={() => setPay(true)}>{settleLabel}</Btn>}
        <Btn sm onClick={onClose} aria-label="Close">×</Btn></div>}>
      <div style={{ padding: 12 }}>
        {!canSee ? <div className="alert">Balances and statements are hidden for your role.</div>
          : err ? <div className="alert" role="alert">{err}</div>
          : isEmployee ? (advance === null ? <div className="skeleton" style={{ minHeight: 60 }} /> :
            <div className="pay-box"><div className="pay-net num"><span>Advance outstanding</span><span>{money(advance)}</span></div></div>)
          : !st ? <div className="skeleton" style={{ minHeight: 120 }} />
          : st.rows.length === 0 ? <EmptyState title="No transactions yet" />
          : <div className="tbl-scroll"><table className="tbl">
            <thead><tr><th>Date</th><th>Entry</th><th className="td-right">Debit</th><th className="td-right">Credit</th><th className="td-right">Balance</th></tr></thead>
            <tbody>{st.rows.map((r, i) => (
              <tr key={i}><td className="td-muted">{r.date}</td><td><span className="cell-main">{r.voucher}</span><div className="t-caption">{r.description || r.ref}</div></td>
                <td className="td-right num">{r.debit ? money(r.debit) : ''}</td><td className="td-right num">{r.credit ? money(r.credit) : ''}</td><td className="td-right num">{money(r.balance)}</td></tr>))}</tbody></table></div>}
      </div>
      {pay && <SettleDrawer party={party} onClose={() => setPay(false)} onDone={() => { setPay(false); toast('Recorded', 'ok'); void load(); onChanged() }} />}
    </Panel>
  )
}

function SettleDrawer({ party, onClose, onDone }: { party: Party; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<'cash' | 'upi'>('cash')
  const [note, setNote] = useState('')
  const [empKind, setEmpKind] = useState<'advance' | 'recovery' | 'wage'>('advance')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const supplier = party.kind === 'supplier'
  const employee = party.kind === 'employee'
  const due = supplier ? party.payable : party.receivable

  const submit = async () => {
    setErr('')
    if (amount <= 0) return setErr('Enter an amount greater than zero.')
    setBusy(true)
    try {
      if (employee) await call('accounts', 'employee_voucher', { employee_partner_id: party.id, kind: empKind, amount, method, note: note || undefined })
      else await call('accounts', supplier ? 'pay_supplier' : 'receive_payment', { partner_id: party.id, amount, method, note: note || undefined })
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not record this.') } finally { setBusy(false) }
  }

  return (
    <Drawer open onClose={onClose} title={supplier ? `Pay ${party.name}` : employee ? `${party.name}: advance / wage` : `Receive from ${party.name}`}
      footer={<Btn variant="primary" block disabled={busy} onClick={() => void submit()}>{busy ? 'Recording…' : 'Record'}</Btn>}>
      <div className="stack" style={{ gap: 14 }}>
        {err && <div className="alert" role="alert">{err}</div>}
        {!employee && due !== null && due > 0 && <div className="t-caption">Outstanding: <strong className="num">{money(due)}</strong> <button className="link-btn" onClick={() => setAmount(due)}>Use full amount</button></div>}
        {employee && <div className="pay-seg flow" role="group" aria-label="Voucher type">
          {(['advance', 'recovery', 'wage'] as const).map((k) => <button key={k} type="button" className={`pay-seg-btn ${empKind === k ? 'on' : ''}`} onClick={() => setEmpKind(k)}>{k === 'advance' ? 'Advance' : k === 'recovery' ? 'Recovery' : 'Wage'}</button>)}</div>}
        <Field label="Amount (₹)"><NumInput className="field-control" autoFocus value={amount} onChange={setAmount} /></Field>
        <Field label={supplier || employee ? 'Paid from' : 'Received in'}>
          <select className="field-control" value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'upi')}><option value="cash">Cash</option><option value="upi">UPI / bank</option></select></Field>
        <Field label="Note"><input className="field-control" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Drawer>
  )
}

function AddDrawer({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const { isOwner } = useAuth()
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [kind, setKind] = useState<Kind>('customer')
  const [opening, setOpening] = useState(0)
  const [gstin, setGstin] = useState('')
  const [gst, setGst] = useState<{ valid: boolean; reason: string; state: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (gstin.trim().length < 15) { setGst(null); return }
    let stale = false
    call<{ valid: boolean; reason: string; state: string }>('accounts', 'lookup_gstin', { gstin }).then((r) => { if (!stale) setGst(r) }).catch(() => undefined)
    return () => { stale = true }
  }, [gstin])

  const submit = async () => {
    setErr('')
    if (!name.trim()) return setErr('A name is required.')
    if (gstin.trim() && gst && !gst.valid) return setErr(gst.reason || 'The GSTIN is not valid.')
    setBusy(true)
    try { await call('accounts', 'create_party', { name, kind, mobile: mobile || undefined, opening_balance: opening || 0, gstin: gstin.trim() || undefined }); onDone(name.trim()) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the account.') } finally { setBusy(false) }
  }
  return (
    <Drawer open onClose={onClose} title="Add account" footer={<Btn variant="primary" block disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Add account'}</Btn>}>
      <div className="stack" style={{ gap: 14 }}>
        {err && <div className="alert" role="alert">{err}</div>}
        <Field label="Type"><select className="field-control" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="customer">Customer</option><option value="supplier">Supplier</option>{isOwner && <option value="employee">Employee</option>}<option value="other">Other</option></select></Field>
        <Field label="Name"><input className="field-control" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mobile"><input className="field-control" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} /></Field>
        {(kind === 'customer' || kind === 'supplier') && <Field label="GSTIN (optional)" help={gst ? (gst.valid ? `Valid · ${gst.state}` : gst.reason) : 'Checked for format and check digit.'}>
          <input className="field-control" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} /></Field>}
        <Field label="Opening balance (₹)" help="What they already owe you (customer) or you owe them (supplier)."><NumInput className="field-control" value={opening} onChange={setOpening} /></Field>
      </div>
    </Drawer>
  )
}
