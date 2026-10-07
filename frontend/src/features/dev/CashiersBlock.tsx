import { useMemo, useState } from 'react'
import { IconKey, IconPause, IconPlay, IconPlus } from '@/components/icons'
import { IconButton } from '@/components/ui/Button'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PasswordField } from '@/components/ui/PasswordField'
import { Stepper } from '@/components/ui/Stepper'
import { Tag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import { ICON } from '@/components/ui/tokens'
import { copyText } from '@/lib/clipboard'
import { cx } from '@/lib/cx'
import { generatePassword, useDevRead, useDevWrite } from './api'
import { Block } from './parts'
import { OWNER_ID, suggestOwnerId, takenIds } from './ownerId'
import type { Business, Person } from './types'

/** Cashier accounts: how many exist against the limit the developer set, with the accounts themselves one line each. */
export function CashiersBlock({ b, onAdd, onReset }: { b: Business; onAdd: () => void; onReset: (p: Person) => void }) {
  const { used, limit, list } = b.cashiers
  const [editing, setEditing] = useState(false)
  const [next, setNext] = useState(limit)
  const setLimit = useDevWrite('dev.cashiers.setLimit', { onSuccess: () => setEditing(false) })
  const setActive = useDevWrite('dev.users.setActive')
  const full = used >= limit
  return (
    <Block
      title="Cashier accounts"
      editing={editing}
      onEdit={() => { setNext(limit); setEditing(true) }}
      onCancel={() => setEditing(false)}
      onSave={() => setLimit.mutate({ slug: b.slug, limit: next })}
      saving={setLimit.isPending}
      saveDisabled={next === limit}
      aside={
        <IconButton label={full ? 'Limit reached: raise it first' : 'Add cashier'} variant="ghost" disabled={full} onClick={onAdd}>
          <IconPlus size={ICON.md} />
        </IconButton>
      }
    >
      {editing ? (
        <Field label="Cashier accounts allowed" hint={used ? `Cannot be lower than the ${used} that already exist.` : 'Default is 2.'}>
          <Stepper value={next} onChange={setNext} min={used} max={50} label="Cashier accounts allowed" />
        </Field>
      ) : (
        <>
          <div className="mb-8 flex items-center gap-8 text-s13h">
            <b>{used} of {limit}</b>
            <span className="text-muted">{full ? 'limit reached' : `${limit - used} left`}</span>
          </div>
          <div className="mb-8 flex gap-3" aria-hidden>
            {Array.from({ length: Math.min(Math.max(limit, 1), 12) }, (_, i) => (
              <i key={i} className={cx('h-6 flex-1', i < used ? 'bg-blue' : 'bg-layer-2')} />
            ))}
          </div>
          {list.length === 0 && <div className="text-s13 text-muted">No cashier accounts yet.</div>}
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-6 border-t border-layer-2 py-4 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-s13 font-medium">{p.name}</div>
                <div className="truncate font-mono text-s11h text-muted">{p.login}</div>
              </div>
              {!p.active && <Tag tone="gray">Suspended</Tag>}
              <IconButton label="Reset password" variant="ghost" onClick={() => onReset(p)}>
                <IconKey size={ICON.md} />
              </IconButton>
              <IconButton
                label={p.active ? 'Suspend cashier' : 'Reactivate cashier'}
                variant="ghost"
                loading={setActive.isPending && setActive.variables?.id === p.id}
                onClick={() => setActive.mutate({ slug: b.slug, id: p.id, active: !p.active })}
              >
                {p.active ? <IconPause size={ICON.md} /> : <IconPlay size={ICON.md} />}
              </IconButton>
            </div>
          ))}
        </>
      )}
    </Block>
  )
}

/** A cashier's name, login ID and password. The limit and the unique ID are enforced by the server; this form refuses early. */
export function AddCashierDialog({ open, b, onClose }: { open: boolean; b: Business; onClose: () => void }) {
  const toast = useToast()
  // every login in the fleet, so the suggested ID is not one that is already used (IDs are unique across businesses)
  const fleet = useDevRead<{ businesses: Business[] }>('dev.businesses.list')
  const taken = useMemo(() => takenIds((fleet.data?.businesses ?? []).flatMap((x) => [x.owner?.login, ...x.cashiers.list.map((c) => c.login)]).filter((l): l is string => !!l)), [fleet.data])
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [touched, setTouched] = useState(false)
  const [password, setPassword] = useState('')
  const [tried, setTried] = useState(false)
  const reset = () => { setName(''); setId(''); setTouched(false); setPassword(''); setTried(false) }
  const create = useDevWrite('dev.cashiers.create', {
    onSuccess: async () => {
      await copyText(`${id}@orsquare.com\n${password}`)
      toast('Cashier created. Login and password copied.')
      reset()
      onClose()
    },
  })
  const errors = {
    name: name.trim() ? '' : 'Enter the cashier’s name.',
    id: OWNER_ID.test(id) ? '' : 'Use 3 to 20 letters or numbers.',
    password: password.length >= 10 ? '' : 'Use at least 10 characters, or press the dice.',
  }
  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title={`Add cashier to ${b.name}`}
      width={440}
      footer={
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            onClick={() => {
              setTried(true)
              if (!errors.name && !errors.id && !errors.password) create.mutate({ slug: b.slug, name: name.trim(), cashierId: id, password })
            }}
          >
            Create cashier
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-12">
        <Field label="Cashier’s name" required error={tried ? errors.name : undefined}>
          <Input data-autofocus autoFocus value={name} placeholder="e.g. Counter 2" onChange={(e) => { setName(e.target.value); if (!touched) setId(suggestOwnerId(e.target.value, taken)) }} />
        </Field>
        <Field label="Login ID" required error={tried ? errors.id : undefined} hint="Used to sign in, as ID@orsquare.com. Unique across all businesses.">
          <div className="flex items-stretch">
            <Input fluid={false} className="min-w-0 flex-1" value={id} autoComplete="off" onChange={(e) => { setTouched(true); setId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)) }} />
            <span className="flex items-center border-b border-b-subtle bg-layer-2 px-10 text-s12 text-muted">@orsquare.com</span>
          </div>
        </Field>
        <Field label="Password" required error={tried ? errors.password : undefined}>
          <PasswordField value={password} onChange={setPassword} onGenerate={async () => { const p = await generatePassword(); if (await copyText(p)) toast('Password generated and copied'); return p }} />
        </Field>
      </div>
    </Modal>
  )
}
