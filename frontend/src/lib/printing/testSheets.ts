/**
 * Calibration and acceptance sheets, printed through exactly the same
 * pipeline as a real bill. Each is deliberately short (paper costs money) and
 * answers one question an installer has on site:
 *
 *   probe    How many characters per line does THIS printer fit, per font? (set Custom preset from it)
 *   ruler    Are all columns on the paper? Where is the left/right edge?
 *   margins  Is anything clipped or off-centre? (box, centre, right-align, big text)
 *   charset  Do digits, punctuation and accented letters come out right (code page)?
 *   codes    Do the QR code and barcode scan?
 *   cut      Does the cutter cut clear of the last line, and is the feed right?
 *   sample   What will a normal bill look like?
 *   stress   Long names, many items, big numbers: does alignment hold?
 */
import type { InvoicePrefs } from '../prefs'
import { receiptToDoc, type ReceiptData } from '../receipt'
import { layoutDocument, type Block, type DocModel } from './layout'
import { paperGeometry, type PrintSettings } from './presets'

export type TestKind = 'sample' | 'stress' | 'probe' | 'ruler' | 'margins' | 'charset' | 'codes' | 'cut'

export const TEST_SHEETS: { id: TestKind; label: string; hint: string }[] = [
  { id: 'sample', label: 'Sample bill', hint: 'A typical 2-item bill with your shop header.' },
  { id: 'probe', label: 'Printer probe', hint: 'Measures how many characters per line this printer really fits, in Font A and Font B.' },
  { id: 'ruler', label: 'Ruler', hint: 'Column ruler and edge markers: shows the real printable width.' },
  { id: 'margins', label: 'Margins box', hint: 'Box, centred and right-aligned text: reveals clipping and offset.' },
  { id: 'charset', label: 'Characters', hint: 'Digits, symbols and accented letters: verifies the code page.' },
  { id: 'codes', label: 'QR + barcode', hint: 'Scan both with a phone to confirm size and quality.' },
  { id: 'cut', label: 'Cut & feed', hint: 'Checks the cutter clears the last line.' },
  { id: 'stress', label: 'Stress bill', hint: 'Long names, 12 items, large quantities and prices.' },
]

export function sampleReceipt(stress = false): ReceiptData {
  const items = stress
    ? [
        { name: 'ROYAL STAG BARREL SELECT LARGE PREMIUM WHISKY', unit: '750 ML', qty: 2, rate: 1480 },
        { name: 'KINGFISHER ULTRA PREMIUM LAGER STRONG BEER', unit: '650 ML', qty: 24, rate: 185.5 },
        { name: 'BLENDERS PRIDE RESERVE COLLECTION', unit: '180 ML', qty: 6, rate: 420 },
        { name: 'OLD MONK XXX RUM', unit: '375 ML', qty: 1, rate: 310 },
        { name: 'MCDOWELLS NO.1 CELEBRATION RUM', unit: '750 ML', qty: 3, rate: 560 },
        { name: 'IMPERIAL BLUE', unit: '90 ML', qty: 100, rate: 95 },
        { name: 'BUDWEISER MAGNUM STRONG', unit: '500 ML', qty: 12, rate: 160 },
        { name: 'SULA SAUVIGNON BLANC WINE', unit: '750 ML', qty: 1, rate: 1350 },
        { name: 'SODA WATER', unit: '750 ML', qty: 5.5, rate: 18 },
        { name: 'DISPOSABLE GLASS PACK OF 50', qty: 2, rate: 45 },
        { name: 'PEANUTS MASALA', qty: 10, rate: 20 },
        { name: 'ROYAL CHALLENGE AMERICAN PRIDE', unit: '750 ML', qty: 1, rate: 2150 },
      ]
    : [
        { name: 'ROYAL STAG 750ML', unit: '750 ML', qty: 1, rate: 480 },
        { name: 'KINGFISHER ULTRA 650ML', unit: '650 ML', qty: 2, rate: 180 },
      ]
  const subtotal = items.reduce((a, i) => a + i.qty * i.rate, 0)
  const discount = stress ? 500 : 40
  const gstSlab = 18
  const gstAmount = Math.round((subtotal - discount) * 0.18 * 100) / 100
  return {
    billNo: stress ? '1000456' : '1756',
    date: new Date(2026, 7, 22, 18, 45).getTime(),
    station: 'Counter 1',
    staffName: 'Ravi',
    customerName: stress ? 'SHARMA TRADING AND GENERAL MERCHANTS' : 'WALK IN CUSTOMER',
    method: 'Cash',
    couponCode: 'PROMO40',
    items,
    subtotal,
    discount,
    gstSlab,
    gstAmount,
    total: subtotal - discount + gstAmount,
  }
}

const ln = (text: string, o: Partial<Extract<Block, { t: 'line' }>> = {}): Block => ({ t: 'line', text, align: 'left', ...o })

export interface TestSheet {
  label: string
  laid: { blocks: Block[]; cols: number }
  cash?: boolean
}

export function buildTestSheet(kind: TestKind, inv: InvoicePrefs, s: PrintSettings): TestSheet {
  const g = paperGeometry(s)
  const W = g.usableCols
  const half = Math.floor(W / 2)
  const label = `Test: ${TEST_SHEETS.find((t) => t.id === kind)?.label ?? kind}`
  const doc = (d: DocModel): TestSheet => ({ label, laid: layoutDocument(d, s), cash: d.cash })

  if (kind === 'sample' || kind === 'stress') return doc(receiptToDoc(inv, sampleReceipt(kind === 'stress'), s))

  const b: Block[] = []
  /** Decade-marked ruler longer than any head: the printer wraps it where the paper ends, so the last number on row 1 is the answer. */
  const pattern = (n: number) => {
    let out = ''
    for (let i = 1; i <= n; i++) out += i % 10 === 0 ? String((i / 10) % 10) : '.'
    return out
  }
  if (kind === 'probe') {
    b.push(ln('PRINTER PROBE', { align: 'center', bold: true }))
    b.push(ln('Row 1 length = chars per line', { align: 'center' }))
    b.push({ t: 'font', font: 'a' })
    b.push(ln('FONT A'))
    b.push(ln(pattern(80)))
    b.push({ t: 'font', font: 'b' })
    b.push(ln('FONT B'))
    b.push(ln(pattern(80)))
    b.push({ t: 'font', font: g.font })
  } else if (kind === 'ruler') {
    b.push(ln(`${g.paperMm}mm preset ${g.dots} dots ${W} cols`, { bold: true }))
    b.push(ln('<' + '-'.repeat(Math.max(0, W - 2)) + '>'))
    b.push(ln(pattern(80)))
    b.push(ln('|' + ' '.repeat(Math.max(0, W - 2)) + '|'))
    b.push(ln('L' + ' '.repeat(Math.max(0, W - 2)) + 'R'))
    b.push(ln(`${s.marginLeft}L ${s.marginRight}R dots trim ${s.colsTrim}`, { align: 'center' }))
  } else if (kind === 'margins') {
    b.push(ln('+' + '-'.repeat(Math.max(0, W - 2)) + '+'))
    b.push(ln('|' + 'LEFT'.padEnd(Math.max(0, W - 2)) + '|'))
    b.push(ln('|' + 'CENTRE'.padStart(Math.floor((W - 2 + 6) / 2)).padEnd(Math.max(0, W - 2)) + '|'))
    b.push(ln('|' + 'RIGHT'.padStart(Math.max(0, W - 2)) + '|'))
    b.push(ln('+' + '-'.repeat(Math.max(0, W - 2)) + '+'))
    b.push(ln('BIG TEXT'.slice(0, half), { big: true, bold: true, align: 'center' }))
    b.push(ln('Bold line', { bold: true }))
    b.push(ln('Normal line 0123456789'.slice(0, W)))
  } else if (kind === 'charset') {
    b.push(ln('Rs. 0123456789 ,.-/:;@#%&*()'.slice(0, W)))
    b.push(ln('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, W)))
    b.push(ln('abcdefghijklmnopqrstuvwxyz'.slice(0, W)))
    b.push(ln('Accents: é ñ ü å ç ß'.slice(0, W)))
    b.push(ln('Rupee sign maps to: ₹'.slice(0, W)))
  } else if (kind === 'codes') {
    b.push(ln('Scan me', { align: 'center', bold: true }))
    b.push({ t: 'code', kind: 'qr', value: `${inv.prefix || 'INV-'}1756` })
    b.push({ t: 'code', kind: 'code128', value: '1756' })
  } else {
    b.push(ln('CUT TEST', { align: 'center', bold: true, big: true }))
    b.push(ln('Last line before the cutter'))
    b.push(ln('This line must be fully on the slip'))
  }
  return { label, laid: { blocks: b, cols: W } }
}
