import { useRef, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { cx } from '@/lib/cx'

export type DrawerWidth = 'default' | 'wide' | 'xwide' | 'import'

const WIDTH: Record<DrawerWidth, string> = {
  default: 'w-[min(560px,100vw)]',
  wide: 'w-[min(880px,100vw)]',
  xwide: 'w-[min(1080px,100vw)]',
  import: 'w-[min(1600px,98vw)]',
}

/**
 * Right-anchored slide-over. Behaviour (focus trap, Escape, scroll lock, outside
 * press, aria) comes from Base UI Dialog; every visual value is the original's:
 * hairline left border, 560px (or wider), 24px gutters, no shadow.
 */
export function Drawer({
  open,
  onClose,
  title,
  width = 'default',
  footer,
  dense,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  width?: DrawerWidth
  footer?: ReactNode
  /** Tighter header, gutters and gaps (16px) for a drawer that holds a dense property panel rather than a form. */
  dense?: boolean
  children: ReactNode
}) {
  const popup = useRef<HTMLDivElement>(null)
  // Focus the field marked [data-autofocus] (the original relies on React autoFocus);
  // otherwise let Base UI pick the first tabbable element.
  const initialFocus = () => popup.current?.querySelector<HTMLElement>('[data-autofocus]') ?? true
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-(--z-overlay) animate-[lab-fade-in_140ms_ease-out] bg-[rgba(22,22,22,0.45)]" />
        <Dialog.Popup
          ref={popup}
          aria-label={title}
          aria-modal="true"
          initialFocus={initialFocus}
          className={cx(
            'fixed inset-y-0 right-0 z-(--z-drawer) flex animate-[lab-slide-in_160ms_ease-out] flex-col border-l border-line bg-canvas',
            WIDTH[width],
          )}
        >
          <div className={cx('flex items-center justify-between gap-12 border-b border-line', dense ? 'px-16 py-10' : 'px-24 py-16')}>
            <span className={cx('min-w-0 truncate font-normal', dense ? 'text-s15' : 'text-s17')}>{title}</span>
            <Dialog.Close
              aria-label="Close drawer"
              className="inline-flex size-32 cursor-pointer items-center justify-center border-0 bg-transparent text-muted hover:bg-layer hover:text-ink"
            >
              ✕
            </Dialog.Close>
          </div>
          <div className={cx('flex flex-1 flex-col overflow-y-auto', dense ? 'gap-12 p-16' : 'gap-16 p-24')}>{children}</div>
          {footer && <div className={cx('flex items-center justify-between gap-12 border-t border-line', dense ? 'px-16 py-10' : 'px-24 py-16')}>{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
