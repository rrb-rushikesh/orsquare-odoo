import type { BridgeSnapshot } from './bridge'
import type { QueueSummary } from './queue'

export type HealthLevel = 'off' | 'ok' | 'busy' | 'warn' | 'error'

export interface PrintHealth {
  level: HealthLevel
  /** Short label for the status bar. */
  label: string
  /** One sentence telling the cashier what to do (empty when nothing is needed). */
  action: string
  bridge: BridgeSnapshot
  queue: QueueSummary
}

/** Pure mapping from raw state to what a cashier sees. Exported for tests. */
export function describeHealth(backendIsQz: boolean, b: BridgeSnapshot, q: QueueSummary): Omit<PrintHealth, 'bridge' | 'queue'> {
  if (!backendIsQz) return { level: 'off', label: 'Browser printing', action: '' }
  if (backendIsQz && b.awaitingPermission) {
    return {
      level: 'warn',
      label: q.pending > 0 ? `Allow printing in QZ (${q.pending} waiting)` : 'Allow printing in QZ',
      action: 'QZ Tray is asking permission on this PC. Click Allow, then open Settings > Bill & Invoice > "Stop the Allow pop-ups" once so it never asks again.',
    }
  }
  if (q.uncertain > 0) return { level: 'warn', label: 'Check last receipt', action: 'A receipt may not have printed. Open the printer status and confirm.' }
  if (b.bridge === 'unreachable') {
    return q.pending > 0
      ? { level: 'error', label: `Printer offline (${q.pending} waiting)`, action: 'Start QZ Tray on this computer. Receipts are saved and will print automatically.' }
      : { level: 'error', label: 'Printer offline', action: 'Start QZ Tray on this computer.' }
  }
  if (b.bridge === 'connecting' || b.bridge === 'off') {
    return { level: 'busy', label: q.pending > 0 ? `Connecting printer (${q.pending} waiting)` : 'Connecting printer', action: '' }
  }
  if (b.printerState === 'missing') return { level: 'error', label: q.pending > 0 ? `No printer (${q.pending} waiting)` : 'No printer found', action: 'Check the printer is plugged in and switched on.' }
  if (b.printerState === 'offline' || b.printerState === 'attention') {
    const why = b.detail ? b.detail.replace(/_/g, ' ').toLowerCase() : 'needs attention'
    return { level: 'error', label: q.pending > 0 ? `Printer ${why} (${q.pending} waiting)` : `Printer ${why}`, action: 'Check paper, cover and power. Waiting receipts print automatically.' }
  }
  if (q.pending > 0) return { level: 'busy', label: q.attention > 0 ? `Retrying (${q.pending})` : `Printing (${q.pending})`, action: '' }
  return { level: 'ok', label: 'Printer ready', action: '' }
}

