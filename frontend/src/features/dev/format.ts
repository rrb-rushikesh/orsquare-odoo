import type { Stage } from './types'
import type { TagTone } from '@/components/ui/Tag'

/** An ISO date ("2026-10-05") as "5 Oct 2026". Pure formatting of the server's date; the browser clock and zone play no part. */
export function showDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** An ISO timestamp with offset ("2026-10-05T14:03:00+05:30") as "5 Oct, 14:03" in the zone the server sent it in. */
export function showWhen(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso)
  return m ? `${showDate(m[1]).replace(/ \d{4}$/, '')}, ${m[2]}` : iso
}

export const STAGE_LABEL: Record<Stage, string> = {
  active: 'Active',
  trial: 'Trial',
  expiring: 'Expiring',
  suspended: 'Suspended',
  unavailable: 'Unavailable',
}

export const STAGE_TONE: Record<Stage, TagTone> = {
  active: 'ok',
  trial: 'info',
  expiring: 'warn',
  suspended: 'err',
  unavailable: 'gray',
}

export const REASON_TEXT: Record<string, string> = {
  administrative: 'Suspended by an administrator',
  expired: 'Subscription ended',
  not_started: 'Subscription not started',
}

/** "3 days left", "ends today", "ended 4 days ago". */
export function leftText(days: number | null): string {
  if (days === null) return 'No end date'
  if (days === 0) return 'Ends today'
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} left`
  return `Ended ${-days} day${days === -1 ? '' : 's'} ago`
}
