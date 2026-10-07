import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '@/lib/cx'

/*
 * MENUS - a small popover list of actions (user menu) or suggestions (typeahead results).
 *
 *   const menu = useMenu()
 *   <div ref={menu.ref} className="relative">
 *     <button onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open}>...</button>
 *     {menu.open && (
 *       <MenuPopover placement="above-end" className="min-w-264">
 *         <MenuItem icon={<IconGear />} onClick={...}>Settings</MenuItem>
 *         <MenuSeparator />
 *         <MenuItem danger>Sign out</MenuItem>
 *       </MenuPopover>
 *     )}
 *   </div>
 *
 * `useMenu` closes on outside press and Escape (call `close()` after an action / route change).
 * Use a menu for 2-6 actions that do not deserve a toolbar slot; use `ToolbarSelect` to pick a filter value.
 */
export function useMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const toggle = useCallback(() => setOpen((v) => !v), [])
  const close = useCallback(() => setOpen(false), [])
  return { open, toggle, close, ref }
}

const PLACEMENT = {
  /** Under the anchor, right edges aligned (default). */
  'below-end': 'top-[calc(100%+6px)] right-0',
  /** Under the anchor, left edges aligned - pickers that open from a control at the start of a row. */
  'below-start': 'top-[calc(100%+6px)] left-0',
  /** Above the anchor, right edges aligned - menus anchored in a bottom bar. */
  'above-end': 'bottom-[calc(100%+6px)] right-0',
  /** Under a text field, as wide as the field - typeahead suggestions. */
  'below-fill': 'top-46 right-0 left-0',
} as const

export function MenuPopover({
  placement = 'below-end',
  className,
  children,
}: {
  placement?: keyof typeof PLACEMENT
  className?: string
  children: ReactNode
}) {
  return (
    <div role="menu" className={cx('absolute z-(--z-popover) min-w-200 border border-line bg-canvas p-6', PLACEMENT[placement], className)}>
      {children}
    </div>
  )
}

export function MenuItem({
  icon,
  danger,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      {...rest}
      className={cx(
        'flex w-full cursor-pointer items-center gap-10 border-0 bg-transparent px-10 py-9 text-left text-s13 hover:bg-layer',
        danger ? 'text-err' : 'text-ink',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export const MenuSeparator = () => <div role="separator" className="my-6 h-1 bg-line" />
