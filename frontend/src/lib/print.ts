/**
 * Bill printing.
 *
 * The bill itself (taxes, totals, HSN, GSTIN, UPI QR text) is rendered by Odoo (`bills.thermal_text` / `bills.escpos`),
 * so every receipt matches the posted document exactly.  This module only delivers it:
 *   - QZ Tray configured  -> raw ESC/POS bytes straight to the thermal printer (silent, opens the drawer)
 *   - otherwise / on failure -> the browser print dialog with the same fixed-width text
 * Offline there is no posted bill yet, so a clearly marked PROVISIONAL slip is printed from the local basket.
 */
import { call } from './api'
import { ensureConnected, ensurePrinter, sendRaw } from './printing/bridge'
import { PAPER_PRESETS } from './printing/presets'
import { loadPrefs } from './prefs'

export type PrintResult = 'printed' | 'dialog' | 'failed'

function paperCols(): number {
  const s = loadPrefs().print
  if (s.preset === 'custom') return s.customCols
  return PAPER_PRESETS.find((p) => p.id === s.preset)?.cols ?? 48
}

function printViaBrowser(lines: string[], title: string): PrintResult {
  const w = window.open('', '_blank', 'width=420,height=640')
  if (!w) return 'failed'
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  w.document.write(`<!doctype html><title>${esc(title)}</title><style>@page{margin:4mm}body{margin:0}pre{font:12px/1.25 "Cascadia Mono",Consolas,monospace;white-space:pre}</style><pre>${esc(lines.join('\n'))}</pre>`)
  w.document.close()
  w.focus()
  w.print()
  return 'dialog'
}

/** Print a posted bill (online). Falls back to the browser dialog if the thermal printer is unavailable. */
export async function printBill(orderId: number, jobName = 'Bill'): Promise<PrintResult> {
  const settings = loadPrefs().print
  const cols = paperCols()
  if (settings.backend === 'qz') {
    try {
      await ensureConnected()
      const printer = await ensurePrinter(settings)
      const b64 = await call<string>('bills', 'escpos', { order_id: orderId, cols, open_drawer: settings.drawer !== 'never' })
      await sendRaw(printer, b64, jobName)
      return 'printed'
    } catch {
      /* printer unreachable: fall through to the dialog so the customer still gets a slip */
    }
  }
  try {
    const lines = await call<string[]>('bills', 'thermal_text', { order_id: orderId, cols })
    return printViaBrowser(lines, jobName)
  } catch {
    return 'failed'
  }
}

export interface ProvisionalLine { name: string; qty: number; rate: number }

/** Offline slip from the local basket. Not a tax invoice: Odoo posts the real bill when the device reconnects. */
export function printProvisional(shop: string, lines: ProvisionalLine[], estimatedTotal: number): PrintResult {
  const cols = paperCols()
  const rule = '-'.repeat(cols)
  const row = (l: ProvisionalLine) => {
    const left = `${l.name}`.slice(0, Math.max(8, cols - 22))
    const right = `${l.qty} x ${l.rate.toFixed(2)}`
    return left.padEnd(cols - right.length) + right
  }
  const out = [shop.toUpperCase().slice(0, cols), 'PROVISIONAL SLIP: NOT A TAX INVOICE', rule, ...lines.map(row), rule,
    `ESTIMATED TOTAL ${estimatedTotal.toFixed(2)}`.padStart(cols), '', 'The final bill is issued when the', 'shop is back online.']
  return printViaBrowser(out, 'Provisional slip')
}
