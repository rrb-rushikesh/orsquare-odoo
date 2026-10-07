import { useEffect, useMemo, useRef, useState } from 'react'
import { todayKey, useDayTick } from '@/lib/clock'
import { dayKeyOfValue, dayKeyShift } from '@/lib/utils'
import { Btn } from './Button'
import { cx } from '@/lib/cx'

export type DateMode = 'all' | 'today' | 'custom'

export interface DateRangeState {
  mode: DateMode
  from: string | null
  to: string | null
}

export const pad2 = (n: number) => String(n).padStart(2, '0')
export const calKey = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`

export const ddisplay = (k: string | null | undefined): string => {
  if (!k) return ''
  const d = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
  return isNaN(d.getTime()) ? k : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * Standardized Date Range Hook.
 *
 * Per-section date range state + effective [from, to] day keys.
 * `all` → no bounds · `today` → [todayKey, todayKey] · `custom` → the selected single date or range [from, to].
 *
 * `todayKeyOverride` lets a register that buckets rows by BUSINESS date (e.g.
 * sales history, whose rows carry the server's `business_date`) anchor "Today"
 * on the shop's current business date instead of the calendar date.
 */
export function useDateRange(initialMode: DateMode = 'all', todayKeyOverride?: string): [
  DateRangeState,
  (s: DateRangeState | ((prev: DateRangeState) => DateRangeState)) => void,
  { from: string | null; to: string | null },
] {
  const [st, setSt] = useState<DateRangeState>({ mode: initialMode, from: null, to: null })
  const eff = useMemo(() => {
    if (st.mode === 'today') {
      const k = todayKeyOverride || todayKey()
      return { from: k, to: k }
    }
    if (st.mode === 'custom') {
      if (!st.from && !st.to) return { from: null, to: null }
      if (st.from && !st.to) return { from: st.from, to: st.from }
      if (!st.from && st.to) return { from: st.to, to: st.to }
      if (st.from && st.to && st.from > st.to) return { from: st.to, to: st.from }
      return { from: st.from, to: st.to }
    }
    return { from: null, to: null }
  }, [st, todayKeyOverride])
  return [st, setSt, eff]
}

/** Day-keyed range test: NEVER compare raw ISO strings (AGENTS.md rule). */
export function dateRowMatches(iso: string, from: string | null, to: string | null): boolean {
  if (!from && !to) return true
  const k = dayKeyOfValue(iso)
  if (!k) return false
  if (from && k < from) return false
  if (to && k > to) return false
  return true
}

/** Compact month-grid date picker popover. */
function parseAnchor(str: string | null | undefined): { y: number; m: number } {
  if (!str) {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() }
  }
  const parts = str.split(/[-/]/).map(Number)
  if (parts.length >= 3) {
    if (parts[0] >= 1000 && parts[0] <= 9999) {
      return { y: parts[0], m: Math.max(0, Math.min(11, (parts[1] || 1) - 1)) }
    }
    if (parts[2] >= 1000 && parts[2] <= 9999) {
      return { y: parts[2], m: Math.max(0, Math.min(11, (parts[1] || 1) - 1)) }
    }
  }
  const now = new Date()
  return { y: now.getFullYear(), m: now.getMonth() }
}

export function MiniCalendar({
  from,
  to,
  onPick,
  onClose,
  onPreset,
  onClear,
  todayKey: todayAnchor,
}: {
  from: string | null
  to: string | null
  onPick: (day: string) => void
  onClose?: () => void
  onPreset?: (range: { from: string; to: string }) => void
  onClear?: () => void
  todayKey?: string
}) {
  const today = useDayTick()
  const [view, setView] = useState(() => parseAnchor(from ?? todayAnchor ?? today))

  useEffect(() => {
    if (from) {
      setView(parseAnchor(from))
    }
  }, [from])

  const days = new Date(view.y, view.m + 1, 0).getDate()
  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7
  const inRange = (k: string) => !!(from && to && k >= from && k <= to)

  const applyPreset = (preset: 'today' | 'yesterday' | '7days' | 'month') => {
    const t = todayAnchor || todayKey()
    if (preset === 'today') {
      onPreset?.({ from: t, to: t })
    } else if (preset === 'yesterday') {
      const y = dayKeyShift(t, -1)
      onPreset?.({ from: y, to: y })
    } else if (preset === '7days') {
      const seven = dayKeyShift(t, -6)
      onPreset?.({ from: seven, to: t })
    } else if (preset === 'month') {
      const startOfMonth = `${t.slice(0, 7)}-01`
      onPreset?.({ from: startOfMonth, to: t })
    }
  }

  return (
    <div className="cf-cal" role="dialog" aria-label="Pick a date or date range">
      <div className="cf-cal-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Btn sm variant="ghost" aria-label="Previous month" onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { ...v, m: v.m - 1 }))}>←</Btn>
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {new Date(view.y, view.m, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
          </span>
          <Btn sm variant="ghost" aria-label="Next month" onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { ...v, m: v.m + 1 }))}>→</Btn>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {onClear && (from || to) && (
            <button type="button" className="cf-cal-clear-btn" onClick={onClear} title="Clear selected dates">
              Clear
            </button>
          )}
          {onClose && (
            <Btn sm variant="ghost" aria-label="Close calendar" onClick={onClose} style={{ padding: '2px 6px' }}>
              ✕
            </Btn>
          )}
        </div>
      </div>
      {onPreset && (
        <div className="cf-cal-presets">
          <button type="button" className="cf-cal-preset-btn" onClick={() => applyPreset('today')}>Today</button>
          <button type="button" className="cf-cal-preset-btn" onClick={() => applyPreset('yesterday')}>Yesterday</button>
          <button type="button" className="cf-cal-preset-btn" onClick={() => applyPreset('7days')}>Last 7d</button>
          <button type="button" className="cf-cal-preset-btn" onClick={() => applyPreset('month')}>This month</button>
        </div>
      )}
      <div className="cal-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
          <div key={w} className="cal-wd">{w}</div>
        ))}
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`lead-${i}`} className="cal-cell cal-empty" />
        ))}
        {Array.from({ length: days }, (_, i) => i + 1).map((day) => {
          const k = calKey(view.y, view.m, day)
          const sel = k === from || k === to
          const rng = inRange(k)
          return (
            <button
              key={k}
              type="button"
              className={cx('cal-cell', sel && 'sel', rng && 'rng', k === today && 'today')}
              onClick={() => onPick(k)}
              title={k}
            >
              {day}
            </button>
          )
        })}
      </div>
      <div className="cf-cal-foot">
        <span className="t-caption">
          {from ? (to && to !== from ? `${ddisplay(from)} – ${ddisplay(to)}` : ddisplay(from)) : 'Click date for single · 2nd for range'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {onClear && (from || to) && (
            <Btn sm variant="ghost" onClick={onClear}>Clear date</Btn>
          )}
          {onClose && (
            <Btn sm variant="primary" onClick={onClose}>Done</Btn>
          )}
        </div>
      </div>
    </div>
  )
}

const DATE_MODES: { v: DateMode; label: string }[] = [
  { v: 'all', label: 'All time' },
  { v: 'today', label: 'Today' },
  { v: 'custom', label: 'Custom date' },
]

export function DateRangeFilter({
  state,
  onChange,
  className = '',
  todayKeyOverride,
  align = 'left',
}: {
  state: DateRangeState
  onChange: (s: DateRangeState | ((prev: DateRangeState) => DateRangeState)) => void
  className?: string
  todayKeyOverride?: string
  align?: 'left' | 'right'
}) {
  const [calOpen, setCalOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!calOpen) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setCalOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [calOpen])

  const customLabel = useMemo(() => {
    if (state.from) {
      if (!state.to || state.from === state.to) {
        return ddisplay(state.from)
      }
      return `${ddisplay(state.from)}–${ddisplay(state.to)}`
    }
    return 'Custom date'
  }, [state.from, state.to])

  const handleClear = () => {
    onChange({ mode: 'all', from: null, to: null })
    setCalOpen(false)
  }

  return (
    <div className={cx('cf-date-wrap', align === 'right' && 'align-right', className)} ref={wrapRef}>
      <div className="seg" role="group" aria-label="Filter by date">
        {DATE_MODES.map((m) => (
          <button
            key={m.v}
            type="button"
            className={cx('seg-btn', state.mode === m.v && 'active')}
            onClick={() => {
              if (m.v === 'custom') {
                if (state.mode !== 'custom') {
                  const t = todayKeyOverride || todayKey()
                  onChange({ mode: 'custom', from: state.from || t, to: state.to || t })
                }
                setCalOpen((o) => (state.mode === 'custom' ? !o : true))
              } else {
                onChange({ mode: m.v, from: null, to: null })
                setCalOpen(false)
              }
            }}
          >
            {m.v === 'custom' ? customLabel : m.label}
          </button>
        ))}
      </div>
      {calOpen && state.mode === 'custom' && (
        <MiniCalendar
          from={state.from}
          to={state.to}
          onClose={() => setCalOpen(false)}
          onClear={handleClear}
          todayKey={todayKeyOverride}
          onPreset={(r) => {
            onChange({ mode: 'custom', from: r.from, to: r.to })
            setCalOpen(false)
          }}
          onPick={(k) => {
            onChange((cur) => {
              if (!cur || !cur.from || (cur.from && cur.to && cur.from !== cur.to) || (cur.from === k)) {
                return { mode: 'custom', from: k, to: k }
              }
              return k < cur.from
                ? { mode: 'custom', from: k, to: cur.from }
                : { mode: 'custom', from: cur.from, to: k }
            })
          }}
        />
      )}
    </div>
  )
}
