import { type CSSProperties, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { IconSearch } from '@/components/icons'
import { cx } from '@/lib/cx'

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  onClear?: () => void
}

/**
 * Standardized Search Box for toolbars and page headers.
 *
 * Reserves 36px on the left for the 15px search icon.
 * Features an optional clear button (✕) when a query is active.
 * Flexible width (min-width 200px, flex 1 1 240px, max-width 480px).
 */
export function SearchField({
  value,
  onChange,
  onClear,
  placeholder = 'Search…',
  className = '',
  style,
  ...rest
}: SearchFieldProps) {
  const hasValue = value != null && String(value).length > 0

  return (
    <div
      className={cx('toolbar-grow search-box', className)}
      style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 480, ...style }}
    >
      <IconSearch size={15} className="search-glyph" />
      <input
        type="search"
        autoComplete="off"
        className="field-control"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        style={{ width: '100%', height: 38 }}
        {...rest}
      />
      {hasValue && onClear && (
        <button
          type="button"
          className="search-clear"
          onClick={onClear}
          aria-label="Clear search"
          title="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  )
}

export type ToolbarSelectWidth = 'sm' | 'md' | 'lg' | 'auto'

const SELECT_WIDTH_CLASS: Record<ToolbarSelectWidth, string> = {
  sm: 'tb-select-sm', // 140px
  md: 'tb-select-md', // 160px
  lg: 'tb-select-lg', // 170px
  auto: '',
}

const SELECT_WIDTH_STYLE: Record<ToolbarSelectWidth, CSSProperties | undefined> = {
  sm: { width: 140, minWidth: 140, maxWidth: 140, flex: '0 0 auto' },
  md: { width: 160, minWidth: 160, maxWidth: 160, flex: '0 0 auto' },
  lg: { width: 170, minWidth: 170, maxWidth: 170, flex: '0 0 auto' },
  auto: { width: 'auto', flex: '0 0 auto' },
}

export interface ToolbarSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  width?: ToolbarSelectWidth
}

/**
 * Standardized Toolbar Select for filter, sort, or scope dropdowns.
 *
 * Ensures all selects align to the same --ctl-h (38px) height as SearchField and Button,
 * with standard option width tiers ('sm': 140px, 'md': 160px, 'lg': 170px).
 * Strictly prevents full-width stretch in flex toolbars.
 */
export function ToolbarSelect({
  width = 'md',
  className = '',
  style,
  children,
  ...rest
}: ToolbarSelectProps) {
  const wClass = SELECT_WIDTH_CLASS[width] || ''
  const wStyle = SELECT_WIDTH_STYLE[width]

  return (
    <select
      className={cx('field-control tb-select', wClass, className)}
      style={{ ...wStyle, ...style }}
      {...rest}
    >
      {children}
    </select>
  )
}
