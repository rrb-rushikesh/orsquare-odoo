import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { resolveColumnWidth } from './columnWidths'
import './register-grid.css'

/**
 * Enterprise IBM Carbon register grid for retail sheets and stock matrices.
 *
 * Supports:
 * - Explicit, uncompressed column widths (no clipping of large currency / quantity figures).
 * - Sticky frozen left columns (pinned brand column with clean separator border).
 * - Multi-level grouped / nested headers with row-span and col-span.
 * - Sticky top header and sticky bottom summary footer.
 * - Accordion drawer sub-components (variant breakdowns, extra sizes).
 * - Full row selection and cell click interactions.
 */
export interface GridColumn<T = any> {
  key: string
  title: ReactNode
  /** Header text, used only for width measurement (ReactNode titles are not measured). */
  headerText?: string
  /** Authored width in px. Ignored when `autoSize` is on. */
  width?: number
  /** Digits this column normally holds. Drives the width baseline (§3.2). */
  typicalDigits?: number
  /** Floor, for columns whose real content is not a plain data value. */
  minWidth?: number
  /** Cap for the measured width, so one outlier cannot dominate the layout. */
  maxWidth?: number
  align?: 'left' | 'right' | 'center'
  render?: (value: any, row: T) => ReactNode
  divider?: boolean
}

export interface NestedHeader {
  title: ReactNode
  colspan: number
}

export interface RegisterGridProps<T = any> {
  columns: GridColumn<T>[]
  data: T[]
  /** Grouped header rows above the column-title row (one array per row). */
  nestedHeaders?: NestedHeader[][]
  /** One or more footer rows, aligned to the columns by index. */
  footers?: (string | number)[][]
  /** Number of columns pinned to the left edge during horizontal scroll. */
  freezeColumns?: number
  /** Scale every column to fill container with no horizontal scroll (not recommended for 10+ cols). */
  fitWidth?: boolean
  onCellClick?: (colKey: string, row: T) => void
  rowKey?: (row: T, index: number) => string
  /** Move existing keyed rows smoothly and briefly mark increased sold counts. */
  animateChanges?: boolean
  animationScope?: string
  soldCount?: (row: T) => number
  /** Per-row increase shown as a floating "+N" ticker, keyed by row key. */
  saleTicks?: Record<string, number>
  /** Bump to re-trigger a ticker whose value is unchanged (e.g. +1 then +1). */
  tickVersion?: number
  /** Render function for expandable accordion drawers beneath a row. */
  renderDrawer?: (row: T) => ReactNode
  /** Predicate determining whether the drawer for this row is currently expanded. */
  isDrawerOpen?: (row: T) => boolean
  /** Size columns from their declared digit baseline, widened by real content. */
  autoSize?: boolean
  empty?: ReactNode
  ariaLabel?: string
  className?: string
}

/** Fixed header row height in px; sticky offsets are derived from it. */
const HEADER_ROW_H = 28

function alignClass(align?: GridColumn['align']): string {
  if (align === 'right') return 'num'
  if (align === 'center') return 'rg-center'
  return ''
}

export function RegisterGrid<T = any>({
  columns,
  data,
  nestedHeaders,
  footers,
  freezeColumns = 0,
  fitWidth = false,
  onCellClick,
  rowKey,
  animateChanges = false,
  animationScope = '',
  soldCount,
  saleTicks,
  tickVersion = 0,
  renderDrawer,
  isDrawerOpen,
  autoSize = true,
  empty,
  ariaLabel = 'Data grid',
  className = '',
}: RegisterGridProps<T>) {
  const [selectedRow, setSelectedRow] = useState<string | number | null>(null)
  const [selectedCol, setSelectedCol] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const previous = useRef(new Map<string, { top: number; sold: number }>())
  const previousScope = useRef(animationScope)
  const frame = useRef<number | null>(null)

  /**
   * Drawer enter/exit. A `<tr>` cannot be height-animated, so the row stays
   * mounted through the close and is unmounted only after the transition has
   * actually run — otherwise closing is an instant disappearance, which is what
   * made the interaction feel abrupt.
   */
  const [closingKeys, setClosingKeys] = useState<string[]>([])
  const [mountedKeys, setMountedKeys] = useState<string[]>([])

  // A stable signature of which rows are open, so the effect below runs only on
  // a real open/close and not on every re-render.
  const openSignature = useMemo(
    () => data
      .map((row, i) => (renderDrawer && isDrawerOpen?.(row) ? String(rowKey ? rowKey(row, i) : i) : null))
      .filter((k): k is string => !!k)
      .join('|'),
    [data, renderDrawer, isDrawerOpen, rowKey],
  )
  const openKeys = useMemo(
    () => new Set(openSignature ? openSignature.split('|') : []),
    [openSignature],
  )
  const openKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const next = openKeys
    const justClosed = [...openKeysRef.current].filter((k) => !next.has(k))
    openKeysRef.current = next
    setMountedKeys((cur) => [...new Set([...cur, ...next])])
    if (!justClosed.length) return
    setClosingKeys((cur) => [...new Set([...cur, ...justClosed])])
    const timer = window.setTimeout(() => {
      setClosingKeys((cur) => cur.filter((k) => !justClosed.includes(k)))
      setMountedKeys((cur) => cur.filter((k) => !justClosed.includes(k)))
    }, 280)
    return () => window.clearTimeout(timer)
  }, [openKeys])

  /**
   * Column widths: declared digit baseline, widened to fit the widest real
   * value in the column, capped so a single outlier cannot dominate. Measured
   * from the data (deterministic, no layout thrash) rather than from the DOM.
   */
  const widths = useMemo(() => {
    if (!autoSize) {
      return columns.map((c) => ({ ...c, px: c.width || 100 }))
    }
    return columns.map((c) => {
      const values = data.map((row) => (row as any)[c.key])
      return {
        ...c,
        px: resolveColumnWidth({
          typical: (c.typicalDigits ?? 3) as any,
          header: c.headerText,
          values,
          min: c.minWidth,
          max: c.maxWidth,
        }),
      }
    })
  }, [columns, data, autoSize])

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    const old = previousScope.current === animationScope ? previous.current : new Map()
    const next = new Map<string, { top: number; sold: number }>()
    const moving: HTMLElement[] = []
    const prefersLessMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const elements = new Map(Array.from(body.querySelectorAll<HTMLTableRowElement>('tr[data-grid-key]'))
      .map((element) => [element.dataset.gridKey, element]))
    const drawers = new Map(Array.from(body.querySelectorAll<HTMLTableRowElement>('tr[data-grid-drawer-key]'))
      .map((element) => [element.dataset.gridDrawerKey, element]))
    for (const [index, row] of data.entries()) {
      const key = String(rowKey ? rowKey(row, index) : index)
      const element = elements.get(key)
      if (!element) continue
      const top = element.offsetTop
      const sold = soldCount?.(row) ?? 0
      next.set(key, { top, sold })
      const prior = old.get(key)
      if (!animateChanges || prefersLessMotion || !prior) continue
      const distance = prior.top - top
      if (Math.abs(distance) > 1 && Math.abs(distance) < window.innerHeight * 2) {
        for (const movingRow of [element, drawers.get(key)].filter((item): item is HTMLTableRowElement => !!item)) {
          movingRow.style.transition = 'none'
          movingRow.style.transform = `translateY(${distance}px)`
          moving.push(movingRow)
        }
      }
      if (sold > prior.sold) {
        element.classList.remove('rg-sale-pulse')
        void element.offsetWidth
        element.classList.add('rg-sale-pulse')
      }
    }
    previous.current = next
    previousScope.current = animationScope
    frame.current = requestAnimationFrame(() => {
      for (const element of moving) {
        element.style.transition = 'transform 550ms ease-out'
        element.style.transform = ''
      }
      frame.current = null
    })
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [data, rowKey, soldCount, animateChanges, animationScope])

  const leftOffsets = useMemo(() => {
    const offsets: number[] = []
    let acc = 0
    for (let i = 0; i < widths.length; i++) {
      offsets.push(acc)
      acc += widths[i].px
    }
    return offsets
  }, [widths])

  const totalPx = useMemo(() => widths.reduce((sum, c) => sum + c.px, 0), [widths])

  const headerRows = nestedHeaders?.length ?? 0

  // Columns already covered by a row-spanning single-column group cell, so the
  // column-title row must not render a duplicate header for them.
  const covered = useMemo(() => {
    const set = new Set<number>()
    if (!nestedHeaders?.length) return set
    let cursor = 0
    for (const group of nestedHeaders[0]) {
      if (group.colspan === 1) set.add(cursor)
      cursor += group.colspan
    }
    return set
  }, [nestedHeaders])

  const frozen = (index: number) => index < freezeColumns
  const isFreezeEdge = (index: number) => index === freezeColumns - 1

  const cellClass = (index: number, align?: GridColumn['align']) =>
    [
      alignClass(align),
      frozen(index) ? 'rg-freeze' : '',
      isFreezeEdge(index) ? 'rg-freeze-edge' : '',
      columns[index]?.divider ? 'rg-col-divider' : '',
    ]
      .filter(Boolean)
      .join(' ')

  if (data.length === 0) {
    return (
      <div className={`rg-wrap ${className}`.trim()} role="region" aria-label={ariaLabel}>
        {empty ?? <div className="rg-empty">No rows to display.</div>}
      </div>
    )
  }

  return (
    <div className={`rg-wrap ${className}`.trim()} role="region" aria-label={ariaLabel}>
      <table
        className="rg-table"
        style={
          fitWidth
            ? { width: '100%', minWidth: `${totalPx}px`, tableLayout: 'fixed' }
            : { width: 'max-content', minWidth: `${totalPx}px`, tableLayout: 'auto' }
        }
      >
        <colgroup>
          {widths.map((c, i) => (
            <col
              key={c.key}
              style={{
                width: fitWidth && i === 0 ? 'auto' : `${c.px}px`,
                minWidth: i === 0 ? `${c.px}px` : `${c.px}px`,
                maxWidth: fitWidth && i > 0 ? `${c.px}px` : undefined,
              }}
            />
          ))}
        </colgroup>

        <thead>
          {nestedHeaders?.map((row, r) => (
            <tr key={`group-${r}`}>
              {row.map((group, gi) => {
                const isFirstCol = gi === 0 && frozen(0)
                const isRowSpan = group.colspan === 1 && r === 0
                return isRowSpan ? (
                  <th
                    key={`g-${gi}`}
                    rowSpan={headerRows + 1}
                    className={`rg-th rg-group ${isFirstCol ? 'rg-freeze rg-freeze-edge' : ''}`.trim()}
                    style={{
                      top: r * HEADER_ROW_H,
                      left: isFirstCol ? 0 : undefined,
                      width: isFirstCol ? (fitWidth ? 'auto' : `${widths[0]?.px || 220}px`) : undefined,
                      minWidth: isFirstCol ? `${widths[0]?.px || 220}px` : undefined,
                    }}
                  >
                    {group.title}
                  </th>
                ) : (
                  <th
                    key={`g-${gi}`}
                    colSpan={group.colspan}
                    className="rg-th rg-group"
                    style={{ top: r * HEADER_ROW_H }}
                  >
                    {group.title}
                  </th>
                )
              })}
            </tr>
          ))}
          <tr>
            {widths.map((c, i) =>
              covered.has(i) ? null : (
                <th
                  key={c.key}
                  className={`rg-th rg-col ${cellClass(i, c.align)}`.trim()}
                  style={{
                    top: headerRows * HEADER_ROW_H,
                    left: frozen(i) ? `${leftOffsets[i]}px` : undefined,
                    width: i > 0 ? `${c.px}px` : undefined,
                    minWidth: i === 0 ? `${c.px}px` : `${c.px}px`,
                  }}
                  data-col={c.key}
                >
                  {c.title}
                </th>
              )
            )}
          </tr>
        </thead>

        <tbody ref={bodyRef}>
          {data.map((row, ri) => {
            const key = rowKey ? rowKey(row, ri) : ri
            const isSelected = selectedRow === key
            const showDrawer = Boolean(renderDrawer && isDrawerOpen && isDrawerOpen(row))
            const keyStr = String(key)
            const isClosing = showDrawer ? false : closingKeys.includes(keyStr)
            const keepMounted = showDrawer || isClosing || mountedKeys.includes(keyStr)
            const tick = saleTicks?.[keyStr]
            // The key changes with the value so a repeated "+1" re-runs the
            // animation instead of being swallowed by a same-value element.
            const tickId = tick ? `${tick}:${tickVersion}` : ''

            return (
              <Fragment key={key}>
                <tr
                  data-grid-key={String(key)}
                  className={[
                    isSelected ? 'rg-row-sel' : '',
                    showDrawer ? 'rg-row-expanded' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {widths.map((c, i) => {
                    const isActiveCell = isSelected && selectedCol === c.key
                    return (
                      <td
                        key={c.key}
                        className={`rg-cell ${cellClass(i, c.align)}${isActiveCell ? ' rg-cell-active' : ''}`.trim()}
                        style={{
                          left: frozen(i) ? `${leftOffsets[i]}px` : undefined,
                          width: i > 0 ? `${c.px}px` : undefined,
                          minWidth: i === 0 ? `${c.px}px` : `${c.px}px`,
                        }}
                        data-col={c.key}
                        data-row={ri}
                        onClick={() => {
                          setSelectedRow(isSelected && selectedCol === c.key ? null : key)
                          setSelectedCol(isSelected && selectedCol === c.key ? null : c.key)
                          onCellClick?.(c.key, row)
                        }}
                      >
                        {c.render ? c.render((row as any)[c.key], row) : String((row as any)[c.key] ?? '')}
                        {/* The ticker belongs to the product, not to the
                            selection, so it always anchors to the first
                            (label) cell of the affected row. */}
                        {i === 0 && tick ? (
                          <span className="rg-sale-tick" key={tickId} aria-hidden="true">+{tick}</span>
                        ) : null}
                      </td>
                    )
                  })}
                </tr>

                {keepMounted && renderDrawer && (
                  <tr
                    key={`${key}-drawer`}
                    data-grid-drawer-key={keyStr}
                    className={`rg-drawer-row${showDrawer ? ' open' : ' closing'}`}
                  >
                    <td colSpan={widths.length} className="rg-drawer-cell">
                      <div className="rg-drawer-scroll">{renderDrawer(row)}</div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>

        {footers && footers.length > 0 && (
          <tfoot>
            {footers.map((row, fi) => (
              <tr key={`foot-${fi}`} className="rg-foot-row">
                {widths.map((c, i) => (
                  <td
                    key={c.key}
                    className={`rg-foot ${cellClass(i, c.align)}`.trim()}
                    style={{
                      left: frozen(i) ? `${leftOffsets[i]}px` : undefined,
                      width: i > 0 ? `${c.px}px` : undefined,
                      minWidth: i === 0 ? `${c.px}px` : `${c.px}px`,
                    }}
                    data-col={c.key}
                  >
                    {row[i] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  )
}

export default RegisterGrid
