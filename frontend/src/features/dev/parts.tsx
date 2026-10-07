import { useEffect, useState, type ReactNode } from 'react'
import { IconCheck, IconCopy, IconEdit, IconX } from '@/components/icons'
import { Input } from '@/components/ui/Field'
import { Button, IconButton } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Tag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import { ICON } from '@/components/ui/tokens'
import { copyText } from '@/lib/clipboard'
import { REASON_TEXT, STAGE_LABEL, STAGE_TONE } from './format'
import type { Business, Secret } from './types'

/** A business's stage as a tag; the reason of a suspension is its tooltip. */
export function StageTag({ b }: { b: Pick<Business, 'stage' | 'reason'> }) {
  return (
    <Tag tone={STAGE_TONE[b.stage]} title={b.reason ? REASON_TEXT[b.reason] : undefined}>
      {STAGE_LABEL[b.stage]}
    </Tag>
  )
}

/** Copies a value and says so: the icon becomes a tick for a moment. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1400)
    return () => clearTimeout(t)
  }, [done])
  return (
    <IconButton
      label={label}
      variant="ghost"
      onClick={async () => {
        if (await copyText(value)) setDone(true)
        else toast('Could not copy. Select the text and copy it.', 'err')
      }}
    >
      {done ? <IconCheck size={ICON.md} /> : <IconCopy size={ICON.md} />}
    </IconButton>
  )
}

/**
 * Shows a login and password once. The password is not stored anywhere readable, so closing this loses it: the dialog says so, and
 * offers one tap to copy both lines ready to send to the owner.
 */
export function SecretDialog({ secret, title, onClose }: { secret: Secret | null; title: string; onClose: () => void }) {
  const toast = useToast()
  return (
    <Modal
      open={!!secret}
      onClose={onClose}
      title={title}
      width={460}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={async () => secret && (await copyText(`${secret.login}\n${secret.password}`)) && toast('Login and password copied')}
          >
            <IconCopy size={ICON.sm} /> Copy both
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <p className="mt-0 mb-12 text-ink">This password cannot be shown again. Send it to the owner now.</p>
      <div className="border-l-3 border-l-blue bg-layer px-12 py-10 font-mono text-s14 leading-l155 text-ink select-all">
        {secret?.login}
        <br />
        {secret?.password}
      </div>
    </Modal>
  )
}

/** A label above a value, for the compact property grids of the business panel. */
export function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-s11h font-semibold uppercase tracking-caption text-muted">{label}</div>
      <div className="mt-2 flex min-w-0 items-center gap-6 text-s13h text-ink">{children}</div>
    </div>
  )
}

/** A titled block of the business panel. `edit` shows the pencil; while editing, the block shows its form and a tick/cross instead. */
export function Block({
  title, children, aside, onEdit, editing, onSave, onCancel, saving, saveDisabled,
}: {
  title: string
  children: ReactNode
  /** Extra icon buttons beside the pencil. */
  aside?: ReactNode
  onEdit?: () => void
  editing?: boolean
  onSave?: () => void
  onCancel?: () => void
  saving?: boolean
  saveDisabled?: boolean
}) {
  return (
    <section className="border border-line">
      <div className="flex items-center gap-4 border-b border-line bg-layer py-2 pr-4 pl-12">
        <h3 className="m-0 flex-1 text-s11h font-semibold uppercase tracking-caption text-muted">{title}</h3>
        {editing ? (
          <>
            <IconButton label="Save" variant="primary" loading={saving} disabled={saveDisabled} onClick={onSave}>
              <IconCheck size={ICON.md} />
            </IconButton>
            <IconButton label="Cancel" variant="ghost" onClick={onCancel}>
              <IconX size={ICON.md} />
            </IconButton>
          </>
        ) : (
          <>
            {aside}
            {onEdit && (
              <IconButton label={`Edit ${title.toLowerCase()}`} variant="ghost" onClick={onEdit}>
                <IconEdit size={ICON.md} />
              </IconButton>
            )}
          </>
        )}
      </div>
      <div className="p-12">{children}</div>
    </section>
  )
}

/** The business code must be typed to confirm a serious change: the dialog says what happens, and the button stays off until it matches. */
export function TypedConfirm({
  open, title, message, code, confirmLabel, busy, onClose, onConfirm,
}: {
  open: boolean
  title: string
  message: ReactNode
  code: string
  confirmLabel: string
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (!open) setTyped('')
  }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={typed !== code} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="mt-0 mb-12">{message}</p>
      <label className="mb-4 block text-s12h font-semibold text-ink-2">
        Type <span className="font-mono">{code}</span> to confirm
      </label>
      <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && typed === code && onConfirm()} />
    </Modal>
  )
}
