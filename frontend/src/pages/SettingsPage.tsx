import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import * as repo from '@/lib/repo'
import type { PBusinessDayInfo, PEmployee, PFeatureCatalogEntry, PFeatureState, ShopClosingSettings } from '@/lib/repo'
import { call, ApiError } from '@/lib/api'
async function restoreUnavailable(_file: File): Promise<{ products?: number; customers?: number; suppliers?: number; sales?: number; days?: number }> {
  throw new ApiError('File restore is not available yet.', 'not_available')
}
import { SURFACE_SHEET } from '@/lib/experience'
import {
  applyPrefs,
  loadPrefs,
  savePrefs,
  defaultPrefs,
  clampSeatingHeight,
  clampSeatingTile,
  SEATING_TILE_MIN,
  SEATING_TILE_MAX,
  SEATING_HEIGHT_MIN,
  SEATING_HEIGHT_MAX,
} from '@/lib/prefs'
import type {
  DefaultPayMethod,
  FontFamily,
  FontSize,
  Prefs,
  PrintMode,
  Theme,
  SeatingArrangement,
  SeatingPos,
  SeatingSize,
} from '@/lib/prefs'
import type { ReceiptData } from '@/lib/receipt'
import PrintingPanel, { ReceiptPreview } from '@/components/PrintingPanel'
import { buildTestSheet, type TestKind } from '@/lib/printing/testSheets'
import { beginPrint, outcomeMessage } from '@/lib/printing/service'
import type { PrintSettings } from '@/lib/printing/presets'
import { fuzzyMatch } from '@/lib/search'
import { now as nowClock } from '@/lib/clock'
import { currentBusinessDateKey, timeToMinutes, labelDayKey } from '@/lib/businessDay'
import { normalizeTablesConfig, tableId, tableLabels } from '@/lib/tables'
import type { TablePattern, TablesConfig } from '@/types'
import { money } from '@/lib/utils'
import { pullCatalogDelta, flushOfflineSalesQueue, listQueueForReview, retryQueuedSale, discardQueuedSale, getOfflineCacheStats, purgeCatalogCache, type QueueInspectionRow } from '@/lib/sync'
import { Btn, ConfirmDialog, Drawer, EmptyState, Field, NoAccess, Panel, Tag, useToast } from '@/components/ui'
import {
  IconGear,
  IconLayers,
  IconPOS,
  IconUsers,
  IconCal,
  IconTrash,
  IconRefresh,
  IconCash,
  IconQrCode,
  IconCreditLedger,
  IconPrinter,
  IconMessageSquare,
  IconPaperless,
  IconCheck,
  IconArrowRight,
  IconAlertTriangle,
  IconDatabase,
} from '@/components/icons'

type SettingsTab = 'appearance' | 'billing' | 'features' | 'tables' | 'team' | 'shops' | 'management'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  employee: 'Employee',
}

const ROLE_TONE: Record<string, 'blue' | 'green' | 'gray' | 'purple'> = {
  owner: 'purple',
  employee: 'blue',
}

/** Server-delivered grantable-tab registry (GRANTABLE_TABS). Used to render
 *  the per-employee tab checkbox group when the session payload omits it. */
const FALLBACK_TABS: { key: string; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'sales', label: 'Sales' },
  { key: 'stock', label: 'Stock' },
  { key: 'products', label: 'Products' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'cashflow', label: 'Cash Flow' },
  { key: 'daybook', label: 'Day Book' },
  { key: 'reports', label: 'Calendar & analytics' },
  { key: 'settings', label: 'Settings' },
]

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={`seg-btn ${value === o.v ? 'active' : ''}`}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function GridSizeEditor({
  rows,
  cols,
  onApply,
}: {
  rows: number
  cols: number
  onApply: (rows: number, cols: number) => void
}) {
  // Two creation modes: direct counts (with steppers), or a row/column RANGE
  // (e.g. rows 1–4, columns 1–6 => a 4x6 floor). The inputs keep a local draft
  // and commit on blur/Enter, so a partially typed value can never be clamped
  // mid-keystroke (the old bug: clearing the field forced "1" and the next
  // digit concatenated, so typing 6 produced 16 -> clamped 8).
  const [mode, setMode] = useState<'count' | 'range'>('count')
  const [draftRows, setDraftRows] = useState(String(rows))
  const [draftCols, setDraftCols] = useState(String(cols))
  const [range, setRange] = useState({ r1: '1', r2: String(rows), c1: '1', c2: String(cols) })

  useEffect(() => {
    setDraftRows(String(rows))
    setDraftCols(String(cols))
    setRange({ r1: '1', r2: String(rows), c1: '1', c2: String(cols) })
  }, [rows, cols])

  const clampRows = (n: number) => Math.max(1, Math.min(8, n))
  const clampCols = (n: number) => Math.max(1, Math.min(12, n))
  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 2)

  function commitCount() {
    const r = clampRows(parseInt(draftRows, 10) || rows)
    const c = clampCols(parseInt(draftCols, 10) || cols)
    setDraftRows(String(r))
    setDraftCols(String(c))
    if (r !== rows || c !== cols) onApply(r, c)
  }

  function commitRange() {
    const a = clampRows(parseInt(range.r1, 10) || 1)
    const b = clampRows(parseInt(range.r2, 10) || rows)
    const x = clampCols(parseInt(range.c1, 10) || 1)
    const y = clampCols(parseInt(range.c2, 10) || cols)
    const rr = Math.max(1, Math.abs(b - a) + 1)
    const cc = Math.max(1, Math.abs(y - x) + 1)
    setRange({ r1: String(a), r2: String(b), c1: String(x), c2: String(y) })
    if (rr !== rows || cc !== cols) onApply(rr, cc)
  }

  const numInput = (
    value: string,
    set: (v: string) => void,
    onCommit: () => void,
    ariaLabel: string,
  ) => (
    <input
      className="field-control num"
      style={{ width: 64, textAlign: 'center' }}
      inputMode="numeric"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => set(digitsOnly(e.target.value))}
      onBlur={onCommit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCommit() } }}
    />
  )

  const stepper = (
    value: number,
    apply: (n: number) => void,
    label: string,
  ) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: 34, height: 34, padding: 0 }}
        aria-label={`Decrease ${label}`}
        disabled={value <= 1}
        onClick={() => apply(value - 1)}
      >
        −
      </button>
      <span className="num" style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>{value}</span>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: 34, height: 34, padding: 0 }}
        aria-label={`Increase ${label}`}
        onClick={() => apply(value + 1)}
      >
        +
      </button>
    </div>
  )

  return (
    <div className="stack" style={{ gap: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Floor size</span>
        <Seg<'count' | 'range'>
          value={mode}
          options={[
            { v: 'count', label: 'Rows × Columns' },
            { v: 'range', label: 'Row & column range' },
          ]}
          onChange={setMode}
        />
      </div>

      {mode === 'count' ? (
        <div className="form-grid">
          <Field label="Floor rows (1–8)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {numInput(draftRows, setDraftRows, commitCount, 'Floor rows')}
              {stepper(rows, (n) => onApply(clampRows(n), cols), 'rows')}
            </div>
          </Field>
          <Field label="Floor columns (1–12)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {numInput(draftCols, setDraftCols, commitCount, 'Floor columns')}
              {stepper(cols, (n) => onApply(rows, clampCols(n)), 'columns')}
            </div>
          </Field>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="form-grid">
            <Field label="Rows from → to">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {numInput(range.r1, (v) => setRange((r) => ({ ...r, r1: v })), commitRange, 'Starting row')}
                <span className="td-muted">→</span>
                {numInput(range.r2, (v) => setRange((r) => ({ ...r, r2: v })), commitRange, 'Ending row')}
              </div>
            </Field>
            <Field label="Columns from → to">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {numInput(range.c1, (v) => setRange((r) => ({ ...r, c1: v })), commitRange, 'Starting column')}
                <span className="td-muted">→</span>
                {numInput(range.c2, (v) => setRange((r) => ({ ...r, c2: v })), commitRange, 'Ending column')}
              </div>
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span className="t-caption">
              Generates {Math.max(1, Math.abs((parseInt(range.r2, 10) || rows) - (parseInt(range.r1, 10) || 1)) + 1)}
              {' × '}
              {Math.max(1, Math.abs((parseInt(range.c2, 10) || cols) - (parseInt(range.c1, 10) || 1)) + 1)} tables
              {' '}({rows}R × {cols}C applied)
            </span>
            <Btn variant="secondary" onClick={commitRange} style={{ height: 36 }}>Apply range</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

function FeaturesPanel({
  shopId,
  prefs,
  update,
}: {
  shopId: string
  prefs: Prefs
  update: (patch: Partial<Prefs>) => void
}) {
  const toast = useToast()
  const { refreshUserProfile } = useAuth()
  const [features, setFeatures] = useState<Record<string, PFeatureState>>({})
  const [catalog, setCatalog] = useState<PFeatureCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Day closing rules. Server-owned, so read and written through the console API
  // rather than the local preference blob: they decide what the shop is allowed
  // to get away with, and a device-local setting would let two tablets disagree
  // about it. They live here because `close_day`'s refusal points here.
  const [closingSettings, setClosingSettings] = useState<ShopClosingSettings | null>(null)
  const [closingMateriality, setClosingMateriality] = useState('')
  const [closingSettingsError, setClosingSettingsError] = useState('')

  const loadClosing = useCallback(async () => {
    try {
      const s = await repo.getShopClosingSettings(shopId)
      setClosingSettings(s)
      setClosingMateriality(s.materiality)
      setClosingSettingsError('')
    } catch (err) {
      setClosingSettingsError(err instanceof Error ? err.message : 'Could not load.')
    }
  }, [shopId])

  const saveClosing = useCallback(async (patch: { materiality?: string; depth?: 'simple' | 'rigorous' }) => {
    setClosingSettingsError('')
    try {
      const s = await repo.updateShopClosingSettings(shopId, patch)
      setClosingSettings(s)
      setClosingMateriality(s.materiality)
    } catch (err) {
      setClosingSettingsError(err instanceof Error ? err.message : 'Could not save.')
    }
  }, [shopId])

  useEffect(() => { void loadClosing() }, [loadClosing])

  useEffect(() => {
    let alive = true
    if (!shopId) {
      setLoading(false)
      return
    }
    setLoading(true)
    repo
      .getShopFeatures(shopId)
      .then((d) => {
        if (!alive) return
        setFeatures(d.features)
        setCatalog(d.catalog)
        setError(null)
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load feature settings.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [shopId])

  async function apply(key: string, patch: Partial<PFeatureState>, label: string) {
    if (busy) return
    const previous = features
    // Optimistic: the switch answers immediately, then reconciles with the
    // server response (or rolls back on failure) — never a silent divergence.
    setFeatures((f) => ({ ...f, [key]: { ...f[key], ...patch } }))
    setBusy(key)
    try {
      const resolved = await repo.updateShopFeatures(shopId, { [key]: patch })
      setFeatures(resolved)
      // Capability changes are permission-adjacent: refresh the session so
      // every page (nav, POS, cash flow) re-reads the server-authoritative
      // feature state instead of running on a stale copy.
      void refreshUserProfile()
      toast(`${label} updated.`)
    } catch (err) {
      setFeatures(previous)
      toast(err instanceof Error ? err.message : `Could not update ${label}.`, 'err')
    } finally {
      setBusy(null)
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, PFeatureCatalogEntry[]>()
    for (const entry of catalog) {
      const list = map.get(entry.group) || []
      list.push(entry)
      map.set(entry.group, list)
    }
    return [...map.entries()]
  }, [catalog])

  if (loading) return <div className="skeleton" style={{ height: 260 }} />
  if (error) {
    return (
      <Panel title="Feature controls" bodyPad>
        <div style={{ color: 'var(--err-fg)' }}>{error}</div>
      </Panel>
    )
  }

  const title = 'Feature controls'
  const intro = 'Optional capabilities and behaviour settings for this shop. Turning a capability off hides its screens, selectors, filters and reports for owners and employees alike — server-side, so it cannot be bypassed from another screen or by an offline client. Existing data is always preserved and reappears if you turn the capability back on. GST/tax, printing, tables and discount schemes are configured in their own dedicated tabs, not here.'

  return (
    <div className="grid-2">
      <div className="stack">
        <Panel title={title} bodyPad>
          <div className="t-caption" style={{ marginBottom: 16 }}>
            {intro}
          </div>

          {groups.length === 0 && (
            <EmptyState title="Nothing to configure" hint="No options are available in this section for your shop." />
          )}

          {groups.map(([group, entries]) => (
            <div key={group} className="stack" style={{ gap: 0, marginBottom: 8 }}>
              <div className="t-caption" style={{ textTransform: 'uppercase', letterSpacing: 0.32, fontWeight: 600, margin: '8px 0' }}>
                {group}
              </div>
              {entries.map((entry, idx) => {
                const state = features[entry.key] || entry.default
                const isLast = idx === entries.length - 1
                return (
                  <div
                    key={entry.key}
                    className="pref-row"
                    style={isLast ? undefined : { borderBottom: '1px solid var(--line)' }}
                  >
                    <div style={{ flex: 1 }}>
                      <div className="pref-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{entry.label}</span>
                        <Tag kind={state.enabled ? 'green' : 'gray'}>{state.enabled ? 'ON' : 'OFF'}</Tag>
                        {state.enabled && state.owner_only && <Tag kind="blue">Owners only</Tag>}
                      </div>
                      <div className="t-caption" style={{ marginTop: 2 }}>{entry.description}</div>
                      {state.enabled && entry.owner_only_capable && (
                        <div style={{ marginTop: 8 }}>
                          <Seg<'all' | 'owner'>
                            value={state.owner_only ? 'owner' : 'all'}
                            options={[
                              { v: 'all', label: 'Everyone' },
                              { v: 'owner', label: 'Owners only' },
                            ]}
                            onChange={(v) => apply(entry.key, { owner_only: v === 'owner' }, entry.label)}
                          />
                        </div>
                      )}
                      {state.enabled && entry.modes && entry.modes.length > 1 && (
                        <div style={{ marginTop: 8 }}>
                          <Seg<string>
                            value={state.mode || entry.modes[0]}
                            options={entry.modes.map((m) => ({
                              v: m,
                              label: m === 'auto'
                                ? 'Auto (suggest)'
                                : m === 'manual'
                                  ? 'Manual'
                                  : m === 'gross'
                                    ? 'Gross sales'
                                    : m === 'net'
                                      ? 'Net sales'
                                      : m,
                            }))}
                            onChange={(v) => apply(entry.key, { mode: v }, `${entry.label} mode`)}
                          />
                        </div>
                      )}
                    </div>
                    <button
                      className={`switch ${state.enabled ? 'on' : ''}`}
                      type="button"
                      role="switch"
                      aria-checked={state.enabled}
                      aria-label={`Toggle ${entry.label}`}
                      disabled={busy === entry.key}
                      onClick={() => apply(entry.key, { enabled: !state.enabled }, entry.label)}
                    >
                      <span className="knob" />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </Panel>

        <Panel title="Sales Register &amp; Checkout Preferences" bodyPad>
          <div className="t-caption" style={{ marginBottom: 16 }}>
            Configure scanning behaviour and payment enforcement for the POS sales register.
          </div>

          <div className="stack" style={{ gap: 0 }}>
            {/* Continuous Scanning */}
            <div className="pref-row" style={{ borderBottom: '1px solid var(--line)' }}>
              <div style={{ flex: 1 }}>
                <div className="pref-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Continuous Scanning</span>
                  <Tag kind={prefs.continuousScanning ? 'green' : 'gray'}>{prefs.continuousScanning ? 'ON' : 'OFF'}</Tag>
                </div>
                <div className="t-caption" style={{ marginTop: 2 }}>
                  Accumulates scans into a persistent open draft sale. Quick-access tiles are hidden, and the cart list is locked by default.
                </div>
              </div>
              <button
                className={`switch ${prefs.continuousScanning ? 'on' : ''}`}
                type="button"
                role="switch"
                aria-checked={prefs.continuousScanning}
                aria-label="Toggle Continuous Scanning"
                onClick={() => update({ continuousScanning: !prefs.continuousScanning })}
              >
                <span className="knob" />
              </button>
            </div>

            {/* Enforce Payment Method */}
            <div className="pref-row last">
              <div style={{ flex: 1 }}>
                <div className="pref-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Enforce Payment Method</span>
                  <Tag kind={prefs.salesDefaultPaymentMode === 'all' ? 'gray' : 'blue'}>
                    {prefs.salesDefaultPaymentMode === 'all' ? 'All (No restriction)' : `${prefs.salesDefaultPaymentMode} only`}
                  </Tag>
                </div>
                <div className="t-caption" style={{ marginTop: 2 }}>
                  Restricts checkout to a single payment method. When enforced, payment method buttons in Sales are hidden, settlement buttons settle that method directly, and keyboard shortcuts (F8/F9/Ctrl+Enter) route to the enforced method.
                </div>
                <div style={{ marginTop: 10 }}>
                  <Seg<'all' | 'Cash' | 'UPI'>
                    value={prefs.salesDefaultPaymentMode || 'all'}
                    options={[
                      { v: 'all', label: 'All / Any (No restriction)' },
                      { v: 'Cash', label: 'Cash only' },
                      { v: 'UPI', label: 'UPI only' },
                    ]}
                    onChange={(v) => update({ salesDefaultPaymentMode: v })}
                  />
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="rail">
        <Panel title="Day closing rules" bodyPad>
          <div className="t-caption" style={{ marginBottom: 12 }}>
            How much cash difference this shop tolerates at close, and how strict the
            closing count is. A rigorous shop is held to an exact zero whatever the
            limit is set to.
          </div>
          {!closingSettings ? (
            <div className="t-caption">
              {closingSettingsError
                ? <>{closingSettingsError} <Btn sm variant="ghost" onClick={() => void loadClosing()}>Retry</Btn></>
                : 'Loading…'}
            </div>
          ) : <div className="stack" style={{ gap: 12 }}>
            <div>
              <label className="pref-label" htmlFor="closing-materiality">
                Cash difference allowed at close (₹)
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <input
                  id="closing-materiality"
                  className="field-control"
                  style={{ width: 120 }}
                  inputMode="decimal"
                  value={closingMateriality}
                  onChange={e => setClosingMateriality(e.target.value)}
                  onBlur={() => void saveClosing({ materiality: closingMateriality })}
                  onKeyDown={e => { if (e.key === 'Enter') void saveClosing({ materiality: closingMateriality }) }}
                />
                <Btn sm onClick={() => void saveClosing({ materiality: closingMateriality })}>
                  Save
                </Btn>
              </div>
              <div className="t-caption" style={{ marginTop: 4 }}>
                0 means the drawer must match to the paisa. Set a small amount if a few
                rupees of change routinely goes missing in the till.
              </div>
            </div>
            <div>
              <span className="pref-label">Closing count strictness</span>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <Btn sm variant={closingSettings.depth === 'simple' ? 'primary' : 'ghost'}
                  onClick={() => void saveClosing({ depth: 'simple' })}>Simple</Btn>
                <Btn sm variant={closingSettings.depth === 'rigorous' ? 'primary' : 'ghost'}
                  onClick={() => void saveClosing({ depth: 'rigorous' })}>Rigorous</Btn>
              </div>
              <div className="t-caption" style={{ marginTop: 4 }}>
                Simple counts the products that moved. Rigorous also counts the whole
                active range and hides the expected quantity until you commit to a number.
              </div>
            </div>
          </div>}
        </Panel>
        <Panel title="How features behave" bodyPad>
          <div className="stack" style={{ gap: 12 }}>
            <div>
              <div className="pref-label">Server-enforced</div>
              <div className="t-caption">
                The POS and catalog APIs re-check every option. A disabled rate edit or discount
                is refused even from a queued offline bill or a direct API call.
              </div>
            </div>
            <div>
              <div className="pref-label">Data is never destroyed</div>
              <div className="t-caption">
                Disabling Kitchen hides kitchen products everywhere but keeps them, their sales and their history
                intact. Turn it back on to restore visibility instantly.
              </div>
            </div>
            <div>
              <div className="pref-label">Owners vs employees</div>
              <div className="t-caption">
                For rate editing and quick discounts you can keep the capability for owners while employees bill
                at the catalog rate and without manual discounts.
              </div>
            </div>
            <div>
              <div className="pref-label">One home per setting</div>
              <div className="t-caption">
                GST/tax and printing live under Bill &amp; Invoice; table layouts live under Tables; discount
                schemes and coupons have their own editor. This tab never duplicates them.
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function SettingsPage() {
  const toast = useToast()
  const { activeShop, signOut, isOwner, isOwnerAccount, isMultiShop, featureOn } = useAuth()
  const canManageShops = isOwnerAccount && isMultiShop

  const [tab, setTab] = useState<SettingsTab>('appearance')
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const [invoiceDraft, setInvoiceDraft] = useState(prefs.invoice)
  const [previewStress, setPreviewStress] = useState<'normal' | 'stress'>('normal')

  const sampleReceipt: ReceiptData = useMemo(() => {
    const items = [
      { name: 'ROYAL STAG 750ML', unit: '750 ML', qty: 1, rate: 480 },
      { name: 'KINGFISHER ULTRA 650ML', unit: '650 ML', qty: 2, rate: 180 },
    ]
    const subtotal = 840
    const discount = (featureOn('quick_discount') || featureOn('discount')) ? 40 : 0
    const afterDisc = subtotal - discount
    const gstSlab = prefs.enableGst ? 18 : 0
    const gstAmount = prefs.enableGst ? Math.round(afterDisc * 0.18) : 0
    const total = afterDisc + gstAmount
    const method =
      prefs.defaultPayMethod === 'Cash'
        ? 'Cash'
        : prefs.defaultPayMethod === 'UPI'
        ? 'UPI QR'
        : prefs.defaultPayMethod === 'Khata'
        ? 'Khata (Credit)'
        : 'Cash'
    return {
      billNo: '1756',
      date: new Date(2026, 7, 22, 18, 45).getTime(),
      station: 'POS Terminal 1',
      customerName: 'WALK IN CUSTOMER',
      method,
      couponCode: discount > 0 ? 'PROMO40' : undefined,
      items,
      subtotal,
      discount,
      gstSlab,
      gstAmount,
      total,
    }
  }, [prefs.enableGst, prefs.defaultPayMethod, featureOn])

  // Data Control tab (owner only). Quick wipe erases all business entries and
  // restarts bill numbering; restore-from-file imports a developer-provided
  // data file into a fresh account (freshness-gated, one import, then
  // sign-out). Business day cutoff is the per-shop lock-in time
  // (see docs/ANALYTICS.md, business day).
  const [mgmtStep, setMgmtStep] = useState<1 | 2 | null>(null)
  const [mgmtName, setMgmtName] = useState('')
  const [mgmtBusy, setMgmtBusy] = useState(false)

  async function handleMgmtWipe() {
    if (!activeShop) return
    setMgmtBusy(true)
    try {
      throw new ApiError('Data wipe is not available from this form yet.', 'not_available')
      toast('All shop data wiped. The account is fresh as new. Signing you out…')
      setMgmtStep(null)
      setTimeout(() => signOut(), 900)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Wipe failed.', 'err')
    } finally {
      setMgmtBusy(false)
    }
  }

  // Business day cutoff (lock-in) and account freshness for the restore card.
  // Freshness tri-state: null = checking, false = not fresh (or could not be
  // verified, so restoring stays disabled), true = zero business entries.
  const [biz, setBiz] = useState<PBusinessDayInfo | null>(null)
  const [bizLoading, setBizLoading] = useState(false)
  const [bizError, setBizError] = useState(false)
  const [retryBiz, setRetryBiz] = useState(0)
  const [lockIn, setLockIn] = useState('02:00')
  const [lockInBusy, setLockInBusy] = useState(false)
  const [fresh, setFresh] = useState<boolean | null>(null)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreConfirm, setRestoreConfirm] = useState(false)

  useEffect(() => {
    if (tab !== 'management' || !isOwner || !activeShop) return
    let alive = true
    setFresh(null)
    setBizLoading(true)
    setBizError(false)
    repo.businessDayInfo(activeShop.id)
      .then((r) => {
        if (!alive) return
        setBiz(r)
        setLockIn(r.lockInTime)
      })
      .catch(() => {
        if (alive) setBizError(true)
      })
      .finally(() => {
        if (alive) setBizLoading(false)
      })
    setFresh(false)
    return () => {
      alive = false
    }
  }, [tab, isOwner, activeShop, retryBiz])

  async function handleLockInSave() {
    if (!activeShop || !lockIn) return
    setLockInBusy(true)
    try {
      await call('staff', 'update_settings', { values: { orsquare_cutoff_hour: Number(lockIn.slice(0, 2)) + Number(lockIn.slice(3, 5)) / 60 } })
      const r = await repo.businessDayInfo(activeShop.id)
      setBiz(r)
      toast(`Business day cutoff saved at ${lockIn}. Sealed days are unchanged.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the cutoff time.', 'err')
    } finally {
      setLockInBusy(false)
    }
  }

  async function handleRestore() {
    if (!activeShop || !restoreFile) return
    setRestoreBusy(true)
    try {
      const r = await restoreUnavailable(restoreFile)
      toast(
        `Restore complete: ${r.products ?? 0} products, ${r.customers ?? 0} customers, ${r.suppliers ?? 0} suppliers, ${r.sales ?? 0} bills, ${r.days ?? 0} sealed days. Signing you out…`,
      )
      setRestoreConfirm(false)
      setTimeout(() => signOut(), 1200)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Restore failed.', 'err')
      setRestoreConfirm(false)
    } finally {
      setRestoreBusy(false)
    }
  }

  function update(patch: Partial<Prefs>) {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(next)
    applyPrefs(next)
  }

  function saveInvoice() {
    const next = { ...prefs, invoice: invoiceDraft }
    setPrefs(next)
    savePrefs(next)
    toast('Receipt and invoice preset saved.')
  }

  /** Print settings are device-local and take effect immediately (no Save step): a counter must never be half-configured. */
  function updatePrint(patch: Partial<PrintSettings>) {
    update({ print: { ...prefs.print, ...patch } })
    window.dispatchEvent(new Event('orsquare:print-settings'))
    if (patch.backend === 'qz') void import('@/lib/printing/service').then((m) => m.startPrinting())
  }

  /** Sends a calibration sheet through the real pipeline. beginPrint() runs first, inside the click, so browser mode keeps its pop-up. */
  async function testPrint(kind: TestKind) {
    const h = beginPrint()
    const sheet = buildTestSheet(kind, invoiceDraft, loadPrefs().print)
    const outcome = await h.submitBlocks(sheet.laid, { key: `test:${kind}`, label: sheet.label, kind: 'test', repeatable: true })
    const msg = outcomeMessage(outcome)
    if (msg) toast(msg.text, msg.kind)
    else if (outcome === 'queued' || outcome === 'queued-offline') toast(`${sheet.label} sent to the printer.`)
    else if (outcome === 'duplicate') toast('Already sent. Wait a moment before printing it again.', 'info')
  }

  // ---- Business-day cutoff panel derived values ---------------------------
  // Display math only. The authoritative window comes from the server
  // business-day endpoint; these helpers estimate what a change would do.
  const cutoffMins = timeToMinutes(lockIn)
  const lockInValid = /^\d{2}:\d{2}$/.test(lockIn) && cutoffMins >= 0 && cutoffMins <= 300
  const nowMs = nowClock()
  const timeLabel = (mins: number): string => {
    const m = ((Math.round(mins) % 1440) + 1440) % 1440
    const h24 = Math.floor(m / 60)
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    const minsRem = m % 60
    return `${h12}:${String(minsRem).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
  }
  const cutoffPresets = [
    { time: '00:00', title: '12:00 AM', desc: 'Standard Midnight' },
    { time: '01:00', title: '1:00 AM', desc: 'Closes by 1 AM' },
    { time: '02:00', title: '2:00 AM', desc: 'Default Shift Cutoff' },
    { time: '03:00', title: '3:00 AM', desc: 'Late Operations' },
  ]
  const savedLockIn = biz?.lockInTime ?? '02:00'
  const reDatesToday =
    !!biz && lockIn !== savedLockIn && currentBusinessDateKey(savedLockIn, nowMs) !== currentBusinessDateKey(lockIn, nowMs)
  const lockInChanged = !!biz && lockIn !== savedLockIn

  return (
    <>
      <div className="subtabs" role="tablist" aria-label="Settings sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'appearance'}
          className={`subtab ${tab === 'appearance' ? 'active' : ''}`}
          onClick={() => setTab('appearance')}
        >
          <IconGear /> Appearance
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'billing'}
          className={`subtab ${tab === 'billing' ? 'active' : ''}`}
          onClick={() => setTab('billing')}
        >
          <IconPOS /> Bill &amp; Invoice
        </button>
        {isOwner && (
          <button
            type="button"
            role="tab"
            disabled title="Not available yet." aria-selected={tab === 'features'}
            className={`subtab ${tab === 'features' ? 'active' : ''}`}
            onClick={() => setTab('features')}
          >
            <IconLayers /> Features
          </button>
        )}
        <button
          type="button"
          role="tab"
          disabled title="Not available yet." aria-selected={tab === 'tables'}
          className={`subtab ${tab === 'tables' ? 'active' : ''}`}
          onClick={() => setTab('tables')}
        >
          <IconCal /> Tables
        </button>
        <button
          type="button"
          role="tab"
          disabled title="Not available yet." aria-selected={tab === 'team'}
          className={`subtab ${tab === 'team' ? 'active' : ''}`}
          onClick={() => setTab('team')}
        >
          <IconUsers /> Team &amp; Access
        </button>
        {canManageShops && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'shops'}
            className={`subtab ${tab === 'shops' ? 'active' : ''}`}
            onClick={() => setTab('shops')}
          >
            <IconLayers /> Shops
          </button>
        )}
        {isOwner && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'management'}
            className={`subtab ${tab === 'management' ? 'active' : ''}`}
            onClick={() => setTab('management')}
          >
            <IconDatabase /> Data Control
          </button>
        )}
      </div>

      {tab === 'management' && isOwner && (
        <div className="grid-2">
          <div className="stack" style={{ gap: 20 }}>
            <Panel title="Business Day & Shift Cutoff" bodyPad>
              <div className="t-caption" style={{ margin: '0 0 16px' }}>
                Defines the store closing hour. Transactions punched before cutoff group into the active shift register.
              </div>

              {bizLoading ? (
                <div className="skeleton" style={{ height: 180 }} />
              ) : bizError ? (
                <div style={{ padding: 14, background: 'var(--err-bg)', color: 'var(--err-fg)', borderLeft: '3px solid var(--err)' }}>
                  <span style={{ fontSize: 13, marginRight: 8 }}>Couldn’t load current business day details.</span>
                  <Btn sm variant="ghost" onClick={() => setRetryBiz((t) => t + 1)}>
                    Retry
                  </Btn>
                </div>
              ) : biz ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Status Strip */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: 1,
                      background: 'var(--line)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <div style={{ padding: '10px 14px', background: 'var(--canvas)' }}>
                      <span className="micro-label" style={{ display: 'block', color: 'var(--subtle)' }}>CURRENT BUSINESS DAY</span>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
                        {labelDayKey(biz.currentBusinessDate)}
                        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--subtle)', marginLeft: 6 }}>
                          ({biz.currentBusinessDate})
                        </span>
                      </div>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {biz.today.bills} bill{biz.today.bills === 1 ? '' : 's'} recorded today
                      </span>
                    </div>

                    <div style={{ padding: '10px 14px', background: 'var(--canvas)' }}>
                      <span className="micro-label" style={{ display: 'block', color: 'var(--subtle)' }}>SHIFT CLOSING TIME</span>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--blue)', marginTop: 2 }}>
                        {savedLockIn === '00:00' ? '12:00 AM (Midnight)' : timeLabel(timeToMinutes(savedLockIn))}
                      </div>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {savedLockIn === '00:00'
                          ? 'Standard 24-hr calendar day'
                          : `Shift window closes at ${timeLabel(timeToMinutes(savedLockIn))}`}
                      </span>
                    </div>
                  </div>

                  {/* Preset & Custom Cutoff Selector */}
                  <div>
                    <span className="micro-label" style={{ display: 'block', marginBottom: 8 }}>
                      SELECT SHIFT CLOSING TIME
                    </span>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                        gap: 8,
                      }}
                    >
                      {cutoffPresets.map((preset) => {
                        const isSelected = lockIn === preset.time
                        return (
                          <button
                            key={preset.time}
                            type="button"
                            onClick={() => setLockIn(preset.time)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-start',
                              padding: '8px 10px',
                              border: isSelected ? '1px solid var(--blue)' : '1px solid var(--line)',
                              background: isSelected ? 'var(--canvas)' : 'var(--layer)',
                              cursor: 'pointer',
                              borderRadius: 0,
                              textAlign: 'left',
                              transition: 'all 100ms ease',
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? 'var(--blue)' : 'var(--ink)' }}>
                              {preset.title}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                              {preset.desc}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Custom Time & Save Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 14px',
                      background: 'var(--layer)',
                      border: '1px solid var(--line)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Custom Cutoff (00:00–05:00):</span>
                      <input
                        type="time"
                        className="num"
                        style={{
                          height: 32,
                          width: 120,
                          padding: '0 8px',
                          background: 'var(--canvas)',
                          border: lockInValid ? '1px solid var(--line)' : '1px solid var(--err)',
                          fontSize: 13,
                          borderRadius: 0,
                        }}
                        min="00:00"
                        max="05:00"
                        step={60}
                        aria-label="Custom business day cutoff time"
                        value={lockIn}
                        onChange={(e) => setLockIn(e.target.value)}
                      />
                    </div>

                    <Btn
                      variant={lockInChanged ? 'primary' : 'secondary'}
                      disabled={true} title="Cutoff settings are not available in this screen yet."
                      onClick={handleLockInSave}
                      style={{ height: 32, padding: '0 14px', fontSize: 12, fontWeight: 600 }}
                    >
                      {lockInBusy ? 'Saving…' : lockInChanged ? 'Save Cutoff' : 'Saved'}
                    </Btn>
                  </div>

                  {!lockInValid && (
                    <div style={{ padding: '8px 12px', background: 'var(--err-bg)', color: 'var(--err-fg)', fontSize: 12 }}>
                      Cutoff must be between 12:00 AM (00:00) and 5:00 AM (05:00).
                    </div>
                  )}

                  {/* Concise 1-liner Shift Rule */}
                  <div
                    style={{
                      padding: '10px 12px',
                      background: 'var(--canvas)',
                      border: '1px solid var(--line)',
                      borderLeft: '3px solid var(--blue)',
                      fontSize: 12,
                      color: 'var(--ink)',
                      lineHeight: 1.4,
                    }}
                  >
                    {cutoffMins === 0 ? (
                      <span><strong>Standard 24-hr day:</strong> Bills punched from 12:00 AM to 11:59 PM tally into today’s register.</span>
                    ) : (
                      <span><strong>Late-night shift:</strong> Bills punched before {timeLabel(cutoffMins)} tally into tonight’s register. Next shift starts at {timeLabel(cutoffMins)}.</span>
                    )}
                  </div>

                  {reDatesToday && (
                    <div
                      style={{
                        padding: '8px 12px',
                        background: 'var(--warn-bg)',
                        borderLeft: '3px solid var(--warn-fg)',
                        color: 'var(--warn-fg)',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <IconAlertTriangle size={14} style={{ flexShrink: 0 }} />
                      <span>Shift boundary change re-aligns today’s active bills. Past sealed days remain immutable.</span>
                    </div>
                  )}

                  {/* Sealed History Archive */}
                  {biz.sealedDays.length > 0 && (
                    <details
                      style={{
                        background: 'var(--canvas)',
                        border: '1px solid var(--line)',
                        padding: '8px 12px',
                        fontSize: 12,
                      }}
                    >
                      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink)' }}>
                        Sealed Daily Archives ({biz.sealedDays.length} days)
                      </summary>
                      <div
                        style={{
                          marginTop: 10,
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                          gap: 6,
                        }}
                      >
                        {biz.sealedDays.slice(0, 8).map((s) => (
                          <div
                            key={s.dateKey}
                            style={{
                              padding: '6px 8px',
                              background: 'var(--layer)',
                              border: '1px solid var(--line)',
                              fontSize: 11,
                              display: 'flex',
                              justifyContent: 'space-between',
                            }}
                          >
                            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.dateKey}</span>
                            <span style={{ color: 'var(--subtle)' }}>
                              Cutoff {s.lockInTime === '00:00' ? 'Midnight' : s.lockInTime}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ) : null}
            </Panel>

            <OfflineCachePanel />
          </div>

          <div className="rail">
            <div style={{ borderTop: '3px solid var(--err)' }}>
              <Panel title="Disaster Recovery &amp; Store Reset" bodyPad>
                <div className="t-caption" style={{ margin: '0 0 14px' }}>
                  Administrative operations for clean-slate reset and snapshot restoration.
                </div>

                <div className="stack" style={{ gap: 14 }}>
                  {/* Clean Slate / Wipe */}
                  <div style={{ padding: '12px 14px', background: 'var(--layer)', border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Wipe Shop Transactions &amp; Catalog</div>
                    <div className="t-caption" style={{ margin: '4px 0 10px' }}>
                      Erases all products, bills, and ledgers for {activeShop?.name}. Login credentials and store configuration are preserved.
                    </div>
                    <Btn
                      variant="ghost"
                      style={{ color: 'var(--err)', height: 32, padding: '0 10px', fontSize: 12 }}
                      onClick={() => { setMgmtStep(1); setMgmtName('') }}
                    >
                      <IconTrash size={13} /> Wipe All Shop Data…
                    </Btn>
                  </div>

                  {/* Restore from File */}
                  <div style={{ padding: '12px 14px', background: 'var(--layer)', border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Restore Account Snapshot</div>
                    {fresh === null ? (
                      <div className="t-caption" style={{ marginTop: 4 }}>Checking account freshness…</div>
                    ) : !fresh ? (
                      <div className="t-caption" style={{ marginTop: 4, color: 'var(--muted)' }}>
                        Snapshots can only be restored into a fresh shop account with zero existing transactions.
                      </div>
                    ) : (
                      <>
                        <div className="t-caption" style={{ margin: '4px 0 10px' }}>
                          Import a verified archive (.zip, .or2, .enc) into this fresh account. Available once before new bills are punched.
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            type="file"
                            className="field-control"
                            accept=".zip,.or2,.enc"
                            disabled={restoreBusy}
                            onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                            style={{ flex: 1, minWidth: 180, height: 32, fontSize: 12 }}
                          />
                          <Btn
                            variant="primary"
                            sm
                            disabled={!restoreFile || restoreBusy}
                            onClick={() => setRestoreConfirm(true)}
                          >
                            Restore Snapshot
                          </Btn>
                        </div>
                        {restoreFile && (
                          <div className="t-caption" style={{ marginTop: 4, color: 'var(--blue)' }}>
                            Selected: {restoreFile.name}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="t-caption" style={{ color: 'var(--subtle)' }}>
                    For emergency database rollbacks or assistance, contact your system administrator.
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      )}

      {tab === 'features' && isOwner && (
        <FeaturesPanel shopId={activeShop?.id ?? ''} prefs={prefs} update={update} />
      )}

      {tab === 'appearance' && (
        <div className="grid-2">
          <div className="stack">
            <Panel title="Appearance &amp; display preferences" bodyPad>
              <div className="pref-row">
                <div>
                  <div className="pref-label">Theme mode</div>
                  <div className="t-caption">Light for counter daylight environments; Dark for low-glare evening operation.</div>
                </div>
                <Seg<Theme>
                  value={prefs.theme}
                  options={[
                    { v: 'light', label: 'Light' },
                    { v: 'dark', label: 'Dark' },
                  ]}
                  onChange={(theme) => update({ theme })}
                />
              </div>

              <div className="pref-row">
                <div>
                  <div className="pref-label">Font scaling</div>
                  <div className="t-caption">Scales the entire typography system across POS registers, reports, and menus.</div>
                </div>
                <Seg<FontSize>
                  value={prefs.fontSize}
                  options={[
                    { v: 'small', label: 'Small (90%)' },
                    { v: 'medium', label: 'Medium (100%)' },
                    { v: 'large', label: 'Large (108%)' },
                  ]}
                  onChange={(fontSize) => update({ fontSize })}
                />
              </div>

              <div className="pref-row last">
                <div>
                  <div className="pref-label">Typeface family</div>
                  <div className="t-caption">IBM Plex Sans (standard enterprise) / System UI (platform default) / Serif (editorial).</div>
                </div>
                <Seg<FontFamily>
                  value={prefs.fontFamily}
                  options={[
                    { v: 'plex', label: 'IBM Plex Sans' },
                    { v: 'system', label: 'System UI' },
                    { v: 'serif', label: 'Serif' },
                  ]}
                  onChange={(fontFamily) => update({ fontFamily })}
                />
              </div>
            </Panel>
          </div>

          <div className="rail">
            <Panel title="Live UI Token Preview" bodyPad>
              <div className="stack" style={{ gap: 12 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Tag kind="blue">POS Register</Tag>
                  <Tag kind="green">Active Shop</Tag>
                  <Tag kind="purple">Owner</Tag>
                  <Tag kind="gray">v1.0.0</Tag>
                </div>

                <div
                  style={{
                    border: '1px solid var(--line)',
                    background: 'var(--canvas)',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Sample Financial Row</span>
                    <span className="num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ok-fg)' }}>
                      ₹ 1,450.00
                    </span>
                  </div>
                  <div className="t-caption">Tabular numerals align currency decimals perfectly across inventory ledgers.</div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant="primary" sm>
                    Primary Action
                  </Btn>
                  <Btn variant="secondary" sm>
                    Secondary
                  </Btn>
                  <Btn variant="ghost" sm>
                    Ghost
                  </Btn>
                </div>

                <div className="t-caption" style={{ marginTop: 4 }}>
                  Stored in local storage (<code style={{ fontFamily: 'ui-monospace, monospace' }}>xpo.prefs</code>) and applies instantaneously to root HTML tokens. Appearance choices are saved on this device.
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'billing' && (
        <div className="bill-layout-wrap">
          {/* LEFT COLUMN: Customizer Settings (Store Header & Checkout Preferences) */}
          <div className="stack" style={{ gap: 20 }}>
            {/* PANEL 1: Store legal details & thermal receipt header */}
            <Panel
              title="Store & Receipt Header"
              subtitle="Printed at the top of physical thermal receipts and customer credit notes"
              actions={<Tag kind="blue">LIVE SYNC</Tag>}
              bodyPad
            >
              <div className="stack" style={{ gap: 14 }}>
                <Field
                  label="Shop / store legal name"
                  help={activeShop ? `Leave blank to print your shop profile name (${activeShop.name}). Type here only to override it on receipts.` : 'Rendered in bold headline font at the top of every receipt roll.'}
                >
                  <input
                    className="field-control"
                    value={invoiceDraft.shopName}
                    onChange={(e) => setInvoiceDraft({ ...invoiceDraft, shopName: e.target.value.toUpperCase() })}
                    placeholder={activeShop?.name ?? 'Shop name'}
                    style={{ textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 600 }}
                  />
                </Field>

                <Field label="Business tagline / category" help="Printed centered directly below the store name.">
                  <input
                    className="field-control"
                    value={invoiceDraft.tagline}
                    onChange={(e) => setInvoiceDraft({ ...invoiceDraft, tagline: e.target.value })}
                    placeholder="Optional line under the name"
                  />
                </Field>

                <div className="form-grid">
                  <Field label="Address line 1">
                    <input
                      className="field-control"
                      value={invoiceDraft.addressLine}
                      onChange={(e) => setInvoiceDraft({ ...invoiceDraft, addressLine: e.target.value })}
                      placeholder="Shop no, street, landmark"
                    />
                  </Field>
                  <Field label="Address line 2 (City / PIN)">
                    <input
                      className="field-control"
                      value={invoiceDraft.addressLine2}
                      onChange={(e) => setInvoiceDraft({ ...invoiceDraft, addressLine2: e.target.value })}
                      placeholder="Pune, Maharashtra - 411057"
                    />
                  </Field>
                </div>

                <div className="form-grid">
                  <Field label="Support phone / WhatsApp" help={activeShop?.phone ? 'Leave blank to print the shop profile phone.' : 'Printed on the contact line.'}>
                    <input
                      className="field-control num"
                      value={invoiceDraft.phone}
                      onChange={(e) => setInvoiceDraft({ ...invoiceDraft, phone: e.target.value })}
                      placeholder={activeShop?.phone || '+91 98765 43210'}
                    />
                  </Field>
                  <Field label="GSTIN tax ID" help="Leave blank for a tax-exempt retail bill.">
                    <input
                      className="field-control num"
                      value={invoiceDraft.gstin}
                      onChange={(e) => setInvoiceDraft({ ...invoiceDraft, gstin: e.target.value.toUpperCase() })}
                      placeholder="27AAAAA0000A1Z5"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </Field>
                </div>

                <Field label="Sequential bill number prefix" help="Prepended to sequential bill numbers.">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <input
                      className="field-control num"
                      style={{ maxWidth: 160 }}
                      value={invoiceDraft.prefix}
                      onChange={(e) => setInvoiceDraft({ ...invoiceDraft, prefix: e.target.value.toUpperCase() })}
                      placeholder="INV-"
                    />
                    <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>Rendered sample:</span>
                      <span
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontWeight: 600,
                          color: 'var(--blue)',
                          background: 'var(--layer)',
                          padding: '2px 8px',
                          border: '1px solid var(--line)',
                        }}
                      >
                        {invoiceDraft.prefix || 'INV-'}1756
                      </span>
                    </div>
                  </div>
                </Field>

                <Field
                  label="Receipt footer note & customer terms"
                  help="Printed at the bottom of the bill roll. Tap a preset chip to quickly append standard store terms."
                >
                  <div className="preset-chips" style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className="preset-chip-btn"
                      onClick={() =>
                        setInvoiceDraft((d) => ({
                          ...d,
                          footerNote: d.footerNote
                            ? `${d.footerNote}\nThank you for shopping with us! Visit again.`
                            : 'Thank you for shopping with us! Visit again.',
                        }))
                      }
                    >
                      + Thank you note
                    </button>
                    <button
                      type="button"
                      className="preset-chip-btn"
                      onClick={() =>
                        setInvoiceDraft((d) => ({
                          ...d,
                          footerNote: d.footerNote
                            ? `${d.footerNote}\nGoods once sold can be exchanged within 7 days with bill.`
                            : 'Goods once sold can be exchanged within 7 days with original bill.',
                        }))
                      }
                    >
                      + 7-day exchange
                    </button>
                    <button
                      type="button"
                      className="preset-chip-btn"
                      onClick={() =>
                        setInvoiceDraft((d) => ({
                          ...d,
                          footerNote: d.footerNote
                            ? `${d.footerNote}\nNo returns or refunds once goods leave the counter.`
                            : 'No returns or refunds once goods leave the counter.',
                        }))
                      }
                    >
                      + No returns
                    </button>
                    <button
                      type="button"
                      className="preset-chip-btn"
                      onClick={() =>
                        setInvoiceDraft((d) => ({
                          ...d,
                          footerNote: d.footerNote
                            ? `${d.footerNote}\nComputer generated bill. No signature required.`
                            : 'Computer generated bill. No signature required.',
                        }))
                      }
                    >
                      + Tax bill clause
                    </button>
                    {invoiceDraft.footerNote && (
                      <button
                        type="button"
                        className="preset-chip-btn"
                        style={{ color: 'var(--err-fg, #da1e28)' }}
                        onClick={() => setInvoiceDraft((d) => ({ ...d, footerNote: '' }))}
                      >
                        Clear note
                      </button>
                    )}
                  </div>
                  <textarea
                    className="field-control"
                    rows={3}
                    value={invoiceDraft.footerNote}
                    onChange={(e) => setInvoiceDraft({ ...invoiceDraft, footerNote: e.target.value })}
                    placeholder={'Thank you for your business!\nGoods once sold can be exchanged within 7 days with original bill.'}
                  />
                </Field>
              </div>
            </Panel>

            {/* PANEL 2: POS register checkout controls */}
            <Panel
              title="Checkout & Receipt Preferences"
              subtitle="Synced across all cashier terminals, barcode registers, and counter tablets"
              bodyPad
            >
              <div className="stack" style={{ gap: 18 }}>
                <Field
                  label="Default payment method at checkout"
                  help="Pre-selected on the payment modal. Cashier can still select any method with 1 tap."
                >
                  <div className="pay-choice-grid" role="radiogroup" aria-label="Default payment method">
                    {[
                      { id: 'Cash', icon: IconCash, title: 'Cash', hint: 'Instant drawer tally' },
                      { id: 'UPI', icon: IconQrCode, title: 'UPI QR', hint: 'Dynamic counter scan' },
                      { id: 'Khata', icon: IconCreditLedger, title: 'Khata', hint: 'Customer ledger balance' },
                      { id: 'last', icon: IconRefresh, title: 'Auto-Last', hint: 'Remembers cashier pick' },
                    ].map((m) => {
                      const isSelected = prefs.defaultPayMethod === m.id
                      const CardIcon = m.icon
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          className={`pay-choice-card ${isSelected ? 'active' : ''}`}
                          onClick={() => update({ defaultPayMethod: m.id as DefaultPayMethod })}
                        >
                          <div className="choice-head">
                            <span className="choice-icon">
                              <CardIcon size={16} />
                            </span>
                            {isSelected && (
                              <span className="choice-check">
                                <IconCheck size={11} style={{ marginRight: 3, verticalAlign: '-1px' }} />
                                ACTIVE
                              </span>
                            )}
                          </div>
                          <div className="choice-title">{m.title}</div>
                          <div className="choice-hint">{m.hint}</div>
                        </button>
                      )
                    })}
                  </div>
                </Field>

                <Field
                  label="Thermal printing after bill confirmation"
                  help="Controls what happens on this device immediately when cashier taps 'Confirm Bill'."
                >
                  <div className="print-mode-grid" role="radiogroup" aria-label="Printing after a bill">
                    {[
                      {
                        id: 'ask',
                        icon: IconMessageSquare,
                        name: 'Prompt Cashier',
                        tag: 'STANDARD',
                        tagKind: 'blue' as const,
                        desc: 'Shows a 1-tap "Print receipt? Yes / Skip" dialog after confirming every bill.',
                        speed: 'Saves paper when customer declines',
                      },
                      {
                        id: 'auto',
                        icon: IconPrinter,
                        name: 'Always Print',
                        tag: 'SPEED POS',
                        tagKind: 'purple' as const,
                        desc: 'Sends the bill straight to the printer without asking or waiting.',
                        speed: 'Best for busy retail & supermarket queues',
                      },
                      {
                        id: 'off',
                        icon: IconPaperless,
                        name: 'Paperless',
                        tag: 'DIGITAL',
                        tagKind: 'green' as const,
                        desc: 'Completely silent checkout. Past bills remain printable from Sales History.',
                        speed: 'Fastest counter cycle time',
                      },
                    ].map((p) => {
                      const isSelected = (prefs.printMode ?? 'ask') === p.id
                      const ModeIcon = p.icon
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          className={`print-mode-card ${isSelected ? 'active' : ''}`}
                          onClick={() => update({ printMode: p.id as PrintMode, autoPrintBill: p.id === 'auto' })}
                        >
                          <div className="print-card-head">
                            <div className="print-card-title-row">
                              <span className="print-card-icon">
                                <ModeIcon size={16} />
                              </span>
                              <span className="print-card-name">{p.name}</span>
                            </div>
                            <Tag kind={isSelected ? 'blue' : p.tagKind}>{isSelected ? 'ACTIVE' : p.tag}</Tag>
                          </div>
                          <div className="print-card-desc">{p.desc}</div>
                          <div className="print-card-foot">
                            <IconArrowRight size={11} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                            <span>{p.speed}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </Field>

                <div className="pref-row last" style={{ paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <div>
                    <div className="pref-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>GST billing &amp; tax slabs</span>
                      <Tag kind={prefs.enableGst ? 'green' : 'gray'}>{prefs.enableGst ? 'ON' : 'OFF'}</Tag>
                    </div>
                    <div className="t-caption" style={{ marginTop: 2 }}>
                      Calculates output GST (0%, 5%, 12%, 18%, 28%) on items. When OFF, bills are tax-exempt retail.
                    </div>
                  </div>
                  <button
                    className={`switch ${prefs.enableGst ? 'on' : ''}`}
                    type="button"
                    role="switch"
                    aria-checked={prefs.enableGst}
                    aria-label="Toggle GST billing"
                    onClick={() => update({ enableGst: !prefs.enableGst })}
                  >
                    <span className="knob" />
                  </button>
                </div>
              </div>
            </Panel>

            <PrintingPanel settings={prefs.print} onChange={updatePrint} onTest={testPrint} />
          </div>

          {/* RIGHT COLUMN: Live sticky thermal receipt stage */}
          <div className="bill-sticky-rail">
            <Panel
              title="Live Receipt Preview"
              subtitle="Simulates physical thermal roll print output"
              actions={
                <Seg<'normal' | 'stress'>
                  value={previewStress}
                  options={[
                    { v: 'normal', label: 'Sample' },
                    { v: 'stress', label: 'Stress bill' },
                  ]}
                  onChange={(v) => setPreviewStress(v)}
                />
              }
              bodyPad
            >
              <ReceiptPreview invoice={invoiceDraft} settings={prefs.print} receipt={sampleReceipt} stress={previewStress === 'stress'} />

              <div className="stack" style={{ gap: 8, marginTop: 16 }}>
                <Btn
                  variant={JSON.stringify(invoiceDraft) !== JSON.stringify(prefs.invoice) ? 'primary' : 'secondary'}
                  onClick={saveInvoice}
                  style={{ width: '100%', height: 44, fontWeight: 600 }}
                >
                  {JSON.stringify(invoiceDraft) !== JSON.stringify(prefs.invoice) ? (
                    'Save Bill & Receipt Settings'
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <IconCheck size={14} /> Settings Saved
                    </span>
                  )}
                </Btn>
                <div className="row" style={{ gap: 8 }}>
                  <Btn
                    variant="secondary"
                    style={{ flex: 1, height: 40 }}
                    onClick={() => {
                      setInvoiceDraft(defaultPrefs.invoice)
                      toast('Reset to factory defaults. Click Save to apply.')
                    }}
                  >
                    Reset Defaults
                  </Btn>
                  <Btn
                    variant="ghost"
                    style={{ flex: 1, height: 40 }}
                    onClick={() => void testPrint('sample')}
                  >
                    Print Test Bill
                  </Btn>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'tables' && <TablesPanel />}

      {tab === 'team' && <TeamPanel />}

      {tab === 'shops' && canManageShops && <ShopsPanel />}

      {/* Data Control tab dialogs (owner quick wipe + restore-from-file confirm) */}
      <ConfirmDialog
        open={mgmtStep === 1}
        title={`Wipe all data for "${activeShop?.name}"?`}
        confirmLabel="Continue"
        onClose={() => setMgmtStep(null)}
        onConfirm={() => setMgmtStep(2)}
        message="Step 1 of 2. This erases every product, bill, ledger entry and register row for this shop and restarts bill numbering. The next step asks you to type the shop name to confirm."
      />

      <ConfirmDialog
        open={mgmtStep === 2}
        title="Final confirmation — wipe to fresh"
        confirmLabel={mgmtBusy ? 'Wiping…' : 'Wipe Data Forever'}
        busy={mgmtBusy}
        disabled={mgmtName.trim().toUpperCase() !== (activeShop?.name ?? '').trim().toUpperCase()}
        onClose={() => setMgmtStep(null)}
        onConfirm={handleMgmtWipe}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            This permanently erases every product, bill, ledger entry and register row for{' '}
            <strong>{activeShop?.name}</strong>. Bill numbering restarts and the account becomes fresh as new.
            Your login and staff accounts are kept, and you will be signed out after the wipe.
          </div>
          <Field label={`Type "${activeShop?.name}" to confirm`}>
            <input
              className="field-control"
              value={mgmtName}
              onChange={(e) => setMgmtName(e.target.value)}
              placeholder={activeShop?.name}
              autoComplete="off"
            />
          </Field>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={restoreConfirm}
        title="Restore data from this file?"
        confirmLabel={restoreBusy ? 'Restoring…' : 'Import and sign out'}
        busy={restoreBusy}
        disabled={!restoreFile}
        onClose={() => {
          if (!restoreBusy) setRestoreConfirm(false)
        }}
        onConfirm={handleRestore}
      >
        <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          This loads the developer-provided file into the fresh account for <strong>{activeShop?.name}</strong>:
          products, customers, suppliers, past bills and day summaries are recreated. This cannot be undone once
          imported, and you will be signed out when it finishes.
        </div>
      </ConfirmDialog>
    </>
  )
}

// ------------------------------------------------------------------
// Tables: restaurant floor plan configuration (device-local)
// ------------------------------------------------------------------

function TablesPanel() {
  const toast = useToast()
  const initialPrefs = loadPrefs()
  const [cfg, setCfg] = useState<TablesConfig>(() => normalizeTablesConfig(initialPrefs.tables))
  const [seatingPos, setSeatingPos] = useState<SeatingPos>(() => initialPrefs.seatingPos)
  const [seatingArrangement, setSeatingArrangement] = useState<SeatingArrangement>(() => initialPrefs.seatingArrangement)
  const [seatingSize, setSeatingSize] = useState<SeatingSize>(() => initialPrefs.seatingSize)
  const [seatingCustomTile, setSeatingCustomTile] = useState<number>(() => initialPrefs.seatingCustomTile)
  const [seatingCustomHeight, setSeatingCustomHeight] = useState<number>(() => initialPrefs.seatingCustomHeight)

  // Interactive floor simulator state — tapping tables cycles their status
  const [simulatedState, setSimulatedState] = useState<Record<string, 'avail' | 'occ' | 'act'>>({
    '1': 'occ',
    '2': 'act',
    '5': 'occ',
  })

  function toggleSimulatedTable(id: string) {
    setSimulatedState((prev) => {
      const cur = prev[id] || 'avail'
      const next = cur === 'avail' ? 'occ' : cur === 'occ' ? 'act' : 'avail'
      return { ...prev, [id]: next }
    })
  }

  const seededRef = useRef({
    tables: normalizeTablesConfig(initialPrefs.tables),
    seatingPos: initialPrefs.seatingPos,
    seatingArrangement: initialPrefs.seatingArrangement,
    seatingSize: initialPrefs.seatingSize,
    seatingCustomTile: initialPrefs.seatingCustomTile,
    seatingCustomHeight: initialPrefs.seatingCustomHeight,
  })

  const dirty =
    JSON.stringify(cfg) !== JSON.stringify(seededRef.current.tables) ||
    seatingPos !== seededRef.current.seatingPos ||
    seatingArrangement !== seededRef.current.seatingArrangement ||
    seatingSize !== seededRef.current.seatingSize ||
    seatingCustomTile !== seededRef.current.seatingCustomTile ||
    seatingCustomHeight !== seededRef.current.seatingCustomHeight

  function patch(p: Partial<TablesConfig>) {
    setCfg((c) => normalizeTablesConfig({ ...c, ...p }))
  }

  function save() {
    const next = loadPrefs()
    const updated = {
      ...next,
      tables: cfg,
      seatingPos,
      seatingArrangement,
      seatingSize,
      seatingCustomTile: clampSeatingTile(seatingCustomTile),
      seatingCustomHeight: clampSeatingHeight(seatingCustomHeight),
    }
    savePrefs(updated)
    seededRef.current = {
      tables: cfg,
      seatingPos,
      seatingArrangement,
      seatingSize,
      seatingCustomTile: clampSeatingTile(seatingCustomTile),
      seatingCustomHeight: clampSeatingHeight(seatingCustomHeight),
    }
    toast('Table configuration saved on this counter device.')
  }

  function discard() {
    setCfg(seededRef.current.tables)
    setSeatingPos(seededRef.current.seatingPos)
    setSeatingArrangement(seededRef.current.seatingArrangement)
    setSeatingSize(seededRef.current.seatingSize)
    setSeatingCustomTile(seededRef.current.seatingCustomTile)
    setSeatingCustomHeight(seededRef.current.seatingCustomHeight)
  }

  const labels = tableLabels(cfg)
  const previewLabels = labels.slice(0, 48)

  const patternHint: Record<TablePattern, string> = {
    numeric: 'Sequential numbers: 1, 2, 3 … standard table numbering',
    letters: 'Bar & counter seats: A, B, C … alphabet sequence',
    grid: 'Floor sectors & rows: A1, A2, B1, B2 … multi-station dining',
    custom: 'Branded sections: BAR-1, VIP-1, PATIO-1 … custom prefix sequence',
  }

  const tileMin =
    seatingSize === 'compact' ? 80 : seatingSize === 'large' ? 145 : seatingSize === 'custom' ? seatingCustomTile : 110
  const tileHeight =
    seatingSize === 'compact' ? 54 : seatingSize === 'large' ? 84 : seatingSize === 'custom' ? seatingCustomHeight : 68

  const gridPresets = [
    { label: '12 Tables (3×4)', r: 3, c: 4 },
    { label: '24 Tables (4×6)', r: 4, c: 6 },
    { label: '36 Tables (6×6)', r: 6, c: 6 },
    { label: '48 Tables (6×8)', r: 6, c: 8 },
  ]

  return (
    <div className="grid-2 bill-grid">
      <div className="stack" style={{ gap: 16 }}>
        {/* CARD 1: Service Mode & Tip Prompt */}
        <Panel
          title="Floor Service Mode &amp; POS Behavior"
          subtitle="Switches Sales between high-speed retail checkout and dine-in restaurant operations"
          bodyPad
        >
          <div className="stack" style={{ gap: 14 }}>
            <div className="pref-row">
              <div>
                <div className="pref-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Dine-In Table Floor Service</span>
                  <Tag kind={cfg.enabled ? 'green' : 'gray'}>{cfg.enabled ? 'TABLE POS' : 'RETAIL COUNTER'}</Tag>
                </div>
                <div className="t-caption">
                  {cfg.enabled
                    ? 'Interactive floor grid is active on Sales. Allows holding open tabs, table rounds, and dine-in billing.'
                    : 'Single high-speed retail queue. Table grid is hidden for direct scanning and instant checkout.'}
                </div>
              </div>
              <button
                className={`switch ${cfg.enabled ? 'on' : ''}`}
                type="button"
                role="switch"
                aria-checked={cfg.enabled}
                aria-label="Enable table service"
                onClick={() => patch({ enabled: !cfg.enabled })}
              >
                <span className="knob" />
              </button>
            </div>

            <div className="pref-row" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <div>
                <div className="pref-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Service Tip &amp; Gratuity Prompt</span>
                  <Tag kind={cfg.tips ? 'green' : 'gray'}>{cfg.tips ? 'ON' : 'OFF'}</Tag>
                </div>
                <div className="t-caption">
                  Displays a 1-tap tip selector at checkout (No tip / 5% / 10% / custom ₹) printed on the customer receipt.
                </div>
              </div>
              <button
                className={`switch ${cfg.tips ? 'on' : ''}`}
                type="button"
                role="switch"
                aria-checked={cfg.tips}
                aria-label="Enable service tip"
                onClick={() => patch({ tips: !cfg.tips })}
              >
                <span className="knob" />
              </button>
            </div>
          </div>
        </Panel>

        {/* CARD 2: Touch & Display Presets (Tablet Optimized) */}
        <Panel
          title="Touch Tile Dimensions &amp; Layout"
          subtitle="Engineered for counter touchscreens, iPads, and high-density monitors"
          bodyPad
        >
          <div className="stack" style={{ gap: 14 }}>
            <div className="pref-row">
              <div>
                <div className="pref-label">Tile sizing preset</div>
                <div className="t-caption">
                  {seatingSize === 'standard' && 'Recommended for iPads & tablets (≥48px touch targets for rapid tapping).'}
                  {seatingSize === 'compact' && 'Dense layout for high-capacity banquet halls and bars (30+ tables).'}
                  {seatingSize === 'large' && 'High-visibility tiles for large wall-mounted POS displays.'}
                  {seatingSize === 'custom' && 'Manual pixel footprint for custom counter displays.'}
                </div>
              </div>
              <Seg<SeatingSize>
                value={seatingSize}
                options={[
                  { v: 'compact', label: 'Compact (80px)' },
                  { v: 'standard', label: 'Standard (Tablet)' },
                  { v: 'large', label: 'Large (145px)' },
                  { v: 'custom', label: 'Custom' },
                ]}
                onChange={(s) => setSeatingSize(s)}
              />
            </div>

            {seatingSize === 'custom' && (
              <div className="form-grid" style={{ padding: '10px 12px', background: 'var(--layer)', border: '1px solid var(--line)' }}>
                <Field label={`Tile width (${SEATING_TILE_MIN}–${SEATING_TILE_MAX}px)`}>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <input
                      className="field-control num"
                      type="number"
                      min={SEATING_TILE_MIN}
                      max={SEATING_TILE_MAX}
                      value={seatingCustomTile}
                      onChange={(e) => setSeatingCustomTile(clampSeatingTile(Number(e.target.value)))}
                    />
                    <span className="t-caption">px</span>
                  </div>
                </Field>
                <Field label={`Tile height (${SEATING_HEIGHT_MIN}–${SEATING_HEIGHT_MAX}px)`}>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <input
                      className="field-control num"
                      type="number"
                      min={SEATING_HEIGHT_MIN}
                      max={SEATING_HEIGHT_MAX}
                      value={seatingCustomHeight}
                      onChange={(e) => setSeatingCustomHeight(clampSeatingHeight(Number(e.target.value)))}
                    />
                    <span className="t-caption">px</span>
                  </div>
                </Field>
              </div>
            )}

            <div className="pref-row" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <div>
                <div className="pref-label">Tile arrangement</div>
                <div className="t-caption">Choose between a multi-column visual matrix or a compact vertical list.</div>
              </div>
              <Seg<SeatingArrangement>
                value={seatingArrangement}
                options={[
                  { v: 'grid', label: 'Matrix Grid' },
                  { v: 'list', label: 'Linear List' },
                ]}
                onChange={(a) => setSeatingArrangement(a)}
              />
            </div>

            <div className="pref-row">
              <div>
                <div className="pref-label">Floor plan placement</div>
                <div className="t-caption">Position of the seating area relative to the billing register.</div>
              </div>
              <Seg<SeatingPos>
                value={seatingPos}
                options={[
                  { v: 'top', label: 'Top' },
                  { v: 'bottom', label: 'Bottom' },
                  { v: 'left', label: 'Left' },
                  { v: 'right', label: 'Right' },
                ]}
                onChange={(p) => setSeatingPos(p)}
              />
            </div>
          </div>
        </Panel>

        {/* CARD 3: Floor Dimensions & Numbering Scheme */}
        <Panel
          title="Floor Capacity &amp; Table Numbering"
          subtitle="Configure table counts and identification scheme"
          bodyPad
        >
          <div className="stack" style={{ gap: 14 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Quick Capacity Presets</span>
                <span className="num" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--blue)' }}>
                  {labels.length} Tables Active ({cfg.rows}R × {cfg.cols}C)
                </span>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {gridPresets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`btn btn-sm ${cfg.rows === p.r && cfg.cols === p.c ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ height: 34, fontSize: 12.5, padding: '0 10px' }}
                    onClick={() => patch({ rows: p.r, cols: p.c })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <GridSizeEditor
              rows={cfg.rows}
              cols={cfg.cols}
              onApply={(r, c) => patch({ rows: r, cols: c })}
            />

            <div className="pref-row" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <div>
                <div className="pref-label">Table identifier pattern</div>
                <div className="t-caption">{patternHint[cfg.pattern]}</div>
              </div>
              <Seg<TablePattern>
                value={cfg.pattern}
                options={[
                  { v: 'numeric', label: '1 2 3' },
                  { v: 'letters', label: 'A B C' },
                  { v: 'grid', label: 'A1 B1' },
                  { v: 'custom', label: 'Custom' },
                ]}
                onChange={(pattern) => patch({ pattern })}
              />
            </div>

            {cfg.pattern === 'custom' && (
              <Field label="Custom prefix text" help="Prepended before sequential table numbers (e.g. BAR-, VIP-, T-).">
                <input
                  className="field-control"
                  style={{ maxWidth: 220 }}
                  value={cfg.prefix}
                  maxLength={8}
                  onChange={(e) => patch({ prefix: e.target.value })}
                  placeholder="BAR-"
                />
              </Field>
            )}

            <div className="row" style={{ gap: 10, marginTop: 6 }}>
              <Btn
                variant="primary"
                disabled={!dirty}
                onClick={save}
                style={{ height: 44, padding: '0 20px', flex: 1 }}
              >
                {dirty ? 'Save Table Plan' : 'Configuration Saved'}
              </Btn>
              {dirty && (
                <Btn variant="ghost" onClick={discard} style={{ height: 44 }}>
                  Discard Changes
                </Btn>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* RIGHT COLUMN: Interactive Live Floor Simulator */}
      <div className="rail" style={{ position: 'sticky', top: 60 }}>
        <Panel
          title="Interactive Floor Simulator"
          subtitle="Tap any table below to test status transitions"
          bodyPad
        >
          <div className="t-caption" style={{ marginBottom: 10, color: 'var(--subtle)' }}>
            <strong>Touch simulator:</strong> Tap any tile to cycle: Available &rarr; Occupied tab &rarr; Active billing.
          </div>

          {seatingArrangement === 'list' ? (
            <div className="seat-list" style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 12 }}>
              {previewLabels.slice(0, 16).map((l, i) => {
                const id = tableId(l)
                const sim = simulatedState[id] || (i === 0 ? 'occ' : i === 1 ? 'act' : 'avail')
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleSimulatedTable(id)}
                    className={`seat-row ${sim === 'occ' ? 'occ' : sim === 'act' ? 'act' : ''}`}
                    style={{
                      width: '100%',
                      minHeight: Math.max(44, tileHeight * 0.7),
                      cursor: 'pointer',
                      border: '1px solid var(--line)',
                      background: 'var(--canvas)',
                      textAlign: 'left',
                      marginBottom: 4,
                    }}
                  >
                    <span className="fc-label" style={{ fontWeight: 600 }}>{l}</span>
                    {sim === 'occ' ? (
                      <span className="fc-amt num" style={{ color: 'var(--ok-fg)', fontWeight: 600 }}>
                        ₹ 480 · 3 items
                      </span>
                    ) : sim === 'act' ? (
                      <span className="fc-amt num" style={{ color: 'var(--blue)', fontWeight: 600 }}>
                        Active Billing
                      </span>
                    ) : (
                      <span className="seat-row-free" style={{ color: 'var(--muted)' }}>Available</span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div
              className="floor-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.min(tileMin, 120)}px, 1fr))`,
                gap: 6,
                maxHeight: 340,
                overflowY: 'auto',
                marginBottom: 12,
              }}
            >
              {previewLabels.map((l, i) => {
                const id = tableId(l)
                const sim = simulatedState[id] || (i === 0 ? 'occ' : i === 1 ? 'act' : 'avail')
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleSimulatedTable(id)}
                    className={`floor-cell ${sim === 'occ' ? 'occ' : sim === 'act' ? 'act' : ''}`}
                    style={{
                      minHeight: tileHeight,
                      cursor: 'pointer',
                      border: '1px solid var(--line)',
                      background: 'var(--canvas)',
                      padding: '8px 10px',
                    }}
                  >
                    <div className="fc-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="fc-label" style={{ fontWeight: 600 }}>{l}</span>
                      <span
                        className="fc-status-pill"
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          color: sim === 'occ' ? 'var(--ok-fg)' : sim === 'act' ? 'var(--blue)' : 'var(--subtle)',
                        }}
                      >
                        {sim === 'occ' ? 'TAB' : sim === 'act' ? 'POS' : 'FREE'}
                      </span>
                    </div>
                    <div className="fc-bottom" style={{ marginTop: 6 }}>
                      {sim === 'occ' && <span className="fc-amt num" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ok-fg)' }}>₹ 480</span>}
                      {sim === 'act' && <span className="fc-amt num" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--blue)' }}>Billing</span>}
                      {sim === 'avail' && <span className="fc-meta" style={{ fontSize: 11, color: 'var(--subtle)' }}>Available</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          <div className="kv-list" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div className="kv-row">
              <span className="kv-key">Active tables</span>
              <span className="kv-val num">{labels.length} total</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Touch footprint</span>
              <span className="kv-val num">{tileMin}px × {tileHeight}px</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Layout position</span>
              <span className="kv-val" style={{ textTransform: 'capitalize' }}>{seatingPos}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Identifier pattern</span>
              <span className="kv-val" style={{ textTransform: 'capitalize' }}>{cfg.pattern}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">Service state</span>
              <span className="kv-val">
                {cfg.enabled ? <Tag kind="green">Dine-In POS</Tag> : <Tag kind="gray">Retail Counter</Tag>}
              </span>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              background: 'var(--layer)',
              border: '1px solid var(--line)',
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, background: 'var(--ok-fg)' }} />
              <span><strong>Green TAB</strong>: Open bill / guest seated.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, background: 'var(--blue)' }} />
              <span><strong>Blue POS</strong>: Table actively open in register.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, border: '1px solid var(--line-strong)', background: 'var(--canvas)' }} />
              <span><strong>Plain</strong>: Available for new order.</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Team: staff accounts with per-account tab grants and status tags
// ------------------------------------------------------------------

function TeamPanel() {
  const { wsUid, role, user } = useAuth()
  const shopId = wsUid
  const toast = useToast()

  const [data, setData] = useState<{ cap: number | null; count: number; employees: PEmployee[] } | null>(null)
  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'edit'; emp: PEmployee } | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<PEmployee | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PEmployee | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      setData(await repo.listEmployees(shopId))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load staff.', 'err')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s || !data) return data?.employees ?? []
    return data.employees.filter((m) => fuzzyMatch([m.name, m.email], s))
  }, [data, search])

  async function flipStatus(m: PEmployee) {
    if (!confirmTarget) return
    setBusy(true)
    try {
      if (m.isActive) await repo.suspendEmployee(shopId, m.userId)
      else await repo.reactivateEmployee(shopId, m.userId)
      toast(m.isActive ? `${m.name} suspended. Sign-in is blocked at the database.` : `${m.name} reactivated.`)
      setConfirmTarget(null)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Status change failed.', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await repo.deleteEmployee(shopId, deleteTarget.userId)
      toast(`${deleteTarget.name} deleted. Sales history is preserved.`)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.', 'err')
    } finally {
      setBusy(false)
    }
  }

  const tabsRegistry = user?.tabs && user.tabs.length > 0 ? user.tabs : FALLBACK_TABS

  if (role !== 'owner') {
    return (
      <Panel bodyPad>
        <EmptyState
          title="Owner access required"
          hint="Only the shop owner account can manage staff accounts, credentials, and access grants. Ask the shop owner to sign in on this device."
        />
      </Panel>
    )
  }

  const atLimit = data != null && data.cap != null && data.count >= data.cap

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Panel>
        <div className="panel-head">
          <div className="panel-title-group">
            <span className="panel-title">Team register</span>
            <span className="t-caption">
              {filtered.length} of {data?.count ?? 0} accounts
            </span>
          </div>
          <div className="panel-actions">
            <div className="toolbar-grow search-box">
              <input
                className="field-control"
                placeholder="Search staff by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {atLimit ? (
              <span className="t-caption" style={{ color: 'var(--err)' }}>
                Plan limit of {data?.cap} staff reached.
              </span>
            ) : (
              <Btn variant="primary" onClick={() => setDrawer({ mode: 'new' })}>
                + Add employee
              </Btn>
            )}
          </div>
        </div>

        {!data ? (
          <div className="skeleton" style={{ height: 140 }} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={data.employees.length ? 'No matching employees' : 'No employee accounts yet'}
            hint={
              data.employees.length
                ? 'Adjust the search keyword to find staff.'
                : 'Create employee accounts and grant each one access per tab.'
            }
          />
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="td-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const deleted = m.status === 'deleted'
                  const suspended = m.status === 'suspended' || (!deleted && !m.isActive)
                  return (
                    <tr key={m.userId}>
                      <td>
                        <span className="cell-main">{m.name}</span>
                        <span className="cell-sub">{m.email}</span>
                      </td>
                      <td>
                        <Tag kind={ROLE_TONE[m.role] ?? 'gray'}>{ROLE_LABEL[m.role] ?? m.role}</Tag>
                        {m.role !== 'owner' && (
                          <span className="cell-sub">
                            {m.tabGrants?.length ?? 0} tab{(m.tabGrants?.length ?? 0) === 1 ? '' : 's'}
                          </span>
                        )}
                      </td>
                      <td>
                        {deleted ? (
                          <Tag kind="red">Deleted</Tag>
                        ) : suspended ? (
                          <Tag kind="warn">Suspended</Tag>
                        ) : (
                          <Tag kind="green">Active</Tag>
                        )}
                      </td>
                      <td className="td-right">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          <Btn sm variant="secondary" disabled={deleted} onClick={() => setDrawer({ mode: 'edit', emp: m })}>
                            Edit
                          </Btn>
                          <Btn
                            sm
                            variant="ghost"
                            disabled={deleted}
                            style={m.isActive ? { color: 'var(--err)' } : undefined}
                            onClick={() => setConfirmTarget(m)}
                          >
                            {deleted ? 'Deleted' : m.isActive ? 'Suspend' : 'Reactivate'}
                          </Btn>
                          {!deleted && (
                            <Btn sm variant="ghost" style={{ color: 'var(--err)' }} onClick={() => setDeleteTarget(m)}>
                              <IconTrash size={14} /> Delete
                            </Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Access model summary */}
      <Panel title="Access model" bodyPad>
        <div className="team-note">
          Owners see every module plus all money and valuation figures. Employees see only the
          tabs you grant them in each account's drawer, plus two switches. Money (sales totals,
          drawer cash) and Valuation (cost price, stock value). Purchases stays owner-only.
        </div>

        <div className="micro-label" style={{ margin: '16px 0 6px', fontSize: 11, fontWeight: 600, color: 'var(--subtle)', letterSpacing: '0.4px', textTransform: 'uppercase' }}>
          Grantable tabs (per employee)
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {tabsRegistry.map((t) => (
            <Tag key={t.key} kind="gray">{t.label}</Tag>
          ))}
        </div>
      </Panel>

      <MemberDrawer
        state={drawer}
        onClose={() => setDrawer(null)}
        onSaved={() => {
          setDrawer(null)
          load()
        }}
      />

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.isActive ? `Suspend ${confirmTarget?.name}?` : `Reactivate ${confirmTarget?.name}?`}
        message={
          confirmTarget?.isActive
            ? 'Their active JWT sessions will be revoked and database queries denied immediately.'
            : 'They regain login access and the tabs granted on this account.'
        }
        busy={busy}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => confirmTarget && flipStatus(confirmTarget)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${deleteTarget?.name}?`}
        message="Delete this employee account? Sales history is preserved."
        confirmLabel="Delete employee"
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function MemberDrawer({
  state,
  onClose,
  onSaved,
}: {
  state: { mode: 'new' } | { mode: 'edit'; emp: PEmployee } | null
  onClose: () => void
  onSaved: () => void
}) {
  const { wsUid, user, surfaceOn } = useAuth()
  const shopId = wsUid
  const toast = useToast()

  const initial = state?.mode === 'edit' ? state.emp : null
  const baseTabs = user?.tabs && user.tabs.length > 0 ? user.tabs : FALLBACK_TABS
  const tabsRegistry = useMemo(() => {
    if (surfaceOn(SURFACE_SHEET) && !baseTabs.some((t) => t.key === 'sheet')) {
      const stockIdx = baseTabs.findIndex((t) => t.key === 'stock')
      const item = { key: 'sheet', label: 'Sheet (Daily registers)' }
      if (stockIdx >= 0) {
        return [...baseTabs.slice(0, stockIdx + 1), item, ...baseTabs.slice(stockIdx + 1)]
      }
      return [...baseTabs, item]
    }
    return baseTabs.filter((t) => t.key !== 'sheet' || surfaceOn(SURFACE_SHEET))
  }, [baseTabs, surfaceOn])

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tabKeys, setTabKeys] = useState<string[]>(['dashboard'])
  const [canMoney, setCanMoney] = useState(false)
  const [canValuation, setCanValuation] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!state) return
    setName(initial?.name ?? '')
    setEmail(initial?.email ?? '')
    setPassword('')
    setTabKeys(initial && initial.tabGrants && initial.tabGrants.length > 0 ? [...initial.tabGrants] : ['dashboard'])
    setCanMoney(initial?.canSeeMoney ?? false)
    setCanValuation(initial?.canSeeValuation ?? false)
  }, [state, initial])

  function toggleTab(key: string, on: boolean) {
    setTabKeys((prev) => (on ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key)))
  }

  async function save() {
    if (!name.trim()) return toast('Name is required.', 'err')
    if (tabKeys.length === 0) return toast('Select at least one tab.', 'err')
    setBusy(true)
    try {
      if (initial) {
        const grantsChanged =
          JSON.stringify([...tabKeys].sort()) !== JSON.stringify([...(initial.tabGrants ?? [])].sort()) ||
          canMoney !== initial.canSeeMoney ||
          canValuation !== initial.canSeeValuation
        if (grantsChanged) {
          await repo.updateEmployeeAccess(shopId, initial.userId, {
            tabGrants: tabKeys,
            canSeeMoney: canMoney,
            canSeeValuation: canValuation,
          })
          toast(`${name.trim()} access updated.`)
        }
        if (password.trim()) {
          if (password.length < 8) return toast('Temporary password must be at least 8 characters.', 'err')
          await repo.resetEmployeePassword(shopId, initial.userId, password)
          toast('Password reset. Share the new one privately.')
        }
        if (!grantsChanged && !password.trim()) toast(`${name.trim()}: nothing changed.`)
      } else {
        const em = email.trim().toLowerCase()
        if (!em || !em.includes('@')) return toast('A valid email is required.', 'err')
        if (password.length < 8) return toast('Temporary password must be at least 8 characters.', 'err')
        await repo.createEmployee(shopId, {
          name: name.trim(),
          email: em,
          password,
          tabGrants: tabKeys,
          canSeeMoney: canMoney,
          canSeeValuation: canValuation,
        })
        toast(`Account created for ${name.trim()}. Share the email and temporary password with them.`)
      }
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={!!state}
      title={initial ? `Edit ${initial.name}` : 'New employee account'}
      onClose={onClose}
      wide
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Btn variant="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Create account & grant access'}
          </Btn>
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
        </div>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        {!initial && (
          <>
            <Field label="Full name">
              <input
                className="field-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ravi Kumar"
                autoFocus
              />
            </Field>
            <Field label="Login email">
              <input
                className="field-control"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@example.com"
              />
            </Field>
            <Field
              label="Temporary password"
              help="At least 8 characters. Share it privately; employee can sign in immediately."
            >
              <input
                className="field-control num"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="min 8 characters"
              />
            </Field>
          </>
        )}
        {initial && (
          <>
            <Field
              label="Full name"
              help="Name is set at account creation and cannot be edited here."
            >
              {/* Read-only like the email: no backend endpoint updates a staff
                  name, so an editable field would silently discard edits. */}
              <input className="field-control" value={name} disabled readOnly />
            </Field>
            <Field label="Login email">
              <input className="field-control" type="email" value={email} disabled readOnly />
            </Field>
          </>
        )}

        <Field label="Tabs this employee can access" help="Only granted tabs appear in their app navigation.">
          <div className="perm-grid">
            {tabsRegistry.map((t) => {
              const on = tabKeys.includes(t.key)
              return (
                <label key={t.key} className={`perm-card ${on ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    className="check-box"
                    checked={on}
                    onChange={(e) => toggleTab(t.key, e.target.checked)}
                  />
                  <span className="perm-card-main">
                    <span className="perm-card-label">{t.label}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </Field>

        <div className="pref-row">
          <div>
            <div className="pref-label">Money (see sales totals, drawer cash)</div>
            <div className="t-caption">Grants aggregate sales figures, daybook cash, and dashboard money tiles.</div>
          </div>
          <button
            className={`switch ${canMoney ? 'on' : ''}`}
            type="button"
            role="switch"
            aria-checked={canMoney}
            aria-label="See money"
            onClick={() => setCanMoney((v) => !v)}
          >
            <span className="knob" />
          </button>
        </div>

        <div className="pref-row last">
          <div>
            <div className="pref-label">Valuation (see cost price, stock value)</div>
            <div className="t-caption">Reveals cost prices, COGS, margins, and stock valuation figures.</div>
          </div>
          <button
            className={`switch ${canValuation ? 'on' : ''}`}
            type="button"
            role="switch"
            aria-checked={canValuation}
            aria-label="See valuation"
            onClick={() => setCanValuation((v) => !v)}
          >
            <span className="knob" />
          </button>
        </div>

        {initial && (
          <Field label="Reset temporary password" help="Leave blank to keep the current password.">
            <input
              className="field-control num"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="new password (min 8 chars)"
            />
          </Field>
        )}

        <div className="t-caption" style={{ lineHeight: 1.6 }}>
          <strong>Owner:</strong> always sees every tab plus all money and valuation figures.<br />
          <strong>Employee:</strong> sees only the tabs granted here. Money and valuation are opt-in per
          account. Changes apply within one sync poll.
        </div>
      </div>
    </Drawer>
  )
}

// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Shops: multi-shop owner - read-only shop list + retailer login
// password reset. Shop CREATION is developer-only (dev console);
// the owner's single permitted action is resetting a retailer login.
// ------------------------------------------------------------------

function ShopsPanel() {
  const { user, activeShop } = useAuth()
  const toast = useToast()

  const shops = user?.shops ?? []
  const godownShopId = shops.find((s) => s.is_primary)?.id ?? shops[0]?.id ?? ''
  const retailerShops = shops.filter((s) => s.id !== godownShopId)

  const [resetShopId, setResetShopId] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitReset() {
    const shop = shops.find((s) => s.id === resetShopId)
    if (!shop) return toast('Select the retailer shop first.', 'err')
    if (newPassword.length < 8) return toast('New password must be at least 8 characters.', 'err')
    if (newPassword !== confirmPassword) return toast('The two passwords do not match.', 'err')
    setBusy(true)
    try {
      const res = await repo.resetShopLogin(shop.id, newPassword)
      toast(`Password reset for ${shop.name} (${res.login_email}). Share it privately - it cannot be viewed again.`)
      setResetShopId('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not reset the password. Check your connection and retry.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Panel>
        <div className="panel-head">
          <div className="panel-title-group">
            <span className="panel-title">My shops</span>
            <span className="t-caption">
              {shops.length} shops · {activeShop?.tenant_name || 'This business'}
            </span>
          </div>
        </div>
        {shops.length === 0 ? (
          <EmptyState
            title="No shops on your account"
            hint="Your shop list could not be loaded. Re-open this page once your session has loaded."
          />
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Account</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="cell-main">{s.name}</span>
                      <span className="cell-sub">{s.code}</span>
                    </td>
                    <td>
                      {s.is_primary ? (
                        <Tag kind="blue">OWNER</Tag>
                      ) : (
                        <Tag kind="gray">RETAILER</Tag>
                      )}
                    </td>
                    <td>
                      {s.id === activeShop?.id ? <Tag kind="green">Active</Tag> : <span className="t-caption">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="t-caption" style={{ margin: '10px 0 0' }}>
          Adding or removing shops is done by your developer. Each shop signs in with its own email and password -
          there is no switching between shops inside one login.
        </p>
      </Panel>

      <Panel title="Reset retailer shop password" bodyPad>
        <p className="t-caption" style={{ marginTop: 0, marginBottom: 12 }}>
          Set a new password for one of your retailer shops' own login. The retailer signs in with the same email as
          before; any device they were signed in on is signed out.
        </p>
        {retailerShops.length === 0 ? (
          <EmptyState title="No retailer shops" hint="Only retailer outlets have separate logins to reset." />
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <Field label="Retailer shop" required>
              <select
                className="field-control"
                value={resetShopId}
                onChange={(e) => setResetShopId(e.target.value)}
                disabled={busy}
              >
                <option value="">Select a shop…</option>
                {retailerShops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="New password" help="At least 8 characters. Share it privately; it cannot be viewed again." required>
                <input
                  className="field-control num"
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="min 8 characters"
                  disabled={busy}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm new password" required>
                <input
                  className="field-control num"
                  type="text"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="type it again"
                  disabled={busy}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Btn variant="primary" disabled={busy || !resetShopId} onClick={submitReset}>
                {busy ? 'Resetting…' : 'Reset password'}
              </Btn>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}

// ------------------------------------------------------------------
// Local Cache & Offline Storage Controls (Data Control Tab)
// ------------------------------------------------------------------

function OfflineCachePanel() {
  const { wsUid } = useAuth()
  const toast = useToast()

  const [cacheStats, setCacheStats] = useState<{
    products: number
    categories: number
    customers: number
    queue: number
    lastSync: string | null
  }>({
    products: 0,
    categories: 0,
    customers: 0,
    queue: 0,
    lastSync: null,
  })

  const [syncing, setSyncing] = useState(false)
  const [purgeDialog, setPurgeDialog] = useState(false)
  const [queueRows, setQueueRows] = useState<QueueInspectionRow[]>([])

  const loadCacheStats = async () => {
    try {
      const [stats, queueRowsNow] = await Promise.all([getOfflineCacheStats(), listQueueForReview()])
      setQueueRows(queueRowsNow)
      setCacheStats({
        ...stats,
        lastSync: stats.lastSync ? new Date(stats.lastSync).toLocaleString('en-US', { hour12: true }) : 'Never',
      })
    } catch {
      // Ignore Dexie read errors
    }
  }

  async function handleRetryQueued(id: string) {
    try {
      await retryQueuedSale(id)
      await handleForceSync()
      toast('Bill re-queued and flushed to the server.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Retry failed.', 'err')
      await loadCacheStats()
    }
  }

  async function handleDiscardQueued(id: string) {
    try {
      await discardQueuedSale(id)
      await loadCacheStats()
      toast('Stranded bill discarded from this device.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Discard failed.', 'err')
    }
  }

  useEffect(() => {
    loadCacheStats()
  }, [])

  async function handleForceSync() {
    if (!wsUid) return
    setSyncing(true)
    try {
      await Promise.all([flushOfflineSalesQueue(), pullCatalogDelta(wsUid)])
      await loadCacheStats()
      toast('Catalog delta synchronized and offline queue flushed.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sync failed.', 'err')
    } finally {
      setSyncing(false)
    }
  }

  async function handlePurgeCache() {
    try {
      await purgeCatalogCache()
      setPurgeDialog(false)
      await loadCacheStats()
      toast('IndexedDB product and catalog cache purged.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Purge failed.', 'err')
    }
  }

  return (
    <Panel title="Offline Storage & Local Sync (IndexedDB)" bodyPad>
      <div className="t-caption" style={{ margin: '0 0 16px' }}>
        Browser IndexedDB cache keeps counter checkout operational offline and synchronizes automatically on reconnection.
      </div>

      {/* High-density 5-tile Carbon Metric Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 1,
          background: 'var(--line)',
          border: '1px solid var(--line)',
          marginBottom: 16,
        }}
      >
        <div style={{ padding: '10px 12px', background: 'var(--canvas)' }}>
          <span className="micro-label" style={{ display: 'block', color: 'var(--subtle)' }}>PRODUCTS</span>
          <span className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{cacheStats.products}</span>
        </div>
        <div style={{ padding: '10px 12px', background: 'var(--canvas)' }}>
          <span className="micro-label" style={{ display: 'block', color: 'var(--subtle)' }}>CATEGORIES</span>
          <span className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{cacheStats.categories}</span>
        </div>
        <div style={{ padding: '10px 12px', background: 'var(--canvas)' }}>
          <span className="micro-label" style={{ display: 'block', color: 'var(--subtle)' }}>CUSTOMERS</span>
          <span className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{cacheStats.customers}</span>
        </div>
        <div style={{ padding: '10px 12px', background: 'var(--canvas)' }}>
          <span className="micro-label" style={{ display: 'block', color: cacheStats.queue > 0 ? 'var(--warn-fg)' : 'var(--subtle)' }}>QUEUED SALES</span>
          <span className="num" style={{ fontSize: 16, fontWeight: 600, color: cacheStats.queue > 0 ? 'var(--warn-fg)' : 'var(--ink)' }}>{cacheStats.queue}</span>
        </div>
        <div style={{ padding: '10px 12px', background: 'var(--canvas)' }}>
          <span className="micro-label" style={{ display: 'block', color: 'var(--subtle)' }}>LAST DELTA SYNC</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cacheStats.lastSync ?? '—'}
          </span>
        </div>
      </div>

      {/* Carbon Action Buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Btn variant="primary" disabled={syncing} onClick={handleForceSync} style={{ height: 36, padding: '0 14px' }}>
          <IconRefresh size={14} /> {syncing ? 'Synchronizing…' : 'Force Catalog Sync'}
        </Btn>
        <Btn variant="ghost" style={{ color: 'var(--err)', height: 36, padding: '0 14px' }} onClick={() => setPurgeDialog(true)}>
          <IconTrash size={14} /> Purge Local Cache…
        </Btn>
      </div>

      {/* Stranded offline bills: action needed */}
      {queueRows.length > 0 && (
        <div style={{ marginTop: 16, border: '1px solid var(--err)', background: 'var(--canvas)' }}>
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--err-bg)',
              borderBottom: '1px solid var(--err)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--err-fg)', letterSpacing: '0.16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconAlertTriangle size={14} /> ACTION NEEDED: {queueRows.length} STRANDED OFFLINE BILL{queueRows.length > 1 ? 'S' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {queueRows.map((q) => (
              <div
                key={q.id ?? q.idempotency_key}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--line)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag kind={q.status === 'queued' ? 'blue' : q.status === 'conflict' ? 'red' : 'warn'}>{q.status}</Tag>
                    <span className="num" style={{ fontWeight: 600, fontSize: 13 }}>{money(q.total)}</span>
                    <span style={{ fontSize: 12, color: 'var(--subtle)' }}>
                      · {q.lineCount} item{q.lineCount === 1 ? '' : 's'} · {q.attempts} attempt{q.attempts === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                    {q.created_at ? new Date(q.created_at).toLocaleString('en-US', { hour12: true }) : '—'}
                    {q.last_error ? ` — ${q.last_error}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn sm variant="secondary" disabled={syncing} onClick={() => void handleRetryQueued(q.id!)}>
                    Retry now
                  </Btn>
                  <Btn sm variant="ghost" style={{ color: 'var(--err)' }} onClick={() => void handleDiscardQueued(q.id!)}>
                    Discard
                  </Btn>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 14px', background: 'var(--layer)', fontSize: 11, color: 'var(--muted)' }}>
            Retry re-posts the bill to the server (duplicate-safe). Discard removes the queued bill from this device only.
          </div>
        </div>
      )}

      <ConfirmDialog
        open={purgeDialog}
        title="Purge offline catalog cache?"
        message="This removes local IndexedDB cached product names and categories. Live data on the PostgreSQL server is unaffected; records will re-download on next sync."
        confirmLabel="Purge cache"
        onClose={() => setPurgeDialog(false)}
        onConfirm={handlePurgeCache}
      />
    </Panel>
  )
}

export default function SettingsPageGuarded() {
  const { can } = useAuth()
  if (!can('settings')) return <NoAccess what="Settings" />
  return <SettingsPage />
}
