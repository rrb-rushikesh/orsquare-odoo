import { useMemo, useState, useDeferredValue, type CSSProperties, type RefObject } from 'react'
import { searchGeneric } from '@/lib/search'
import { IconSearch } from './icons'

export interface BillFinderRow {
  id: string
  /** Bill number, e.g. INV-0123, the primary recognisable key. */
  billNo: string
  /** Customer or supplier display name. */
  title: string
  /** Pre-formatted time or date string. */
  when: string
  /** Pre-formatted bill total. */
  amount: string
}

/**
 * Searchable "find the original bill" list shared by Sales and Purchase
 * returns. Recognition over recall: the most recent bills are listed to
 * tap directly; typing narrows the same list by bill number or name.
 */
export function BillFinder({
  rows,
  loading,
  onPick,
  searchPlaceholder,
  emptyHint,
  inputRef,
  maxHeight = 280,
}: {
  rows: BillFinderRow[]
  loading?: boolean
  onPick: (id: string) => void
  searchPlaceholder: string
  emptyHint?: string
  inputRef?: RefObject<HTMLInputElement | null>
  maxHeight?: number
}) {
  const [q, setQ] = useState('')
  const deferredQ = useDeferredValue(q)

  const visible = useMemo(() => {
    const needle = deferredQ.trim()
    if (!needle) return rows.slice(0, 60)
    return searchGeneric(
      rows,
      needle,
      [
        { get: (r) => r.billNo, weight: 2.5, isCode: true },
        { get: (r) => r.title, weight: 1.5 },
      ],
      { limit: 60 }
    )
  }, [rows, deferredQ])

  const listStyle: CSSProperties = {
    marginTop: 8,
    border: '1px solid var(--line)',
    maxHeight,
    overflowY: 'auto',
    background: 'var(--canvas)',
  }
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    minHeight: 44,
    padding: '8px 12px',
    background: 'var(--canvas)',
    border: 0,
    borderBottom: '1px solid var(--line)',
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
  }

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="field-control"
          style={{ height: 44, paddingLeft: 38 }}
          value={q}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && visible.length > 0) {
              e.preventDefault()
              onPick(visible[0].id)
            }
          }}
        />
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--subtle)', display: 'inline-flex' }}>
          <IconSearch size={16} />
        </span>
      </div>
      <div className="t-caption" style={{ marginTop: 6 }}>
        {loading
          ? 'Loading bills…'
          : q.trim()
            ? `${visible.length} of ${rows.length} bill${rows.length === 1 ? '' : 's'} match. Enter picks the first one`
            : `Showing ${visible.length} of ${rows.length} recent bill${rows.length === 1 ? '' : 's'}. Tap one, or type to search`}
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyRow>{emptyHint ?? 'No bills found yet.'}</EmptyRow>
      ) : !loading && visible.length === 0 ? (
        <EmptyRow>
          No bill matches “{q.trim()}”. Check the spelling, or find older bills under the History tab.
        </EmptyRow>
      ) : (
        <div style={listStyle}>
          {visible.map((r) => (
            <button key={r.id} type="button" style={rowStyle} onClick={() => onPick(r.id)}>
              <span className="mono-tag" style={{ fontWeight: 600, fontSize: 13 }}>{r.billNo}</span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{r.title}</span>
                <span className="t-caption num">{r.when}</span>
              </span>
              <span className="num" style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13.5 }}>{r.amount}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 8,
        border: '1px solid var(--line)',
        background: 'var(--layer)',
        padding: '16px 12px',
        fontSize: 13.5,
        color: 'var(--muted)',
      }}
    >
      {children}
    </div>
  )
}
