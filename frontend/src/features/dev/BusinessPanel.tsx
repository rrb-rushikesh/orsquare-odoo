import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconKey, IconPause, IconPlay, IconRefresh, IconSliders } from '@/components/icons'
import { IconButton } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { Field, Input } from '@/components/ui/Field'
import { PhoneField, type Mobile } from '@/components/ui/PhoneField'
import { Tag } from '@/components/ui/Tag'
import { ICON } from '@/components/ui/tokens'
import { DEFAULT_COUNTRY, displayMobile, mobileProblem } from '@/lib/mobile'
import { useDevRead, useDevWrite } from './api'
import { AddCashierDialog, CashiersBlock } from './CashiersBlock'
import { showDate, showWhen } from './format'
import { Block, CopyButton, Prop, SecretDialog, StageTag, TypedConfirm } from './parts'
import { StudioPanel } from './studio/StudioPanel'
import { SubscriptionBlock } from './SubscriptionBlock'
import type { AuditEvent, Business, Person, Secret, StudioData } from './types'

/**
 * One business, all its governance in a single compact panel: identity, owner, subscription, cashiers, Business Studio, status and
 * its own activity. Everything shown is read from the business's own database; every control is an icon button with a tooltip, and
 * each block edits in place (pencil, tick, cross). The URL is /dev/b/<slug>, so a refresh or a shared link returns here.
 */
export function BusinessPanel({ slug }: { slug: string }) {
  const navigate = useNavigate()
  const q = useDevRead<Business>('dev.businesses.get', { slug })
  const b = q.data
  const close = () => navigate('/dev')
  return (
    <Drawer open onClose={close} title={b?.name ?? 'Business'} dense footer={null}>
      {q.isPending && <p className="m-0 text-s13 text-muted">Loading.</p>}
      {q.error && <p role="alert" className="m-0 text-s13 text-err-fg">{q.error.message}</p>}
      {b && <Body b={b} onRefresh={() => void q.refetch()} refreshing={q.isFetching} />}
    </Drawer>
  )
}

function Body({ b, onRefresh, refreshing }: { b: Business; onRefresh: () => void; refreshing: boolean }) {
  const [secret, setSecret] = useState<{ secret: Secret; title: string } | null>(null)
  const [suspending, setSuspending] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [addingCashier, setAddingCashier] = useState(false)
  const studio = useDevRead<StudioData>('dev.studio.get', { slug: b.slug }, studioOpen)
  const audit = useDevRead<AuditEvent[]>('dev.audit.list', { slug: b.slug, limit: 6 })
  const status = useDevWrite('dev.status.set', { onSuccess: () => setSuspending(false) })
  const saveStudio = useDevWrite('dev.studio.set', { onSuccess: () => setStudioOpen(false) })
  const reset = useDevWrite<Secret>('dev.users.resetPassword', { onSuccess: (s) => setSecret({ secret: s, title: 'Password reset' }) })
  const suspended = b.status === 'suspended'
  const resetFor = (p: Person) => reset.mutate({ slug: b.slug, id: p.id })

  return (
    <>
      <div className="flex flex-wrap items-center gap-8">
        <StageTag b={b} />
        {b.planLabel && <Tag tone="gray">{b.planLabel}</Tag>}
        <span className="font-mono text-s12 text-muted">/{b.slug}/{b.code}</span>
        <span className="ml-auto flex items-center">
          {b.owner && <CopyButton value={b.owner.login} label="Copy owner login" />}
          {b.owner && (
            <IconButton label="Reset owner password" variant="ghost" loading={reset.isPending} onClick={() => resetFor(b.owner!)}>
              <IconKey size={ICON.md} />
            </IconButton>
          )}
          <IconButton label="Open Business Studio" variant="ghost" onClick={() => setStudioOpen(true)}>
            <IconSliders size={ICON.md} />
          </IconButton>
          <IconButton label="Refresh" variant="ghost" loading={refreshing} onClick={onRefresh}>
            <IconRefresh size={ICON.md} />
          </IconButton>
          {suspended ? (
            <IconButton label="Reactivate business" variant="ghost" onClick={() => status.mutate({ slug: b.slug, status: 'active' })} loading={status.isPending}>
              <IconPlay size={ICON.md} />
            </IconButton>
          ) : (
            <IconButton label="Suspend business" variant="ghost" onClick={() => setSuspending(true)}>
              <IconPause size={ICON.md} />
            </IconButton>
          )}
        </span>
      </div>

      {suspended && b.reason && (
        <div role="status" className="border-l-3 border-l-err bg-err-bg px-10 py-8 text-s12h text-err-fg">
          {b.reason === 'expired' ? `The subscription ended on ${showDate(b.validUntil)}. Extend it to restore the shop.` : b.reason === 'not_started' ? 'The subscription has not started yet.' : 'Suspended by an administrator. Users can sign in and see why; nothing else works.'}
        </div>
      )}

      <IdentityBlock b={b} />
      <OwnerBlock b={b} onReset={() => b.owner && resetFor(b.owner)} />
      <SubscriptionBlock b={b} />
      <CashiersBlock b={b} onAdd={() => setAddingCashier(true)} onReset={resetFor} />
      <Block title="Business Studio" onEdit={() => setStudioOpen(true)}>
        <div className="flex flex-wrap items-center gap-6 text-s13h">
          <Tag tone="gray">{b.tabs} tabs on</Tag>
          <span className="text-muted">Which tabs, variants and features this business gets.</span>
        </div>
      </Block>

      <Block title="Activity">
        {audit.data && audit.data.length === 0 && <div className="text-s13 text-muted">Nothing recorded yet.</div>}
        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {audit.data?.map((e) => (
            <li key={e.id} className="flex items-baseline gap-8 text-s12h">
              <span className="w-80 shrink-0 text-muted">{showWhen(e.at)}</span>
              <span className="min-w-0">
                <b className="font-medium">{e.action}</b> <span className="text-muted">{e.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </Block>

      <AddCashierDialog open={addingCashier} b={b} onClose={() => setAddingCashier(false)} />
      <SecretDialog secret={secret?.secret ?? null} title={secret?.title ?? ''} onClose={() => setSecret(null)} />
      <TypedConfirm
        open={suspending}
        title={`Suspend ${b.name}?`}
        message="Users can still sign in and see why, but every other request is refused. Data is untouched and you can restore it at any time."
        code={b.slug}
        confirmLabel="Suspend business"
        busy={status.isPending}
        onClose={() => setSuspending(false)}
        onConfirm={() => status.mutate({ slug: b.slug, status: 'suspended', confirm: b.slug })}
      />
      {studio.data && (
        <StudioPanel
          open={studioOpen}
          title={b.name}
          data={studio.data}
          value={studio.data.setup}
          saving={saveStudio.isPending}
          onClose={() => setStudioOpen(false)}
          onSave={(setup) => saveStudio.mutate({ slug: b.slug, setup })}
        />
      )}
    </>
  )
}

function IdentityBlock({ b }: { b: Business }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(b.name)
  const rename = useDevWrite('dev.businesses.rename', { onSuccess: () => setEditing(false) })
  return (
    <Block
      title="Business"
      editing={editing}
      onEdit={() => { setName(b.name); setEditing(true) }}
      onCancel={() => setEditing(false)}
      onSave={() => rename.mutate({ slug: b.slug, name })}
      saving={rename.isPending}
      saveDisabled={!name.trim() || name.trim() === b.name}
    >
      {editing ? (
        <Field label="Business name" hint={`The shop URL /${b.slug}/${b.code} never changes.`}>
          <Input data-autofocus autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && rename.mutate({ slug: b.slug, name })} />
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-12">
          <Prop label="Name">{b.name}</Prop>
          <Prop label="Created">{showDate(b.createdAt)}</Prop>
        </div>
      )}
    </Block>
  )
}

function OwnerBlock({ b, onReset }: { b: Business; onReset: () => void }) {
  const owner = b.owner
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState<Mobile>({ country: DEFAULT_COUNTRY, number: '' })
  const [tried, setTried] = useState(false)
  const save = useDevWrite('dev.owner.update', { onSuccess: () => setEditing(false) })
  if (!owner) return <Block title="Owner and login"><span className="text-s13 text-muted">This business has no owner.</span></Block>
  const problem = mobileProblem(mobile.country, mobile.number)
  return (
    <Block
      title="Owner and login"
      editing={editing}
      onEdit={() => { setName(owner.name); setMobile(owner.mobile ?? { country: DEFAULT_COUNTRY, number: '' }); setTried(false); setEditing(true) }}
      onCancel={() => setEditing(false)}
      onSave={() => { setTried(true); if (!problem && name.trim()) save.mutate({ slug: b.slug, name, country: mobile.country, mobile: mobile.number }) }}
      saving={save.isPending}
      aside={<IconButton label="Reset password" variant="ghost" onClick={onReset}><IconKey size={ICON.md} /></IconButton>}
    >
      {editing ? (
        <div className="flex flex-col gap-10">
          <Field label="Owner’s name" required error={tried && !name.trim() ? 'Enter the owner’s name.' : undefined}>
            <Input data-autofocus autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Mobile number" required error={tried ? problem : undefined}>
            <PhoneField value={mobile} onChange={setMobile} invalid={tried && !!problem} />
          </Field>
          <span className="text-s12 text-muted">The owner ID {owner.login.split('@')[0]} is the login and cannot change.</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-12 gap-y-10">
          <Prop label="Owner">{owner.name}</Prop>
          <Prop label="Owner ID">
            <span className="truncate font-mono text-s12h">{owner.login}</span>
            <CopyButton value={owner.login} label="Copy owner login" />
          </Prop>
          <Prop label="Mobile">{owner.mobile ? <span className="font-mono text-s12h">{displayMobile(owner.mobile.country, owner.mobile.number)}</span> : <Tag tone="warn">Missing</Tag>}</Prop>
          <Prop label="Account">{owner.active ? <Tag tone="ok">Active</Tag> : <Tag tone="gray">Suspended</Tag>}</Prop>
        </div>
      )}
    </Block>
  )
}

