/**
 * IndexedDB job store (Dexie). A database of its own, not the offline-sales
 * one: print jobs are device-local, never synced, never part of a shop wipe,
 * and must not share a schema migration with money data.
 */
import Dexie, { type Table } from 'dexie'
import type { JobStore, PrintJob } from './queue'

class PrintDatabase extends Dexie {
  jobs!: Table<PrintJob, string>
  constructor() {
    super('OrsquarePrintQueue')
    this.version(1).stores({ jobs: 'id, dedupeKey, status, createdAt' })
  }
}

let db: PrintDatabase | null = null
const getDb = () => (db ??= new PrintDatabase())

export const dexieJobStore: JobStore = {
  async add(job) {
    await getDb().jobs.add(job)
  },
  get: (id) => getDb().jobs.get(id),
  async findByKey(key) {
    const rows = await getDb().jobs.where('dedupeKey').equals(key).toArray()
    return rows.filter((r) => r.status !== 'cancelled').sort((a, b) => b.createdAt - a.createdAt)[0]
  },
  all: () => getDb().jobs.orderBy('createdAt').toArray(),
  async patch(id, p) {
    await getDb().jobs.update(id, p)
  },
  async remove(ids) {
    await getDb().jobs.bulkDelete(ids)
  },
  /** One transaction: two tabs racing for the same job cannot both win. */
  claim(now) {
    const d = getDb()
    return d.transaction('rw', d.jobs, async () => {
      const all = await d.jobs.orderBy('createdAt').toArray()
      if (all.some((j) => j.status === 'printing')) return undefined
      const head = all.find((j) => j.status === 'queued')
      if (!head || head.nextAttemptAt > now) return undefined
      await d.jobs.update(head.id, { status: 'printing' })
      return { ...head, status: 'printing' as const }
    })
  },
}
