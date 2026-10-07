import { describe, expect, it } from 'vitest'
import { blocksToText, layoutDocument, leftRight, wrap, type DocModel } from '../layout'
import { PAPER_PRESETS, defaultPrintSettings, normalizePrintSettings, paperGeometry, type PrintSettings } from '../presets'

const base = (over: Partial<DocModel> = {}): DocModel => ({
  shop: { name: 'ORSQUARE RETAIL', tagline: 'Fresh every day', address: ['12 MG Road', 'Pune 411057'], phone: '98765 43210', gstin: '27AAAAA0000A1Z5' },
  meta: [['Bill:', 'INV-1756'], ['Date:', '22/08/2026 6:45 PM'], ['Cust:', 'WALK IN CUSTOMER'], ['By:', 'Ravi']],
  items: [
    { name: 'ROYAL STAG 750ML', unit: '750 ML', qty: '1', rate: '480.00', amount: '480.00' },
    { name: 'KINGFISHER ULTRA PREMIUM LAGER STRONG BEER 650ML', unit: '650 ML', qty: '12', rate: '180.00', amount: '2,160.00' },
  ],
  summary: [{ label: 'Subtotal', value: '2,640.00' }, { label: 'GST 18%', value: '475.20' }],
  net: { label: 'NET PAID', value: 'Rs. 3,115.20' },
  settle: [{ label: 'Paid by', value: 'Cash' }],
  footer: ['Thank you for your business.'],
  itemCount: { lines: 2, qty: '13' },
  ...over,
})
const at = (id: string, over: Partial<PrintSettings> = {}): PrintSettings => ({ ...defaultPrintSettings, preset: id as never, ...over })

describe('wrap / leftRight', () => {
  it('wraps on words and hard-splits oversize words', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrap('', 5)).toEqual([''])
  })
  it('puts value flush right on one line when it fits', () => {
    const [l] = leftRight('Subtotal', '1,000.00', 24)
    expect(l).toHaveLength(24)
    expect(l.startsWith('Subtotal')).toBe(true)
    expect(l.endsWith('1,000.00')).toBe(true)
  })
  it('keeps the value on the last line when the label is too long', () => {
    const ls = leftRight('A very long label that cannot share a line', '99.00', 20)
    expect(ls.length).toBeGreaterThan(1)
    expect(ls[ls.length - 1].endsWith('99.00')).toBe(true)
    ls.forEach((x) => expect(x.length).toBeLessThanOrEqual(20))
  })
})

describe('layout across every preset', () => {
  for (const p of PAPER_PRESETS) {
    it(`${p.id}: no line exceeds the usable columns; item columns align`, () => {
      const s = at(p.id)
      const { blocks, cols } = layoutDocument(base(), s)
      const lines = blocksToText(blocks, cols)
      lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(cols))
      // Every item row ends at the same column as the header: amounts right-aligned top to bottom.
      const head = lines.find((l) => l.startsWith('ITEM'))
      if (!head) {
        // Narrow paper stacks the rows: name line, then an indented "qty x rate ... amount" line with the amount flush right.
        const amt = lines.filter((l) => /^ +[0-9]+ x [0-9.,]+ +[0-9.,]+$/.test(l))
        expect(amt.length).toBeGreaterThanOrEqual(2)
        expect(new Set(amt.map((l) => l.length)).size).toBe(1)
        return
      }
      const rows = lines.filter((l) => /\d+\.\d\d$/.test(l) && /^[A-Z]/.test(l) && !l.startsWith('ITEM') && l.length === head.length)
      expect(rows.length).toBeGreaterThanOrEqual(2)
      const rightEdges = new Set(rows.map((r) => r.trimEnd().length))
      expect(rightEdges.size).toBe(1)
    })
  }
  it('a long name wraps inside the name column without moving qty/rate/amount', () => {
    const { blocks, cols } = layoutDocument(base(), at('80-a'))
    const lines = blocksToText(blocks, cols)
    const i = lines.findIndex((l) => l.startsWith('KINGFISHER'))
    expect(lines[i]).toMatch(/12\s+180\.00\s+2,160\.00$/)
    expect(lines[i + 1].trim().length).toBeGreaterThan(0)
    expect(lines[i + 1]).not.toMatch(/\d\.\d\d$/)
  })
  it('does not repeat a unit already in the name', () => {
    const { blocks, cols } = layoutDocument(base(), at('80-a'))
    expect(blocksToText(blocks, cols).join('\n')).not.toMatch(/750ML 750 ML/)
  })
  it('falls back to stacked rows when four columns cannot fit', () => {
    const s = at('58-a', { itemLayout: 'stacked' })
    const { blocks, cols } = layoutDocument(base(), s)
    const lines = blocksToText(blocks, cols)
    expect(lines.some((l) => /^\s+12 x 180\.00\s+2,160\.00$/.test(l))).toBe(true)
  })
})

describe('compactness', () => {
  it('a 2-item bill fits in well under 25 printed lines on 80 mm', () => {
    const { blocks, cols } = layoutDocument(base(), at('80-a'))
    const n = blocksToText(blocks, cols).length
    expect(n).toBeLessThanOrEqual(24)
  })
  it('address and phone/GSTIN share lines when they fit', () => {
    const { blocks, cols } = layoutDocument(base(), at('80-a'))
    const t = blocksToText(blocks, cols).join('\n')
    expect(t).toContain('12 MG Road, Pune 411057')
    expect(t).toContain('Ph: 98765 43210  GSTIN: 27AAAAA0000A1Z5')
  })
  it('meta cells pair up on one line', () => {
    const { blocks, cols } = layoutDocument(base(), at('80-a'))
    const t = blocksToText(blocks, cols)
    expect(t.some((l) => l.startsWith('Bill: INV-1756') && l.endsWith('22/08/2026 6:45 PM'))).toBe(true)
  })
  it('the net total is printed large when it fits, bold when it does not', () => {
    const big = layoutDocument(base(), at('80-a')).blocks.find((b) => b.t === 'line' && b.text.startsWith('NET PAID'))
    expect(big && big.t === 'line' && big.big).toBe(true)
    const narrow = layoutDocument(base({ net: { label: 'CUSTOMER PAYS', value: 'Rs. 1,23,45,678.00' } }), at('58-a')).blocks.find((b) => b.t === 'line' && b.text.startsWith('CUSTOMER'))
    expect(narrow && narrow.t === 'line' && narrow.big).toBeFalsy()
  })
})

describe('settings', () => {
  it('normalize repairs junk and clamps', () => {
    const n = normalizePrintSettings({ preset: 'nope', marginLeft: -5, copies: 99, currency: 'Rs.₹é', cut: 'x', colsTrim: 'a' })
    expect(n.preset).toBe('80-a')
    expect(n.marginLeft).toBe(0)
    expect(n.copies).toBe(3)
    expect(n.currency).toBe('Rs.')
    expect(n.cut).toBe('full')
    expect(n.colsTrim).toBe(0)
  })
  it('margins shrink the usable columns by whole cells', () => {
    const g = paperGeometry(at('80-a', { marginLeft: 24, marginRight: 24 }))
    expect(g.usableCols).toBe(44)
    expect(paperGeometry(at('80-a', { colsTrim: 2 })).usableCols).toBe(46)
  })
  it('custom preset uses its own width', () => {
    const g = paperGeometry(at('custom', { customCols: 36, customDots: 432 }))
    expect(g.usableCols).toBe(36)
    expect(g.printableMm).toBeCloseTo(54)
  })
})
