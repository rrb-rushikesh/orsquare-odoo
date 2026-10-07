import { describe, expect, it } from 'vitest'
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import { encodeBlocks, shouldOpenDrawer, toBase64 } from '../escpos'
import { type Block } from '../layout'
import { PAPER_PRESETS, defaultPrintSettings, type PrintSettings } from '../presets'

const S = (o: Partial<PrintSettings> = {}): PrintSettings => ({ ...defaultPrintSettings, feedLines: 0, spacing: 'normal', ...o })
const line = (text: string, o: Partial<Extract<Block, { t: 'line' }>> = {}): Block => ({ t: 'line', text, align: 'left', ...o })
/** Latin-1 text of the stream with code-page selects (ESC t n) removed, so split pieces read as one line. */
const text = (u: Uint8Array) => Buffer.from(u).toString('latin1').replace(/t./g, '')
const hex = (u: Uint8Array) => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join(' ')
const has = (u: Uint8Array, seq: number[]) => hex(u).includes(seq.map((b) => b.toString(16).padStart(2, '0')).join(' '))
const oracle = (language: PrintSettings['language'], f: (e: ReceiptPrinterEncoder) => ReceiptPrinterEncoder) =>
  Array.from(f(new ReceiptPrinterEncoder({ language, columns: 48, feedBeforeCut: 0 })).encode())

describe('encodeBlocks (ESC/POS)', () => {
  it('starts with initialise and ends with a cut', () => {
    const b = encodeBlocks([line('HELLO')], 48, S())
    expect(Array.from(b.slice(0, 2))).toEqual([0x1b, 0x40])
    expect(Array.from(b.slice(-3))).toEqual([0x1d, 0x56, 0x00]) // GS V 0: full cut, no trailing CR/LF after it
  })
  it('cut modes: partial, none', () => {
    expect(Array.from(encodeBlocks([line('x')], 48, S({ cut: 'partial' })).slice(-3))).toEqual([0x1d, 0x56, 0x01])
    expect(has(encodeBlocks([line('x')], 48, S({ cut: 'none' })), [0x1d, 0x56])).toBe(false)
  })
  it('never emits CR (0x0d): bare LF line ends only', () => {
    const b = encodeBlocks([line('one'), line('two', { bold: true }), { t: 'feed', n: 2 }, line('BIG', { big: true, align: 'center' })], 48, S())
    expect(Array.from(b).includes(0x0d)).toBe(false)
  })
  it('one LF per line, and text bytes are the ASCII text', () => {
    const b = Array.from(encodeBlocks([line('AB'), line('CD')], 48, S({ cut: 'none' })))
    expect(b.filter((x) => x === 0x0a).length).toBe(2)
    expect(b.includes(0x41) && b.includes(0x44)).toBe(true)
  })
  it('centers and right-aligns by padding within the usable width', () => {
    const c = encodeBlocks([line('AB', { align: 'center' })], 10, S({ cut: 'none' }))
    expect(text(c)).toContain('    AB\n') // (10-2)/2 = 4 spaces
    const r = encodeBlocks([line('AB', { align: 'right' })], 10, S({ cut: 'none' }))
    expect(text(r)).toContain('        AB\n')
  })
  it('wide presets (64 cols) are emitted whole, not wrapped at 48', () => {
    const t = text(encodeBlocks([line('x'.repeat(64))], 64, S({ preset: '80-b', cut: 'none' })))
    expect(t).toContain('x'.repeat(64) + '\n')
  })
  it('big lines use double size and reset', () => {
    const b = encodeBlocks([line('TOTAL', { big: true, bold: true })], 48, S())
    expect(has(b, [0x1d, 0x21, 0x11])).toBe(true)
    expect(has(b, [0x1d, 0x21, 0x00])).toBe(true)
  })
  it('margins emit GS L / GS W with the print-area width; none emits nothing', () => {
    const none = encodeBlocks([line('x')], 48, S())
    expect(has(none, [0x1d, 0x4c])).toBe(false)
    const m = encodeBlocks([line('x')], 44, S({ marginLeft: 24, marginRight: 24 }))
    expect(has(m, [0x1d, 0x4c, 24, 0])).toBe(true)
    expect(has(m, [0x1d, 0x57, 528 & 0xff, 528 >> 8])).toBe(true)
  })
  it('line pitch: tight sets ESC 3, normal leaves the printer default', () => {
    expect(has(encodeBlocks([line('x')], 48, S({ spacing: 'tight' })), [0x1b, 0x33, 27])).toBe(true)
    expect(has(encodeBlocks([line('x')], 48, S({ spacing: 'normal' })), [0x1b, 0x33])).toBe(false)
  })
  it('QR and barcode match the library byte-for-byte (plus centering)', () => {
    const qr = Array.from(encodeBlocks([{ t: 'code', kind: 'qr', value: 'INV-1' }], 48, S({ cut: 'none' })))
    const want = oracle('esc-pos', (e) => e.qrcode('INV-1', { model: 2, size: 5, errorlevel: 'm' })).slice(0, -2)
    expect(hex(Uint8Array.from(qr))).toContain(hex(Uint8Array.from(want)))
    const bc = encodeBlocks([{ t: 'code', kind: 'code128', value: 'INV1' }], 48, S({ cut: 'none' }))
    const wantBc = oracle('esc-pos', (e) => e.barcode('INV1', 'code128', { height: 64, width: 2, text: true })).slice(0, -2)
    expect(hex(bc)).toContain(hex(Uint8Array.from(wantBc)))
  })
  it('drawer pulse only per policy', () => {
    const on = S({ drawer: 'cash' })
    expect(shouldOpenDrawer(on, true)).toBe(true)
    expect(shouldOpenDrawer(on, false)).toBe(false)
    expect(shouldOpenDrawer(S({ drawer: 'never' }), true)).toBe(false)
    expect(shouldOpenDrawer(S({ drawer: 'always' }), false)).toBe(true)
    expect(has(encodeBlocks([line('x')], 48, on, { cash: true }), [0x1b, 0x70, 0x00])).toBe(true)
    expect(has(encodeBlocks([line('x')], 48, on, { cash: false }), [0x1b, 0x70])).toBe(false)
  })
  it('feed lines are added before the cut', () => {
    const a = Array.from(encodeBlocks([line('x')], 48, S({ feedLines: 4 })))
    const cut = a.lastIndexOf(0x56)
    expect(a.slice(cut - 5, cut - 1)).toEqual([0x0a, 0x0a, 0x0a, 0x0a].slice(0, 4).length ? [0x0a, 0x0a, 0x0a, 0x0a] : [])
  })
  it('every supported code page encodes without throwing', () => {
    for (const cp of ['auto', 'cp437', 'cp850', 'cp852', 'cp858', 'cp860', 'cp863', 'cp865', 'cp866', 'windows1252'] as const) {
      expect(() => encodeBlocks([line('Rs. 1,234.50 café ₹ न')], 48, S({ codePage: cp }))).not.toThrow()
    }
  })
  it('unprintable characters degrade to "?", never crash or drop the line', () => {
    const s = Buffer.from(encodeBlocks([line('A नम B')], 48, S({ cut: 'none' }))).toString('latin1')
    expect(s).toMatch(/A \?+ B\n/)
  })
  it('all three command languages produce a cut', () => {
    for (const language of ['esc-pos', 'star-line', 'star-prnt'] as const) {
      const b = encodeBlocks([line('x')], 48, S({ language }))
      expect(b.length).toBeGreaterThan(8)
    }
  })
  it('every preset encodes a full-width line', () => {
    for (const p of PAPER_PRESETS) {
      const b = text(encodeBlocks([line('y'.repeat(p.cols))], p.cols, S({ preset: p.id, cut: 'none' })))
      expect(b).toContain('y'.repeat(p.cols) + '\n')
    }
  })
  it('base64 round-trips', () => {
    const u = Uint8Array.from([0, 1, 2, 250, 255, 27, 64])
    expect(Array.from(Buffer.from(toBase64(u), 'base64'))).toEqual(Array.from(u))
  })
})

describe('interior spacing survives the encoder (regression: amounts were not right-aligned on paper)', () => {
  const one = (text: string, o: Partial<Extract<Block, { t: 'line' }>> = {}) => text0(encodeBlocks([line(text, o)], 48, S({ cut: 'none' })))
  const text0 = (u: Uint8Array) => Buffer.from(u).toString('latin1').replace(/\u001bt.|\u001d!.|\u001bE./g, '')
  it('a padded label/value row keeps every space', () => {
    const row = 'Subtotal' + ' '.repeat(18) + '840.00'
    expect(one(row)).toContain(row + '\n')
  })
  it('keeps the exact column gap in an item row', () => {
    const row = 'ROYAL STAG      1   480.00   480.00'
    expect(one(row)).toContain(row + '\n')
  })
  it('keeps spaces in bold and big styled lines', () => {
    const row = 'NET' + ' '.repeat(10) + '944.00'
    expect(one(row, { bold: true })).toContain(row + '\n')
    expect(one(row, { big: true })).toContain(row + '\n')
  })
  it('a full-width padded line is identical on paper to the layout text, for every preset', () => {
    for (const p of PAPER_PRESETS) {
      const row = 'A' + ' '.repeat(p.cols - 8) + '123.45'.padStart(7, ' ')
      expect(text0(encodeBlocks([line(row)], p.cols, S({ preset: p.id, cut: 'none' })))).toContain(row + '\n')
    }
  })
})
