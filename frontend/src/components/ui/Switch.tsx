import { cx } from '@/lib/cx'

/**
 * On/off switch for a setting that applies immediately (feature flags, preferences, "link customer").
 * A square track with a square knob - not a checkbox (checkboxes are for choices submitted with a form: `Choice`).
 *
 *   size="md"  42x22 (Settings lists)      size="sm"  32x18 (inline inside a panel header)
 *
 * `label` is required: it is the accessible name ("Toggle Continuous Scanning"). Show the on/off state in words
 * next to it (a `Tag` ON/OFF) when the surrounding row does, as Settings does.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  size = 'md',
  disabled,
  title,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  label: string
  size?: 'md' | 'sm'
  disabled?: boolean
  title?: string
}) {
  const sm = size === 'sm'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cx(
        'relative shrink-0 cursor-pointer border transition-[background,border-color] duration-100 ease-[ease-out]',
        sm ? 'h-18 w-32' : 'h-22 w-42',
        checked ? 'border-blue bg-blue' : 'border-line-strong bg-canvas',
      )}
    >
      <span
        className={cx(
          'absolute top-2 left-2 transition-[transform,background] duration-120 ease-[ease-out]',
          sm ? 'size-12' : 'size-16',
          checked ? 'bg-white' : 'bg-subtle',
          checked && (sm ? '[transform:translateX(14px)]' : '[transform:translateX(20px)]'),
        )}
      />
    </button>
  )
}
