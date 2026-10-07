import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'sm' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Inside panel header toolbars: weight 500 and hairline border on ghost */
  toolbar?: boolean
  /** Block button: width 100% */
  block?: boolean
  /** Busy indicator: disabled, aria-busy, and shows a spinner */
  loading?: boolean
  /** Backward compatibility with legacy `sm` boolean prop */
  sm?: boolean
}

/**
 * Standardized Carbon Button with 0px radius geometry.
 *
 * md: height --ctl-h (40px)
 * sm: height --ctl-h-sm (32px)
 * icon: square (--ctl-h x --ctl-h, or 32x32 for sm)
 */
export function Button({
  variant = 'ghost',
  size = 'md',
  toolbar = false,
  block = false,
  loading = false,
  sm = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const effectiveSize = sm ? 'sm' : size
  const cls = [
    'btn',
    `btn-${variant}`,
    effectiveSize === 'sm' ? 'btn-sm' : '',
    effectiveSize === 'icon' ? 'btn-icon' : '',
    toolbar ? 'btn-toolbar' : '',
    block ? 'btn-block' : '',
    loading ? 'loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-touch-target=""
      className={cls}
    >
      {loading && <span className="lab-spinner" aria-hidden />}
      {children}
    </button>
  )
}

/** Backward-compatibility alias for existing code */
export const Btn = Button

export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'block'> {
  /** Accessible label (required for screen readers and tooltips) */
  label: string
  /** Tooltip text (defaults to label) */
  tooltip?: string
  /** Icon element to render inside */
  icon?: ReactNode
  /** Size of the icon button ('md' = 40px square, 'sm' = 32px square) */
  size?: 'md' | 'sm' | 'icon'
}

/**
 * Standardized Icon-Only Action Button.
 *
 * Always rendered as a square matching adjacent inputs and buttons.
 * Accessible name (aria-label) and tooltip are guaranteed.
 */
export function IconButton({
  label,
  tooltip,
  icon,
  children,
  className = '',
  size = 'md',
  ...rest
}: IconButtonProps) {
  const tip = tooltip || label
  return (
    <Button
      {...rest}
      size="icon"
      className={`${size === 'sm' ? 'btn-icon-sm' : ''} ${className}`.trim()}
      aria-label={label}
      title={tip}
      data-tooltip={tip}
    >
      {!rest.loading && (icon || children)}
    </Button>
  )
}
