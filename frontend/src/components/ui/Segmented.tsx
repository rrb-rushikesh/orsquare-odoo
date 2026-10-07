import type { ReactNode } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  label: string
  appearance?: 'default' | 'toolbar'
  semantics?: 'tabs' | 'buttons'
  fill?: boolean
  className?: string
  renderLabel?: (option: SegmentedOption<T>) => ReactNode
}

/**
 * Standardized Segmented Control with 0px geometry.
 *
 * appearance="toolbar":
 *   Inside panel toolbars. Height is --ctl-h; active segment is solid blue with white text.
 * appearance="default":
 *   In-page view switches with bottom blue indicator.
 *
 * semantics="tabs": role="tablist", aria-selected
 * semantics="buttons": role="group", aria-pressed
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  appearance = 'toolbar',
  semantics = 'buttons',
  fill = false,
  className = '',
  renderLabel,
}: SegmentedProps<T>) {
  const isToolbar = appearance === 'toolbar'
  const isTabs = semantics === 'tabs'

  return (
    <div
      className={`seg ${isToolbar ? 'seg-toolbar' : 'seg-inline'} ${fill ? 'seg-fill' : ''} ${className}`.trim()}
      role={isTabs ? 'tablist' : 'group'}
      aria-label={label}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role={isTabs ? 'tab' : undefined}
            aria-selected={isTabs ? active : undefined}
            aria-pressed={isTabs ? undefined : active}
            data-touch-target=""
            className={`seg-btn ${active ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {renderLabel ? renderLabel(opt) : opt.label}
          </button>
        )
      })}
    </div>
  )
}
