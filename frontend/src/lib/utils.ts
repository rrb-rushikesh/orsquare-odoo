import { now, dayKeyOf, APP_TIMEZONE } from './clock'

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export const num = (n: number): string => nf.format(Number.isFinite(n) ? n : 0)
export const num0 = (n: number): string => nf0.format(Number.isFinite(n) ? n : 0)
export const money = (n: number): string => {
  const v = Number.isFinite(n) ? n : 0
  if (v < 0) return `-₹ ${num(Math.abs(v))}`
  return `₹ ${num(v)}`
}
export const money0 = (n: number): string => {
  const v = Number.isFinite(n) ? n : 0
  if (v < 0) return `-₹ ${num0(Math.abs(v))}`
  return `₹ ${num0(v)}`
}

export const compact = (n: number): string => {
  const neg = n < 0
  const a = Math.abs(n)
  if (a >= 1e7) return `${neg ? '-₹ ' : '₹ '}${(a / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${neg ? '-₹ ' : '₹ '}${(a / 1e5).toFixed(2)} L`
  if (a >= 1e3) return `${neg ? '-₹ ' : '₹ '}${(a / 1e3).toFixed(1)} K`
  return money(n)
}

export const dt = (ts?: number): string =>
  ts ? new Date(ts).toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE }) : '—'

/** Coerce a stored timestamp (number | Firestore Timestamp | ISO string) to
 *  epoch ms: 0 when it carries no usable time. */
export function tsToMs(v: unknown): number {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object') {
    const o = v as { toMillis?: () => number; seconds?: number }
    if (typeof o.toMillis === 'function') return o.toMillis()
    if (typeof o.seconds === 'number') return o.seconds * 1000
  }
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
  }
  return 0
}

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: APP_TIMEZONE,
})

export const tm = (ts?: number): string =>
  ts ? timeFmt.format(new Date(ts)) : '—'

/** 12-hour clock time ("6:02 AM") in APP_TIMEZONE from a stored ISO timestamp string. */
export const timeOf = (iso: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d)
}

/** Extracts authoritative 'YYYY-MM-DD' day key in APP_TIMEZONE ('Asia/Kolkata').
 *  Supports plain day keys ('2026-09-08'), full UTC/ISO timestamps ('2026-09-07T19:30:00Z'),
 *  and epoch timestamps.
 *  Never relies on raw UTC slice which causes day-drift for early morning transactions (12am-5:30am IST).
 */
export function dayKeyOfValue(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') {
    return Number.isFinite(v) && v > 0 ? dayKeyOf(v) : ''
  }
  if (typeof v !== 'string') return ''
  if (v.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const ms = Date.parse(v)
  if (!isNaN(ms)) {
    return dayKeyOf(ms)
  }
  if (v.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  return ''
}

/** Deterministic 'DD/MM/YYYY' date display strictly anchored to APP_TIMEZONE ('Asia/Kolkata').
 *  Accepts ISO strings, YYYY-MM-DD day keys, epoch timestamps, or Date objects.
 */
export function formatDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  const key = dayKeyOfValue(v as any)
  if (!key) return '—'
  const [y, m, d] = key.split('-')
  if (!y || !m || !d) return '—'
  return `${d}/${m}/${y}`
}

export const dateInputValue = (d: Date): string => {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** App-timezone month key ('YYYY-MM') anchored to APP_TIMEZONE (Asia/Kolkata),
 *  never the device-local calendar: drives the write-time sales summary.
 *  Defaults to the corrected app clock, not the raw device clock. */
export const monthKeyOf = (ts: number = now()): string => dayKeyOf(ts).slice(0, 7)

export const startOfDay = (ts: number): number => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const parseDateInput = (v: string): number => {
  const [y, m, d] = v.split('-').map(Number)
  if (!y || !m || !d) return now()
  return new Date(y, m - 1, d).getTime()
}

const round2 = (n: number): number => Math.round(n * 100) / 100
export { round2 }

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v)
    // Formula-injection guard: spreadsheet apps execute cells starting with
    // = + - @ TAB CR as formulas. Plain numbers (incl. negatives) pass through.
    if (!/^-?[\d.,]+$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const body = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || 'U'

// Shift a YYYY-MM-DD day key by N days (local calendar arithmetic, DST-safe
// via setDate, not fixed 86400000ms).
export function dayKeyShift(k: string, days: number): string {
  const d = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Receivable / payable totals.
//
// These used to filter on `type === 'Customer'` / `'Supplier'` while the rows
// above them were coloured by a per-screen sign check that also matched
// Retailer and Employee. So a Retailer's outstanding khata rendered green
// "You'll Get" in the table and was silently omitted from the summary tile
// directly above it - two different numbers for the same list.
//
// They now consume the server's authoritative `isReceivable` / `isPayable`,
// which accounts/selectors.py derives from the ledger. Advances are excluded
// from both, because an advance is neither money owed to us nor money we owe:
// a customer who prepaid is a liability, and counting it as a receivable
// inflated the figure. A null balance is a hidden balance, not a zero one, so
// it contributes nothing rather than pretending to be square.
export function receivablesOf(accounts: { isReceivable?: boolean; type: string; balance: number | null }[]): number {
  return accounts
    .filter((a) => a.isReceivable === true)
    .reduce((s, a) => s + (a.balance ?? 0), 0)
}

export function payablesOf(accounts: { isPayable?: boolean; type: string; balance: number | null }[]): number {
  return accounts
    .filter((a) => a.isPayable === true)
    .reduce((s, a) => s + (a.balance ?? 0), 0)
}

// Numeric size of a catalogue unit string ("90 ML" → 90, "1 L" → 1000).
// Returns NaN when the unit carries no measurable volume (e.g. "PCS").
export function unitMl(unit: string): number {
  const s = unit.toLowerCase().replace(/\s+/g, '')
  const m = s.match(/(\d+(?:\.\d+)?)/)
  if (!m) return Number.NaN
  const v = parseFloat(m[1])
  if (/ml/.test(s)) return v
  if (/l(?:itre|ter)?/.test(s)) return v * 1000
  return v
}

// Stable, deterministic short code for a workspace URL (/w/CODE). Derived
// purely from the uid: no storage, no lookups, same on every device.
export function workspaceCode(uid: string): string {
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < uid.length; i++) {
    const c = uid.charCodeAt(i)
    h1 = ((h1 * 33) ^ c) >>> 0
    h2 = ((h2 * 31) ^ c) >>> 0
  }
  return ((h1 ^ (h2 << 3)) >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 6)
}