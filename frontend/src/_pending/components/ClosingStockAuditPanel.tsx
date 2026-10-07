import { useCallback, useEffect, useState } from 'react'
import { Btn, Panel, useToast } from './ui'
import * as repo from '@/lib/repo'
import type { ClosingAudit, ClosingAuditAction, ClosingAuditFact } from '@/lib/repo'
import '@/styles/sheet-register.css'

/**
 * The Closing Stock Audit.
 *
 * The real closing workflow finishes *after* the day is sealed: the cashier
 * closes on the drawer count, then walks the shop against the printed closing
 * stock, and only then knows whether the day reconciles. This panel is that last
 * step.
 *
 * It posts nothing. It separates two things that are constantly confused:
 *
 *   - **Facts** — what the records demonstrate. The day is sealed, the drawer was
 *     counted, it holds Rs N less than expected, these three SKUs are short, this
 *     is what they are worth. Each one shows its working.
 *   - **Findings** — what that probably means, with a confidence, the products
 *     involved, the money at stake, and an action the operator must confirm.
 *
 * Every action here routes to the same settlement endpoints the closing section
 * uses, so a confirmed action writes the same real business document with the
 * same audit trail. Nothing on this screen can quietly change the books.
 */

const CONFIDENCE_LABEL: Record<string, string> = {
  proven: 'Explains it',
  likely: 'Likely',
  check_next: 'Check first',
}

const rupees = (paise: number | null | undefined): string => {
  if (paise === null || paise === undefined) return '-'
  const value = Math.abs(paise) / 100
  return `Rs ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function FactRow({ fact }: { fact: ClosingAuditFact }) {
  return <div className={`audit-fact${fact.ok ? '' : ' audit-fact--open'}`}>
    <div className="audit-fact-head">
      <span className="audit-fact-label">{fact.label}</span>
      {fact.value_paise !== undefined && fact.value_paise !== null
        ? <span className={fact.value_paise === 0 ? '' : fact.value_paise < 0 ? 'fin-rec' : 'fin-pay'}>
            {fact.value_paise >= 0 ? '+' : '-'}{rupees(fact.value_paise)}
          </span>
        : <span>{fact.value}</span>}
    </div>
    <p className="t-caption">{fact.detail}</p>
    {!!fact.products?.length && <table className="audit-products">
      <thead><tr><th>Product</th><th>Diff</th><th>Rate</th><th>Worth</th></tr></thead>
      <tbody>
        {fact.products.map(p => <tr key={p.product_id}>
          <td>{p.name}{p.size_ml ? ` · ${p.size_ml}ml` : ''}
            {p.settled && <span className="audit-settled"> settled</span>}</td>
          <td className="num">{p.variance > 0 ? `+${p.variance}` : p.variance}</td>
          <td className="num">{rupees(p.rate_paise)}<br /><span className="t-caption">{p.rate_source}</span></td>
          <td className="num">{rupees(Math.abs(p.value_paise))}</td>
        </tr>)}
      </tbody>
    </table>}
    {!!fact.hidden_products && <p className="t-caption">and {fact.hidden_products} more.</p>}
  </div>
}

export function ClosingStockAuditPanel({ shopId, dateKey, onChanged }: {
  shopId: string; dateKey: string; onChanged: () => Promise<void>
}) {
  const toast = useToast()
  const [audit, setAudit] = useState<ClosingAudit | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setAudit(await repo.closingAudit(shopId, dateKey))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run the audit.')
    }
  }, [shopId, dateKey])

  useEffect(() => { void load() }, [load])

  /** Post a confirmed action through the same settlement path the closing
   *  section uses. The audit never posts on its own. */
  const runAction = async (findingId: string, action: ClosingAuditAction) => {
    setBusy(findingId)
    try {
      if (action.kind === 'record_sale') {
        await repo.recordClosingSale(shopId, dateKey, action.product_id, action.qty, crypto.randomUUID())
        toast(`Invoice recorded for ${action.qty} item(s).`)
      } else if (action.kind === 'record_expense') {
        await repo.recordClosingExpense(shopId, dateKey, action.amount_paise / 100,
          'Unrecorded expense', `Closing Stock Audit: ${findingId}`, crypto.randomUUID())
        toast(`Expense of Rs ${(action.amount_paise / 100).toFixed(2)} recorded.`)
      } else {
        await repo.recordClosingCorrection(shopId, dateKey, action.product_id,
          action.cause, action.qty, 'Closing Stock Audit', crypto.randomUUID())
        toast('Stock correction written.')
      }
      setConfirming(null)
      await Promise.all([load(), onChanged()])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not post that.', 'err')
    } finally { setBusy('') }
  }

  return <Panel title="Closing Stock Audit" actions={
    <Btn sm variant="ghost" onClick={() => void load()}>Re-run</Btn>
  }>
    {error && <p role="alert">{error} <Btn sm variant="ghost" onClick={() => void load()}>Retry</Btn></p>}
    {!audit && !error && <p className="t-caption">Loading the audit…</p>}
    {audit && <>
      <div className="audit-header">
        <div>
          <strong>{audit.date_key}</strong>
          <span className="t-caption">
            {' '}{audit.closed
              ? `Sealed ${audit.sealed_at ? new Date(audit.sealed_at).toLocaleString() : ''}${audit.closed_by ? ` by ${audit.closed_by}` : ''}`
              : 'This day is still open.'}
          </span>
        </div>
        {audit.counted_cash !== null && audit.expected_cash !== null && <div>
          <span className="t-caption">Drawer counted {audit.counted_cash} against an expected {audit.expected_cash}</span>
        </div>}
        <span className={`audit-verdict${audit.all_clear ? '' : ' audit-verdict--open'}`}>
          {audit.all_clear ? 'Reconciles' : 'Differences to resolve'}
        </span>
      </div>

      <section className="audit-section">
        <h4>What the records show</h4>
        {audit.facts.map(f => <FactRow key={f.id} fact={f} />)}
      </section>

      {!!audit.findings.length && <section className="audit-section">
        <h4>What that probably means</h4>
        {audit.findings.map(f => <div key={f.id} className="audit-finding">
          <div className="audit-finding-head">
            <span className={`closing-confidence closing-confidence--${f.confidence}`}>
              {CONFIDENCE_LABEL[f.confidence] ?? f.confidence}
            </span>
            <strong>{f.title}</strong>
          </div>
          <p>{f.narrative}</p>
          {f.evidence && <p className="t-caption">{f.evidence}</p>}
          {(f.value_paise !== 0 || f.cash_paise !== 0) && <p className="t-caption">
            Stock worth {rupees(f.value_paise)} · cash {rupees(f.cash_paise)}
            {f.residual_paise ? ` · ${rupees(f.residual_paise)} not accounted for` : ''}
          </p>}

          {f.action && (confirming === f.id
            ? <div className="audit-confirm">
              <p>{f.action.confirmation}</p>
              <Btn sm variant="primary" disabled={!!busy}
                onClick={() => void runAction(f.id, f.action!)}>
                {busy === f.id ? 'Posting…' : 'Yes, post this document'}
              </Btn>
              <Btn sm variant="ghost" onClick={() => setConfirming(null)}>Cancel</Btn>
            </div>
            : <Btn sm onClick={() => setConfirming(f.id)}>{f.action.label}</Btn>)}

          {f.unavailable && <div className="audit-unavailable">
            <strong>{f.unavailable.label}</strong>
            <p className="t-caption">{f.unavailable.detail}</p>
          </div>}
        </div>)}
      </section>}

      <p className="t-caption audit-disposition">{audit.disposition_note}</p>
    </>}
  </Panel>
}

/** Whether the audit is worth offering: the day must be closed and the drawer
 *  counted. The user-visible button is gated on exactly this, so the rule is
 *  stated once and both sides use it. */
export function auditIsAvailable(audit: {
  closed: boolean; cash_counted: boolean
} | null): boolean {
  return Boolean(audit?.closed && audit.cash_counted)
}
