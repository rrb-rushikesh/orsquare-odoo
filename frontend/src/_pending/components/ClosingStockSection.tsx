import { useEffect, useMemo, useRef, useState } from 'react'
import { Btn, Panel, useToast } from './ui'
import { IconCheck } from './icons'
import * as repo from '@/lib/repo'
import type { ClosingRow, ClosingState, ClosingSuggestion } from '@/lib/repo'
import '@/styles/sheet-register.css'

/**
 * The closing ritual.
 *
 * One workflow, two depths. `simple` (the default) shows the expected quantity
 * and counts only what is worth counting; `rigorous` hides the expected quantity
 * until the operator has committed to a number, because seeing the answer
 * invites confirming it rather than counting. Nothing else changes — same rows,
 * same settlements, same audit trail.
 *
 * Every difference is settled by a real business document, never by editing a
 * count. The suggestions say which document fits and how sure the arithmetic is;
 * the operator disposes.
 */

/** A variance cause, and the document that must exist afterwards. Mirrors
 *  ClosingCount.variance_cause and apps.inventory.services.ADJUSTMENT_CAUSES. */
const CAUSES: { value: string; label: string }[] = [
  { value: 'unrecorded_sale', label: 'Sold but not billed' },
  { value: 'unrecorded_return', label: 'Returned but not recorded' },
  { value: 'unrecorded_transfer', label: 'Moved but not transferred' },
  { value: 'wastage_breakage', label: 'Breakage or wastage' },
  { value: 'opening_error', label: 'Opening balance was wrong' },
  { value: 'miscount_system', label: 'System count was wrong' },
  { value: 'theft_suspected', label: 'Suspected loss' },
]
/** Only these can dispose of a shortage by writing stock off. The rest need a
 *  document the reconciler has not got a path for yet, so they are not offered
 *  as a correction — a reason the system records but cannot act on is how a
 *  variance becomes a dead end. */
const WRITEOFF_CAUSES = new Set(['wastage_breakage', 'miscount_system', 'opening_error', 'theft_suspected'])

const DRAWER_EXPENSE_HEADS = [
  'Owner withdrawal', 'Employee advance', 'Cash drop / pay-in', 'Cash pickup / deposit', 'Unrecorded expense',
]
const DRAWER_INCOME_HEADS = [
  'Cash found', 'Float carried over', 'Change returned to customer', 'Unrecorded receipt',
]

/** Carbon confidence tags. Green means the arithmetic is complete, yellow means
 *  it fits but is not exclusive, and neutral means the engine is out of evidence
 *  and is saying so. Never colour alone — the word is always present. */
const CONFIDENCE_LABEL: Record<string, string> = {
  proven: 'Explains it', likely: 'Likely', check_next: 'Check first',
}

const STATE_LABEL: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'Count in progress',
  blocked: 'Differences open',
  counted_and_balanced: 'Counted and balanced',
  counted_with_variances: 'Counted, differences recorded',
  auto_sealed_unverified: 'Sealed without a count',
}

type Dialog = 'expense' | 'income' | 'correction' | 'abandon' | null

/**
 * Parse a variance the operator typed.
 *
 * The field is deliberately a delta against the book's closing quantity, not an
 * absolute count: someone holding a bottle and looking at "system close 20"
 * can say "-2" without doing arithmetic, and a mis-tapped absolute count is
 * invisible where a mis-tapped delta is obvious.
 *
 * Only a leading minus and digits are accepted, so the field cannot receive a
 * decimal point, an exponent, or a stray letter from a tablet keyboard. A
 * trailing minus ("5-") is dropped rather than reinterpreted, and a bare "-"
 * is treated as not yet entered.
 */
export function parseVariance(raw: string): number | null {
  const cleaned = raw.trim().replace(/^(-?)(\d*).*$/, '$1$2')
  if (cleaned === '' || cleaned === '-') return null
  const value = Number(cleaned)
  if (!Number.isInteger(value)) return null
  return value
}

export function ClosingStockSection({ shopId, dateKey, isOpen, onCashSaved, onChanged, onReady }: {
  shopId: string; dateKey: string; isOpen: boolean; onCashSaved: (value: number) => void; onChanged: () => Promise<void>; onReady: (ready: boolean) => void
}) {
  const toast = useToast()
  const [state, setState] = useState<ClosingState | null>(null)
  const [viewDate, setViewDate] = useState(dateKey)
  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [varianceDraft, setVarianceDraft] = useState<Record<string, string>>({})
  const [draftCause, setDraftCause] = useState<Record<string, string>>({})
  const [draftNote, setDraftNote] = useState<Record<string, string>>({})
  const [cash, setCash] = useState('')
  const [busy, setBusy] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [target, setTarget] = useState<ClosingRow | null>(null)
  const [amount, setAmount] = useState('')
  const [head, setHead] = useState('')
  const [note, setNote] = useState('')
  const [cause, setCause] = useState('')
  const idemKey = useRef<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  async function refresh() {
    try {
      const next = await repo.closingState(shopId, viewDate)
      setState(next)
      if (viewDate === dateKey) onReady(next.ready)
      setCash(next.counted_cash ?? '')
      if (viewDate === dateKey && next.counted_cash !== null) onCashSaved(Number(next.counted_cash))
      setLoadError(false)
    } catch { setLoadError(true); if (viewDate === dateKey) onReady(false) }
  }
  useEffect(() => { setViewDate(dateKey) }, [dateKey])
  useEffect(() => { void refresh() }, [shopId, viewDate])
  const editable = isOpen && viewDate === dateKey
  const blind = state?.scope.blind ?? false
  const brands = useMemo(() => [...new Set((state?.rows || []).map(r => r.brand))]
    .filter(name => name.toLowerCase().includes(search.toLowerCase())).sort(), [state, search])
  const selected = brands.includes(brand) ? brand : brands[0]
  const rows = (state?.rows || []).filter(r => r.brand === selected)
  const cashVariance = state?.expected_cash != null && cash !== '' && Number.isFinite(Number(cash))
    ? Math.round((Number(cash) - Number(state.expected_cash)) * 100) : state?.cash_variance_paise
  const unresolved = state?.stock_unresolved ?? 0

  async function act(key: string, task: () => Promise<void>, message: string): Promise<boolean> {
    setBusy(key)
    try { await task(); toast(message); await Promise.all([refresh(), onChanged()]); return true }
    catch (err) { toast(err instanceof Error ? err.message : 'Could not save.', 'err'); return false }
    finally { setBusy('') }
  }

  const saveCount = (row: ClosingRow, value: number | null, extra: { reason?: string; cause?: string; note?: string } = {}) =>
    act(row.product_id, () => repo.saveClosingCount(
      shopId, dateKey, row.product_id, value, extra.reason ?? '', extra.cause ?? '', extra.note ?? ''), 'Count saved.')

  const currentActual = (row: ClosingRow) => draft[row.product_id] !== undefined ? Number(draft[row.product_id]) : row.actual_qty

  /**
   * The +/- steppers.
   *
   * A step of +1 is a claim about the physical shelf, so it may only be applied
   * when the operator can see the book's number to step away from. In a rigorous
   * (blind) close `system_qty` is null precisely so the answer cannot be read
   * off the screen — and stepping from a null baseline silently posted a count
   * of 1, which is not a count, it is a fabricated observation that then had to
   * be explained. The steppers are disabled in that case; the variance field is
   * too, because a delta against an unknown baseline is meaningless.
   */
  const canStep = (row: ClosingRow) => row.system_qty != null || row.actual_qty != null
  const step = (row: ClosingRow, delta: number) => {
    if (!canStep(row)) return
    const base = currentActual(row) ?? row.system_qty ?? 0
    void saveCount(row, Math.max(0, base + delta))
  }

  /** What the variance field currently holds, defaulting to the saved variance. */
  const varianceOf = (row: ClosingRow): string => {
    if (varianceDraft[row.product_id] !== undefined) return varianceDraft[row.product_id]
    if (row.actual_qty != null && row.system_qty != null) return String(row.actual_qty - row.system_qty)
    return ''
  }

  /**
   * Commit a typed variance.
   *
   * The count is stored, never the variance: `actual = system + delta`. The
   * variance is a convenience of the entry, and persisting it would create a
   * second source of truth for the same fact. Any cause already chosen for this
   * row travels with it, so the audit trail records why the count differs and
   * not merely that it did.
   */
  const commitVariance = (row: ClosingRow) => {
    const delta = parseVariance(varianceDraft[row.product_id] ?? '')
    if (delta === null || row.system_qty == null) return
    const actual = row.system_qty + delta
    if (actual < 0) { toast('A count cannot be negative.', 'err'); return }
    const causeValue = draftCause[row.product_id] ?? row.variance_cause ?? ''
    const noteValue = (draftNote[row.product_id] ?? row.variance_note ?? '').trim()
    void saveCount(row, actual, { cause: causeValue, note: noteValue }).then(() => {
      setVarianceDraft(d => { const n = { ...d }; delete n[row.product_id]; return n })
    })
  }

  function openDialog(which: Dialog, row?: ClosingRow) {
    idemKey.current = crypto.randomUUID()
    setTarget(row ?? null); setDialog(which)
    setAmount(''); setNote(''); setCause('')
    // Prefill from the residual the reconciler left unexplained, so the operator
    // confirms a number the system already worked out rather than retyping it.
    // The sign matters: the expense dialog is always an outflow and the income
    // dialog always an inflow, so a dialog is only ever prefilled with the
    // absolute residual and is only ever opened in the direction that residual
    // implies. Opening 'income' for a short drawer would post a voucher that
    // moves the variance the wrong way.
    if (which === 'expense' || which === 'income') {
      setHead(which === 'expense' ? DRAWER_EXPENSE_HEADS[4] : DRAWER_INCOME_HEADS[0])
      const residual = state?.cash_variance_paise
      if (residual) setAmount((Math.abs(residual) / 100).toFixed(2))
    }
  }

  const submitExpense = () => {
    const value = Number(amount)
    if (!(value > 0) || !head || !note.trim()) return
    void act('expense', async () => { await repo.recordClosingExpense(shopId, dateKey, value, head, note.trim(), idemKey.current!); },
      'Cash movement out of the drawer recorded.')
      .then(ok => { if (ok) setDialog(null) })
  }
  const submitIncome = () => {
    const value = Number(amount)
    if (!(value > 0) || !head) return
    void act('income', async () => { await repo.recordClosingIncome(shopId, dateKey, value, head, note.trim(), idemKey.current!); },
      'Cash found in the drawer recorded.')
      .then(ok => { if (ok) setDialog(null) })
  }
  const submitCorrection = () => {
    if (!target || !cause) return
    const qty = Math.abs(target.variance ?? 0)
    if (!qty) return
    void act('correction', async () => { await repo.recordClosingCorrection(shopId, dateKey, target.product_id, cause, qty, note.trim()); },
      'Stock correction written.')
      .then(ok => { if (ok) setDialog(null) })
  }
  const submitAbandon = () => {
    if (!note.trim()) return
    void act('abandon', async () => { await repo.abandonClosingReview(shopId, dateKey, note.trim()); },
      'Count discarded.')
      .then(ok => { if (ok) setDialog(null) })
  }

  /** The settlement each suggestion offers, if any. Everything else is advice:
   *  a recount, or something to go and look at.
   *
   *  Direction matters here. `cash` is only ever emitted for a surplus, so
   *  "Record cash found" is the correct posting for it. `recount_cash` is
   *  emitted for BOTH directions and is a check-first step, not a settlement —
   *  it used to open the same Income dialog, which meant that on a short
   *  drawer the top-ranked suggestion offered to post an income voucher for
   *  the shortage and push the variance further the wrong way. A recount is
   *  performed by re-entering the counted cash above, so it needs no button. */
  function actionsFor(s: ClosingSuggestion) {
    if (!editable) return null
    if (s.kind === 'expense') return <Btn sm variant="ghost" onClick={() => openDialog('expense')}>Record payout</Btn>
    if (s.kind === 'cash' && s.direction !== 'short')
      return <Btn sm variant="ghost" onClick={() => openDialog('income')}>Record cash found</Btn>
    if (s.kind === 'recount_cash')
      return <Btn sm variant="ghost" onClick={() => document.getElementById('closing-cash')?.focus()}>Recount the drawer</Btn>
    if (s.kind === 'sale' && s.product_id && s.qty) return <Btn sm variant="ghost" disabled={!!busy} onClick={() => {
      if (window.confirm(`Record ${s.qty} item(s) as a cash sale at the rate it actually sold for? This posts a real invoice.`))
        void act('sale', async () => { await repo.recordClosingSale(shopId, dateKey, s.product_id!, s.qty!, crypto.randomUUID()) }, 'Sale recorded.')
    }}>Record sale</Btn>
    if (s.kind === 'stock' && s.product_id) {
      const row = (state?.rows || []).find(r => r.product_id === s.product_id)
      if (row && row.variance) return <Btn sm variant="ghost" onClick={() => { setTarget(row); openDialog('correction', row) }}>Write off / correct</Btn>
    }
    return null
  }

  return <Panel title="Closing Stock" actions={
    <span className="t-caption">{state ? `${state.counted} / ${state.total} counted` : 'Loading'}</span>}>
    {loadError && <p role="alert">Could not load closing counts. <Btn sm variant="ghost" onClick={() => void refresh()}>Retry</Btn></p>}
    {state && <>
      <div className="closing-state" data-state={state.closing_state}>
        <span className="closing-state-tag">{STATE_LABEL[state.closing_state] ?? state.closing_state}</span>
        {state.closing_state === 'auto_sealed_unverified' && state.closed
          && <span className="t-caption">Nobody counted this day. The sealer closed it at the expected cash.</span>}
        {state.shrink_pct != null && <span className="t-caption">
          Shrink {state.shrink_pct.toFixed(2)}% of today&rsquo;s sales{state.tolerance_paise > 0
            ? ` · limit ₹${(state.tolerance_paise / 100).toFixed(2)}` : ' · no limit set'}
        </span>}
      </div>
      {state.reconciliation_status === 'Blocked' && <p role="alert">Stock reconciliation is blocked. Resolve the Sheet error before closing.</p>}
      {state.scope.depth === 'rigorous' && <p className="t-caption">Rigorous close: the expected quantity is hidden until you enter a count.</p>}
      {state.scope.depth === 'simple' && state.scope.total_active > state.scope.in_scope && <p className="t-caption">
        Counting {state.scope.in_scope} of {state.scope.total_active} products &mdash;{' '}
        {Object.entries(state.scope.rules).map(([rule, n]) => `${n} ${rule.replace('_', ' ')}`).join(', ')}.
        The rest did not move and are not worth the walk.
      </p>}
      <label className="t-caption">Review day <input className="field-control" type="date" value={viewDate} max={dateKey} onChange={e => setViewDate(e.target.value)} /></label>
      <div className="closing-layout">
        <div className="closing-brands">
          <input className="field-control" aria-label="Search brands" placeholder="Search brands" value={search} onChange={e => setSearch(e.target.value)} />
          {brands.map(name => <button type="button" key={name} className={name === selected ? 'active' : ''} onClick={() => setBrand(name)}>{name}</button>)}
        </div>
        <div className="closing-variants">
          <strong>{selected || 'No products'}</strong>
          {rows.map(row => {
            const actual = currentActual(row)
            const entered = actual != null && Number.isFinite(actual)
            const shownVariance = row.actual_qty != null
              ? row.actual_qty - (row.system_qty ?? 0) : null
            // A delta is only meaningful against a known book figure. In a
            // blind close there is none, and offering the field anyway invites
            // the operator to invent a baseline.
            const varianceUsable = row.system_qty != null
            const typed = varianceOf(row)
            const parsed = parseVariance(typed)
            const varianceDirty = parsed !== null && row.system_qty != null
              && parsed !== (row.actual_qty != null ? row.actual_qty - row.system_qty : null)
            return <div className={`closing-variant${shownVariance ? ' has-variance' : ''}`} key={row.product_id}>
              <div className="closing-variant-label"><strong>{row.name}</strong> {row.size_ml ? `${row.size_ml}ml` : ''}<br />
                {blind && row.system_qty == null
                  ? <span className="t-caption">Not yet counted</span>
                  : <>System close {row.system_qty} ·{' '}
                    {row.skip_reason ? `Skipped: ${row.skip_reason}`
                      : shownVariance == null ? 'Not counted'
                        : shownVariance === 0 ? 'Matches'
                          : <span className="closing-delta">{shownVariance > 0 ? `+${shownVariance} extra` : `${shownVariance} short`}</span>}
                  </>}
                {row.settled && <><br /><span className="closing-cause">
                  Settled{row.settled_by ? ` by ${row.settled_by}` : ''}
                </span></>}
                {row.variance_cause && <><br /><span className="closing-cause">
                  {CAUSES.find(c => c.value === row.variance_cause)?.label ?? row.variance_cause}
                  {row.variance_note ? `: ${row.variance_note}` : ''}
                </span></>}
              </div>
              {editable && <>
              {varianceUsable && <div className="closing-variance">
                <label htmlFor={`var-${row.product_id}`}>Variance</label>
                <input id={`var-${row.product_id}`} className="field-control closing-variance-input"
                  type="text" inputMode="numeric" autoComplete="off" enterKeyHint="done"
                  pattern="-?[0-9]*" placeholder="0"
                  aria-label={`Variance for ${row.name}: negative when the shelf holds less than the system`}
                  value={typed}
                  onChange={e => {
                    const next = e.target.value.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, '').replace(/-(?=.)/g, '')
                    setVarianceDraft(d => ({ ...d, [row.product_id]: next }))
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitVariance(row) } }} />
                <Btn sm aria-label={`Save variance for ${row.name}`} disabled={!!busy || !varianceDirty}
                  onClick={() => commitVariance(row)}><IconCheck size={16} /></Btn>
              </div>}
              {!varianceUsable && <span className="t-caption closing-variance-hint">
                Blind count: enter the count itself
              </span>}
              <div className="closing-actions">
                <Btn sm variant="ghost" disabled={!!busy || !canStep(row)} onClick={() => step(row, 1)}>+1</Btn>
                <Btn sm variant="ghost" disabled={!!busy || !canStep(row)} onClick={() => step(row, -1)}>&minus;1</Btn>
                <Btn sm variant="ghost" disabled={!!busy || !canStep(row)} onClick={() => step(row, -3)}>&minus;3</Btn>
                <input className="field-control" type="number" min="0" step="1" aria-label={`Actual count for ${row.name}`}
                  value={draft[row.product_id] ?? row.actual_qty ?? ''} onChange={e => setDraft(d => ({ ...d, [row.product_id]: e.target.value }))} />
                <Btn sm variant="ghost" disabled={!!busy || draft[row.product_id] === undefined || !Number.isInteger(Number(draft[row.product_id])) || Number(draft[row.product_id]) < 0}
                  onClick={() => { void saveCount(row, Number(draft[row.product_id])); setDraft(d => { const n = { ...d }; delete n[row.product_id]; return n }) }}>Save</Btn>
                {row.system_qty != null && <Btn sm variant="ghost" disabled={!!busy} onClick={() => void saveCount(row, row.system_qty!)}>Matches</Btn>}
                <Btn sm variant="ghost" disabled={!!busy} onClick={() => { const reason = window.prompt(`Reason to skip ${row.name}?`); if (reason?.trim()) void saveCount(row, null, { reason: reason.trim() }) }}>Skip</Btn>
                {entered && actual !== row.system_qty && !row.variance_cause && (
                  <div className="closing-why">
                    <select className="field-control" aria-label={`Why is ${row.name} different`}
                      value={draftCause[row.product_id] ?? ''}
                      onChange={e => setDraftCause(d => ({ ...d, [row.product_id]: e.target.value }))}>
                      <option value="">Why is this different?</option>
                      {CAUSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <input className="field-control" placeholder="Note (optional)"
                      aria-label={`Note about ${row.name}`}
                      value={draftNote[row.product_id] ?? ''}
                      onChange={e => setDraftNote(d => ({ ...d, [row.product_id]: e.target.value }))} />
                    <Btn sm variant="primary" disabled={!!busy || !(draftCause[row.product_id] ?? '')}
                      onClick={() => {
                        void saveCount(row, actual, {
                          cause: draftCause[row.product_id]!, note: (draftNote[row.product_id] ?? '').trim(),
                        })
                        setDraftCause(d => { const n = { ...d }; delete n[row.product_id]; return n })
                        setDraftNote(d => { const n = { ...d }; delete n[row.product_id]; return n })
                      }}>Save reason</Btn>
                  </div>
                )}
                {entered && actual !== row.system_qty && row.variance_cause
                  && WRITEOFF_CAUSES.has(row.variance_cause) && (
                  <Btn sm variant="ghost" disabled={!!busy} onClick={() => { setTarget(row); openDialog('correction', row) }}>Settle</Btn>)}
              </div>
              </>}
            </div>
          })}
        </div>
      </div>
      <div className="closing-cash">
        <strong>Drawer cash</strong>
        {state.expected_cash !== null && <span>Expected ₹{Number(state.expected_cash).toFixed(2)}</span>}
        <label>Counted <input id="closing-cash" className="field-control" type="number" min="0" step="0.01" value={cash} onChange={e => setCash(e.target.value)} disabled={!editable} /></label>
        {editable && <Btn sm variant="ghost" disabled={!!busy || cash === '' || Number(cash) < 0} onClick={() => void act('cash', async () => { await repo.saveClosingCash(shopId, dateKey, Number(cash)); onCashSaved(Number(cash)) }, 'Cash count saved.')}>Save cash</Btn>}
        {cashVariance != null && state.expected_cash !== null && <span className={cashVariance === 0 ? '' : cashVariance < 0 ? 'fin-rec' : 'fin-pay'}>
          Difference {cashVariance >= 0 ? '+' : '−'}₹{(Math.abs(cashVariance) / 100).toFixed(2)}
          {state.within_tolerance && cashVariance !== 0 ? ' (within this shop’s limit)' : ''}
        </span>}
      </div>
      {state.suggestions.length > 0 && <div className="closing-suggestions">
        <strong>Check these differences</strong>
        {state.suggestions.map((s, index) => <div key={`${s.kind}:${s.product_id}:${index}`} className="closing-suggestion">
          <div>
            {s.confidence && <span className={`closing-confidence closing-confidence--${s.confidence}`}>
              {CONFIDENCE_LABEL[s.confidence] ?? s.confidence}</span>}
            {s.text}<small>{s.evidence}</small>
          </div>
          {actionsFor(s)}
        </div>)}
      </div>}

      {dialog === 'expense' && <div className="closing-expense">
        <strong>Cash left the drawer</strong>
        <input className="field-control" type="number" min="0.01" step="0.01" placeholder="Amount" aria-label="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
        <select className="field-control" aria-label="What it was for" value={head} onChange={e => setHead(e.target.value)}>
          {DRAWER_EXPENSE_HEADS.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <input className="field-control" placeholder="Note" aria-label="Note" value={note} onChange={e => setNote(e.target.value)} />
        <Btn sm variant="primary" disabled={!!busy || !(Number(amount) > 0) || !head || !note.trim()} onClick={submitExpense}>Record</Btn>
        <Btn sm variant="ghost" onClick={() => setDialog(null)}>Cancel</Btn>
      </div>}

      {dialog === 'income' && <div className="closing-expense">
        <strong>Cash found in the drawer</strong>
        <input className="field-control" type="number" min="0.01" step="0.01" placeholder="Amount" aria-label="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
        <select className="field-control" aria-label="What it was" value={head} onChange={e => setHead(e.target.value)}>
          {DRAWER_INCOME_HEADS.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <input className="field-control" placeholder="Note (optional)" aria-label="Note" value={note} onChange={e => setNote(e.target.value)} />
        <Btn sm variant="primary" disabled={!!busy || !(Number(amount) > 0) || !head} onClick={submitIncome}>Record</Btn>
        <Btn sm variant="ghost" onClick={() => setDialog(null)}>Cancel</Btn>
      </div>}

      {dialog === 'correction' && target && <div className="closing-expense">
        <strong>{target.name}: {Math.abs(target.variance ?? 0)} {(target.variance ?? 0) < 0 ? 'short' : 'extra'}</strong>
        <select className="field-control" aria-label="Correction reason" value={cause} onChange={e => setCause(e.target.value)}>
          <option value="">Choose a reason</option>
          {CAUSES.filter(c => WRITEOFF_CAUSES.has(c.value)).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input className="field-control" placeholder="Note" aria-label="Note" value={note} onChange={e => setNote(e.target.value)} />
        <Btn sm variant="primary" disabled={!!busy || !cause} onClick={submitCorrection}>Write correction</Btn>
        <Btn sm variant="ghost" onClick={() => setDialog(null)}>Cancel</Btn>
      </div>}

      {dialog === 'abandon' && <div className="closing-expense">
        <strong>Discard this count</strong>
        <input className="field-control" placeholder="Why?" aria-label="Why the count is being discarded" value={note} onChange={e => setNote(e.target.value)} />
        <Btn sm variant="primary" disabled={!!busy || !note.trim()} onClick={submitAbandon}>Discard</Btn>
        <Btn sm variant="ghost" onClick={() => setDialog(null)}>Cancel</Btn>
      </div>}

      <p className="t-caption">
        {state.counted}/{state.total} counted or skipped &middot; cash {state.cash_counted ? 'saved' : 'not saved'} &middot; {unresolved} stock differences.
        {editable && state.review_started && <> <Btn sm variant="ghost" onClick={() => openDialog('abandon')}>Discard count</Btn></>}
      </p>
      {state.audit.length > 0 && <details><summary>Count history</summary><div className="closing-history">
        {state.audit.map((event, index) => <div key={`${event.at}:${index}`}>{event.at.slice(0, 16).replace('T', ' ')} &middot; {event.by || 'Operator'} &middot; {event.action} {event.before ? `${event.before} → ` : ''}{event.after}{event.reason ? ` · ${event.reason}` : ''}</div>)}
      </div></details>}
    </>}
  </Panel>
}
