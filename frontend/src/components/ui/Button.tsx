import type { ButtonHTMLAttributes } from 'react'
import { cva, cx, type VariantProps } from '@/lib/cx'

/**
 * Square, flat button. Geometry comes from the control-size standard
 * (styles/controls.css, docs/UI_STANDARDS.md): full-size controls are `--ctl-h`
 * high (44px comfortable / 34px compact), inline controls `--ctl-h-sm` (32px).
 *
 *   md    h-ctl, 0 18px (0 12px compact)           default
 *   sm    h-ctl-sm (32px), 0 12px, 13px            inline / dense actions
 *   icon  ctl-h x ctl-h SQUARE, no padding         icon-only (use <IconButton>)
 *
 * Icon + text: put the icon first inside the button; the button's own 8px gap
 * spaces it (never add margins to the icon).
 *
 * `toolbar` marks buttons placed in a panel header toolbar: weight 500 and the
 * bordered "ghost" look (a ghost button outside a toolbar is borderless link-blue).
 */
const button = cva(
  [
    'btn inline-flex items-center justify-center gap-8 border py-0 tracking-body',
    'cursor-pointer whitespace-nowrap transition-[background] duration-80 ease-[ease-out]',
    'disabled:opacity-50 disabled:cursor-default',
  ],
  {
    variants: {
      variant: {
        primary: 'btn-primary bg-blue border-blue text-white enabled:hover:bg-blue-hover enabled:active:bg-blue-active',
        secondary:
          'btn-secondary bg-btn-secondary border-btn-secondary text-btn-secondary-fg enabled:hover:bg-btn-secondary-hover enabled:hover:border-btn-secondary-hover',
        danger: 'btn-danger bg-err border-err text-white enabled:hover:bg-[#b82025]',
        tertiary: 'btn-tertiary bg-canvas border-blue text-blue enabled:hover:bg-layer-accent',
        ghost: 'btn-ghost',
      },
      size: {
        md: 'h-ctl px-18 text-s14 compact:px-12 compact:text-s13',
        sm: 'btn-sm h-ctl-sm px-12 text-s13',
        icon: 'btn-icon size-ctl shrink-0 p-0 text-s14 compact:text-s13 [&_svg]:shrink-0',
      },
      toolbar: { true: 'btn-toolbar shrink-0 font-medium', false: '' },
    },
    compoundVariants: [
      { variant: 'ghost', toolbar: false, class: 'bg-transparent border-transparent text-blue-link enabled:hover:bg-layer' },
      {
        variant: 'ghost',
        toolbar: true,
        class: [
          'bg-canvas border-line text-ink enabled:hover:bg-layer enabled:hover:text-blue enabled:hover:border-blue',
          'aria-pressed:bg-blue! aria-pressed:border-blue! aria-pressed:text-white!',
        ],
      },
    ],
    defaultVariants: { variant: 'ghost', size: 'md', toolbar: false },
  },
)

export type ButtonSize = 'md' | 'sm' | 'icon'
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'tertiary' | 'ghost'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & {
    /** Wide block button. */
    block?: boolean
    /** Busy: disables the button, sets aria-busy and shows a spinner before the label. */
    loading?: boolean
    /** Backward compatibility with legacy `sm` boolean prop */
    sm?: boolean
  }

export function Button({ variant, size, toolbar, block, loading, sm, disabled, className, children, ...rest }: ButtonProps) {
  const effectiveSize = sm ? 'sm' : size
  return (
    <button
      data-touch-target=""
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(button({ variant, size: effectiveSize, toolbar: toolbar ?? false }), block && 'w-full btn-block', loading && 'loading cursor-progress', className)}
    >
      {loading && <span className="lab-spinner" aria-hidden />}
      {children}
    </button>
  )
}

/** Backward-compatibility alias */
export const Btn = Button

export type IconButtonProps = Omit<ButtonProps, 'size' | 'block' | 'aria-label'> & {
  /** Accessible name (required: an icon has no text). Also the default tooltip. */
  label: string
  /** Tooltip text when it should differ from the label (e.g. a toggle's current state). */
  tooltip?: string
  /** Icon element to render inside */
  icon?: React.ReactNode
}

/**
 * Icon-only action: a `--ctl-h` square with a mandatory accessible name and the
 * product's CSS tooltip. Pass the icon as the child (16px: `<IconGear size={ICON.md} />`).
 */
export function IconButton({ label, tooltip, icon, children, ...rest }: IconButtonProps) {
  const tip = tooltip ?? label
  return (
    <Button {...rest} size="icon" aria-label={label} title={tip} data-tooltip={tip}>
      {!rest.loading && (icon || children)}
    </Button>
  )
}
