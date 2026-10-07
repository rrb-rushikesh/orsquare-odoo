import { IconMinus, IconPlus } from '@/components/icons'
import { IconButton } from './Button'
import { ICON } from './tokens'

/**
 * Whole-number stepper: a minus, the number, a plus. The number can also be typed. `min` is a floor the caller computes (the cashier
 * limit cannot go below the accounts that already exist); the control just refuses to cross it.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  /** Accessible name of the quantity ("Cashier accounts allowed"). */
  label: string
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))
  return (
    <div className="inline-flex items-stretch border border-line-strong">
      <IconButton label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
        <IconMinus size={ICON.lg} />
      </IconButton>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(clamp(parseInt(e.target.value.replace(/\D/g, ''), 10)))}
        className="h-ctl w-48 border-x border-line bg-canvas text-center text-s14 font-semibold tabular-nums outline-none focus:bg-layer-accent"
      />
      <IconButton label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
        <IconPlus size={ICON.lg} />
      </IconButton>
    </div>
  )
}
