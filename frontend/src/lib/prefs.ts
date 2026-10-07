import type { TablesConfig } from '@/types'
import { DEFAULT_TABLES, normalizeTablesConfig } from './tables'
import { defaultPrintSettings, normalizePrintSettings, type PrintSettings } from './printing/presets'

export interface InvoicePrefs {
  shopName: string
  tagline: string
  addressLine: string
  addressLine2: string
  phone: string
  gstin: string
  prefix: string
  footerNote: string
}

export type Theme = 'light' | 'dark'
export type FontSize = 'small' | 'medium' | 'large'
export type FontFamily = 'plex' | 'system' | 'serif'
export type Density = 'comfortable' | 'compact'
export type SeatingArrangement = 'grid' | 'list'
export type SeatingSize = 'compact' | 'standard' | 'large' | 'custom'
export type SeatingPos = 'top' | 'left' | 'right' | 'bottom' | 'tab' | 'hidden'
export type PayMethodPref = 'Cash' | 'UPI' | 'Khata'
export type DefaultPayMethod = PayMethodPref | 'last'
/** What happens on this device right after a bill (or return note) completes. */
export type PrintMode = 'ask' | 'auto' | 'off'

export interface Prefs {
  theme: Theme
  fontSize: FontSize
  fontFamily: FontFamily
  density: Density
  invoice: InvoicePrefs
  /** Restaurant floor plan: device-local, no backend store. */
  tables: TablesConfig
  /** Seating area view: tile grid vs single-column list (phone-friendly). */
  seatingArrangement: SeatingArrangement
  /** Seating tile density. */
  seatingSize: SeatingSize
  /** Where the seating floor plan docks on the POS tab (top, left, right, bottom, separate tab, or hidden). */
  seatingPos: SeatingPos
  /** Custom seating tile width in px (used when seatingSize is 'custom'). */
  seatingCustomTile: number
  /** Custom seating tile height in px (used when seatingSize is 'custom'). */
  seatingCustomHeight: number
  /** Payment method pre-selected at checkout on this device ('last' remembers the previous bill). */
  defaultPayMethod: DefaultPayMethod
  /** Last payment method used on this device, applied when defaultPayMethod is 'last'. */
  lastPayMethod?: PayMethodPref
  /**
   * After-bill printing behavior on this device:
   * 'ask' (default) shows the once-per-bill print prompt, 'auto' prints
   * without asking, 'off' never opens a print window or prompt, manual
   * printing from the toolbar stays available. Supersedes autoPrintBill.
   */
  printMode: PrintMode
  /** Printer, paper preset and layout controls. DEVICE-local by design: a printer belongs to one terminal, never synced. */
  print: PrintSettings
  /** @deprecated Legacy opt-in flag; kept for migration (true → printMode 'auto'). */
  autoPrintBill?: boolean
  /** Turn on / off GST slab selection and tax calculation on checkout bills (default: false). Available for everyone. */
  enableGst: boolean
  /** Turn on / off coupon codes and discount schemes at checkout (default: false). Available for everyone. */
  enableDiscount: boolean
  /** Turn on / off kitchen dishes and food menu items with infinite stock (default: false). */
  enableKitchen: boolean
  /** Continuous scanning mode on Sales tab: scan -> accumulate in persistent draft -> settle when ready. */
  continuousScanning: boolean
  /** Sales-only payment mode: 'all' | 'Cash' | 'UPI'. When set, hides payment selector and settles strictly with that method. */
  salesDefaultPaymentMode: 'all' | 'Cash' | 'UPI'
}

const KEY = 'xpo.prefs'
const SERVER_CACHE_KEY = 'xpo.prefs.server'
const UNSYNCED_KEY = 'xpo.prefs.unsynced'

/** Keys replicated to the user's account (PATCH /api/auth/prefs/). Everything else stays device-local. */
export const SYNCED_KEYS = [
  'theme',
  'fontSize',
  'fontFamily',
  'density',
  'defaultPayMethod',
  'printMode',
  'invoice',
  'enableGst',
  'enableDiscount',
  'enableKitchen',
  'continuousScanning',
  'salesDefaultPaymentMode',
] as const

export const defaultPrefs: Prefs = {
  theme: 'light',
  fontSize: 'medium',
  fontFamily: 'plex',
  density: 'comfortable',
  invoice: {
    shopName: '',
    tagline: '',
    addressLine: '',
    addressLine2: '',
    phone: '',
    gstin: '',
    prefix: 'INV-',
    footerNote: 'Thank you for your business.',
  },
  tables: DEFAULT_TABLES,
  seatingArrangement: 'grid',
  seatingSize: 'standard',
  seatingPos: 'top',
  seatingCustomTile: 110,
  seatingCustomHeight: 68,
  defaultPayMethod: 'Cash',
  printMode: 'ask',
  print: defaultPrintSettings,
  enableGst: false,
  enableDiscount: false,
  enableKitchen: false,
  continuousScanning: false,
  salesDefaultPaymentMode: 'all',
}

export const SEATING_TILE_MIN = 70
export const SEATING_TILE_MAX = 240
export const SEATING_HEIGHT_MIN = 48
export const SEATING_HEIGHT_MAX = 160

export function clampSeatingTile(v: number): number {
  if (!Number.isFinite(v)) return 110
  return Math.min(SEATING_TILE_MAX, Math.max(SEATING_TILE_MIN, Math.round(v)))
}

export function clampSeatingHeight(v: number): number {
  if (!Number.isFinite(v)) return 68
  return Math.min(SEATING_HEIGHT_MAX, Math.max(SEATING_HEIGHT_MIN, Math.round(v)))
}

function asPayMethod(v: unknown): PayMethodPref | undefined {
  return v === 'Cash' || v === 'UPI' || v === 'Khata' ? v : undefined
}

function asDefaultPayMethod(v: unknown): DefaultPayMethod {
  return v === 'UPI' || v === 'Khata' || v === 'last' ? v : 'Cash'
}

function asPrintMode(v: unknown, legacyAutoPrint?: unknown): PrintMode {
  if (v === 'ask' || v === 'auto' || v === 'off') return v
  // Migration: devices that opted into the old "Always print" checkbox keep
  // auto-printing; everyone else keeps the default ask-once behavior.
  return legacyAutoPrint === true ? 'auto' : 'ask'
}

function asSyncedTheme(v: unknown): Theme | undefined {
  return v === 'light' || v === 'dark' ? v : undefined
}

function asSyncedFontSize(v: unknown): FontSize | undefined {
  return v === 'small' || v === 'medium' || v === 'large' ? v : undefined
}

function asSyncedFontFamily(v: unknown): FontFamily | undefined {
  return v === 'plex' || v === 'system' || v === 'serif' ? v : undefined
}

function asSyncedDensity(v: unknown): Density | undefined {
  return v === 'comfortable' || v === 'compact' ? v : undefined
}

function asSyncedDefaultPayMethod(v: unknown): DefaultPayMethod | undefined {
  return v === 'Cash' || v === 'UPI' || v === 'Khata' || v === 'last' ? v : undefined
}

function asSyncedPrintMode(v: unknown): PrintMode | undefined {
  return v === 'ask' || v === 'auto' || v === 'off' ? v : undefined
}

function asSyncedInvoice(v: unknown): Partial<InvoicePrefs> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const out: Partial<InvoicePrefs> = {}
  let any = false
  for (const k of Object.keys(defaultPrefs.invoice) as (keyof InvoicePrefs)[]) {
    if (typeof o[k] === 'string') {
      out[k] = o[k] as string
      any = true
    }
  }
  return any ? out : undefined
}

/** The account-synced subset of prefs (device-local keys are never uploaded). */
export function extractSynced(prefs: Prefs): Record<string, unknown> {
  return {
    theme: prefs.theme,
    fontSize: prefs.fontSize,
    fontFamily: prefs.fontFamily,
    density: prefs.density,
    defaultPayMethod: prefs.defaultPayMethod,
    printMode: prefs.printMode,
    invoice: { ...prefs.invoice },
    enableGst: !!prefs.enableGst,
    enableDiscount: !!prefs.enableDiscount,
    enableKitchen: !!prefs.enableKitchen,
    continuousScanning: !!prefs.continuousScanning,
    salesDefaultPaymentMode: prefs.salesDefaultPaymentMode,
  }
}

/** Copies known synced keys from a server blob onto prefs, ignoring invalid values. */
export function mergeSynced(prefs: Prefs, synced: Record<string, unknown>): Prefs {
  const next: Prefs = { ...prefs }
  const theme = asSyncedTheme(synced.theme)
  if (theme !== undefined) next.theme = theme
  const fontSize = asSyncedFontSize(synced.fontSize)
  if (fontSize !== undefined) next.fontSize = fontSize
  const fontFamily = asSyncedFontFamily(synced.fontFamily)
  if (fontFamily !== undefined) next.fontFamily = fontFamily
  const density = asSyncedDensity(synced.density)
  if (density !== undefined) next.density = density
  const defaultPayMethod = asSyncedDefaultPayMethod(synced.defaultPayMethod)
  if (defaultPayMethod !== undefined) next.defaultPayMethod = defaultPayMethod
  const printMode = asSyncedPrintMode(synced.printMode)
  if (printMode !== undefined) next.printMode = printMode
  const invoice = asSyncedInvoice(synced.invoice)
  if (invoice) next.invoice = { ...prefs.invoice, ...invoice }
  if (typeof synced.enableGst === 'boolean') next.enableGst = synced.enableGst
  if (typeof synced.enableDiscount === 'boolean') next.enableDiscount = synced.enableDiscount
  if (typeof synced.enableKitchen === 'boolean') next.enableKitchen = synced.enableKitchen
  if (typeof synced.continuousScanning === 'boolean') next.continuousScanning = synced.continuousScanning
  if (
    synced.salesDefaultPaymentMode === 'Cash' ||
    synced.salesDefaultPaymentMode === 'UPI' ||
    synced.salesDefaultPaymentMode === 'all'
  ) {
    next.salesDefaultPaymentMode = synced.salesDefaultPaymentMode
  }
  return next
}

function loadServerCache(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(SERVER_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function hasUnsyncedPrefs(): boolean {
  try {
    return localStorage.getItem(UNSYNCED_KEY) === '1'
  } catch {
    return false
  }
}

let serverCacheApplied = false

export function loadPrefs(): Prefs {
  let prefs: Prefs
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      prefs = { ...defaultPrefs, invoice: { ...defaultPrefs.invoice }, tables: { ...defaultPrefs.tables } }
    } else {
      const saved = JSON.parse(raw) as Partial<Prefs>
      prefs = {
        ...defaultPrefs,
        ...saved,
        invoice: { ...defaultPrefs.invoice, ...(saved.invoice ?? {}) },
        tables: normalizeTablesConfig(saved.tables),
        seatingCustomTile: clampSeatingTile(saved.seatingCustomTile ?? defaultPrefs.seatingCustomTile),
        seatingCustomHeight: clampSeatingHeight(saved.seatingCustomHeight ?? defaultPrefs.seatingCustomHeight),
        defaultPayMethod: asDefaultPayMethod(saved.defaultPayMethod),
        lastPayMethod: asPayMethod(saved.lastPayMethod),
        printMode: asPrintMode(saved.printMode, saved.autoPrintBill),
        print: normalizePrintSettings(saved.print),
        enableGst: typeof saved.enableGst === 'boolean' ? saved.enableGst : false,
        enableDiscount: typeof saved.enableDiscount === 'boolean' ? saved.enableDiscount : false,
        enableKitchen: typeof saved.enableKitchen === 'boolean' ? saved.enableKitchen : false,
        continuousScanning: typeof saved.continuousScanning === 'boolean' ? saved.continuousScanning : false,
        salesDefaultPaymentMode:
          saved.salesDefaultPaymentMode === 'Cash' || saved.salesDefaultPaymentMode === 'UPI'
            ? saved.salesDefaultPaymentMode
            : 'all',
      }
    }
  } catch {
    prefs = { ...defaultPrefs, invoice: { ...defaultPrefs.invoice }, tables: { ...defaultPrefs.tables } }
  }
  if (!serverCacheApplied) {
    serverCacheApplied = true
    if (!hasUnsyncedPrefs()) {
      const cached = loadServerCache()
      if (cached) prefs = mergeSynced(prefs, cached)
    }
  }
  return prefs
}

// Preferences are per device (theme, density, seating, print mode). There is no server copy: a shared counter
// PC should keep its own look, and the shop's real settings live in Odoo (Business Studio).
export function flushPrefsSync(): Promise<void> {
  return Promise.resolve()
}

export async function hydratePrefsFromServer(): Promise<void> {
  /* intentionally empty: preferences are device-local */
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

export function applyPrefs(p: Prefs): void {
  const el = document.documentElement
  el.dataset.theme = p.theme
  el.dataset.fontsize = p.fontSize
  el.dataset.fontfamily = p.fontFamily
  el.dataset.density = p.density === 'compact' ? 'compact' : 'comfortable'
}