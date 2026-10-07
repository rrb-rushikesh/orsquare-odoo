/**
 * Client-side helpers for the business-day cutoff ("lock-in") feature.
 *
 * DISPLAY helpers only. The server stays authoritative for attribution:
 * GET /api/console/shops/<id>/business-day/ resolves the current business
 * date, and /api/sales/list/ rows carry an additive `business_date` key.
 * These functions power the Settings → Data Control preview/timeline and the
 * "changing the cutoff moves today" consequence warning.
 */

import { useEffect, useState } from 'react'
import { now, onClock, keyToMs } from './clock'
import { dayKeyOfValue } from './utils'

const IST = 'Asia/Kolkata'
const pad2 = (n: number) => String(n).padStart(2, '0')

/** 'HH:MM' → minutes-since-midnight (invalid input → 0). */
export function timeToMinutes(v: string): number {
  const [h, m] = (v || '').split(':').map(Number)
  const hh = Number.isFinite(h) ? h : 0
  const mm = Number.isFinite(m) ? m : 0
  return hh * 60 + mm
}

/** Business-day key of a sale-like row: prefer the server's additive
 *  `businessDate`; fall back to the historical UTC slice of `date`. */
export function saleBusinessDayKey(s: { date: string; businessDate?: string | null }): string {
  return (s.businessDate || '').slice(0, 10) || dayKeyOfValue(s.date) || ''
}

/** minutes-since-midnight → 'HH:MM' (wraps into 00:00–23:59). */
export function minutesToTime(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

/** IST-projected parts of an instant: { dayKey: 'YYYY-MM-DD', minutes }. */
export function istParts(ms: number): { dayKey: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = new Map(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const hh = Number(parts.get('hour') ?? '0')
  const mm = Number(parts.get('minute') ?? '0')
  return {
    dayKey: `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`,
    minutes: (hh === 24 ? 0 : hh) * 60 + mm,
  }
}

/** Shift a 'YYYY-MM-DD' key by whole days (DST-safe via setDate). */
export function shiftDayKey(k: string, days: number): string {
  const d = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Business-date key ('YYYY-MM-DD') of an instant under a cutoff (IST).
 *  Defaults to the same 02:00 cutoff the server uses when a shop has no
 *  explicit lock-in (`apps/core/business_day.py`), never 00:00 — a wrong
 *  default silently reproduces calendar-day bucketing for those shops. */
export function businessDateKeyOf(ms: number, lockIn?: string): string {
  const p = istParts(ms)
  return p.minutes < timeToMinutes(lockIn ?? '02:00') ? shiftDayKey(p.dayKey, -1) : p.dayKey
}

/** Today's business-date key under a cutoff, observed on the corrected clock. */
export function currentBusinessDateKey(lockIn?: string, atMs: number = now()): string {
  return businessDateKeyOf(atMs, lockIn)
}

/** Epoch ms of the next business-day boundary (the end of the current
 *  business day = tomorrow's lock-in) under `lockIn`. Anchors a "Today"
 *  surface so it rolls over exactly at the cutoff, not at IST midnight. */
export function nextLockInBoundary(lockIn?: string, atMs: number = now()): number {
  const cur = currentBusinessDateKey(lockIn, atMs)
  const lockMins = timeToMinutes(lockIn ?? '02:00')
  return keyToMs(shiftDayKey(cur, 1)) + lockMins * 60000
}

/**
 * React hook: the shop's CURRENT business-date key under its lock-in cutoff,
 * re-rendered when the clock is corrected and re-scheduled to roll over at
 * the next lock-in boundary. The server's `business_date` per-sale rows use
 * exactly this key, so a "Today" filter anchored here always agrees with the
 * bills that belong to the current business day (including the 00:00→cutoff
 * window, when the business date is still the previous calendar day).
 */
export function useCurrentBusinessDate(lockIn?: string): string {
  const [key, setKey] = useState<string>(() => currentBusinessDateKey(lockIn))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const wait = Math.max(1000, nextLockInBoundary(lockIn) - now() + 1600)
      if (timer) clearTimeout(timer)
      timer = setTimeout(tick, wait)
    }
    const tick = () => {
      setKey(currentBusinessDateKey(lockIn))
      schedule()
    }
    const off = onClock(() => {
      setKey(currentBusinessDateKey(lockIn))
      schedule()
    })
    schedule()
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [lockIn])
  return key
}

/** Pretty short label for a day key, e.g. 'Sun, 6 Sep'. */
export function labelDayKey(k: string): string {
  const d = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
  return Number.isNaN(d.getTime()) ? k : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Human remaining-time label until an ISO instant ('4h 5m'), '' when invalid. */
export function remainingUntil(iso: string, atMs: number = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = t - atMs
  if (diff <= 0) return 'now'
  const mins = Math.ceil(diff / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}