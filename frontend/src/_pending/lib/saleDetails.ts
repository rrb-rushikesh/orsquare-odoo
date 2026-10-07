import { useEffect, useState } from 'react'
import * as repo from './repo'
import type { PSale } from './repo'

const cache = new Map<string, PSale>()
// Bills that permanently fail to hydrate (404/permission) are skipped on
// later renders instead of being retried on every `sales` change.
const failedKeys = new Set<string>()

/** Parallel GETs in flight: a simple sequential-chunk queue keeps a large
 *  register from machine-gunning the server (the old version fired up to
 *  ~1000 simultaneous requests). */
const CONCURRENCY = 6

/** Lazily loads full bill details (line items) for a list of sales and
 *  returns the same list with any cached details merged in. The server's
 *  list endpoint carries no items, so item-level surfaces (top sellers,
 *  category mix, profit) hydrate on demand; each bill is fetched at most
 *  once per session. Pass `enabled: false` when the consumer's current view
 *  doesn't need line items: no requests are fired at all. */
export function useSaleDetails(shopId: string, sales: PSale[], opts?: { enabled?: boolean }): { rows: PSale[]; loading: boolean } {
  const enabled = opts?.enabled ?? true
  const [doneKeys, setDoneKeys] = useState<Set<string>>(() => new Set())
  const missing = enabled ? sales.filter((s) => {
    const k = `${shopId}:${s.id}`
    return !cache.has(k) && !failedKeys.has(k)
  }) : []
  const key = missing.map((s) => s.id).join('|')
  useEffect(() => {
    if (!missing.length) return
    let alive = true
    let idx = 0
    const worker = async () => {
      while (idx < missing.length) {
        const s = missing[idx++]
        await repo.getSale(shopId, s.id)
          .then((full) => { cache.set(`${shopId}:${s.id}`, full); failedKeys.delete(`${shopId}:${s.id}`) })
          .catch(() => { failedKeys.add(`${shopId}:${s.id}`) })
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, missing.length) }, () => worker())
    Promise.all(workers).finally(() => {
      if (alive) setDoneKeys((prev) => { const next = new Set(prev); next.add(key); return next })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, key])
  return {
    rows: enabled ? sales.map((s) => cache.get(`${shopId}:${s.id}`) ?? s) : sales,
    loading: enabled && missing.length > 0 && !doneKeys.has(key),
  }
}
