import { useMemo, useState, type ReactNode } from 'react'
import { EmptyState, PageSizePicker, Pager, usePaged } from '@/components/ui'

/**
 * Standardized data table with sortable headers, optional # index column,
 * smooth horizontal scrolling, and pagination footer.
 */
export interface DTCol<T> {
  key: string
  label: ReactNode
  align?: 'left' | 'right' | 'center'
  /** Value used when sorting this column; defaults to the rendered text. */
  sortValue?: (row: T) => string | number
  render: (row: T) => ReactNode
  /** Custom header renderer overriding default button/label */
  headerRender?: () => ReactNode
  /** Kept for backward compatibility with existing column declarations. */
  hideMobile?: boolean
  mobile?: { label?: string; primary?: boolean }
}

export type SortDir = 'asc' | 'desc'

export function DataTable<T>({
  cols,
  rows,
  index = true,
  pageSize = 20,
  defaultSort,
  onRowClick,
  rowKey,
  ariaLabel,
  empty,
  className = '',
  manualSort = false,
}: {
  cols: DTCol<T>[]
  rows: T[]
  index?: boolean
  pageSize?: number
  defaultSort?: { key: string; dir: SortDir }
  onRowClick?: (row: T) => void
  /** Stable React key extractor: keeps row identity across sort/page/filter
   *  changes. Defaults to the row index when the row type has no natural id. */
  rowKey?: (row: T) => string
  ariaLabel?: string
  empty?: ReactNode
  className?: string
  manualSort?: boolean
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(defaultSort ?? null)
  const [size, setSize] = useState(pageSize)

  const sorted = useMemo(() => {
    if (manualSort || !sort) return rows
    const col = cols.find((c) => c.key === sort.key)
    if (!col) return rows
    const get = col.sortValue
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = get ? get(a) : String(a)
      const vb = get ? get(b) : String(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir
    })
  }, [rows, sort, cols, manualSort])

  const { slice, page, setPage, pages, count } = usePaged(sorted, size)

  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )

  const changeSize = (n: number) => {
    setSize(n)
    setPage(1)
  }

  if (rows.length === 0) {
    return empty ?? <EmptyState title="No records" hint="Nothing matches the current view." />
  }

  const from = (page - 1) * size + 1
  const to = Math.min(page * size, count)

  return (
    <div className={`dt ${className}`.trim()}>
      <div className="dt-table-wrap">
        <div className="tbl-scroll">
          <table className="tbl" aria-label={ariaLabel}>
            <thead>
              <tr>
                {index && <th className="dt-idx">#</th>}
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className={`${c.align === 'right' ? 'td-right' : c.align === 'center' ? 'td-center' : ''} ${c.sortValue ? 'dt-sortable' : ''} ${sort?.key === c.key ? `dt-sorted ${sort.dir}` : ''}`}
                  >
                    {c.headerRender ? (
                      c.headerRender()
                    ) : c.sortValue ? (
                      <button type="button" className="dt-sort-btn" onClick={() => toggleSort(c.key)} aria-label={typeof c.label === 'string' ? `Sort by ${c.label}` : 'Sort column'}>
                        <span>{c.label}</span>
                        <span className="dt-sort-ico" aria-hidden>{sort?.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row) : i}
                  className={onRowClick ? 'clickable' : ''}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                >
                  {index && <td className="dt-idx td-muted num">{(page - 1) * size + i + 1}</td>}
                  {cols.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'td-right' : c.align === 'center' ? 'td-center' : ''}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-foot">
        <span className="table-count">
          Showing {from}–{to} of {count}
        </span>
        <PageSizePicker value={size} onChange={changeSize} />
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
    </div>
  )
}
