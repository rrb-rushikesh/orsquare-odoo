import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconX } from '@/components/icons'

/**
 * Renders overlay content (drawers, dialogs) into `document.body` so that no
 * ancestor stacking context, CSS transform, filter, or `overflow: hidden`
 * container can clip or trap it. This is the architectural guarantee that a
 * dialog always paints above the application chrome it was opened from.
 */
function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

/** Module-level count so nested overlays lock the page body exactly once. */
let scrollLockCount = 0

/**
 * Locks background page scrolling while an overlay is open. Safe with several
 * overlays stacked: the lock is released only when the last one closes.
 */
function useScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return
    scrollLockCount += 1
    if (scrollLockCount === 1) document.body.style.overflow = 'hidden'
    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1)
      if (scrollLockCount === 0) document.body.style.overflow = ''
    }
  }, [open])
}

/**
 * Decimal-safe numeric input with strict Carbon tabular numerals formatting.
 */
export function NumInput({
  value,
  onChange,
  className = '',
  allowNegative = false,
  style,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'inputMode'> & {
  value: number
  onChange: (n: number) => void
  allowNegative?: boolean
}) {
  const [txt, setTxt] = useState<string>(() => (value ? String(value) : ''))
  const emitted = useRef(value)

  useEffect(() => {
    if (value !== emitted.current) {
      setTxt(value ? String(value) : '')
      emitted.current = value
    }
  }, [value])

  const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/

  const numStyle: CSSProperties = {
    fontVariantNumeric: 'tabular-nums',
    ...style,
  }

  return (
    <input
      {...rest}
      style={numStyle}
      className={`num ${className}`.trim()}
      inputMode="decimal"
      autoComplete="off"
      value={txt}
      onChange={(e) => {
        const v = e.target.value
        if (v !== '' && v !== '-' && !pattern.test(v)) return
        setTxt(v)
        const n = parseFloat(v)
        const out = v === '' || v === '-' || !Number.isFinite(n) ? 0 : n
        emitted.current = out
        onChange(out)
      }}
    />
  )
}

/**
 * Flat 0px geometry Carbon Button.
 */
export function Btn({
  variant = 'ghost',
  sm,
  block,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger'
  sm?: boolean
  block?: boolean
}) {
  const cls = ['btn', `btn-${variant}`, sm ? 'btn-sm' : '', block ? 'btn-block' : '', className]
    .filter(Boolean)
    .join(' ')
  return <button {...rest} className={cls} />
}

export type TagTone =
  | 'neutral'
  | 'blue'
  | 'green'
  | 'red'
  | 'amber'
  | 'info'
  | 'ok'
  | 'err'
  | 'warn'
  | 'gray'
  | 'purple'
  | 'yellow'

/**
 * Carbon Semantic Tag badge with 0px geometry and standard color tokens.
 */
export function Tag({
  tone = 'neutral',
  kind,
  children,
  className = '',
  title,
}: {
  tone?: TagTone
  kind?: TagTone | string
  children: ReactNode
  className?: string
  title?: string
}) {
  const chosen = kind || tone
  return (
    <span className={`tag tag-${chosen} ${className}`.trim()} title={title}>
      {children}
    </span>
  )
}

/**
 * Form Field wrapper with Carbon label and error messaging.
 */
export function Field({
  label,
  hint,
  help,
  error,
  required,
  children,
}: {
  label?: string
  hint?: string
  help?: string
  error?: string
  required?: boolean
  children: ReactNode
}) {
  const textHint = hint || help
  return (
    <div className="field">
      {label && (
        <label className="field-label">
          {label}
          {required && <span style={{ color: 'var(--err)', marginLeft: 4 }}>*</span>}
        </label>
      )}
      {children}
      {textHint && <span className="field-hint">{textHint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  )
}

/**
 * 0px Flat Surface Panel.
 */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  bodyPad,
  className = '',
}: {
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  bodyPad?: boolean
  className?: string
}) {
  return (
    <div className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <div className="panel-head">
          {title && (
            <div>
              <span className="panel-title">{title}</span>
              {subtitle && <div className="t-caption" style={{ marginTop: 2 }}>{subtitle}</div>}
            </div>
          )}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className={bodyPad ? 'panel-body' : ''}>{children}</div>
    </div>
  )
}

/**
 * Carbon Empty State container with 0px geometry.
 */
export function EmptyState({
  title,
  hint,
  action,
  icon,
  className = '',
}: {
  title: string
  hint?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={`empty ${className}`.trim()}>
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div style={{ marginTop: '12px' }}>{action}</div>}
    </div>
  )
}

/**
 * Slide-over Drawer with 0px geometry, escape handling, and hairline border.
 */
export function Drawer({
  open,
  onClose,
  title,
  wide,
  xwide,
  className = '',
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  wide?: boolean
  xwide?: boolean
  className?: string
  footer?: ReactNode
  children: ReactNode
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!open) return null
  return (
    <Portal>
      <div className="overlay" onClick={onClose} />
      <div
        className={`drawer ${wide ? 'drawer-wide' : ''} ${xwide ? 'drawer-xwide' : ''} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="drawer-head">
          <span className="drawer-title">{title}</span>
          <button className="drawer-close" onClick={onClose} aria-label="Close drawer">
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </Portal>
  )
}

/**
 * Metric summary tile with tabular numerals and 0px flat geometry.
 */
export function Tile({
  label,
  value,
  sub,
  note,
  tone = 'neutral',
  className = '',
  onClick,
  ariaLabel,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  note?: string
  tone?: 'neutral' | 'blue' | 'green' | 'red' | 'amber'
  className?: string
  /** Makes the tile a drill-down: metrics must not be dead-end numbers. */
  onClick?: () => void
  ariaLabel?: string
}) {
  const subtitle = sub || note
  const body = (
    <>
      <div className="tile-body">
        <div className="tile-label" title={label}>{label}</div>
        {subtitle && <div className="tile-note" title={subtitle}>{subtitle}</div>}
      </div>
      <div className="tile-value num">{value}</div>
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        className={`tile tile-${tone} tile-action ${className}`.trim()}
        onClick={onClick}
        aria-label={ariaLabel || `${label}: open the underlying records`}
      >
        {body}
      </button>
    )
  }
  return <div className={`tile tile-${tone} ${className}`.trim()}>{body}</div>
}

/**
 * Confirmation dialog with 0px geometry, 0 shadows, and escape listener.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  busy,
  disabled,
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message?: ReactNode
  confirmLabel?: string
  busy?: boolean
  disabled?: boolean
  children?: ReactNode
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <Portal>
      <div
        className="modal-wrap"
        role="alertdialog"
        aria-modal
        aria-label={title}
        onClick={onClose}
      >
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">{title}</div>
          <div className="modal-body">{children ?? message}</div>
          <div className="modal-foot">
            <Btn variant="secondary" onClick={onClose}>
              Cancel
            </Btn>
            <Btn variant="danger" disabled={busy || disabled} onClick={onConfirm}>
              {busy ? 'Working.' : confirmLabel}
            </Btn>
          </div>
        </div>
      </div>
    </Portal>
  )
}

/**
 * Type-to-confirm destructive dialog. The confirm button stays disabled until
 * the operator types the expected value; Escape closes the dialog.
 */
export function TypeConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  expected,
  busy,
  confirmLabel,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  expected: string
  busy?: boolean
  confirmLabel?: string
}) {
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (open) setTyped('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const isMatched = typed.trim().toUpperCase() === expected.trim().toUpperCase()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      ariaLabel={title}
      closeOnEscape={false}
      className="typed-confirm"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose} style={{ borderRadius: 0, height: 38 }}>
            Cancel
          </Btn>
          <Btn
            variant="danger"
            disabled={busy || !isMatched}
            onClick={onConfirm}
            style={{ borderRadius: 0, height: 38 }}
          >
            {busy ? 'Working…' : (confirmLabel || 'Permanently Archive')}
          </Btn>
        </>
      }
    >
      <div style={{ fontSize: 13.5, color: 'var(--ink, #161616)', lineHeight: 1.5 }}>{message}</div>
      <div style={{ fontSize: 13, color: 'var(--muted, #525252)' }}>
        Type <strong style={{ color: 'var(--ink, #161616)', fontFamily: 'var(--font-mono)' }}>{expected}</strong> to confirm.
      </div>
      <input
        className="field-control"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={expected}
        autoComplete="off"
        autoFocus
        style={{
          borderRadius: 0,
          height: 42,
          fontSize: 14,
          fontFamily: 'var(--font-mono)',
          background: 'var(--layer, #f4f4f4)',
          borderBottom: '1px solid var(--subtle, #8d8d8d)',
          width: '100%',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isMatched && !busy) {
            e.preventDefault()
            onConfirm()
          }
        }}
      />
    </Modal>
  )
}

/**
 * Information modal dialog with 0px geometry.
 */
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
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <Portal>
      <div
        className="modal-wrap"
        role="alertdialog"
        aria-modal
        aria-label={title}
        onClick={onClose}
      >
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">{title}</div>
          <div className="modal-body">{children}</div>
          <div className="modal-foot">
            <Btn variant="secondary" onClick={onClose}>
              {confirmLabel}
            </Btn>
          </div>
        </div>
      </div>
    </Portal>
  )
}

/**
 * Reusable dialog shell for bespoke modals (print prompts, shortcut sheets).
 *
 * Renders through a portal above every drawer/popover and locks background
 * scrolling, so ad-hoc dialogs inherit the same stacking + viewport guarantees
 * as ConfirmDialog/InfoDialog instead of re-implementing them inline.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width,
  className = '',
  ariaLabel,
  closeOnEscape = true,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  width?: number | string
  className?: string
  ariaLabel?: string
  closeOnEscape?: boolean
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useScrollLock(open)

  useEffect(() => {
    if (!open || !closeOnEscape) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeOnEscape])

  if (!open) return null
  return (
    <Portal>
      <div
        className="modal-wrap"
        role="dialog"
        aria-modal
        aria-label={ariaLabel || title}
        onClick={onClose}
      >
        <div
          className={`modal ${className}`.trim()}
          style={width ? { width } : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {title && <div className="modal-head">{title}</div>}
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </Portal>
  )
}

export type ToastKind = 'ok' | 'err' | 'success' | 'info' | 'error' | 'warn'
type ToastItem = { id: number; msg: string; kind: 'ok' | 'err' | 'info' | 'warn' }

export interface ToastFn {
  (msg: string, kind?: ToastKind): void
  show: (msg: string, kind?: ToastKind) => void
}

const ToastCtx = createContext<ToastFn>(
  Object.assign(
    (_msg: string, _kind?: ToastKind) => {},
    { show: (_msg: string, _kind?: ToastKind) => {} }
  )
)

let toastSeq = 0

/**
 * Carbon Notification Toast Provider.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const show = useCallback((msg: string, kind: ToastKind = 'ok') => {
    const id = ++toastSeq
    let normKind: 'ok' | 'err' | 'info' | 'warn' = 'ok'
    if (kind === 'err' || kind === 'error') normKind = 'err'
    else if (kind === 'info') normKind = 'info'
    else if (kind === 'warn') normKind = 'warn'
    setItems((ts) => [...ts.slice(-3), { id, msg, kind: normKind }])
  }, [])

  useEffect(() => {
    if (!items.length) return
    const t = setTimeout(() => setItems((ts) => ts.slice(1)), 3500)
    return () => clearTimeout(t)
  }, [items])

  const toastApi: ToastFn = useMemo(() => {
    const fn = (msg: string, kind: ToastKind = 'ok') => show(msg, kind)
    fn.show = (msg: string, kind: ToastKind = 'ok') => show(msg, kind)
    return fn
  }, [show])

  return (
    <ToastCtx.Provider value={toastApi}>
      {children}
      {items.length > 0 && (
        <div className="toast-stack">
          {items.map((t) => (
            <div
              key={t.id}
              className={`toast ${t.kind === 'err' ? 'err' : ''}`}
              role={t.kind === 'err' ? 'alert' : 'status'}
            >
              {t.kind === 'ok' ? <IconCheck size={14} /> : <IconX size={14} />}
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

/**
 * Multi-step Progress Stepper adhering to IBM Carbon 0px geometry.
 */
export function Stepper({
  steps,
  currentStep,
  onStepClick,
}: {
  steps: { id: string; label: string; sub?: string }[]
  currentStep: number // 0-indexed
  onStepClick?: (stepIndex: number) => void
}) {
  return (
    <div className="stepper" role="tablist" aria-label="Progress steps">
      {steps.map((s, idx) => {
        const isActive = idx === currentStep
        const isPast = idx < currentStep
        const clickable = isPast && !!onStepClick
        return (
          <button
            key={s.id}
            type="button"
            className={`stepper-item ${isActive ? 'active' : ''} ${isPast ? 'completed' : ''}`}
            onClick={() => clickable && onStepClick?.(idx)}
            disabled={!clickable}
            role="tab"
            aria-selected={isActive}
            style={{ cursor: clickable ? 'pointer' : 'default', background: 'transparent', border: 0, padding: 'inherit' }}
          >
            <div className="stepper-badge num">{isPast ? '✓' : idx + 1}</div>
            <div className="stepper-text">
              <span className="stepper-label">{s.label}</span>
              {s.sub && <span className="stepper-sub">{s.sub}</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Linear Progress Bar with 0px geometry.
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = true,
  className = '',
}: {
  value: number
  max?: number
  label?: string
  showValue?: boolean
  className?: string
}) {
  const pct = Math.min(100, Math.max(0, Math.round((value / max) * 100)))
  return (
    <div className={`progress-container ${className}`.trim()}>
      {(label || showValue) && (
        <div className="progress-header">
          {label && <span className="progress-label">{label}</span>}
          {showValue && <span className="progress-pct num">{pct}%</span>}
        </div>
      )}
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function NoAccess({ what }: { what?: string }) {
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">No access</h1>
        <p className="page-sub">
          This section is not part of your staff permissions{what ? ` (${what})` : ''}.
        </p>
      </div>
      <Panel bodyPad>
        <EmptyState
          title="Restricted area"
          hint="Ask the shop owner to update your access in Settings."
        />
      </Panel>
    </>
  )
}

/**
 * Paginated Table Controller.
 */
export function Pager({
  page,
  pages,
  onPage,
}: {
  page: number
  pages: number
  onPage: (p: number) => void
}) {
  if (pages <= 1) return null
  const nums: number[] = []
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i)
  return (
    <div className="pager" role="navigation" aria-label="Pagination">
      <button
        className="page-btn"
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
        aria-label="Previous page"
      >
        {'<'}
      </button>
      {nums[0] !== 1 && (
        <>
          <button className="page-btn" onClick={() => onPage(1)}>
            1
          </button>
          {nums[0] > 2 && <span className="t-caption">…</span>}
        </>
      )}
      {nums.map((n) => (
        <button
          key={n}
          className={`page-btn ${n === page ? 'on' : ''}`}
          onClick={() => onPage(n)}
          aria-current={n === page ? 'page' : undefined}
        >
          {n}
        </button>
      ))}
      {nums[nums.length - 1] !== pages && (
        <>
          {nums[nums.length - 1] < pages - 1 && <span className="t-caption">…</span>}
          <button className="page-btn" onClick={() => onPage(pages)}>
            {pages}
          </button>
        </>
      )}
      <button
        className="page-btn"
        disabled={page === pages}
        onClick={() => onPage(page + 1)}
        aria-label="Next page"
      >
        {'>'}
      </button>
    </div>
  )
}

export function PageSizePicker({
  value,
  onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="page-size">
      <span className="t-caption">Rows</span>
      <select
        className="field-control"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Rows per page"
      >
        {[10, 20, 50].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  )
}

export function usePaged<T>(
  items: T[],
  pageSize: number
): {
  slice: T[]
  page: number
  setPage: (p: number) => void
  pages: number
  count: number
} {
  const [page, setPage] = useState(1)
  const count = items.length
  const pages = Math.max(1, Math.ceil(count / pageSize))
  useEffect(() => {
    if (page > pages) setPage(pages)
  }, [page, pages])
  const safePage = Math.min(page, pages)
  const slice = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  )
  return { slice, page: safePage, setPage, pages, count }
}
