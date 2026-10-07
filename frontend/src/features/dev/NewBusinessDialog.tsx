import { useMemo, useState } from 'react'
import { IconLock, IconSliders } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { ChoiceCards } from '@/components/ui/ChoiceCards'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PasswordField } from '@/components/ui/PasswordField'
import { PhoneField, type Mobile } from '@/components/ui/PhoneField'
import { Stepper } from '@/components/ui/Stepper'
import { useToast } from '@/components/ui/Toast'
import { ICON } from '@/components/ui/tokens'
import { copyText } from '@/lib/clipboard'
import { cx } from '@/lib/cx'
import { DEFAULT_COUNTRY, displayMobile, mobileProblem } from '@/lib/mobile'
import { generatePassword, useDevRead, useDevWrite } from './api'
import { suggestOwnerId, takenIds, OWNER_ID } from './ownerId'
import { StudioPanel } from './studio/StudioPanel'
import { summary } from './studio/model'
import type { Business, Plan, PlanKey, Secret, StudioData, StudioSetup } from './types'

const PLAN_NOTE: Record<PlanKey, string> = { '7d': 'One-time trial. No other trial is offered.', '28d': 'Our normal monthly billing period.', '1y': 'One payment, valid for a full year.' }
const planHeadline = (p: Plan) => (p.price ? `₹${p.price.toLocaleString('en-IN')}` : `${p.days} days`)

/**
 * Registering a business is one form with four short sections and a live summary: the business, its one owner (one owner ID is one
 * business), the subscription, and the access (cashier limit and Business Studio). Every field is required. The server validates
 * again and is the authority; this form only refuses early, in plain sentences.
 */
export function NewBusinessDialog({ open, taken, onClose, onCreated }: { open: boolean; taken: Set<string>; onClose: () => void; onCreated: (b: Business, secret: Secret) => void }) {
  return (
    <Modal open={open} onClose={onClose} ariaLabel="New business" width="min(1000px, 96vw)" flush closeOnEscape={false}>
      {open && <Form taken={taken} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  )
}

function Form({ taken, onClose, onCreated }: { taken: Set<string>; onClose: () => void; onCreated: (b: Business, secret: Secret) => void }) {
  const toast = useToast()
  const plans = useDevRead<{ plans: Plan[] }>('dev.plans.list')
  const studioData = useDevRead<StudioData>('dev.studio.catalog')
  const [name, setName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [mobile, setMobile] = useState<Mobile>({ country: DEFAULT_COUNTRY, number: '' })
  const [password, setPassword] = useState('')
  const [plan, setPlan] = useState<PlanKey | ''>('')
  const [limit, setLimit] = useState(2)
  const [setup, setSetup] = useState<StudioSetup | null>(null)
  const [studioOpen, setStudioOpen] = useState(false)
  const [tried, setTried] = useState(false)
  const [secret, setSecret] = useState<{ secret: Secret; business: Business } | null>(null)

  const taken_ = useMemo(() => takenIds(taken), [taken])
  const effectiveSetup = setup ?? studioData.data?.setup ?? null
  const suggestion = suggestOwnerId(ownerName, taken_)
  const create = useDevWrite<Business>('dev.businesses.create', {
    onSuccess: (business) => setSecret({ secret: { login: `${ownerId}@orsquare.com`, password }, business }),
  })

  const problems = (): Record<string, string> => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Enter the business name.'
    if (!ownerName.trim()) e.ownerName = 'Enter the owner’s name.'
    if (!OWNER_ID.test(ownerId)) e.ownerId = 'Use 3 to 20 letters or numbers.'
    else if (taken_.has(ownerId)) e.ownerId = 'This owner ID already belongs to another business.'
    const m = mobileProblem(mobile.country, mobile.number)
    if (m) e.mobile = m
    if (password.length < 10) e.password = 'Use at least 10 characters, or press the dice.'
    if (!plan) e.plan = 'Choose a subscription.'
    return e
  }

  // after the first attempt the sentences follow the fields live, so a fixed field stops complaining at once
  const errors = tried ? problems() : {}

  const submit = () => {
    setTried(true)
    const e = problems()
    const first = Object.keys(e)[0]
    if (first) {
      document.getElementById(`nb-${first}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      toast('Fix the highlighted fields.', 'err')
      return
    }
    create.mutate({ name: name.trim(), ownerName: ownerName.trim(), ownerId, country: mobile.country, mobile: mobile.number, password, plan, cashierLimit: limit, setup: effectiveSetup })
  }

  const chosen = plans.data?.plans.find((p) => p.key === plan)
  const sum = studioData.data && effectiveSetup ? summary(studioData.data.groups, effectiveSetup) : null
  const row = (k: string, v: string) => (
    <div className="flex gap-8 border-b border-layer-2 py-7 last:border-0">
      <span className="w-84 shrink-0 text-muted">{k}</span>
      <span className={cx('min-w-0 break-words', !v && 'text-subtle')}>{v || '—'}</span>
    </div>
  )

  return (
    <>
      <div className="flex items-center gap-12 border-b border-line px-24 py-14">
        <div>
          <div className="text-s11h font-semibold uppercase tracking-caption text-muted">New business</div>
          <h2 className="m-0 text-s17 font-normal">Register a business and its owner</h2>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] narrow:grid-cols-1">
        <div className="flex max-h-[min(640px,72dvh)] flex-col gap-16 overflow-y-auto p-20">
          <Section n={1} title="Business" done={!!name.trim()}>
            <div id="nb-name">
              <Field label="Business name" required error={errors.name} hint="This becomes the shop name.">
                <Input data-autofocus autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sai Traders" />
              </Field>
            </div>
          </Section>

          <Section n={2} title="Owner and login" done={!!(ownerName && OWNER_ID.test(ownerId) && !mobileProblem(mobile.country, mobile.number) && password)} note="One owner ID is one business">
            <div className="mb-12 flex items-center gap-8 border-l-3 border-l-blue bg-layer-accent px-10 py-8 text-s12h">
              <IconLock size={ICON.sm} /> This owner runs this shop only. A second shop needs a second owner ID.
            </div>
            <div className="grid grid-cols-2 gap-x-16 gap-y-12 narrow:grid-cols-1">
              <div id="nb-ownerName">
                <Field label="Owner’s name" required error={errors.ownerName}>
                  <Input value={ownerName} onChange={(e) => { setOwnerName(e.target.value); if (!idTouched) setOwnerId(suggestOwnerId(e.target.value, taken_)) }} placeholder="e.g. Suresh Shah" />
                </Field>
              </div>
              <div id="nb-ownerId">
                <Field label="Owner ID" required error={errors.ownerId} hint="The owner signs in with this.">
                  <div className="flex items-stretch">
                    <Input fluid={false} className="min-w-0 flex-1" value={ownerId} autoComplete="off" spellCheck={false} placeholder="e.g. sureshs"
                      onChange={(e) => { setIdTouched(true); setOwnerId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)) }} />
                    <span className="flex items-center border-b border-b-subtle bg-layer-2 px-10 text-s12 text-muted">@orsquare.com</span>
                  </div>
                  {suggestion && suggestion !== ownerId && (
                    <button type="button" className="mt-4 w-fit cursor-pointer border-0 bg-layer-accent px-8 py-2 text-s12 text-blue-link" onClick={() => { setOwnerId(suggestion); setIdTouched(false) }}>
                      Use suggested: {suggestion}
                    </button>
                  )}
                </Field>
              </div>
              <div id="nb-mobile">
                <Field label="Owner’s mobile number" required error={errors.mobile}>
                  <PhoneField value={mobile} onChange={setMobile} invalid={!!errors.mobile} />
                </Field>
              </div>
              <div id="nb-password">
                <Field label="Password" required error={errors.password} hint="Type one, or press the dice to generate and copy a secure one.">
                  <PasswordField value={password} onChange={setPassword} onGenerate={async () => { const p = await generatePassword(); if (await copyText(p)) toast('Password generated and copied'); return p }} />
                </Field>
              </div>
            </div>
          </Section>

          <Section n={3} title="Subscription" done={!!plan} note="choose one">
            <div id="nb-plan">
              {errors.plan && <div role="alert" className="mb-8 text-s12 text-err-fg">{errors.plan}</div>}
              <ChoiceCards
                label="Subscription"
                value={plan}
                invalid={!!errors.plan}
                onChange={(v) => setPlan(v)}
                options={(plans.data?.plans ?? []).map((p) => ({ value: p.key, title: p.label, headline: planHeadline(p), note: PLAN_NOTE[p.key] }))}
              />
            </div>
          </Section>

          <Section n={4} title="Access and setup" done>
            <div className="flex flex-wrap items-center gap-24">
              <Field label="Cashier accounts allowed" required hint="Default 2. Changeable later from the business panel.">
                <Stepper value={limit} onChange={setLimit} min={0} max={50} label="Cashier accounts allowed" />
              </Field>
              <div className="flex min-w-240 flex-1 items-center gap-12 border border-line px-12 py-10">
                <IconSliders size={ICON.lg} />
                <div className="min-w-0 flex-1">
                  <div className="text-s13 font-semibold">Business Studio</div>
                  <div className="text-s12 text-muted">{sum ? `${sum.on} of ${sum.total} tabs on · ${sum.variants} variants chosen · ${sum.features} features changed` : 'Loading…'}</div>
                </div>
                <Button variant="secondary" size="sm" disabled={!studioData.data} onClick={() => setStudioOpen(true)}>Open</Button>
              </div>
            </div>
          </Section>
        </div>

        <aside className="border-l border-line bg-layer p-20 text-s13 narrow:hidden">
          <div className="mb-8 text-s11h font-semibold uppercase tracking-caption text-muted">What will be created</div>
          {row('Business', name.trim())}
          {row('Owner', ownerName.trim())}
          {row('Owner ID', ownerId ? `${ownerId}@orsquare.com` : '')}
          {row('Mobile', mobile.number ? displayMobile(mobile.country, mobile.number) : '')}
          {row('Password', password ? 'Set' : '')}
          {row('Plan', chosen ? `${chosen.label} · ${planHeadline(chosen)}` : '')}
          {row('Cashiers', `${limit} allowed`)}
          {row('Studio', sum ? `${sum.on} tabs on` : '')}
        </aside>
      </div>
      <div className="flex items-center gap-8 border-t border-line px-24 py-12">
        <span className="text-s12 text-muted">Every field is required. The password is shown once after creation.</span>
        <span className="ml-auto flex gap-8">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>Create business</Button>
        </span>
      </div>

      {studioData.data && effectiveSetup && (
        <StudioPanel open={studioOpen} title={name.trim() || 'New business'} data={studioData.data} value={effectiveSetup} onClose={() => setStudioOpen(false)} onSave={(s) => { setSetup(s); setStudioOpen(false) }} />
      )}
      <Modal
        open={!!secret}
        onClose={() => undefined}
        closeOnEscape={false}
        title="Business created"
        width={460}
        footer={<>
          <Button variant="secondary" onClick={async () => secret && (await copyText(`${secret.secret.login}\n${secret.secret.password}`)) && toast('Login and password copied')}>Copy both</Button>
          <Button variant="primary" onClick={() => secret && onCreated(secret.business, secret.secret)}>Open business</Button>
        </>}
      >
        <p className="mt-0 mb-12 text-ink">{secret?.business.name} is ready. Send these to the owner now: the password cannot be shown again.</p>
        <div className="border-l-3 border-l-blue bg-layer px-12 py-10 font-mono text-s14 leading-l155 text-ink select-all">{secret?.secret.login}<br />{secret?.secret.password}</div>
      </Modal>
    </>
  )
}

function Section({ n, title, note, done, children }: { n: number; title: string; note?: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="border border-line">
      <div className="flex items-center gap-10 border-b border-line bg-layer px-14 py-8">
        <span className={cx('flex size-20 items-center justify-center text-s11h font-semibold text-white', done ? 'bg-ok' : 'bg-ink')}>{n}</span>
        <h3 className="m-0 text-s13 font-semibold">{title}</h3>
        {note && <span className="text-s12 text-muted">{note}</span>}
      </div>
      <div className="p-14">{children}</div>
    </section>
  )
}
