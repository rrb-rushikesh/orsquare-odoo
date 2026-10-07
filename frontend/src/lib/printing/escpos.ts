/**
 * Blocks -> printer bytes.
 *
 * The command vocabulary (initialise, code pages, bold/size/invert, QR,
 * barcode, cut, cash-drawer pulse) comes from @point-of-sale/receipt-printer-encoder,
 * which also speaks the Star Line and StarPRNT dialects, so switching a shop's
 * printer to a Star model is a setting, not code.
 *
 * The encoder insists on 32/35/42/44/48 columns and pads/re-wraps lines
 * itself. Our layout engine has already placed every character, so we drive
 * the encoder one styled *piece* at a time (each piece <= 48 cells of its own
 * width) and assemble the line ourselves. Each segment's trailing CR+LF is
 * normalised to a bare LF: some printers are configured to turn CR into a
 * second line feed, which shows up as double-spaced slips.
 */
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import { layoutDocument, sanitizeLine, type Block, type DocModel } from './layout'
import { paperGeometry, type PrintSettings } from './presets'

const ENCODER_COLS = 48
const LF = 0x0a
const CR = 0x0d

type Seg = number[]

function mk(s: PrintSettings) {
  return new ReceiptPrinterEncoder({ language: s.language, columns: ENCODER_COLS, feedBeforeCut: 0 })
}

/** Removes the encoder's unconditional trailing CR LF. `keepLf` leaves a bare LF (for QR/barcode, which need to advance). */
function trimNewline(bytes: Uint8Array, keepLf: boolean): Seg {
  const a = Array.from(bytes)
  const n = a.length
  if (n >= 2 && a[n - 2] === LF && a[n - 1] === CR) a.length = n - 2
  else if (n >= 1 && a[n - 1] === LF) a.length = n - 1
  if (keepLf) a.push(LF)
  return a
}

const codepageOf = (s: PrintSettings) => (s.codePage === 'windows1252' ? 'windows1252' : s.codePage)

/** Splits `text` into pieces whose on-paper width (chars x multiplier) fits the encoder's 48 cells. */
function pieces(text: string, widthMul: number): string[] {
  const max = Math.max(1, Math.floor(ENCODER_COLS / widthMul))
  const out: string[] = []
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max))
  return out.length ? out : ['']
}

function textLine(b: Extract<Block, { t: 'line' }>, cols: number, s: PrintSettings): Seg {
  const mul = b.big ? 2 : 1
  const width = b.big ? Math.floor(cols / 2) : cols
  const t = sanitizeLine(b.text) // never toPrintable here: it would collapse the layout's padding
  const pad = b.align === 'center' ? Math.floor((width - t.length) / 2) : b.align === 'right' ? width - t.length : 0
  const full = ' '.repeat(Math.max(0, pad)) + t
  const out: Seg = []
  for (const piece of pieces(full, mul)) {
    if (piece.trim() === '' && !b.invert) continue
    const e = mk(s).codepage(codepageOf(s) as never)
    if (b.big) e.size(2, 2)
    if (b.bold) e.bold(true)
    if (b.invert) e.invert(true)
    // The encoder's line composer collapses every run of spaces to one and strips leading ones, which destroys
    // padding-based alignment (right-aligned amounts, centring). Space runs of 2+ are therefore emitted as raw
    // 0x20 (a space in every code page and in Star mode) inside the same styled run; only the words go through
    // the encoder. Single spaces inside a phrase are safe and stay in the text.
    for (const part of piece.split(/( {2,})/)) {
      if (part === '') continue
      if (/^ +$/.test(part)) e.raw(new Array(part.length).fill(0x20))
      else {
        const word = part.trimStart()
        if (word.length < part.length) e.raw(new Array(part.length - word.length).fill(0x20)) // a lone leading space
        e.text(word)
      }
    }
    if (b.invert) e.invert(false)
    if (b.bold) e.bold(false)
    if (b.big) e.size(1, 1)
    out.push(...trimNewline(e.encode(), false))
  }
  out.push(LF)
  return out
}

const align = (s: PrintSettings, n: 0 | 1 | 2): Seg => (s.language === 'esc-pos' ? [0x1b, 0x61, n] : [0x1b, 0x1d, 0x61, n])

/** Code 128 (subset B) width in modules: start 11 + 11 per character + check 11 + stop 13. */
export const code128Modules = (chars: number): number => 11 * (chars + 2) + 13

function codeBlock(b: Extract<Block, { t: 'code' }>, s: PrintSettings): Seg {
  const out: Seg = [...align(s, 1)]
  const e = mk(s)
  if (b.kind === 'qr') e.qrcode(b.value, { model: 2, size: 5, errorlevel: 'm' })
  else {
    // Module width: the encoder maps width 2 -> 3 dots per module, 1 -> 2. Take the widest that still fits the
    // head with a few dots to spare (a barcode wider than the head is not printed at all by most printers).
    const dots = paperGeometry(s).printWidthDots
    const width = code128Modules(b.value.length) * 3 <= dots - 8 ? 2 : 1
    // Human-readable text below the bars, so a cashier can also read or key the number.
    e.barcode(b.value, 'code128', { height: 64, width, text: true })
  }
  out.push(...trimNewline(e.encode(), true), ...align(s, 0))
  return out
}

/** Bytes that set up the page: reset, font, line spacing, print-area margins. */
function preamble(s: PrintSettings): Seg {
  const geo = paperGeometry(s)
  const out: Seg = trimNewline(mk(s).initialize().font(geo.font).encode(), false)
  if (s.language === 'esc-pos') {
    // GS L nL nH: left margin. GS W nL nH: printable width. Skipped at 0 so printers without the commands are untouched.
    if (s.marginLeft > 0 || s.marginRight > 0) {
      const left = s.marginLeft
      const width = geo.printWidthDots
      out.push(0x1d, 0x4c, left & 0xff, (left >> 8) & 0xff, 0x1d, 0x57, width & 0xff, (width >> 8) & 0xff)
    }
    // ESC 3 n: line pitch in dots. Font A glyphs are 24 dots tall, Font B 17: tight leaves a 2-3 dot gap
    // (clear, not touching), normal keeps the printer's own default (30), loose opens it up.
    if (s.spacing !== 'normal') {
      const a = geo.font === 'a'
      out.push(0x1b, 0x33, s.spacing === 'tight' ? (a ? 27 : 20) : a ? 38 : 30)
    }
  }
  return out
}

function cutBytes(s: PrintSettings): Seg {
  if (s.cut === 'none') return []
  return trimNewline(mk(s).cut(s.cut).encode(), false)
}

function drawerBytes(s: PrintSettings): Seg {
  return trimNewline(mk(s).pulse(s.drawerPin, 100, 100).encode(), false)
}

export interface EncodeOptions {
  /** Fire the cash-drawer pulse (settings.drawer decides whether it is honoured). */
  cash?: boolean
}

/** Whether this job should open the drawer under the device's drawer policy. */
export function shouldOpenDrawer(s: PrintSettings, cash: boolean | undefined): boolean {
  return s.drawer === 'always' || (s.drawer === 'cash' && !!cash)
}

export function encodeBlocks(blocks: Block[], cols: number, s: PrintSettings, opts: EncodeOptions = {}): Uint8Array {
  const out: Seg = [...preamble(s)]
  if (shouldOpenDrawer(s, opts.cash)) out.push(...drawerBytes(s))
  for (const b of blocks) {
    if (b.t === 'line') out.push(...textLine(b, cols, s))
    else if (b.t === 'code') out.push(...codeBlock(b, s))
    else if (b.t === 'font') out.push(...trimNewline(mk(s).font(b.font).encode(), false))
    else for (let i = 0; i < b.n; i++) out.push(LF)
  }
  for (let i = 0; i < s.feedLines; i++) out.push(LF)
  out.push(...cutBytes(s))
  return Uint8Array.from(out)
}

/** Full pipeline for a document: layout -> bytes. */
export function encodeDocument(doc: DocModel, s: PrintSettings): Uint8Array {
  const { blocks, cols } = layoutDocument(doc, s)
  return encodeBlocks(blocks, cols, s, { cash: doc.cash })
}

export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
