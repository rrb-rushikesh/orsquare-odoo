/**
 * The one print entry point for the whole app.
 *
 *   sales bill / reprint / credit note / purchase / test sheet
 *        -> submit()  (layout once, from the shared DocModel)
 *             backend 'qz'     -> durable queue -> QZ Tray -> spooler -> printer (silent)
 *             backend 'browser'-> paper-width HTML in the OS print dialog (legacy / escape hatch)
 *
 * printMode (ask | auto | off) is decided by the *caller* before it gets here;
 * this module only answers "how does a job reach paper". Keeping those two
 * questions apart is what lets one setting drive every print path.
 */
import { printBill, printProvisional } from '../print'
import { loadPrefs } from '../prefs'
import { receiptToDoc, type ReceiptData } from '../receipt'
import { BridgeError, ensurePrinter, getBridgeSnapshot, sendRaw, setStatusChangeHandler, startBridge, stopBridge, subscribeBridge } from './bridge'
import { printableDocument, openPrintWindow, printIntoWindow } from './html'
import { dexieJobStore } from './jobStore'
import { layoutDocument, type Block, type DocModel } from './layout'
import { outcomeMessage, type PrintOutcome } from './outcome'
import type { PrintSettings } from './presets'
import { PrintQueue, type PrintJob, type QueueSummary } from './queue'


export interface SubmitOptions {
  /** Idempotency key. Same key = same physical receipt: submitted twice, printed once. */
  key: string
  label: string
  kind: 'sale' | 'reprint' | 'note' | 'purchase' | 'test'
  /**
   * Reprints and test sheets are deliberate repeats: each press is a new physical receipt, but a double-tap
   * within a few seconds is still one. A non-repeatable key (the automatic print of a bill) is one receipt forever.
   */
  repeatable?: boolean
}

export { outcomeMessage }
export type { PrintOutcome }

// ---- queue singleton ------------------------------------------------------

let queue: PrintQueue | null = null
let summary: QueueSummary = { pending: 0, attention: 0, uncertain: 0, lastError: '', jobs: [] }
const summaryListeners = new Set<() => void>()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('orsquare-print') : null
channel?.addEventListener('message', () => void refreshSummary())

export const subscribeQueue = (l: () => void): (() => void) => {
  summaryListeners.add(l)
  return () => summaryListeners.delete(l)
}
export const getQueueSummary = (): QueueSummary => summary

async function refreshSummary(): Promise<void> {
  if (!queue) return
  summary = await queue.summary()
  summaryListeners.forEach((l) => l())
}

const settings = (): PrintSettings => loadPrefs().print

async function gate(): Promise<string> {
  const s = settings()
  const printer = await ensurePrinter(s)
  const snap = getBridgeSnapshot()
  if (s.holdWhenOffline && (snap.printerState === 'offline' || snap.printerState === 'attention')) {
    throw new BridgeError('printer-offline', snap.detail || 'Printer is offline.')
  }
  return printer
}

function getQueue(): PrintQueue {
  if (queue) return queue
  queue = new PrintQueue({
    store: dexieJobStore,
    gate,
    send: (printer, job) => sendRaw(printer, job.bytes, job.label),
    onChange: (s) => {
      summary = s
      summaryListeners.forEach((l) => l())
      channel?.postMessage('changed')
    },
  })
  return queue
}

let workerStarted = false
/**
 * Brings the QZ path up for this browser tab: connection, queue recovery, and
 * "flush the backlog the moment the printer/QZ is back". Idempotent.
 */
export function startPrinting(): void {
  const s = settings()
  if (s.backend !== 'qz') {
    if (workerStarted) stopBridge()
    workerStarted = false
    return
  }
  const q = getQueue()
  startBridge(settings)
  if (workerStarted) return
  workerStarted = true
  // Only the tab that holds the lock may declare in-flight jobs "uncertain": a second tab must not
  // misread its sibling's live job as a crash. The lock is held for the tab's lifetime.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks) void locks.request('orsquare-print-worker', () => q.recover().then(() => new Promise<void>(() => undefined)))
  else void q.recover()
  let last = ''
  const kick = () => {
    const b = getBridgeSnapshot()
    const sig = `${b.bridge}|${b.printerState}|${b.printer}`
    if (sig === last) return
    last = sig
    if (b.bridge === 'connected' && b.printerState !== 'offline' && b.printerState !== 'attention') void q.retryNow()
  }
  subscribeBridge(kick)
  setStatusChangeHandler(kick)
  void refreshSummary()
}

// ---- submit ---------------------------------------------------------------

// Identical key within this window from the same tab = a double-tap, not a second print.
const recent = new Map<string, number>()
function debounced(key: string): boolean {
  const now = Date.now()
  for (const [k, t] of recent) if (now - t > 4000) recent.delete(k)
  if (recent.has(key)) return true
  recent.set(key, now)
  return false
}

async function encode(doc: DocModel | { blocks: Block[]; cols: number; cash?: boolean }, s: PrintSettings): Promise<{ bytes: Uint8Array; blocks: Block[]; cols: number }> {
  const { encodeBlocks } = await import('./escpos') // lazy: keeps the encoder out of the main bundle
  const laid = 'blocks' in doc ? { blocks: doc.blocks, cols: doc.cols } : layoutDocument(doc, s)
  const cash = 'cash' in doc ? doc.cash : undefined
  return { bytes: encodeBlocks(laid.blocks, laid.cols, s, { cash }), ...laid }
}

/** Repeats the receipt `copies` times inside ONE job: the copies cannot be split by a crash or interleaved with another bill. */
function withCopies(bytes: Uint8Array, copies: number): Uint8Array {
  if (copies <= 1) return bytes
  const out = new Uint8Array(bytes.length * copies)
  for (let i = 0; i < copies; i++) out.set(bytes, i * bytes.length)
  return out
}

async function submitTo(doc: DocModel | { blocks: Block[]; cols: number; cash?: boolean }, o: SubmitOptions, win: Window | null): Promise<PrintOutcome> {
  const s = settings()
  const title = o.label
  if (s.backend === 'browser') {
    const laid = 'blocks' in doc ? { blocks: doc.blocks, cols: doc.cols } : layoutDocument(doc, s)
    const w = win ?? openPrintWindow()
    if (!w) return 'blocked'
    printIntoWindow(w, printableDocument(title, laid.blocks, laid.cols, s))
    return 'browser'
  }
  win?.close()
  if (debounced(o.key)) return 'duplicate'
  try {
    startPrinting()
    const { bytes, blocks, cols } = await encode(doc, s)
    const { toBase64 } = await import('./escpos')
    const { duplicate } = await getQueue().enqueue({
      dedupeKey: o.repeatable ? `${o.key}#${Date.now()}` : o.key,
      label: o.label,
      kind: o.kind,
      bytes: toBase64(withCopies(bytes, s.copies)),
      html: printableDocument(title, blocks, cols, s),
    })
    if (duplicate) return 'duplicate'
    const b = getBridgeSnapshot()
    const notReady = b.bridge === 'unreachable' || b.printerState === 'missing' || b.printerState === 'offline' || b.printerState === 'attention'
    return notReady ? 'queued-offline' : 'queued'
  } catch {
    return 'error'
  }
}

export interface PrintHandle {
  submit(doc: DocModel, o: SubmitOptions): Promise<PrintOutcome>
  submitBlocks(laid: { blocks: Block[]; cols: number }, o: SubmitOptions): Promise<PrintOutcome>
  /** Call when the work before printing failed (e.g. the bill could not be loaded) so no blank window is left behind. */
  abort(): void
}

/**
 * Call synchronously inside the click handler, BEFORE any await. In browser
 * mode it opens the print popup while the user gesture is still valid; in QZ
 * mode it is free.
 */
export function beginPrint(): PrintHandle {
  const win = settings().backend === 'browser' ? openPrintWindow() : null
  return {
    submit: (doc, o) => submitTo(doc, o, win),
    submitBlocks: (laid, o) => submitTo(laid, o, win),
    abort: () => win?.close(),
  }
}

/** Convenience for a ReceiptData (sale, reprint, credit note, open-bill preview). */
export async function printReceipt(r: ReceiptData, o: SubmitOptions): Promise<PrintOutcome> {
  if (r.nativeOrderId) {
    const result = await printBill(r.nativeOrderId, o.label);
    return result === 'failed' ? 'error' : result === 'dialog' ? 'browser' : 'queued';
  }
  if (r.provisional) {
    const result = printProvisional('OR²', r.items, r.total);
    return result === 'failed' ? 'blocked' : 'browser';
  }
  const prefs = loadPrefs()
  return beginPrint().submit(receiptToDoc(prefs.invoice, r, prefs.print), o)
}

// ---- queue controls for the UI -------------------------------------------

export const retryPrintQueue = (): Promise<void> => getQueue().retryNow()
export const cancelPrintJob = (id: string): Promise<void> => getQueue().cancel(id)
export const confirmJobPrinted = (id: string): Promise<void> => getQueue().markPrinted(id)
export const resendPrintJob = (id: string): Promise<void> => getQueue().resend(id)

/** Escape hatch: print a stuck job through the OS dialog, then drop it from the queue so it cannot also print silently. */
export async function printJobViaBrowser(job: PrintJob): Promise<boolean> {
  const w = openPrintWindow()
  if (!w) return false
  printIntoWindow(w, job.html)
  await getQueue().cancel(job.id)
  return true
}
