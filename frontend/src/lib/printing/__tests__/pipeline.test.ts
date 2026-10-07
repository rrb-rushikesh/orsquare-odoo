import { describe, expect, it } from 'vitest'
import { blocksToText, layoutDocument } from '../layout'
import { describeHealth } from '../health'
import { outcomeMessage } from '../outcome'
import { PAPER_PRESETS, defaultPrintSettings, type PrintSettings } from '../presets'
import { sampleReceipt } from '../testSheets'
import { fmtMoney, fmtQty, receiptToDoc, saleToReceipt, type ReceiptData } from '../../receipt'
import type { BridgeSnapshot } from '../bridge'
import type { QueueSummary } from '../queue'

const inv = { shopName: 'SHARMA TRADERS', tagline: '', addressLine: '12 MG Road', addressLine2: 'Pune', phone: '98765 43210', gstin: '', prefix: 'INV-', footerNote: 'Thank you.' }
const S = (o: Partial<PrintSettings> = {}): PrintSettings => ({ ...defaultPrintSettings, ...o })
const render = (r: ReceiptData, s = S()) => {
  const laid = layoutDocument(receiptToDoc(inv, r, s), s)
  return blocksToText(laid.blocks, laid.cols)
}

describe('money and quantity formatting', () => {
  it('always two decimals with Indian grouping', () => {
    expect(fmtMoney(1234567.5)).toBe('12,34,567.50')
    expect(fmtMoney(180)).toBe('180.00')
    expect(fmtMoney(NaN)).toBe('0.00')
  })
  it('integers bare, fractions trimmed', () => {
    expect(fmtQty(12)).toBe('12')
    expect(fmtQty(5.5)).toBe('5.5')
    expect(fmtQty(0.125)).toBe('0.125')
  })
})

describe('sale receipt', () => {
  it('prints discount, GST, tip and the exact server total', () => {
    const r: ReceiptData = { ...sampleReceipt(false), tip: 25, total: 880.5 }
    const t = render(r).join('\n')
    expect(t).toMatch(/Subtotal\s+840\.00/)
    expect(t).toMatch(/Coupon PROMO40\s+-40\.00/)
    expect(t).toMatch(/GST 18%\s+144\.00/)
    expect(t).toMatch(/Tip\s+25\.00/)
    expect(t).toMatch(/NET PAID\s+Rs\. 880\.50/)
    expect(t).toMatch(/Paid by +Cash/)
  })
  it('a provisional open bill says so and is not "NET PAID"', () => {
    const t = render({ ...sampleReceipt(false), provisional: true, method: undefined }).join('\n')
    expect(t).toContain('PROVISIONAL - NOT PAID')
    expect(t).toContain('TOTAL')
    expect(t).not.toContain('NET PAID')
  })
  it('credit note: banner, negative amounts, original bill reference', () => {
    const r: ReceiptData = { ...sampleReceipt(false), billNo: 'CN-7', creditNote: { kind: 'return', originalBillNo: 'INV-1756' }, total: 480, method: 'Refund - Cash' }
    const t = render(r).join('\n')
    expect(t).toContain('CREDIT NOTE')
    expect(t).toContain('Orig: INV-1756')
    expect(t).toMatch(/Returned \(2\)\s+-480\.00/)
    expect(t).toMatch(/CREDIT\s+-Rs\. 480\.00/)
  })
  it('exchange note nets the difference', () => {
    const r: ReceiptData = { ...sampleReceipt(false), billNo: 'EX-1', total: 480, creditNote: { kind: 'exchange', originalBillNo: 'INV-1', replacementBillNo: 'INV-2', replacementTotal: 650 } }
    const t = render(r).join('\n')
    expect(t).toContain('EXCHANGE NOTE')
    expect(t).toMatch(/CUSTOMER PAYS\s+Rs\. 170\.00/)
  })
  it('saleToReceipt joins split payments', () => {
    const r = saleToReceipt({ billNo: 9, date: Date.now(), customerName: 'X', subtotal: 10, discount: 0, gstAmount: 0, total: 10, method: 'Split', payments: [{ method: 'Cash', amount: 5 }, { method: 'UPI', amount: 5 }] })
    expect(r.method).toBe('Cash + UPI')
  })
  it('only cash bills open the drawer', () => {
    expect(receiptToDoc(inv, sampleReceipt(false), S()).cash).toBe(true)
    expect(receiptToDoc(inv, { ...sampleReceipt(false), method: 'UPI' }, S()).cash).toBe(false)
    expect(receiptToDoc(inv, { ...sampleReceipt(false), provisional: true }, S()).cash).toBe(false)
  })
})

describe('hostile data on every preset', () => {
  const nasty: ReceiptData = {
    ...sampleReceipt(true),
    customerName: 'A'.repeat(120),
    items: [
      { name: 'X'.repeat(200), qty: 99999.999, rate: 99999999.99 },
      { name: 'Normal item', unit: '750 ML', qty: 1, rate: 0.5 },
      { name: '  spaced   out \t name\n', qty: 3, rate: 10 },
      { name: 'नमस्ते ₹ "quotes" — dash', qty: 1, rate: 1 },
    ],
    subtotal: 9999999999.99,
    total: 9999999999.99,
  }
  for (const p of PAPER_PRESETS) {
    for (const layout of ['table', 'stacked'] as const) {
      it(`${p.id} / ${layout}: never exceeds the paper, never throws`, () => {
        const s = S({ preset: p.id, itemLayout: layout })
        const lines = render(nasty, s)
        const cols = layoutDocument(receiptToDoc(inv, nasty, s), s).cols
        lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(cols))
        expect(lines.join('\n')).toContain('99,99,99,999.99')
      })
    }
  }
  it('empty bill renders a placeholder, not a crash', () => {
    const t = render({ ...sampleReceipt(false), items: [], subtotal: 0, total: 0, discount: 0, gstSlab: 0, gstAmount: 0 }).join('\n')
    expect(t).toContain('(no items)')
  })
})

describe('health wording', () => {
  const b = (o: Partial<BridgeSnapshot> = {}): BridgeSnapshot => ({ bridge: 'connected', printer: 'P', printerState: 'ready', detail: '', version: '2', awaitingPermission: false, signed: true, lastError: '', ...o })
  const q = (o: Partial<QueueSummary> = {}): QueueSummary => ({ pending: 0, attention: 0, uncertain: 0, lastError: '', jobs: [], ...o })
  it('is quiet when fine', () => expect(describeHealth(true, b(), q()).level).toBe('ok'))
  it('browser mode is neutral', () => expect(describeHealth(false, b(), q()).level).toBe('off'))
  it('QZ down names the count and says receipts are safe', () => {
    const h = describeHealth(true, b({ bridge: 'unreachable' }), q({ pending: 2 }))
    expect(h.level).toBe('error')
    expect(h.label).toContain('2 waiting')
    expect(h.action).toMatch(/saved/)
  })
  it('missing / offline / paper-out map to actionable errors', () => {
    expect(describeHealth(true, b({ printerState: 'missing' }), q()).label).toBe('No printer found')
    expect(describeHealth(true, b({ printerState: 'attention', detail: 'PAPER_OUT' }), q()).label).toBe('Printer paper out')
    expect(describeHealth(true, b({ printerState: 'offline', detail: 'OFFLINE' }), q({ pending: 1 })).label).toBe('Printer offline (1 waiting)')
  })
  it('uncertain outranks everything: a human must look', () => {
    expect(describeHealth(true, b({ bridge: 'unreachable' }), q({ uncertain: 1 })).level).toBe('warn')
  })
  it('printing / retrying', () => {
    expect(describeHealth(true, b(), q({ pending: 1 })).label).toBe('Printing (1)')
    expect(describeHealth(true, b(), q({ pending: 1, attention: 1 })).label).toBe('Retrying (1)')
  })
})

describe('outcome wording', () => {
  it('silent on success, loud on failure, calm when offline-queued', () => {
    expect(outcomeMessage('queued')).toBeNull()
    expect(outcomeMessage('duplicate')).toBeNull()
    expect(outcomeMessage('browser')).toBeNull()
    expect(outcomeMessage('blocked')?.kind).toBe('err')
    expect(outcomeMessage('error')?.kind).toBe('err')
    expect(outcomeMessage('queued-offline')?.kind).toBe('info')
  })
})

describe('shop identity fallback', () => {
  it('prints the shop profile name/phone when the invoice fields are blank, and an override wins', async () => {
    const { shopBlock, setShopIdentity } = await import('../../receipt')
    const blank = { ...inv, shopName: '', phone: '' }
    setShopIdentity({ name: 'Green Mart', phone: '99999 11111' })
    expect(shopBlock(blank).name).toBe('Green Mart')
    expect(shopBlock(blank).phone).toBe('99999 11111')
    expect(shopBlock({ ...blank, shopName: 'Custom Name' }).name).toBe('Custom Name')
    setShopIdentity(null)
    expect(shopBlock(blank).name).toBe('')
  })
})
