/** What a print attempt did, and the one cashier-facing wording for it (pure: unit-tested). */
/** 'queued-offline': saved and will print by itself, but the printer is not ready right now (tell the cashier once). */
export type PrintOutcome = 'queued' | 'queued-offline' | 'duplicate' | 'browser' | 'blocked' | 'error'

/** One toast wording for every caller. Returns null when there is nothing to tell the cashier. */
export function outcomeMessage(o: PrintOutcome): { text: string; kind: 'ok' | 'err' | 'info' } | null {
  switch (o) {
    case 'blocked':
      return { text: 'Allow pop-ups on this site to print, or switch to silent printing in Settings > Bill & Invoice.', kind: 'err' }
    case 'error':
      return { text: 'Could not prepare the receipt for printing.', kind: 'err' }
    case 'queued-offline':
      return { text: 'Printer is not ready. The receipt is saved and will print by itself when it is back.', kind: 'info' }
    default:
      return null
  }
}
