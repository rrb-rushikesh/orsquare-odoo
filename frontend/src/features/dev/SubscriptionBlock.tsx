import { useState } from 'react'
import { IconCheck } from '@/components/icons'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Field'
import { ICON } from '@/components/ui/tokens'
import { cx } from '@/lib/cx'
import { useDevRead, useDevWrite } from './api'
import { leftText, showDate } from './format'
import { Block, Prop } from './parts'
import type { Business, Plan, PlanKey } from './types'

const QUICK = [-28, -7, -1, 1, 7, 28]

/** ISO date plus whole days, by calendar arithmetic only (no clock, no zone). Used for the preview; the server returns the real date. */
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10)

/**
 * Subscription: what was sold (the plan) and what is valid (the dates). Time is given or taken back by typing any number of days,
 * plus or minus, or with one tap; exact dates and a new plan are one click away. Every change is applied by the server, which dates
 * it with the business's own calendar, and recorded with the reason typed here.
 */
export function SubscriptionBlock({ b }: { b: Business }) {
  const plans = useDevRead<{ plans: Plan[] }>('dev.plans.list')
  const [days, setDays] = useState('')
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(b.validFrom ?? '')
  const [end, setEnd] = useState(b.validUntil ?? '')
  const [renew, setRenew] = useState<Plan | null>(null)
  const shiftW = useDevWrite('dev.subscription.shift', { onSuccess: () => { setDays(''); setReason('') } })
  const setW = useDevWrite('dev.subscription.set', { onSuccess: () => setEditing(false) })
  const renewW = useDevWrite('dev.subscription.renew', { onSuccess: () => setRenew(null) })

  const n = /^-?\d+$/.test(days.trim()) ? parseInt(days, 10) : NaN
  const valid = Number.isFinite(n) && n !== 0 && Math.abs(n) <= 3650
  const preview = b.validUntil && valid ? shift(b.validUntil, n) : null
  const planDays = plans.data?.plans.find((p) => p.key === b.plan)?.days
  const used = planDays && b.daysLeft !== null ? Math.min(100, Math.max(0, ((planDays - b.daysLeft) / planDays) * 100)) : null

  return (
    <Block
      title="Subscription"
      editing={editing}
      onEdit={() => { setStart(b.validFrom ?? ''); setEnd(b.validUntil ?? ''); setEditing(true) }}
      onCancel={() => setEditing(false)}
      onSave={() => setW.mutate({ slug: b.slug, start: start || null, end: end || null, reason })}
      saving={setW.isPending}
      saveDisabled={start === (b.validFrom ?? '') && end === (b.validUntil ?? '')}
    >
      {editing ? (
        <div className="flex flex-col gap-10">
          <div className="grid grid-cols-2 gap-12">
            <Field label="Starts"><Input type="date" data-autofocus value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Ends (inclusive)"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <Field label="Reason" hint="Optional. Recorded in the audit log."><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-12">
            <Prop label="Plan">{b.planLabel ?? 'Custom dates'}</Prop>
            <Prop label="Valid">{showDate(b.validFrom)} – {showDate(b.validUntil)}</Prop>
            <Prop label="Remaining"><span className={cx(b.daysLeft !== null && b.daysLeft < 0 && 'text-err-fg', b.daysLeft !== null && b.daysLeft >= 0 && b.daysLeft <= 7 && 'text-warn-fg')}>{leftText(b.daysLeft)}</span></Prop>
          </div>
          {used !== null && (
            <div className="mt-8 h-4 bg-layer-2" aria-hidden>
              <div className={cx('h-full', b.daysLeft !== null && b.daysLeft < 0 ? 'bg-err' : 'bg-blue')} style={{ width: `${used}%` }} />
            </div>
          )}

          <div className="mt-12 border-t border-layer-2 pt-10">
            <div className="mb-6 text-s11h font-semibold uppercase tracking-caption text-muted">Move the end date</div>
            <div className="flex flex-wrap items-center gap-4">
              {QUICK.map((q) => (
                <Button key={q} size="sm" variant="ghost" toolbar onClick={() => setDays(String(q))} aria-pressed={n === q}>
                  {q > 0 ? `+${q}` : q}
                </Button>
              ))}
              <Input
                size="dense"
                fluid={false}
                className="w-96 text-center font-semibold tabular-nums"
                inputMode="numeric"
                aria-label="Days to add or take away"
                placeholder="± days"
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && valid && shiftW.mutate({ slug: b.slug, days: n, reason })}
              />
              <IconButton label={valid ? `Apply ${n > 0 ? '+' : ''}${n} days` : 'Enter a number of days'} variant="primary" disabled={!valid} loading={shiftW.isPending} onClick={() => shiftW.mutate({ slug: b.slug, days: n, reason })}>
                <IconCheck size={ICON.md} />
              </IconButton>
            </div>
            <div className="mt-6 min-h-18 text-s12h text-muted">
              {preview ? <>Ends <b className="text-ink">{showDate(b.validUntil)}</b> → <b className="text-ink">{showDate(preview)}</b></> : 'Type a number, or tap one. Minus takes time away.'}
            </div>
            {valid && <Input size="dense" className="mt-4" placeholder="Reason (optional, recorded in the audit log)" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />}
          </div>

          <div className="mt-10 border-t border-layer-2 pt-10">
            <div className="mb-6 text-s11h font-semibold uppercase tracking-caption text-muted">Start a plan</div>
            <div className="flex flex-wrap gap-4">
              {plans.data?.plans.map((p) => (
                <Button key={p.key} size="sm" variant="ghost" toolbar onClick={() => setRenew(p)}>{p.label}</Button>
              ))}
            </div>
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!renew}
        title={`Start the ${renew?.label}?`}
        message={b.daysLeft !== null && b.daysLeft >= 0 ? 'It is added after the current period and ends after its full length.' : 'The current period has ended, so it starts today, by this business’s own calendar.'}
        confirmLabel="Start plan"
        busy={renewW.isPending}
        onClose={() => setRenew(null)}
        onConfirm={() => renew && renewW.mutate({ slug: b.slug, plan: renew.key as PlanKey, reason })}
      />
    </Block>
  )
}
