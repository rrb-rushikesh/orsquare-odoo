import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryJobStore, PrintQueue, type PrintJob } from '../queue'

let t = 1_000
let n = 0
let store: MemoryJobStore
let sent: string[]
let gateError: Error | null
let sendError: Error | null
let q: PrintQueue

const input = (key: string) => ({ dedupeKey: key, label: key, kind: 'sale', bytes: 'AA==', html: '<p/>' })
const mkQueue = () =>
  new PrintQueue({
    store,
    now: () => t,
    uuid: () => `j${++n}`,
    setTimer: () => 0,
    clearTimer: () => undefined,
    gate: async () => {
      if (gateError) throw gateError
      return 'PRN'
    },
    send: async (_p, job: PrintJob) => {
      if (sendError) throw sendError
      sent.push(job.dedupeKey)
    },
  })

beforeEach(() => {
  t = 1_000
  n = 0
  store = new MemoryJobStore()
  sent = []
  gateError = null
  sendError = null
  q = mkQueue()
})
const settle = () => new Promise((r) => setTimeout(r, 5))

describe('PrintQueue', () => {
  it('prints an enqueued job once', async () => {
    await q.enqueue(input('sale:1'))
    await settle()
    expect(sent).toEqual(['sale:1'])
    expect((await q.summary()).pending).toBe(0)
  })

  it('refuses a duplicate key: double-click / re-render cannot print twice', async () => {
    const a = await q.enqueue(input('sale:1'))
    const b = await q.enqueue(input('sale:1'))
    await settle()
    expect(a.duplicate).toBe(false)
    expect(b.duplicate).toBe(true)
    expect(sent).toEqual(['sale:1'])
  })

  it('a cancelled job frees its key for a deliberate reprint', async () => {
    gateError = new Error('offline')
    const a = await q.enqueue(input('sale:1'))
    await settle()
    await q.cancel(a.job.id)
    gateError = null
    const b = await q.enqueue(input('sale:1'))
    expect(b.duplicate).toBe(false)
  })

  it('keeps the job and backs off when the printer is unavailable, then prints when it returns', async () => {
    gateError = new Error('QZ Tray is not running')
    await q.enqueue(input('sale:1'))
    await settle()
    expect(sent).toEqual([])
    let s = await q.summary()
    expect(s.pending).toBe(1)
    expect(s.jobs[0].attempts).toBe(1)
    expect(s.jobs[0].nextAttemptAt).toBeGreaterThan(t)
    // Not due yet: pumping does nothing.
    gateError = null
    await q.pump()
    expect(sent).toEqual([])
    // Cashier taps Retry / QZ reconnects.
    await q.retryNow()
    await settle()
    expect(sent).toEqual(['sale:1'])
    s = await q.summary()
    expect(s.pending).toBe(0)
  })

  it('preserves bill order: a blocked head holds back later bills', async () => {
    gateError = new Error('offline')
    await q.enqueue(input('sale:1'))
    t += 1
    await q.enqueue(input('sale:2'))
    await settle()
    gateError = null
    t += 60_000
    await q.retryNow()
    await settle()
    expect(sent).toEqual(['sale:1', 'sale:2'])
  })

  it('an ambiguous send failure is parked as uncertain, never auto-retried', async () => {
    sendError = new Error('WebSocket connection closed')
    await q.enqueue(input('sale:1'))
    await settle()
    sendError = null
    await q.retryNow()
    await settle()
    expect(sent).toEqual([])
    const s = await q.summary()
    expect(s.uncertain).toBe(1)
    expect(s.attention).toBe(1)
  })

  it('an uncertain job can be confirmed printed or re-sent by a person', async () => {
    sendError = new Error('socket reset')
    const a = await q.enqueue(input('sale:1'))
    await settle()
    sendError = null
    await q.resend(a.job.id)
    await settle()
    expect(sent).toEqual(['sale:1'])
    sendError = new Error('socket reset')
    const b = await q.enqueue(input('sale:2'))
    await settle()
    await q.markPrinted(b.job.id)
    expect((await q.summary()).uncertain).toBe(0)
    expect(sent).toEqual(['sale:1'])
  })

  it('a definitive QZ rejection (not a connection fault) is retried', async () => {
    sendError = new Error('Printer not found: X')
    await q.enqueue(input('sale:1'))
    await settle()
    const s = await q.summary()
    expect(s.uncertain).toBe(0)
    expect(s.jobs[0].status).toBe('queued')
  })

  it('recover() re-queues a job that was only waiting for the printer when the page died', async () => {
    await store.add({ ...input('sale:1'), id: 'w', status: 'printing', attempts: 0, createdAt: 1, nextAttemptAt: 0 })
    await q.recover()
    await settle()
    expect(sent).toEqual(['sale:1'])
    expect((await q.summary()).uncertain).toBe(0)
  })

  it('recover() parks a job that died mid-send as uncertain', async () => {
    await store.add({ ...input('sale:1'), id: 'x', status: 'printing', sending: true, attempts: 0, createdAt: 1, nextAttemptAt: 0 })
    await q.recover()
    await settle()
    expect(sent).toEqual([])
    expect((await q.summary()).uncertain).toBe(1)
  })

  it('surfaces repeated failures as needing attention', async () => {
    gateError = new Error('printer missing')
    const a = await q.enqueue(input('sale:1'))
    for (let i = 0; i < 3; i++) {
      await settle()
      t += 120_000
      await q.retryNow()
    }
    await settle()
    const s = await q.summary()
    expect(s.jobs.find((j) => j.id === a.job.id)!.attempts).toBeGreaterThanOrEqual(3)
    expect(s.attention).toBe(1)
    expect(s.lastError).toContain('printer missing')
  })

  it('never sends two jobs concurrently', async () => {
    let inflight = 0
    let max = 0
    const q2 = new PrintQueue({
      store,
      now: () => t,
      uuid: () => `k${++n}`,
      setTimer: () => 0,
      clearTimer: () => undefined,
      gate: async () => 'PRN',
      send: async () => {
        inflight++
        max = Math.max(max, inflight)
        await new Promise((r) => setTimeout(r, 3))
        inflight--
      },
    })
    await Promise.all([q2.enqueue(input('a')), q2.enqueue(input('b')), q2.enqueue(input('c'))])
    await new Promise((r) => setTimeout(r, 60))
    expect(max).toBe(1)
    expect((await q2.summary()).pending).toBe(0)
  })

  it('prunes old printed jobs but never live ones', async () => {
    await store.add({ ...input('old'), id: 'o', status: 'printed', attempts: 1, createdAt: 1, nextAttemptAt: 0 })
    await store.add({ ...input('live'), id: 'l', status: 'queued', attempts: 0, createdAt: 2, nextAttemptAt: 9e12 })
    t = 1 + 4 * 24 * 3600_000
    await q.prune()
    expect((await store.all()).map((j) => j.id)).toEqual(['l'])
  })

  it('emits a summary on change', async () => {
    const seen = vi.fn()
    const q3 = new PrintQueue({ store, now: () => t, uuid: () => `m${++n}`, setTimer: () => 0, clearTimer: () => undefined, gate: async () => 'P', send: async () => undefined, onChange: seen })
    await q3.enqueue(input('z'))
    await settle()
    expect(seen).toHaveBeenCalled()
  })
})
