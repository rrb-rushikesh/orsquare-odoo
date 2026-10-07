import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useWorkspace, refreshNow, type CounterProduct } from '@/data/workspace'
import { ApiError, call } from '@/lib/api'
import { submitMutation } from '@/lib/sync'
import { searchProductsCached } from '@/lib/search'
import { money, num } from '@/lib/utils'
import { Btn, Drawer, EmptyState, Field, NumInput, Panel, Tag, Tile, useToast } from '@/components/ui'

/**
 * Purchases: record supplier bills (goods land in the Godown), find past bills, return or exchange.
 *
 * Odoo does all the maths: per-line rate/total (forward and reverse entry), taxes, TCS, round-off and landed cost
 * come back from `purchases.preview_bill` and are what the screen shows.  Recording a bill can be queued offline
 * (same durable outbox and idempotency key as sales); finding bills and returns need the server.
 */

interface BillRow {
  id: number; number: string; supplier: string; supplier_id: number; supplier_invoice_no: string; date: string
  type: string; total: number; amount_due: number; payment_state: string
}
interface BillDetail extends BillRow { lines: { product_id: number; name: string; qty: number; uom: string; rate: number; total: number }[]; tp_no: string }
interface Line { key: number; productId: number; qty: number; uomId: number; source: 'rate' | 'amount'; rate: number; amount: number; discountPct: number }
interface Adjustment { type: 'discount' | 'expense'; description: string; amount: number; capitalize: boolean }
interface Preview {
  lines: { product_id: number; qty: number; rate: number; amount: number }[]
  gross: number; discounts: number; charges: number; tax: number; tcs_rate: number; tcs_calculated: number; total: number
}

const newRef = () => `pur-${crypto.randomUUID()}`
const STATE_LABEL: Record<string, string> = { paid: 'Paid', not_paid: 'Unpaid', partial: 'Part paid', in_payment: 'Paid', reversed: 'Reversed' }

export default function PurchasesPage() {
  const ws = useWorkspace()
  const toast = useToast()
  const { can } = useAuth()
  const [rows, setRows] = useState<BillRow[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [newBill, setNewBill] = useState(false)
  const [detail, setDetail] = useState<BillDetail | null>(null)
  const [returning, setReturning] = useState<BillDetail | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      setRows(await call<BillRow[]>('purchases', 'list_bills', { search: search.trim() || undefined, date_from: from || undefined, date_to: to || undefined, limit: 100 }))
    } catch (e) {
      setRows(null)
      setError(e instanceof ApiError && e.network ? 'You are offline: the bill register needs a connection.' : e instanceof Error ? e.message : 'Could not load bills.')
    }
  }, [search, from, to])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(t)
  }, [load, ws.seq])

  const open = async (r: BillRow) => {
    try { setDetail(await call<BillDetail>('purchases', 'bill_detail', { bill_id: r.id })) } catch (e) { toast(e instanceof Error ? e.message : 'Could not open the bill.', 'err') }
  }

  const due = rows?.reduce((a, r) => a + (r.type === 'in_invoice' ? r.amount_due : 0), 0)

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="tile-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Tile label="Bills shown" value={rows?.length ?? '—'} />
        {rows && <Tile label="Still to pay (shown bills)" value={money(due ?? 0)} tone={due ? 'amber' : 'neutral'} />}
        {ws.pending > 0 && <Tile label="Waiting to sync" value={ws.pending} tone="amber" sub="Saved on this device" />}
      </div>
      <Panel title="Purchase bills" subtitle="Goods received into the Godown"
        actions={<Btn sm variant="primary" disabled={!can('purchases')} onClick={() => setNewBill(true)}>+ New purchase bill</Btn>}>
        <div className="row" style={{ gap: 8, padding: 12, flexWrap: 'wrap' }}>
          <input className="field-control" style={{ flex: '1 1 240px' }} placeholder="Bill no., supplier or invoice no…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a bill" />
          <input className="field-control" type="date" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input className="field-control" type="date" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
        {error ? <div className="alert" role="alert" style={{ margin: 12 }}>{error} <button className="link-btn" onClick={() => void load()}>Retry</button></div>
          : rows === null ? <div className="skeleton" style={{ minHeight: 160, margin: 12 }} />
          : rows.length === 0 ? <EmptyState title="No purchase bills" hint="Record the first bill when stock arrives." action={<Btn variant="primary" onClick={() => setNewBill(true)}>+ New purchase bill</Btn>} />
          : (
            <div className="tbl-scroll"><table className="tbl">
              <thead><tr><th>Date</th><th>Bill</th><th>Supplier</th><th>Supplier inv.</th><th className="td-right">Total</th><th className="td-right">Due</th><th>Status</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => void open(r)}>
                  <td className="td-muted">{r.date}</td><td className="cell-main">{r.number}{r.type === 'in_refund' && <> <Tag kind="amber">RETURN</Tag></>}</td>
                  <td>{r.supplier}</td><td className="td-muted">{r.supplier_invoice_no || '—'}</td>
                  <td className="td-right num">{money(r.total)}</td><td className="td-right num">{r.amount_due ? money(r.amount_due) : '—'}</td>
                  <td><Tag kind={r.payment_state === 'paid' ? 'green' : 'amber'}>{STATE_LABEL[r.payment_state] ?? r.payment_state}</Tag></td>
                </tr>))}</tbody></table></div>)}
      </Panel>

      {newBill && <BillDrawer title="New purchase bill" onClose={() => setNewBill(false)}
        onDone={(msg) => { setNewBill(false); toast(msg, 'ok'); void load(); void refreshNow() }} />}

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail ? `Bill ${detail.number}` : ''} wide
        footer={detail && detail.type === 'in_invoice' ? <Btn variant="tertiary" disabled={!ws.online} onClick={() => { setReturning(detail); setDetail(null) }}>Return / exchange goods</Btn> : undefined}>
        {detail && <div className="stack" style={{ gap: 12 }}>
          <div className="t-caption">{detail.supplier} · {detail.date}{detail.supplier_invoice_no ? ` · Inv. ${detail.supplier_invoice_no}` : ''}{detail.tp_no ? ` · TP ${detail.tp_no}` : ''}</div>
          <table className="tbl"><thead><tr><th>Item</th><th className="td-right">Qty</th><th className="td-right">Rate</th><th className="td-right">Total</th></tr></thead>
            <tbody>{detail.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td className="td-right num">{num(l.qty)} {l.uom}</td><td className="td-right num">{money(l.rate)}</td><td className="td-right num">{money(l.total)}</td></tr>)}</tbody></table>
          <div className="pay-box"><div className="pay-net num"><span>Bill total</span><span>{money(detail.total)}</span></div>
            {detail.amount_due > 0 && <div className="pay-row num"><span>Still to pay</span><span>{money(detail.amount_due)}</span></div>}</div>
        </div>}
      </Drawer>

      {returning && <ReturnDrawer bill={returning} onClose={() => setReturning(null)}
        onDone={(msg) => { setReturning(null); toast(msg, 'ok'); void load(); void refreshNow() }} />}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ bill editor

let lineSeq = 0
const blankLine = (p: CounterProduct): Line => ({ key: ++lineSeq, productId: p.productId, qty: 1, uomId: p.poUomId || p.uomId, source: 'rate', rate: 0, amount: 0, discountPct: 0 })

function useBillForm() {
  const [lines, setLines] = useState<Line[]>([])
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [advanced, setAdvanced] = useState(false)
  const [tcsOverride, setTcsOverride] = useState<number | null>(null)
  const [taxInclusive, setTaxInclusive] = useState(false)
  const body = useMemo(() => ({
    advanced,
    lines: lines.map((l) => ({
      product_id: l.productId, qty: l.qty, uom_id: l.uomId,
      ...(l.source === 'rate' ? (l.rate > 0 ? { rate: l.rate } : {}) : (l.amount > 0 ? { amount: l.amount } : {})),
      ...(advanced && l.discountPct > 0 ? { discount_pct: l.discountPct } : {}),
    })),
    adjustments: advanced ? adjustments.filter((a) => a.amount > 0).map((a) => ({ type: a.type, description: a.description || undefined, amount: a.amount, capitalize: a.capitalize })) : [],
    ...(advanced && tcsOverride !== null ? { tcs: { amount: tcsOverride } } : {}),
    ...(advanced && taxInclusive ? { tax_inclusive_rates: true } : {}),
  }), [lines, adjustments, advanced, tcsOverride, taxInclusive])
  const priced = lines.every((l) => l.qty > 0 && (l.source === 'rate' ? l.rate > 0 : l.amount > 0))
  return { lines, setLines, adjustments, setAdjustments, advanced, setAdvanced, tcsOverride, setTcsOverride, taxInclusive, setTaxInclusive, body, ready: lines.length > 0 && priced }
}

function usePreview(supplierId: number | '', form: ReturnType<typeof useBillForm>) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!supplierId || !form.ready) { setPreview(null); setErr(''); return }
    let stale = false
    const t = window.setTimeout(async () => {
      try { const p = await call<Preview>('purchases', 'preview_bill', { payload: { supplier_id: supplierId, ...form.body } }); if (!stale) { setPreview(p); setErr('') } }
      catch (e) { if (!stale) { setPreview(null); setErr(e instanceof ApiError && e.network ? '' : e instanceof Error ? e.message : 'Could not price the bill.') } }
    }, 250)
    return () => { stale = true; window.clearTimeout(t) }
  }, [supplierId, form.ready, form.body])
  return { preview, err }
}

function LinesEditor({ form, preview }: { form: ReturnType<typeof useBillForm>; preview: Preview | null }) {
  const ws = useWorkspace()
  const [q, setQ] = useState('')
  const stock = useMemo(() => ws.counterProducts.filter((p) => p.active && !p.isKitchen), [ws.counterProducts])
  const hits = useMemo(() => (q.trim() ? searchProductsCached(stock, q, { limit: 6 }) : []), [stock, q])
  const add = (p: CounterProduct) => { form.setLines((l) => [...l, blankLine(p)]); setQ('') }
  const patch = (key: number, p: Partial<Line>) => form.setLines((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)))
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ position: 'relative' }}>
        <input className="field-control" placeholder="Search or scan an item to add…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Add item"
          onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); add(hits[0]) } }} />
        {hits.length > 0 && <div className="menu-pop" style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20 }}>
          {hits.map((p) => <button key={p.productId} type="button" className="menu-item" onClick={() => add(p)}><span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span><span className="t-caption">{p.unit}</span></button>)}</div>}
      </div>
      {form.lines.length > 0 && (
        <div className="tbl-scroll"><table className="tbl">
          <thead><tr><th>Item</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 120 }}>Unit</th><th style={{ width: 110 }}>Rate (₹)</th>{form.advanced && <th style={{ width: 80 }}>Disc %</th>}<th style={{ width: 120 }}>Total (₹)</th><th style={{ width: 36 }}></th></tr></thead>
          <tbody>{form.lines.map((l) => {
            const p = ws.productById.get(l.productId)
            const calc = preview?.lines.find((x) => x.product_id === l.productId)
            return (
              <tr key={l.key}>
                <td className="cell-main">{p?.name}</td>
                <td><NumInput className="field-control" value={l.qty} aria-label="Quantity" onChange={(n) => patch(l.key, { qty: n })} /></td>
                <td><select className="field-control" value={l.uomId} aria-label="Unit" onChange={(e) => patch(l.key, { uomId: Number(e.target.value) })}>{(p?.uoms ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></td>
                <td><NumInput className="field-control" aria-label="Rate" value={l.source === 'rate' ? l.rate : (calc?.rate ?? 0)} onChange={(n) => patch(l.key, { source: 'rate', rate: n })} /></td>
                {form.advanced && <td><NumInput className="field-control" aria-label="Discount percent" value={l.discountPct} onChange={(n) => patch(l.key, { discountPct: n })} /></td>}
                <td><NumInput className="field-control" aria-label="Line total" value={l.source === 'amount' ? l.amount : (calc?.amount ?? 0)} onChange={(n) => patch(l.key, { source: 'amount', amount: n })} /></td>
                <td><button className="icon-btn" aria-label="Remove item" onClick={() => form.setLines((x) => x.filter((y) => y.key !== l.key))}>×</button></td>
              </tr>)
          })}</tbody></table></div>)}
      <div className="t-caption">Type the rate <em>or</em> the line total: Odoo works out the other.</div>
    </div>
  )
}

function Totals({ preview, err, offline }: { preview: Preview | null; err: string; offline: boolean }) {
  if (err) return <div className="alert" role="alert">{err}</div>
  if (offline) return <div className="alert">Offline: Odoo will price and post this bill when it syncs.</div>
  if (!preview) return <div className="t-caption">Add items and choose a supplier to see Odoo&apos;s total.</div>
  return (
    <div className="pay-box">
      <div className="pay-row num"><span>Items</span><span>{money(preview.gross)}</span></div>
      {preview.discounts > 0 && <div className="pay-row num"><span>Discounts</span><span className="pos">− {money(preview.discounts)}</span></div>}
      {preview.charges > 0 && <div className="pay-row num"><span>Charges</span><span>{money(preview.charges)}</span></div>}
      {preview.tax > 0 && <div className="pay-row num"><span>Tax</span><span>{money(preview.tax)}</span></div>}
      {preview.tcs_rate > 0 && <div className="pay-row num"><span>TCS ({preview.tcs_rate}%)</span><span>{money(preview.tcs_calculated)}</span></div>}
      <div className="pay-net num"><span>Bill total</span><span>{money(preview.total)}</span></div>
    </div>
  )
}

function BillDrawer({ title, onClose, onDone }: { title: string; onClose: () => void; onDone: (msg: string) => void }) {
  const ws = useWorkspace()
  const toast = useToast()
  const form = useBillForm()
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [billDate, setBillDate] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [tpNo, setTpNo] = useState('')
  const [tpDate, setTpDate] = useState('')
  const [stated, setStated] = useState(0)
  const [payNow, setPayNow] = useState(0)
  const [payMethod, setPayMethod] = useState<'cash' | 'upi'>('cash')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ref] = useState(newRef)
  const { preview, err: previewErr } = usePreview(supplierId, form)

  const save = async () => {
    setErr('')
    if (!supplierId) return setErr('Choose a supplier.')
    if (!form.ready) return setErr('Every item needs a quantity and a rate or total.')
    setBusy(true)
    try {
      const res = await submitMutation('purchase', {
        client_ref: ref, supplier_id: supplierId, ...form.body,
        bill_date: billDate || undefined, supplier_invoice_no: invoiceNo || undefined,
        ...(form.advanced ? { due_date: dueDate || undefined, tp_no: tpNo || undefined, tp_date: tpDate || undefined, stated_total: stated || undefined } : {}),
        payments: payNow > 0 ? [{ method: payMethod, amount: payNow }] : [],
      })
      onDone(res.queued ? 'Saved on this device: it will be recorded when the connection returns.' : `Recorded ${res.result?.bill_name ?? 'bill'} · stock is in the Godown`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record the bill.')
      toast('The bill was not recorded.', 'err')
    } finally { setBusy(false) }
  }

  return (
    <Drawer open onClose={onClose} title={title} xwide
      footer={<div className="row" style={{ gap: 8 }}><Btn variant="tertiary" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Recording…' : 'Confirm & receive stock'}</Btn></div>}>
      <div className="stack" style={{ gap: 14 }}>
        {err && <div className="alert" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="pay-seg" role="group" aria-label="Bill type">
            <button type="button" className={`pay-seg-btn ${!form.advanced ? 'on' : ''}`} onClick={() => form.setAdvanced(false)}>Simple bill</button>
            <button type="button" className={`pay-seg-btn ${form.advanced ? 'on' : ''}`} onClick={() => form.setAdvanced(true)}>Advanced bill</button>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Supplier"><select className="field-control" value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Choose a supplier…</option>{ws.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Bill date"><input className="field-control" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></Field>
          {form.advanced && <>
            <Field label="Supplier invoice no."><input className="field-control" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
            <Field label="Payment due date"><input className="field-control" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
            <Field label="Transport permit (TP) no."><input className="field-control" value={tpNo} onChange={(e) => setTpNo(e.target.value)} /></Field>
            <Field label="TP date"><input className="field-control" type="date" value={tpDate} onChange={(e) => setTpDate(e.target.value)} /></Field></>}
        </div>
        {ws.suppliers.length === 0 && <div className="alert">No suppliers yet. Add one under Accounts first.</div>}
        <LinesEditor form={form} preview={preview} />

        {form.advanced && (<div className="stack" style={{ gap: 8 }}>
          <div className="micro-label">Discounts and extra charges</div>
          {form.adjustments.map((a, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <select className="field-control" style={{ width: 130 }} value={a.type} aria-label="Adjustment type" onChange={(e) => form.setAdjustments((x) => x.map((y, k) => k === i ? { ...y, type: e.target.value as Adjustment['type'] } : y))}><option value="discount">Trade discount</option><option value="expense">Freight / charge</option></select>
              <input className="field-control" placeholder="Description" value={a.description} onChange={(e) => form.setAdjustments((x) => x.map((y, k) => k === i ? { ...y, description: e.target.value } : y))} />
              <NumInput className="field-control" style={{ width: 110 }} value={a.amount} aria-label="Amount" onChange={(n) => form.setAdjustments((x) => x.map((y, k) => k === i ? { ...y, amount: n } : y))} />
              <label className="row" style={{ gap: 4, whiteSpace: 'nowrap' }}><input type="checkbox" checked={a.capitalize} onChange={(e) => form.setAdjustments((x) => x.map((y, k) => k === i ? { ...y, capitalize: e.target.checked } : y))} /> Add to stock cost</label>
              <Btn sm onClick={() => form.setAdjustments((x) => x.filter((_, k) => k !== i))} aria-label="Remove">×</Btn>
            </div>))}
          <Btn sm onClick={() => form.setAdjustments((x) => [...x, { type: 'expense', description: '', amount: 0, capitalize: true }])}>+ Add discount or charge</Btn>
          <div className="form-grid">
            <Field label="TCS as printed on the bill (₹)" help="Leave empty to use Odoo's calculated TCS."><NumInput className="field-control" value={form.tcsOverride ?? 0} onChange={(n) => form.setTcsOverride(n > 0 ? n : null)} /></Field>
            <Field label="Printed bill total (₹)" help="Odoo books any difference of up to ₹5 as round-off."><NumInput className="field-control" value={stated} onChange={setStated} /></Field>
          </div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={form.taxInclusive} onChange={(e) => form.setTaxInclusive(e.target.checked)} /> Rates I type already include tax</label>
        </div>)}

        <Totals preview={preview} err={previewErr} offline={!ws.online} />
        <div className="form-grid">
          <Field label="Paid now (₹)" help="Leave empty to keep the whole amount payable to the supplier."><NumInput className="field-control" value={payNow} onChange={setPayNow} /></Field>
          <Field label="Paid by"><select className="field-control" value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'cash' | 'upi')}><option value="cash">Cash</option><option value="upi">UPI / bank</option></select></Field>
        </div>
      </div>
    </Drawer>
  )
}

// ------------------------------------------------------------------------------------------------ return / exchange

function ReturnDrawer({ bill, onClose, onDone }: { bill: BillDetail; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast()
  const form = useBillForm()
  const [qty, setQty] = useState<Record<number, number>>({})
  const [reason, setReason] = useState('')
  const [exchange, setExchange] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ref] = useState(newRef)
  const { preview, err: previewErr } = usePreview(exchange ? bill.supplier_id : '', form)
  const chosen = bill.lines.filter((l) => (qty[l.product_id] ?? 0) > 0)

  const submit = async () => {
    setErr('')
    if (!chosen.length) return setErr('Choose what is being returned.')
    if (exchange && !form.ready) return setErr('Every replacement item needs a quantity and a rate or total.')
    setBusy(true)
    try {
      const res = await call<any>('purchases', 'return_to_supplier', { payload: {
        bill_id: bill.id, reason: reason || undefined,
        lines: chosen.map((l) => ({ product_id: l.product_id, qty: qty[l.product_id] })),
        ...(exchange ? { exchange: { client_ref: ref, supplier_id: bill.supplier_id, ...form.body } } : {}),
      } })
      onDone(exchange ? 'Return recorded and the replacement bill posted.' : `Return recorded${res?.credit_note_name ? ` · credit note ${res.credit_note_name}` : ''}`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not record the return.'); toast('Nothing was changed.', 'err') } finally { setBusy(false) }
  }

  return (
    <Drawer open onClose={onClose} title={`Return goods from ${bill.number}`} xwide
      footer={<div className="row" style={{ gap: 8 }}><Btn variant="tertiary" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Working…' : exchange ? 'Return and bill replacement' : 'Return to supplier'}</Btn></div>}>
      <div className="stack" style={{ gap: 14 }}>
        {err && <div className="alert" role="alert">{err}</div>}
        <table className="tbl"><thead><tr><th>Item</th><th className="td-right">Bought</th><th style={{ width: 120 }}>Return qty</th></tr></thead>
          <tbody>{bill.lines.map((l) => <tr key={l.product_id}><td>{l.name}</td><td className="td-right num">{num(l.qty)} {l.uom}</td>
            <td><NumInput className="field-control" aria-label={`Return quantity of ${l.name}`} value={qty[l.product_id] ?? 0} onChange={(n) => setQty((q) => ({ ...q, [l.product_id]: n }))} /></td></tr>)}</tbody></table>
        <Field label="Reason"><input className="field-control" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged, wrong item…" /></Field>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={exchange} onChange={(e) => setExchange(e.target.checked)} /> Exchange items instead (supplier delivers replacements)</label>
        {exchange && <><div className="micro-label">Replacement goods (billed at their own rates and taxes)</div><LinesEditor form={form} preview={preview} /><Totals preview={preview} err={previewErr} offline={false} /></>}
      </div>
    </Drawer>
  )
}
