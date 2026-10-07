/** Pure printer-selection and status helpers (no I/O): unit-tested in __tests__/printerSelect.test.ts. */

export type PrinterState = 'unknown' | 'ready' | 'missing' | 'offline' | 'attention'

const VIRTUAL = /pdf|xps|onenote|fax|microsoft print|print to file|anydesk|teamviewer|snagit|send to|cutepdf|nitro/i
const THERMAL = /pos|thermal|receipt|80\s?mm|58\s?mm|xprinter|gobbler|rongta|epson|\btm-|tsp|star|citizen|bixolon|\btvs\b|zjiang|gprinter|sewoo|posiflex|munbyn|hoin|everycom|sp-?pos/i

export function isVirtualPrinter(name: string): boolean {
  return VIRTUAL.test(name)
}

/**
 * Which printer should jobs go to?
 *  1. the configured name, if Windows still lists it;
 *  2. otherwise (renamed / reinstalled driver) the single thermal-looking printer, if exactly one;
 *  3. with nothing configured: best thermal match, then the Windows default, then the only physical printer.
 * Returns null rather than guess between several.
 */
export function pickPrinter(names: string[], configured: string, defaultName: string | null): string | null {
  const physical = names.filter((n) => !isVirtualPrinter(n))
  const want = configured.trim().toLowerCase()
  if (want) {
    const hit = names.find((n) => n.toLowerCase() === want)
    if (hit) return hit
    const thermal = physical.filter((n) => THERMAL.test(n))
    return thermal.length === 1 ? thermal[0] : null
  }
  const thermal = physical.filter((n) => THERMAL.test(n))
  if (thermal.length >= 1) return thermal[0]
  if (defaultName && physical.includes(defaultName)) return defaultName
  return physical.length === 1 ? physical[0] : null
}

const READY = new Set(['OK', 'BUSY', 'PRINTING', 'IO_ACTIVE', 'PROCESSING', 'WAITING', 'INITIALIZING', 'WARMING_UP', 'POWER_SAVE', 'TONER_LOW', 'PAGE_PUNT'])
const OFFLINE = new Set(['OFFLINE', 'NOT_AVAILABLE', 'SERVER_UNKNOWN'])
const ATTENTION = new Set(['PAPER_OUT', 'PAPER_JAM', 'PAPER_PROBLEM', 'DOOR_OPEN', 'ERROR', 'USER_INTERVENTION', 'NO_TONER', 'OUTPUT_BIN_FULL', 'PAUSED', 'OUT_OF_MEMORY', 'MANUAL_FEED'])

/** Maps a QZ/Windows printer status string to our three-way state. */
export function classifyStatus(text: string): PrinterState {
  const t = text.trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (!t) return 'unknown'
  if (READY.has(t)) return 'ready'
  if (OFFLINE.has(t)) return 'offline'
  if (ATTENTION.has(t)) return 'attention'
  return 'unknown'
}

/** Reconnect / retry delay: 1s, 2s, 4s ... capped, so a QZ outage never becomes a hammer. */
export function backoffMs(attempt: number, capMs = 30_000): number {
  return Math.min(capMs, 1000 * 2 ** Math.max(0, attempt))
}

