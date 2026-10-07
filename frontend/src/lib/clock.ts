import { useEffect, useState } from 'react'

/**
 * Single Authoritative Clock & Timezone Engine for ORSQUARE / XPO.
 *
 * CRITICAL RELIABILITY DIRECTIVE:
 * Never trust local device/PC system time. Client hardware frequently suffers from
 * incorrect CMOS clocks, misconfigured system timezones, or manual tampering.
 *
 * This engine synchronizes time across the entire application using:
 * 1. Primary: Server Authoritative Time via GET /api/time/ (with RTT compensation).
 * 2. Secondary: Continuous passive calibration from HTTP 'Date' response headers.
 * 3. Tertiary fallback: Public redundant online time APIs (WorldTimeAPI, TimeAPI.io).
 * 4. LocalStorage persistence for instant zero-skew hydration across app restarts.
 *
 * All day boundaries, todayKey, and monthKey calculations are standardized
 * to APP_TIMEZONE ('Asia/Kolkata') so all cashiers, owners, and developers share
 * exact parity regardless of their local machine's OS clock or timezone settings.
 */

export const APP_TIMEZONE = 'Asia/Kolkata'

let clockOffset = 0
let synced = false
let lastSyncAt = 0
let isSyncing = false

const listeners = new Set<() => void>()

// 1. Initial hydration from persistent cache
try {
  const cachedOffset = localStorage.getItem('xpo_clock_offset_ms')
  if (cachedOffset !== null) {
    const val = Number(cachedOffset)
    if (!isNaN(val)) {
      clockOffset = val
      synced = true
    }
  }
  const cachedSyncAt = localStorage.getItem('xpo_clock_synced_at')
  if (cachedSyncAt !== null) {
    lastSyncAt = Number(cachedSyncAt) || 0
  }
} catch {
  // Storage unavailable (e.g. private mode)
}

/** Corrected epoch ms: use this instead of Date.now() for every business date. */
export function now(): number {
  return Date.now() + clockOffset
}

/** Current clock offset in milliseconds relative to local Date.now() */
export function getClockOffset(): number {
  return clockOffset
}

export function isClockSynced(): boolean {
  return synced
}

/** Subscribe to clock corrections (re-render consumers when skew lands). */
export function onClock(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function notifyListeners() {
  listeners.forEach((cb) => {
    try {
      cb()
    } catch {
      // safe callback error suppression
    }
  })
}

function setOffset(newOffset: number, source: string) {
  const diff = Math.abs(newOffset - clockOffset)
  // Update if uninitialized or if drift is greater than 1000ms
  if (!synced || diff > 1000) {
    clockOffset = Math.round(newOffset)
    synced = true
    lastSyncAt = Date.now()
    try {
      localStorage.setItem('xpo_clock_offset_ms', String(clockOffset))
      localStorage.setItem('xpo_clock_synced_at', String(lastSyncAt))
    } catch {
      /* ignore */
    }
    notifyListeners()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('xpo_clock_synced', {
          detail: { offset: clockOffset, source, time: now() },
        })
      )
    }
  } else {
    synced = true
    lastSyncAt = Date.now()
  }
}

/**
 * Passive clock calibration: called by ApiClient on every HTTP response that
 * carries a standard 'Date' header. Provides continuous, zero-cost time sync.
 */
export function calibrateClockFromHttpDate(httpDateStr: string | null | undefined): void {
  if (!httpDateStr) return
  const serverMs = Date.parse(httpDateStr)
  if (isNaN(serverMs)) return
  // HTTP Date header resolution is 1 second; only adjust if skew exceeds 2500ms
  const currentEst = Date.now() + clockOffset
  if (!synced || Math.abs(serverMs - currentEst) > 2500) {
    const skew = serverMs - Date.now()
    setOffset(skew, 'http_header')
  }
}

/**
 * Active multi-source clock synchronization.
 * Queries primary and fallback online sources with latency compensation.
 */
export async function syncClock(force = false): Promise<boolean> {
  // Throttle: don't re-sync if successfully synced within the last 60 seconds unless forced
  if (isSyncing) return false
  if (!force && synced && Date.now() - lastSyncAt < 60_000) return true

  isSyncing = true

  // The shop's own server is the only time authority: its HTTP Date header, corrected for half the round trip.
  // (No third-party time services: a counter device should not call out to the internet for the clock.)
  try {
    const t0 = performance.now()
    const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' })
    const t1 = performance.now()
    const serverMs = Date.parse(res.headers.get('Date') || '')
    if (!isNaN(serverMs)) {
      setOffset(serverMs + Math.max(0, t1 - t0) / 2 - Date.now(), 'backend_api')
      isSyncing = false
      return true
    }
  } catch {
    // offline: keep the last calibration
  }

  isSyncing = false
  return synced
}

// Background synchronization lifecycle
if (typeof window !== 'undefined') {
  // Sync immediately on boot
  void syncClock(false)

  // Resync periodically every 5 minutes
  setInterval(() => {
    void syncClock(false)
  }, 300_000)

  // Resync when browser reconnects to network
  window.addEventListener('online', () => {
    void syncClock(true)
  })

  // Resync when tab regains visibility
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastSyncAt > 120_000) {
      void syncClock(false)
    }
  })
}

/** Extracts dynamic ISO timezone offset string e.g. '+05:30' */
export function getTimezoneOffsetString(timeZone: string, date: Date = new Date(now())): string {
  try {
    const str = date.toLocaleString('en-US', { timeZone, timeZoneName: 'longOffset' })
    const match = str.match(/GMT([+-]\d{1,2}:?\d{2})/)
    if (match) {
      let offset = match[1]
      if (!offset.includes(':')) offset = offset.slice(0, 3) + ':' + offset.slice(3)
      if (offset.length === 5) offset = offset[0] + '0' + offset.slice(1)
      return offset
    }
  } catch {
    // safe fallback
  }
  return '+05:30'
}

const dtfDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Local-time 'YYYY-MM-DD' key in APP_TIMEZONE for a timestamp (single source of day keys). */
export function dayKeyOf(ts: number = now()): string {
  return dtfDay.format(new Date(ts))
}

/** Local-time 'YYYY-MM-DD' for "today" in APP_TIMEZONE on the corrected clock. */
export function todayKey(): string {
  return dayKeyOf(now())
}

/** Local-time 'YYYY-MM' month key in APP_TIMEZONE on the corrected clock. */
export function monthKey(): string {
  return todayKey().slice(0, 7)
}

/** Local midnight (ms) of a 'YYYY-MM-DD' key in APP_TIMEZONE. */
export function keyToMs(key: string): number {
  if (!key) return now()
  const offset = getTimezoneOffsetString(APP_TIMEZONE)
  const ms = Date.parse(`${key}T00:00:00${offset}`)
  if (!isNaN(ms)) return ms
  // Fallback
  const [y, m, d] = key.split('-').map(Number)
  if (!y || !m || !d) return now()
  return new Date(y, m - 1, d).getTime()
}

/** Local midnight (ms) of "today" in APP_TIMEZONE on the corrected clock. */
export function startOfToday(): number {
  return keyToMs(todayKey())
}

const DAY_MS = 86400000

/** React hook: re-renders whenever the clock is corrected. */
export function useClockNow(): number {
  const [v, setV] = useState(now)
  useEffect(() => onClock(() => setV(now())), [])
  return v
}

/**
 * React hook: returns the corrected-clock "today" key and re-renders the
 * consumer when the local day rolls over (~12:00:01 am in APP_TIMEZONE) or when the clock is
 * first anchored to the server. Every "Today" surface (Dashboard, Day book,
 * Reports calendar) uses this so the new day starts FRESH: zeroed sales,
 * zeroed cash flow, zeroed profit, without a manual reload.
 */
export function useDayTick(): string {
  const [day, setDay] = useState<string>(todayKey)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const nextMidnight = startOfToday() + DAY_MS
      const wait = Math.max(1000, nextMidnight - now() + 1600)
      if (timer) clearTimeout(timer)
      timer = setTimeout(tick, wait)
    }
    const tick = () => {
      setDay(todayKey())
      schedule()
    }
    const off = onClock(() => {
      setDay(todayKey())
      schedule()
    })
    schedule()
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])
  return day
}