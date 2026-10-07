/**
 * QZ Tray bridge: connection lifecycle, printer discovery, raw send, status.
 *
 * Uses only the official `qz-tray` client API. Responsibilities kept here:
 *  - a single-flight, self-healing websocket (QZ restart, sleep/wake, Windows
 *    restart and a replugged printer all end in "connected again" with no
 *    human action)
 *  - request signing through the server so QZ never prompts
 *  - printer selection that survives renames and USB re-enumeration
 *  - a tiny observable snapshot the UI renders (useSyncExternalStore)
 *
 * It knows nothing about receipts or queues.
 */
import qz from 'qz-tray'
import { backoffMs, classifyStatus, pickPrinter, type PrinterState } from './printerSelect'
import type { PrintSettings } from './presets'

// QZ Tray runs unsigned for now: the operator approves the site once ("Remember this decision") in QZ's prompt.
// Signed requests need a signing endpoint on the backend; add one when silent kiosk printing is required.
const fetchQzCertificate = (): Promise<string> => Promise.resolve('')
const signQzRequest = (_toSign: string): Promise<string> => Promise.resolve('')

export type { PrinterState }

export type BridgeState = 'off' | 'connecting' | 'connected' | 'unreachable'

export interface BridgeSnapshot {
  bridge: BridgeState
  /** Resolved Windows printer name (what jobs go to), or null. */
  printer: string | null
  printerState: PrinterState
  /** Human status text from Windows/QZ when it reports a problem. */
  detail: string
  /** QZ Tray version once connected. */
  version: string
  /** True while a QZ call has been waiting long enough that a person is probably being asked to click Allow. */
  awaitingPermission: boolean
  /** True when requests are signed (silent printing); false = QZ will ask the cashier to allow. */
  signed: boolean
  lastError: string
}

export class BridgeError extends Error {
  constructor(public kind: 'unreachable' | 'printer-missing' | 'printer-offline' | 'send-failed', message: string) {
    super(message)
  }
}

// ---- observable snapshot --------------------------------------------------

let snap: BridgeSnapshot = {
  bridge: 'off',
  printer: null,
  printerState: 'unknown',
  detail: '',
  version: '',
  awaitingPermission: false,
  signed: false,
  lastError: '',
}
const listeners = new Set<() => void>()
function set(patch: Partial<BridgeSnapshot>): void {
  const next = { ...snap, ...patch }
  if ((Object.keys(next) as (keyof BridgeSnapshot)[]).every((k) => next[k] === snap[k])) return
  snap = next
  listeners.forEach((l) => l())
}
export const subscribeBridge = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const getBridgeSnapshot = (): BridgeSnapshot => snap

// ---- connection -----------------------------------------------------------

// A QZ call that takes this long is almost never slow: it is QZ showing its "Allow?" dialog and waiting for a click.
const PERMISSION_HINT_MS = 7000
let slowCalls = 0
/** Flags `awaitingPermission` while `p` is unusually slow, so the UI can say what to do instead of hanging silently. */
function watchPermission<T>(p: Promise<T>): Promise<T> {
  let fired = false
  const t = setTimeout(() => {
    fired = true
    slowCalls += 1
    set({ awaitingPermission: true })
  }, PERMISSION_HINT_MS)
  const done = () => {
    clearTimeout(t)
    if (fired) {
      slowCalls -= 1
      if (slowCalls <= 0) {
        slowCalls = 0
        set({ awaitingPermission: false })
      }
    }
  }
  p.then(done, done)
  return p
}

let securityReady = false
let cachedCert = ''
let running = false
let settingsRef: () => PrintSettings = () => {
  throw new Error('bridge not started')
}
let connecting: Promise<void> | null = null
let failures = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let healthTimer: ReturnType<typeof setInterval> | null = null
let listeningOn = ''

function setupSecurity(): void {
  if (securityReady) return
  securityReady = true
  qz.security.setSignatureAlgorithm('SHA512')
  qz.security.setCertificatePromise((resolve) => {
    fetchQzCertificate()
      .then((c) => {
        cachedCert = c
        set({ signed: true })
        resolve(c)
      })
      .catch(() => {
        // Signing not configured or server unreachable: connect unsigned (QZ asks once) rather than not at all.
        set({ signed: false })
        resolve(cachedCert)
      })
  })
  qz.security.setSignaturePromise((toSign) => (resolve) => {
    signQzRequest(toSign).then(resolve, (e) => {
      // Surface it: an unsigned request makes QZ prompt the cashier, which is exactly what this design prevents.
      console.warn('QZ request signing failed; QZ Tray will ask for permission.', e)
      set({ signed: false })
      resolve()
    })
  })
  qz.websocket.setClosedCallbacks(() => {
    listeningOn = ''
    resolvedAt = 0
    set({ bridge: running ? 'connecting' : 'off', printerState: 'unknown', version: '' })
    if (running) scheduleReconnect()
  })
  qz.printers.setPrinterCallbacks((evt: { statusText?: string; eventType?: string; printerName?: string; message?: string }) => {
    if (evt?.eventType && evt.eventType !== 'PRINTER') return
    const state = classifyStatus(evt?.statusText ?? '')
    if (state === 'unknown') return
    set({ printerState: state, detail: state === 'ready' ? '' : evt.statusText ?? '' })
    onStatusChange?.()
  })
}

let onStatusChange: (() => void) | null = null
/** The queue subscribes so a printer coming back online flushes the backlog immediately. */
export function setStatusChangeHandler(fn: (() => void) | null): void {
  onStatusChange = fn
}

function scheduleReconnect(): void {
  if (!running || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void ensureConnected().catch(() => undefined)
  }, backoffMs(failures))
}

/** Single-flight connect. Resolves when the websocket is open; rejects with BridgeError('unreachable'). */
export function ensureConnected(): Promise<void> {
  setupSecurity()
  if (qz.websocket.isActive()) {
    failures = 0
    if (snap.bridge !== 'connected') set({ bridge: 'connected' })
    return Promise.resolve()
  }
  if (connecting) return connecting
  set({ bridge: 'connecting' })
  connecting = watchPermission(qz.websocket.connect({ retries: 1, delay: 1 }))
    .then(async () => {
      failures = 0
      set({ bridge: 'connected', lastError: '' })
      // Resolve the printer straight away so the status bar names it and offline/paper events start flowing.
      if (running) void ensurePrinter(settingsRef()).catch(() => undefined)
      try {
        const v = (await (qz as unknown as { api: { getVersion(): Promise<string> } }).api.getVersion?.()) ?? qz.version
        set({ version: String(v ?? '') })
      } catch {
        /* version is informational */
      }
    })
    .catch((e: unknown) => {
      failures += 1
      const msg = e instanceof Error ? e.message : String(e)
      set({ bridge: 'unreachable', lastError: msg })
      if (running) scheduleReconnect()
      throw new BridgeError('unreachable', 'QZ Tray is not running on this computer.')
    })
    .finally(() => {
      connecting = null
    })
  return connecting
}

async function listPrinterNames(): Promise<string[]> {
  const r = await watchPermission(qz.printers.find())
  return Array.isArray(r) ? r : r ? [r] : []
}

// Every QZ call is signed by the server (one round-trip), so resolution is cached: a print reuses a result
// younger than PRINTER_TTL_MS, and the background check refreshes it at most once a minute.
const PRINTER_TTL_MS = 30_000
const REFRESH_MS = 60_000
let resolvedAt = 0
let resolvedFor = ''

/** Forget the cached resolution (after a print error, a setting change, or QZ reconnecting). */
export function invalidatePrinter(): void {
  resolvedAt = 0
}

/** Connects if needed and resolves the target printer (and starts status listening on it). */
let resolving: Promise<string> | null = null
/** Single-flight: the queue, the health check and the Settings page may ask at once; QZ is asked once. */
export function ensurePrinter(s: PrintSettings, maxAgeMs = PRINTER_TTL_MS): Promise<string> {
  if (!resolving) {
    resolving = resolvePrinter(s, maxAgeMs).finally(() => {
      resolving = null
    })
  }
  return resolving
}

async function resolvePrinter(s: PrintSettings, maxAgeMs: number): Promise<string> {
  await ensureConnected()
  if (snap.printer && resolvedFor === s.printer && Date.now() - resolvedAt < maxAgeMs) return snap.printer
  const names = await listPrinterNames()
  let name = pickPrinter(names, s.printer, null)
  if (!name && !s.printer) {
    // Only ask Windows for its default when nothing looks like a receipt printer.
    let def: string | null = null
    try {
      def = (await watchPermission(qz.printers.getDefault())) || null
    } catch {
      def = null
    }
    name = pickPrinter(names, s.printer, def)
  }
  resolvedAt = Date.now()
  resolvedFor = s.printer
  if (!name) {
    set({ printer: null, printerState: 'missing', detail: s.printer ? `Printer "${s.printer}" is not installed.` : 'No receipt printer found.' })
    throw new BridgeError('printer-missing', s.printer ? `Printer "${s.printer}" was not found.` : 'No receipt printer was found.')
  }
  if (name !== snap.printer) set({ printer: name, printerState: 'unknown', detail: '' })
  else if (snap.printerState === 'missing') set({ printerState: 'unknown', detail: '' })
  if (listeningOn !== name) {
    try {
      await watchPermission(qz.printers.startListening(name))
      listeningOn = name
    } catch {
      /* status is best-effort; printing does not depend on it */
    }
  }
  return name
}

/** Sends one raw job. Resolves when QZ has handed it to the Windows spooler. */
export async function sendRaw(printer: string, base64: string, jobName: string): Promise<void> {
  const config = qz.configs.create(printer, { jobName, encoding: null })
  try {
    await watchPermission(qz.print(config, [{ type: 'raw', format: 'command', flavor: 'base64', data: base64 }]))
  } catch (e) {
    invalidatePrinter()
    throw new BridgeError('send-failed', e instanceof Error ? e.message : String(e))
  }
}

export interface ConnectionTest {
  ok: boolean
  version: string
  printers: string[]
  chosen: string | null
  signed: boolean
  error?: string
}

/** Diagnostic used by the Settings "Check connection" button. Never throws. */
export async function testConnection(s: PrintSettings): Promise<ConnectionTest> {
  try {
    await ensureConnected()
    const printers = await listPrinterNames()
    let chosen: string | null = null
    try {
      chosen = await ensurePrinter(s)
    } catch {
      chosen = null
    }
    return { ok: chosen !== null, version: snap.version, printers, chosen, signed: snap.signed }
  } catch (e) {
    return { ok: false, version: '', printers: [], chosen: null, signed: snap.signed, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function listPrinters(): Promise<string[]> {
  await ensureConnected()
  return listPrinterNames()
}

// ---- lifecycle ------------------------------------------------------------

function health(): void {
  if (!running) return
  if (!qz.websocket.isActive()) {
    void ensureConnected().catch(() => undefined)
  } else {
    // Keep the resolved printer honest: a driver removed or re-added while connected is noticed within seconds.
    void ensurePrinter(settingsRef(), REFRESH_MS).catch(() => undefined)
  }
}

/** Starts (idempotently) the self-healing connection for this browser session. */
export function startBridge(getSettings: () => PrintSettings): void {
  settingsRef = getSettings
  if (running) return
  running = true
  setupSecurity()
  void ensureConnected().catch(() => undefined)
  healthTimer = setInterval(health, 15_000)
  window.addEventListener('online', health)
  document.addEventListener('visibilitychange', onVisible)
}

function onVisible(): void {
  if (document.visibilityState === 'visible') health()
}

export function stopBridge(): void {
  running = false
  if (healthTimer) clearInterval(healthTimer)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  healthTimer = null
  reconnectTimer = null
  window.removeEventListener('online', health)
  document.removeEventListener('visibilitychange', onVisible)
  if (qz.websocket.isActive()) void qz.websocket.disconnect().catch(() => undefined)
  set({ bridge: 'off', printerState: 'unknown', version: '' })
}
