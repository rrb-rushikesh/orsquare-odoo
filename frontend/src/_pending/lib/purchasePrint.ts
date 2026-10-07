import type { PPurchase, PPurchaseReturn } from './repo'
import { loadPrefs } from './prefs'
import { fmtMoney, fmtQty, shopBlock } from './receipt'
import type { DocModel } from './printing/layout'
import type { PrintSettings } from './printing/presets'
import type { PrintHandle, PrintOutcome } from './printing/service'
import { dt } from './utils'

/**
 * Purchase-bill + debit-note printing (F7).
 *
 * These are documents in the same DocModel as sales receipts, so they get the
 * same layout engine, presets, margins, silent QZ path and queue. Call
 * beginPrint() synchronously in the click (before any await), then pass the
 * handle here once the data is loaded.
 */

/** Purchase `date` may be a day key or an ISO timestamp, parse tolerantly. */
const dayTs = (s?: string): number => {
  if (!s) return 0
  const t = Date.parse(s.includes('T') ? s : `${s}T00:00:00`)
  return Number.isNaN(t) ? 0 : t
}

type Item = { productName: string; qty: number; rate: number; total: number }
const docItems = (items: Item[]): DocModel['items'] =>
  items.map((i) => ({ name: i.productName, qty: fmtQty(i.qty), rate: fmtMoney(i.rate), amount: fmtMoney(i.total) }))

export function purchaseBillDoc(p: PPurchase, s: PrintSettings): DocModel {
  const inv = loadPrefs().invoice
  const ts = dayTs(p.date)
  const cur = s.currency ? `${s.currency} ` : ''
  return {
    shop: shopBlock(inv),
    title: 'PURCHASE BILL',
    meta: [
      ['Bill:', p.billNo],
      ['Date:', ts ? dt(ts) : '-'],
      ['Supplier:', p.supplierName],
      ['Status:', String(p.status)],
    ],
    items: docItems(p.items ?? []),
    headings: { item: 'ITEM', qty: 'QTY', rate: 'RATE', amount: 'AMOUNT' },
    summary: [
      { label: 'Paid', value: fmtMoney(p.paidAmount) },
      { label: 'Balance', value: fmtMoney(Math.max(0, p.amount - p.paidAmount)) },
    ],
    net: { label: 'TOTAL', value: `${cur}${fmtMoney(p.amount)}` },
    settle: [],
    footer: p.notes ? [p.notes] : [],
  }
}

export function debitNoteDoc(ret: PPurchaseReturn & { supplierName?: string }, s: PrintSettings): DocModel {
  const inv = loadPrefs().invoice
  const ts = dayTs(ret.date)
  const cur = s.currency ? `${s.currency} ` : ''
  const meta: [string, string][] = [
    ['Note:', ret.billNo],
    ['Date:', ts ? dt(ts) : '-'],
    ['Orig:', ret.purchaseBillNo],
  ]
  if (ret.supplierName) meta.push(['Supplier:', ret.supplierName])
  const settle =
    ret.settlement === 'refund'
      ? `Refund received${ret.refundMethod ? ` - ${ret.refundMethod}` : ''}${ret.refundRef ? ` (${ret.refundRef})` : ''}`
      : 'Reduce supplier payable'
  return {
    shop: shopBlock(inv),
    title: 'DEBIT NOTE',
    meta,
    items: docItems(ret.items),
    summary: [{ label: 'Stock removed from', value: ret.stockLocation === 'counter' ? 'Counter' : 'Godown' }],
    net: { label: 'DEBIT', value: `-${cur}${fmtMoney(ret.amount)}` },
    settle: [{ label: 'Settlement', value: settle }],
    footer: [`Reason: ${ret.reason}`],
  }
}

export function printPurchaseBill(h: PrintHandle, p: PPurchase): Promise<PrintOutcome> {
  return h.submit(purchaseBillDoc(p, loadPrefs().print), { key: `purchase:${p.id}`, label: `Purchase ${p.billNo}`, kind: 'purchase', repeatable: true })
}

export function printPurchaseDebitNote(h: PrintHandle, ret: PPurchaseReturn & { supplierName?: string }): Promise<PrintOutcome> {
  return h.submit(debitNoteDoc(ret, loadPrefs().print), { key: `debit:${ret.billNo}`, label: `Debit note ${ret.billNo}`, kind: 'purchase', repeatable: true })
}
