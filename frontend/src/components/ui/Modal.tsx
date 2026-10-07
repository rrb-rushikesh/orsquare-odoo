import type { ReactNode } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Dialog } from '@base-ui/react/dialog'
import { cx } from '@/lib/cx'
import { Button } from './Button'

/*
 * DIALOGS - centered, 420px, three parts: head / body / foot. Behaviour (focus trap, Escape, scroll lock,
 * backdrop press) comes from Base UI; every visible value is the original's `.modal`.
 *
 *   ConfirmDialog   a decision that needs a yes/no ("Delete this product?") - AlertDialog semantics.
 *   InfoDialog      a message the user must acknowledge ("Action blocked") - one Close button.
 *   Modal           anything else that must interrupt (a short prompt with its own controls and footer).
 *
 * Long forms and multi-step work are a `Drawer`, not a dialog. Quick results are toasts.
 */
const BACKDROP = 'fixed inset-0 z-(--z-modal) animate-[lab-fade-in_140ms_ease-out] bg-[rgba(22,22,22,0.45)]'
const VIEWPORT = 'fixed inset-0 z-(--z-modal) flex overflow-y-auto overscroll-contain p-16'
const BOX = 'm-auto flex max-h-[calc(100dvh-32px)] w-[420px] max-w-full flex-col border border-line bg-canvas'
const HEAD = 'border-b border-line px-24 py-16 text-s16 font-normal'
const BODY = 'overflow-y-auto p-24 text-s13h leading-l155 text-muted'
const FOOT = 'flex justify-end gap-8 px-24 pt-12 pb-24'

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  busy,
  disabled,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message?: ReactNode
  confirmLabel?: string
  busy?: boolean
  disabled?: boolean
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP} />
        <AlertDialog.Viewport className={VIEWPORT}>
          <AlertDialog.Popup aria-label={title} className={BOX}>
            <div className={HEAD}>{title}</div>
            <div className={BODY}>{message}</div>
            <div className={FOOT}>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" disabled={busy || disabled} onClick={onConfirm}>
                {busy ? 'Working.' : confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

/** General dialog shell. `footer` holds the buttons (right aligned, 8px apart); `width` overrides the 420px. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width,
  ariaLabel,
  closeOnEscape = true,
  flush,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  width?: number | string
  ariaLabel?: string
  closeOnEscape?: boolean
  /** No body padding and no scroll of its own: the content lays itself out in the full height (a workbench like Business Studio). */
  flush?: boolean
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return
        if (!closeOnEscape && details.reason === 'escape-key') return
        onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Viewport className={VIEWPORT}>
          <Dialog.Popup aria-label={ariaLabel || title} className={cx(BOX)} style={width ? { width } : undefined}>
            {title && <div className={HEAD}>{title}</div>}
            <div className={flush ? 'flex min-h-0 flex-1 flex-col text-s13h text-ink' : BODY}>{children}</div>
            {footer && <div className={FOOT}>{footer}</div>}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Acknowledge-only message. */
export function InfoDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel = 'Close',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  confirmLabel?: string
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {confirmLabel}
        </Button>
      }
    >
      {children}
    </Modal>
  )
}
