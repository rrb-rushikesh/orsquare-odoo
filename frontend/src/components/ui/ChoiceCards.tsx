import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'

export interface ChoiceCard<T extends string> {
  value: T
  title: string
  /** Large line under the title (a price, a length). */
  headline?: ReactNode
  note?: ReactNode
}

/**
 * A small set of mutually exclusive choices shown as cards, each with a headline and a note (subscription plans). It is a radio group:
 * arrow keys move, the selected card has a blue frame. Use `Segmented` for a switch between views and `Select` for a long list.
 */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  label,
  invalid,
}: {
  value: T | ''
  onChange: (v: T) => void
  options: ChoiceCard<T>[]
  label: string
  invalid?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('grid gap-8 narrow:grid-cols-1', invalid && 'outline outline-2 outline-offset-2 outline-err')}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative flex cursor-pointer flex-col items-start gap-2 border bg-canvas px-12 py-10 text-left',
              on ? 'border-2 border-blue bg-layer-accent px-11 py-9' : 'border-line hover:border-blue',
            )}
          >
            <span className={cx('absolute top-10 right-10 size-14 rounded-full border bg-canvas', on ? 'border-blue' : 'border-line-strong')}>
              {on && <span className="absolute inset-3 rounded-full bg-blue" />}
            </span>
            <span className="text-s13 font-semibold">{o.title}</span>
            {o.headline && <span className="text-s18 leading-tight">{o.headline}</span>}
            {o.note && <span className="text-s12 text-muted">{o.note}</span>}
          </button>
        )
      })}
    </div>
  )
}
