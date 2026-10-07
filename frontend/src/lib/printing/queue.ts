/**
 * Durable print queue.
 *
 * Guarantees, in order of importance:
 *  1. A bill that was confirmed is never lost to a printer problem: its job is
 *     persisted (IndexedDB) before any printing is attempted and survives a
 *     browser restart, a QZ Tray restart and a Windows reboot.
 *  2. A receipt is never printed twice by us: a job is keyed (dedupeKey), and
 *     an ambiguous outcome (connection died while the bytes were in flight)
 *     is parked as `uncertain` for a human instead of being retried blindly.
 *  3. Order is preserved: the head of the queue blocks the rest until it
 *     prints (receipts must come out in bill order).
 *
 * The engine is storage- and transport-agnostic (injected), so every rule
 * above is unit-tested without a browser or a printer.
 */
import { backoffMs } from './printerSelect'

export type JobStatus = 'queued' | 'printing' | 'printed' | 'uncertain' | 'cancelled'

export interface PrintJob {
  id: string
  /** Idempotency key: at most one live job per key. */
  dedupeKey: string
  label: string
  kind: string
  /** ESC/POS (or Star) bytes, base64. */
  bytes: string
  /** Standalone HTML of the same layout, for the "print via browser" escape hatch. */
  html: string
  status: JobStatus
  attempts: number
  createdAt: number
  nextAttemptAt: number
  printedAt?: number
  /** True only once the bytes are being handed to QZ. A `printing` job that never got here sent nothing and is safe to retry. */
  sending?: boolean
  lastError?: string
}

export interface JobStore {
  add(job: PrintJob): Promise<void>
  get(id: string): Promise<PrintJob | undefined>
  findByKey(key: string): Promise<PrintJob | undefined>
  all(): Promise<PrintJob[]>
  patch(id: string, p: Partial<PrintJob>): Promise<void>
  remove(ids: string[]): Promise<void>
  /** Atomically flips the oldest due `queued` job to `printing` and returns it, unless a job is already `printing`. */
  claim(now: number): Promise<PrintJob | undefined>
}

export class MemoryJobStore implements JobStore {
  jobs = new Map<string, PrintJob>()
  async add(j: PrintJob) {
    this.jobs.set(j.id, { ...j })
  }
  async get(id: string) {
    const j = this.jobs.get(id)
    return j && { ...j }
  }
  async findByKey(key: string) {
    const j = [...this.jobs.values()].filter((x) => x.dedupeKey === key && x.status !== 'cancelled').sort((a, b) => b.createdAt - a.createdAt)[0]
    return j && { ...j }
  }
  async all() {
    return [...this.jobs.values()].map((j) => ({ ...j })).sort((a, b) => a.createdAt - b.createdAt)
  }
  async patch(id: string, p: Partial<PrintJob>) {
    const j = this.jobs.get(id)
    if (j) Object.assign(j, p)
  }
  async remove(ids: string[]) {
    ids.forEach((i) => this.jobs.delete(i))
  }
  async claim(now: number) {
    const list = [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt)
    if (list.some((j) => j.status === 'printing')) return undefined
    const head = list.find((j) => j.status === 'queued')
    if (!head || head.nextAttemptAt > now) return undefined
    head.status = 'printing'
    return { ...head }
  }
}

export interface QueueSummary {
  /** Jobs waiting or in flight. */
  pending: number
  /** Jobs a person should look at: repeated failures or an ambiguous send. */
  attention: number
  uncertain: number
  lastError: string
  jobs: PrintJob[]
}

/** Failures after which a waiting job is surfaced as "needs attention" rather than "retrying". */
export const ATTENTION_AFTER = 3
const SEND_TIMEOUT_MS = 20_000
const AMBIGUOUS = /clos|connection|socket|timeout|timed out|abort|reset/i

export interface QueueDeps {
  store: JobStore
  /** Makes the printer ready (connect, resolve, optionally hold when offline) and returns its name. Throws when it cannot. */
  gate: () => Promise<string>
  /** Sends one job's bytes. Resolves when handed to the spooler. */
  send: (printer: string, job: PrintJob) => Promise<void>
  now?: () => number
  uuid?: () => string
  onChange?: (s: QueueSummary) => void
  /** Timer injection for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
  retentionMs?: number
  maxJobs?: number
}

export interface EnqueueInput {
  dedupeKey: string
  label: string
  kind: string
  bytes: string
  html: string
}

export class PrintQueue {
  private pumping = false
  private timer: unknown = null
  private lastError = ''
  constructor(private d: QueueDeps) {}

  private now = () => (this.d.now ? this.d.now() : Date.now())

  /** Persists the job. `duplicate: true` means a live job with this key already exists and nothing was added. */
  async enqueue(input: EnqueueInput): Promise<{ job: PrintJob; duplicate: boolean }> {
    const existing = await this.d.store.findByKey(input.dedupeKey)
    if (existing) return { job: existing, duplicate: true }
    const job: PrintJob = {
      id: this.d.uuid ? this.d.uuid() : crypto.randomUUID(),
      ...input,
      status: 'queued',
      attempts: 0,
      createdAt: this.now(),
      nextAttemptAt: 0,
    }
    await this.d.store.add(job)
    await this.emit()
    void this.pump()
    return { job, duplicate: false }
  }

  /** Runs the queue until empty, blocked by an error, or not yet due. Safe to call from anywhere, any time. */
  async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      for (;;) {
        const job = await this.d.store.claim(this.now())
        if (!job) break
        if (!(await this.attempt(job))) break
      }
    } finally {
      this.pumping = false
      await this.afterPump()
    }
  }

  /** @returns true when the job printed and the loop may continue. */
  private async attempt(job: PrintJob): Promise<boolean> {
    let printer: string
    try {
      printer = await this.d.gate()
    } catch (e) {
      // Nothing was sent: always safe to retry.
      await this.fail(job, e, false)
      return false
    }
    // From here the outcome of a crash is unknowable: mark it BEFORE the bytes leave.
    await this.d.store.patch(job.id, { sending: true })
    try {
      await withTimeout(this.d.send(printer, job), SEND_TIMEOUT_MS)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await this.fail(job, e, AMBIGUOUS.test(msg))
      return false
    }
    await this.d.store.patch(job.id, { status: 'printed', printedAt: this.now(), lastError: undefined, sending: false })
    this.lastError = ''
    await this.emit()
    return true
  }

  private async fail(job: PrintJob, e: unknown, ambiguous: boolean): Promise<void> {
    const msg = e instanceof Error ? e.message : String(e)
    this.lastError = msg
    const attempts = job.attempts + 1
    if (ambiguous) {
      // The bytes may already be on paper. A second copy is worse than asking.
      await this.d.store.patch(job.id, { status: 'uncertain', attempts, lastError: msg, sending: false })
    } else {
      await this.d.store.patch(job.id, { status: 'queued', attempts, lastError: msg, nextAttemptAt: this.now() + backoffMs(attempts - 1), sending: false })
    }
    await this.emit()
  }

  private async afterPump(): Promise<void> {
    if (this.timer) {
      ;(this.d.clearTimer ?? clearTimeout)(this.timer as never)
      this.timer = null
    }
    const queued = (await this.d.store.all()).filter((j) => j.status === 'queued')
    if (queued.length === 0) return
    const due = Math.min(...queued.map((j) => j.nextAttemptAt))
    const wait = Math.max(250, due - this.now())
    this.timer = (this.d.setTimer ?? ((f, ms) => setTimeout(f, ms)))(() => {
      this.timer = null
      void this.pump()
    }, wait)
  }

  /** Startup recovery: anything left `printing` was in flight when the page died: outcome unknown. */
  async recover(): Promise<void> {
    const jobs = await this.d.store.all()
    for (const j of jobs) {
      if (j.status !== 'printing') continue
      // Died while only waiting for the printer/QZ: nothing was sent, so simply try again. Died mid-send: ask a person.
      if (j.sending) await this.d.store.patch(j.id, { status: 'uncertain', sending: false, lastError: 'Interrupted while printing. Check the paper.' })
      else await this.d.store.patch(j.id, { status: 'queued', nextAttemptAt: 0 })
    }
    await this.prune()
    await this.emit()
    void this.pump()
  }

  /** Make every waiting job due now (cashier tapped Retry, printer came back, QZ reconnected). */
  async retryNow(): Promise<void> {
    for (const j of await this.d.store.all()) if (j.status === 'queued') await this.d.store.patch(j.id, { nextAttemptAt: 0 })
    void this.pump()
  }

  async cancel(id: string): Promise<void> {
    const j = await this.d.store.get(id)
    if (j && (j.status === 'queued' || j.status === 'uncertain')) await this.d.store.patch(id, { status: 'cancelled' })
    await this.emit()
  }

  /** A human confirmed the uncertain job did come out. */
  async markPrinted(id: string): Promise<void> {
    const j = await this.d.store.get(id)
    if (j && j.status === 'uncertain') await this.d.store.patch(id, { status: 'printed', printedAt: this.now() })
    await this.emit()
  }

  /** A human confirmed the uncertain job did NOT come out: send it again. */
  async resend(id: string): Promise<void> {
    const j = await this.d.store.get(id)
    if (j && j.status === 'uncertain') await this.d.store.patch(id, { status: 'queued', nextAttemptAt: 0, lastError: undefined })
    await this.emit()
    void this.pump()
  }

  async summary(): Promise<QueueSummary> {
    const jobs = await this.d.store.all()
    const live = jobs.filter((j) => j.status === 'queued' || j.status === 'printing' || j.status === 'uncertain')
    const uncertain = live.filter((j) => j.status === 'uncertain').length
    const stuck = live.filter((j) => j.status === 'queued' && j.attempts >= ATTENTION_AFTER).length
    return {
      pending: live.filter((j) => j.status !== 'uncertain').length,
      attention: uncertain + stuck,
      uncertain,
      lastError: this.lastError || [...live].reverse().find((j) => j.lastError)?.lastError || '',
      jobs: live,
    }
  }

  private async emit(): Promise<void> {
    if (this.d.onChange) this.d.onChange(await this.summary())
  }

  async prune(): Promise<void> {
    const keep = this.d.maxJobs ?? 300
    const maxAge = this.d.retentionMs ?? 3 * 24 * 3600_000
    const jobs = await this.d.store.all()
    const old = jobs.filter((j) => (j.status === 'printed' || j.status === 'cancelled') && this.now() - j.createdAt > maxAge).map((j) => j.id)
    const overflow = jobs.length > keep ? jobs.filter((j) => j.status === 'printed' || j.status === 'cancelled').slice(0, jobs.length - keep).map((j) => j.id) : []
    const ids = [...new Set([...old, ...overflow])]
    if (ids.length) await this.d.store.remove(ids)
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out waiting for the printer spooler')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}
