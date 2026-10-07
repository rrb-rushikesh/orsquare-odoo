import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import * as repo from '@/lib/repo'
import type { PDayStatus, PSnapshot } from '@/lib/repo'
import { dayKeyOfValue, formatDate, money, num0, tm } from '@/lib/utils'
import { saleBusinessDayKey } from '@/lib/businessDay'
import { useCurrentBusinessDate } from '@/lib/businessDay'
import { now, dayKeyOf, todayKey, APP_TIMEZONE } from '@/lib/clock'
import { ClosingStockSection } from '@/components/ClosingStockSection'
import { ClosingStockAuditPanel } from '@/components/ClosingStockAuditPanel'
import { NoAccess, Btn, EmptyState, Field, NumInput, Panel, Tag, useToast } from '@/components/ui'
import { DataTable, type DTCol } from '@/components/DataTable'

type DayStatus = 'not-started' | 'open' | 'closed'

interface RecentRow {
  dateKey: string
  day: string
  opened: string
  closed: string
  openingCash: number
  closingCash: number | null
  notes: string
  status: 'Open' | 'Closed'
}

const dayLabel = (id: string): string => {
  const tKey = todayKey()
  if (id === tKey) return 'Today'
  const yKey = dayKeyOf(now() - 86400000)
  if (id === yKey) return 'Yesterday'
  return formatDate(id)
}

const iso = (v?: string | null): number => (v ? Date.parse(v) || 0 : 0)
const tms = (v?: string | null): string => (iso(v) ? tm(iso(v)) : '—')

function DayBookPage() {
  const { wsUid, isOwner, seesMoney, activeShop } = useAuth()
  const shopId = wsUid
  const d = useData()
  const toast = useToast()

  const [status, setStatus] = useState<PDayStatus | null>(null)
  const [snaps, setSnaps] = useState<PSnapshot[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [closingReady, setClosingReady] = useState(false)
  const todayKey = useCurrentBusinessDate(activeShop?.lockInTime)
  const state: DayStatus = status ? (status.isClosed ? 'closed' : status.isOpen ? 'open' : 'not-started') : 'not-started'
  /**
   * The Closing Stock Audit is the step that happens *after* the seal: the
   * cashier closes on the drawer count, walks the shop against the printed
   * closing stock, and only then knows whether the day reconciles. It is offered
   * only once the day is actually closed and a drawer count was entered — the two
   * preconditions the audit itself checks. Offering it earlier would show an
   * operator an audit of a day that has not happened yet.
   */
  const [auditOpen, setAuditOpen] = useState(false)
  const auditAvailable = state === 'closed' && status?.closingCash != null

  const [openingCash, setOpeningCash] = useState(0)
  const [closingCash, setClosingCash] = useState(0)
  const [note, setNote] = useState('')
  const [entry, setEntry] = useState('')

  async function refresh() {
    try {
      const [s, snaps] = await Promise.all([repo.dayStatus(shopId, todayKey), repo.listSnapshots(shopId)])
      setStatus(s)
      setSnaps(snaps)
      setLoadFailed(false)
    } catch (err) {
      console.error('[daybook] load failed:', err)
      setLoadFailed(true)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, todayKey])

  async function open() {
    setBusy(true)
    try {
      await repo.openDay(shopId, { opening_cash: openingCash, date_key: todayKey })
      toast(`Day opened — opening cash ${money(openingCash)}.`)
      setOpeningCash(0)
      await refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open the day.', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function close() {
    setBusy(true)
    try {
      await repo.closeDay(shopId, { date_key: todayKey, closing_cash: closingCash, closing_note: note.trim() })
      toast('Day closed. Have a good night!')
      setClosingCash(0)
      setNote('')
      await refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not close the day.', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function addNote() {
    const text = entry.trim()
    if (!text) return
    setBusy(true)
    try {
      await repo.addDayLog(shopId, { date_key: todayKey, text })
      toast('Note added to the day log.')
      setEntry('')
      await refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the note.', 'err')
    } finally {
      setBusy(false)
    }
  }

  const dayLog = useMemo(
    () => (status?.logs ?? []).slice().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [status]
  )

  const glance = useMemo(() => {
    // Bug fix (2026-08-31): list rows carry a full ISO timestamp under
    // `date`: compare the DAY KEY (or "today at a glance" was always 0).
    // Lock-in v2: prefer the server's additive `business_date` (a 2:30 AM
    // bill belongs to the PREVIOUS business date in a 3 AM-cutoff shop).
    const todaySales = d.sales.filter((s) => saleBusinessDayKey(s) === todayKey)
    const billsToday = todaySales.length
    // NOTE: list rows carry no line items, so a piece count here would just
    // count bills: the glance shows BILLS SOLD instead of pretending.
    let toCounter = 0
    let toGodown = 0
    d.transfers.forEach((t) => {
      if (dayKeyOfValue(t.date) !== todayKey) return
      if (t.from === 'godown' && t.to === 'counter') toCounter += t.qty
      else if (t.from === 'counter' && t.to === 'godown') toGodown += t.qty
    })
    const low = d.products.filter((p) => p.godownPcs + p.counterPcs <= p.lowLevel && p.lowLevel > 0)
    const lowHint = low.map((p) => p.name).join(', ')
    return { billsToday, toCounter, toGodown, low, lowHint }
  }, [d.sales, d.transfers, d.products, todayKey])

  const canClose = isOwner

  const recentDays = useMemo<RecentRow[]>(() => {
    const rows: RecentRow[] = []
    if (status && (status.isOpen || status.isClosed)) {
      rows.push({
        dateKey: status.dateKey,
        day: dayLabel(status.dateKey),
        opened: status.openedAt ? `${tms(status.openedAt)} · ${status.openedByName || 'Staff'}` : '—',
        closed: status.closedAt ? `${tms(status.closedAt)} · ${status.closedByName || 'Staff'}` : '—',
        openingCash: status.openingCash,
        closingCash: status.closingCash,
        notes: (status.logs && status.logs.length > 0) ? status.logs.map((l) => l.text).join('; ') : '—',
        status: status.isClosed ? 'Closed' : 'Open',
      })
    }
    for (const s of snaps) {
      if (status && s.dateKey === status.dateKey) continue
      rows.push({
        dateKey: s.dateKey,
        day: dayLabel(s.dateKey),
        opened: s.openedAt
          ? `${tms(s.openedAt)} · ${s.openedByName || 'Staff'}`
          : s.sealedAt
            ? `${tms(s.sealedAt)} · ${s.sealedByName || 'Staff'}`
            : '—',
        closed: s.closedAt ? `${tms(s.closedAt)} · ${s.closedByName || 'Staff'}` : '—',
        openingCash: s.openingCash ?? 0,
        closingCash: s.closingCash ?? null,
        notes: s.closingNote || '—',
        status: 'Closed',
      })
    }
    return rows.sort((a, b) => (b.dateKey ?? '').localeCompare(a.dateKey ?? ''))
  }, [status, snaps])

  const cols = useMemo<DTCol<RecentRow>[]>(
    () => [
      {
        key: 'day',
        label: 'Day',
        sortValue: (r) => r.dateKey,
        render: (r) => <span className="cell-main">{r.day}</span>,
      },
      { key: 'opened', label: 'Opened', hideMobile: true, render: (r) => <span className="num td-muted">{r.opened}</span> },
      { key: 'closed', label: 'Closed', hideMobile: true, render: (r) => <span className="num td-muted">{r.closed}</span> },
      // Opening/closing cash are money: only rendered for money-granted
      // sessions (same gate as the day sheet figures above).
      ...(seesMoney
        ? ([
            {
              key: 'opening',
              label: 'Opening ₹',
              align: 'right',
              sortValue: (r) => r.openingCash,
              render: (r) => <span className="num">{money(r.openingCash)}</span>,
            },
            {
              key: 'closing',
              label: 'Closing ₹',
              align: 'right',
              sortValue: (r) => r.closingCash ?? 0,
              render: (r) => <span className="num">{r.closingCash != null ? money(r.closingCash) : '—'}</span>,
            },
          ] as DTCol<RecentRow>[])
        : []),
      { key: 'notes', label: 'Notes', render: (r) => <span className="dbook-notes td-muted">{r.notes}</span> },
      {
        key: 'status',
        label: 'Status',
        sortValue: (r) => r.status,
        render: (r) => <Tag kind={r.status === 'Closed' ? 'blue' : 'green'}>{r.status}</Tag>,
      },
    ],
    [seesMoney]
  )

  const statusText =
    state === 'not-started' ? 'The counter hasn’t opened yet' : state === 'open' ? 'Day is open' : 'Day closed'
  const statusTone = state === 'not-started' ? 'gray' : state === 'open' ? 'green' : 'blue'

  return (
    <>
      <div className="dbook-hero">
        <div className="dbook-main">
          <span className="micro-label" style={{ letterSpacing: '0.6px', fontWeight: 600 }}>
            {new Date(now()).toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}
          </span>
          <div className="dbook-status">
            <span className={`dbook-dot ${statusTone}`} />
            <span className="dbook-title">{statusText}</span>
          </div>

          {state !== 'not-started' && status && (
            <div className="dbook-tl">
              <div className="dbook-tl-item done">
                <span className="dbook-tl-dot" />
                <div className="dbook-tl-txt">
                  <b>Opened</b> · {tms(status.openedAt)} · {status.openedByName}
                  {seesMoney && <span className="num"> — {money(status.openingCash)} in drawer</span>}
                </div>
              </div>
              <div className={`dbook-tl-item ${state === 'closed' ? 'done' : 'pending'}`}>
                <span className="dbook-tl-dot" />
                <div className="dbook-tl-txt">
                  {state === 'closed' ? (
                    <>
                      <b>Closed</b> · {tms(status.closedAt)} · {status.closedByName}
                      {seesMoney && <span className="num"> — {money(status.closingCash ?? 0)} counted</span>}
                    </>
                  ) : (
                    <b>Closing — pending</b>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="dbook-side">
          {state === 'not-started' &&
            (loadFailed ? (
              <div style={{ border: '1px solid var(--line)', borderLeft: '3px solid #da1e28', padding: '12px 14px' }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#da1e28' }}>Couldn’t load the day sheet</p>
                <p className="t-caption" style={{ margin: '4px 0 10px' }}>
                  The day’s status couldn’t be fetched, so the counter may already be open. Nothing was changed.
                </p>
                <Btn sm variant="ghost" onClick={() => refresh()}>Retry</Btn>
              </div>
            ) : (
              <>
                <span className="micro-label" style={{ letterSpacing: '0.6px', fontWeight: 600 }}>OPENING THE DAY</span>
                <Field label="Cash in drawer" help="Count the drawer and enter the amount.">
                  <NumInput value={openingCash} onChange={setOpeningCash} placeholder="0" className="field-control num" />
                </Field>
                <Btn variant="primary" block disabled={busy || openingCash < 0} onClick={open}>
                  {busy ? 'Opening…' : 'Open the day →'}
                </Btn>
              </>
            ))}

          {state === 'open' && status && (
            canClose ? (
              <>
                <span className="micro-label" style={{ letterSpacing: '0.6px', fontWeight: 600 }}>CLOSING THE DAY</span>
                <div className="dbook-fig">
                  <span className="dbook-fig-label">Expected in drawer</span>
                  <span className="dbook-fig-val num">{money(status.expectedCash)}</span>
                  <span className="t-caption">live — opening + cash in − cash out; count toward this</span>
                </div>
                <Field label="Closing cash counted">
                  <NumInput value={closingCash} onChange={setClosingCash} placeholder="0" className="field-control num" />
                </Field>
                {closingCash > 0 && status.expectedCash !== closingCash && (
                  <Tag kind={Math.abs(status.expectedCash - closingCash) <= 50 ? 'green' : Math.abs(status.expectedCash - closingCash) <= 500 ? 'warn' : 'red'}>
                    {closingCash > status.expectedCash
                      ? `Over by ${money(closingCash - status.expectedCash)}`
                      : `Short by ${money(status.expectedCash - closingCash)}`}
                  </Tag>
                )}
                <Field label="Note (optional)" help="Shortage, expense from drawer, anything unusual.">
                  <input
                    className="field-control"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. ₹50 tea from drawer"
                    maxLength={120}
                  />
                </Field>
                <Btn variant="primary" block disabled={busy || closingCash < 0 || !closingReady} onClick={close}>
                  {busy ? 'Closing…' : 'Close the day ✓'}
                </Btn>
                {!closingReady && <p className="t-caption">Complete Closing Stock counts and drawer cash below to close the day.</p>}
              </>
            ) : (
              <>
                <span className="micro-label" style={{ letterSpacing: '0.6px', fontWeight: 600 }}>CLOSING THE DAY</span>
                <p className="t-caption" style={{ margin: 0 }}>
                  Closing is owner-only. Ask the owner to close the counter tonight.
                </p>
              </>
            )
          )}

          {state === 'closed' && status && (
            <>
              <span className="micro-label" style={{ letterSpacing: '0.6px', fontWeight: 600 }}>THE DAY IN TWO NUMBERS</span>
              {seesMoney ? (
                <>
                  <div className="dbook-fig">
                    <span className="dbook-fig-label">Opening</span>
                    <span className="dbook-fig-val num">{money(status.openingCash)}</span>
                  </div>
                  <div className="dbook-fig">
                    <span className="dbook-fig-label">Closing</span>
                    <span className="dbook-fig-val num">{money(status.closingCash ?? 0)}</span>
                  </div>
                  {status.variance != null && (
                    <div className="kv-row" style={{ marginTop: 6 }}>
                      <span className="kv-key">Difference</span>
                      <Tag kind={Math.abs(status.variance) <= 50 ? 'green' : Math.abs(status.variance) <= 500 ? 'warn' : 'red'}>
                        {status.variance === 0 ? 'Tallied ✓' : `${status.variance > 0 ? 'Over' : 'Short'} ${money(Math.abs(status.variance))}`}
                      </Tag>
                    </div>
                  )}
                </>
              ) : (
                <p className="t-caption" style={{ margin: 0 }}>
                  Cash figures are visible to the owner and accounts with the money grant.
                </p>
              )}
              <p className="t-caption" style={{ margin: 0 }}>
                Closed {tms(status.closedAt)} by {status.closedByName}. The next day opens fresh.
              </p>
            </>
          )}
        </div>
      </div>

      <Panel title="Today at a glance" actions={<span className="t-caption">counts only — money stays in Reports</span>}>
        <div className="glance-grid">
          <div className="glance-tile">
            <span className="glance-label">BILLS RAISED</span>
            <span className="glance-val num">{num0(glance.billsToday)}</span>
          </div>
          <div className="glance-tile">
            <span className="glance-label">BILLS SOLD</span>
            <span className="glance-val num">{num0(glance.billsToday)}</span>
          </div>
          <div className="glance-tile">
            <span className="glance-label">STOCK TO COUNTER</span>
            <span className="glance-val num">{num0(glance.toCounter)} <span className="t-caption" style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>pcs</span></span>
          </div>
          <div className="glance-tile">
            <span className="glance-label">STOCK BACK TO GODOWN</span>
            <span className="glance-val num">{num0(glance.toGodown)} <span className="t-caption" style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>pcs</span></span>
          </div>
          <div className="glance-tile">
            <span className="glance-label">LOW STOCK</span>
            <span className="glance-val num">{num0(glance.low.length)}</span>
            {glance.low.length > 0 && (
              <span className="glance-hint" title={glance.lowHint}>
                {glance.lowHint}
              </span>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Day notes" actions={<span className="t-caption">{num0(dayLog.length)} note{dayLog.length === 1 ? '' : 's'}</span>}>
        <div className="dlog-add">
          <input
            className="field-control"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addNote()
            }}
            placeholder="Jot a note — stock moved, a glitch, something the next shift should know…"
            maxLength={160}
          />
          <Btn sm variant="primary" disabled={busy || !entry.trim()} onClick={addNote}>
            Add
          </Btn>
        </div>
        {dayLog.length === 0 ? (
          <EmptyState
            icon={<span style={{ fontSize: 16, fontWeight: 300, color: 'var(--subtle)' }}>✕</span>}
            title="No notes yet"
            hint="Notes are free text that live on this day's sheet — nothing about money, just the shift."
          />
        ) : (
          <div className="dlog-list">
            {dayLog.map((e, i) => (
              <div className="dlog-row" key={`${e.id}-${i}`}>
                <span className="dlog-time num">{tms(e.createdAt)}</span>
                <span className="dlog-txt">{e.text}</span>
                <span className="dlog-by">{e.byName}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <ClosingStockSection shopId={shopId} dateKey={todayKey} isOpen={state === 'open'} onCashSaved={setClosingCash} onChanged={refresh} onReady={setClosingReady} />

      <Panel title="Closing Stock Audit" actions={
        auditOpen
          ? <Btn sm variant="ghost" onClick={() => setAuditOpen(false)}>Hide</Btn>
          : <Btn sm disabled={!auditAvailable} onClick={() => setAuditOpen(true)}>Run the audit</Btn>
      }>
        {!auditOpen && (auditAvailable
          ? <p className="t-caption">
            This day is closed and its drawer was counted. Print the closing stock from the
            Sheet, walk the shop, then run the audit to reconcile what you found against what
            the day recorded. Nothing is posted without your confirmation.
          </p>
          : <p className="t-caption">
            {state !== 'closed'
              ? 'Available once the day is closed. Close the day above first.'
              : 'Available once a drawer count has been entered for the day.'}
          </p>)}
        {auditOpen && auditAvailable && (
          <ClosingStockAuditPanel shopId={shopId} dateKey={todayKey} onChanged={refresh} />
        )}
      </Panel>

      <Panel title="Recent days" actions={<span className="t-caption">{num0(recentDays.length)} recorded</span>}>
        {!loaded ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : recentDays.length === 0 ? (
          <EmptyState title="No days closed yet" hint="Close the day above — every closed day is kept here with its Z-report." />
        ) : (
          <DataTable
            cols={cols}
            rows={recentDays}
            index={false}
            defaultSort={{ key: 'day', dir: 'desc' }}
          />
        )}
      </Panel>

      <p className="t-caption" style={{ marginTop: 10 }}>
        This page is staff-safe by design — drawer cash and notes, never sales totals or profit. Those live in Reports.
      </p>
    </>
  )
}

export default function DayBookPageGuarded() {
  const { can } = useAuth()
  if (!can('daybook')) return <NoAccess what="Day book" />
  return <DayBookPage />
}
