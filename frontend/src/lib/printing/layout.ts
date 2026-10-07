/**
 * Receipt layout engine: a pure function from a document model + print
 * settings to fixed-width text blocks.
 *
 * Every consumer renders THE SAME blocks: ESC/POS bytes (escpos.ts), the live
 * preview and the browser-print fallback (html.ts). That is what makes the
 * preview true to the paper: there is exactly one place that decides where a
 * character goes. Columns are character cells, so alignment cannot drift with
 * fonts, zoom, drivers or browsers.
 *
 * No I/O, no DOM, no dates, no locale: adapters format money/dates into
 * strings first (see receipt.ts), so this module is trivially testable.
 */
import { paperGeometry, type PrintSettings } from './presets'

export interface DocItem {
  name: string
  unit?: string
  qty: string
  rate: string
  amount: string
}

export interface DocLine {
  label: string
  value: string
  strong?: boolean
}

export interface DocModel {
  shop: { name: string; tagline: string; address: string[]; phone: string; gstin: string }
  /** Reversed/large notice under the header ("PROVISIONAL - NOT PAID", "CREDIT NOTE"). Replaces the title. */
  banner?: string
  /** Centered bold document title ("SALES RECEIPT", "PURCHASE BILL"). */
  title?: string
  meta: [label: string, value: string][]
  items: DocItem[]
  /** Column headings; the second to fourth label the numeric columns. */
  headings?: { item: string; qty: string; rate: string; amount: string }
  summary: DocLine[]
  net?: DocLine
  /** Lines after the net total (payment mode, settlement). */
  settle: DocLine[]
  footer: string[]
  /** Value encoded in the footer barcode / QR. */
  code?: string
  /** True for a cash sale: drives the cash-drawer pulse. */
  cash?: boolean
  itemCount?: { lines: number; qty: string }
}

export type Block =
  | { t: 'line'; text: string; align: 'left' | 'center' | 'right'; bold?: boolean; big?: boolean; invert?: boolean }
  | { t: 'code'; kind: 'qr' | 'code128'; value: string }
  | { t: 'font'; font: 'a' | 'b' }
  | { t: 'feed'; n: number }

export interface LaidOut {
  blocks: Block[]
  /** Usable character columns at normal size. */
  cols: number
}

// ---- text helpers ---------------------------------------------------------

const PUNCT: Record<string, string> = {
  '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '−': '-',
  '·': '-', '•': '*', '…': '...', ' ': ' ', '×': 'x', '→': '>', '₹': 'Rs.',
}

/** Collapses whitespace and control characters and maps common typographic characters to the ASCII every receipt code page has. */
export function toPrintable(s: unknown): string {
  return String(s ?? '')
    .replace(/[‘’“”–—−·•… ×→₹]/g, (c) => PUNCT[c])
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Like toPrintable but keeps spacing exactly: for lines the layout has ALREADY padded. Collapsing whitespace there
 * (as toPrintable does) silently destroys every right-aligned column on paper while the preview still looks right.
 */
export function sanitizeLine(s: unknown): string {
  return String(s ?? '')
    .replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2212\u00b7\u2022\u2026\u00a0\u00d7\u2192\u20b9]/g, (c) => PUNCT[c])
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
}

/** Greedy word wrap to `width`; words longer than a line are hard-split. Always returns at least one line. */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width)
  const out: string[] = []
  let line = ''
  for (const word of toPrintable(text).split(' ')) {
    if (!word) continue
    let rest = word
    while (rest.length > w) {
      // Close the current line first so a long word starts on a fresh one.
      if (line) {
        out.push(line)
        line = ''
      }
      out.push(rest.slice(0, w))
      rest = rest.slice(w)
    }
    if (!line) line = rest
    else if (line.length + 1 + rest.length <= w) line += ' ' + rest
    else {
      out.push(line)
      line = rest
    }
  }
  if (line) out.push(line)
  return out.length ? out : ['']
}

const padR = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)

/** `left` ... `right` on one line at exactly `width`; left wraps onto extra lines only when it cannot share the line. */
export function leftRight(left: string, right: string, width: number): string[] {
  const l = toPrintable(left)
  const r = toPrintable(right)
  if (!r) return wrap(l, width)
  if (l.length + 1 + r.length <= width) return [l + ' '.repeat(width - l.length - r.length) + r]
  // Keep the value on the last line, right-aligned, and wrap the label in the space beside it.
  const room = width - r.length - 1
  if (room >= 6) {
    const parts = wrap(l, room)
    const last = parts.pop() as string
    return [...parts, last + ' '.repeat(width - last.length - r.length) + r]
  }
  return [...wrap(l, width), padL(r, width)]
}

const unitInName = (name: string, unit: string) => {
  const squash = (x: string) => x.replace(/\s+/g, '').toUpperCase()
  return squash(name).includes(squash(unit))
}

// ---- the engine -----------------------------------------------------------

const sep = (ch: string, w: number) => ch.repeat(w)

export function layoutDocument(doc: DocModel, s: PrintSettings): LaidOut {
  const W = paperGeometry(s).usableCols
  const half = Math.floor(W / 2)
  const polished = s.style === 'polished'
  const b: Block[] = []
  const line = (text: string, o: Partial<Extract<Block, { t: 'line' }>> = {}) =>
    b.push({ t: 'line', text, align: 'left', ...o })
  const gap = (n = 1) => b.push({ t: 'feed', n })
  const rule = () => line(sep(s.ruleChar, W))
  /** Heavy rule: frames the header and the total in the polished style. */
  const heavy = () => line(sep(polished ? '=' : s.ruleChar, W))
  const sectionGap = () => {
    if (s.spacing === 'loose') gap(1)
  }

  // --- header
  const { shop } = doc
  if (s.topFeed > 0) gap(s.topFeed)
  const name = toPrintable(shop.name)
  if (name) {
    if (s.headerSize === 'large' && name.length <= half) line(name, { align: 'center', bold: true, big: true })
    else for (const l of wrap(name, W)) line(l, { align: 'center', bold: true })
  }
  if (shop.tagline) for (const l of wrap(shop.tagline, W)) line(l, { align: 'center' })
  // Address lines share a row when they fit; phone + GSTIN likewise.
  const addr = shop.address.map(toPrintable).filter(Boolean)
  const addrJoined = addr.join(', ')
  if (addrJoined) for (const l of wrap(addrJoined, W)) line(l, { align: 'center' })
  const contacts = [shop.phone && `Ph: ${toPrintable(shop.phone)}`, shop.gstin && `GSTIN: ${toPrintable(shop.gstin)}`].filter(Boolean) as string[]
  if (contacts.length) {
    const joined = contacts.join('  ')
    if (joined.length <= W) line(joined, { align: 'center' })
    else for (const c of contacts) for (const l of wrap(c, W)) line(l, { align: 'center' })
  }
  const hasHeader = b.some((x) => x.t === 'line')
  if (hasHeader) heavy()
  sectionGap()

  // Title for documents that carry one; a banner (credit note / provisional) replaces it.
  const title = toPrintable(doc.title ?? '')
  if (doc.banner) {
    const banner = toPrintable(doc.banner)
    if (banner.length <= half) line(banner, { align: 'center', bold: true, big: true })
    else {
      // A full-width reversed band reads as a stamp and never wraps mid-word.
      const t = banner.slice(0, W)
      const padLeft = Math.floor((W - t.length) / 2)
      line(' '.repeat(padLeft) + t + ' '.repeat(W - t.length - padLeft), { bold: true, invert: true })
    }
  } else if (title) {
    line(title, { align: 'center', bold: true })
  }

  // --- meta: pack "Label: value" cells two to a row when both fit
  const cells = doc.meta.filter(([, v]) => toPrintable(v)).map(([k, v]) => `${toPrintable(k)} ${toPrintable(v)}`)
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i]
    const c = cells[i + 1]
    if (c !== undefined && a.length + 1 + c.length <= W) {
      line(leftRight(a, c, W)[0])
      i++
    } else {
      for (const l of wrap(a, W)) line(l)
    }
  }
  rule()
  sectionGap()

  // --- items
  const h = doc.headings ?? { item: 'ITEM', qty: 'QTY', rate: 'RATE', amount: 'AMOUNT' }
  const showNo = s.showItemNumbers
  const nameOf = (it: DocItem, i: number) => {
    let n = toPrintable(it.name)
    if (s.showUnit && it.unit && !unitInName(n, toPrintable(it.unit))) n += ` ${toPrintable(it.unit)}`
    return showNo ? `${i + 1}.${n}` : n
  }
  if (doc.items.length === 0) {
    line('(no items)', { align: 'center' })
  } else {
    // Column widths come from the data, so a bill of small numbers gives the name
    // the widest possible column and a bill with 7-figure totals still aligns.
    const qtyW = Math.max(h.qty.length, ...doc.items.map((i) => i.qty.length))
    const rateW = Math.max(h.rate.length, ...doc.items.map((i) => i.rate.length))
    const amtW = Math.max(h.amount.length, ...doc.items.map((i) => i.amount.length))
    // Two-space gutters between numeric columns read far better on thermal paper when the width allows.
    const gut = W >= 40 ? 2 : 1
    const nameW = W - qtyW - rateW - amtW - gut * 3
    const minName = Math.max(12, Math.floor(W * 0.3))
    // On narrow paper a four-column table squeezes names into ~12 cells and wraps every bottle. Unless every name
    // fits its column, stack instead: the full-width name line reads far better than "ROYAL STAG / 750ML".
    const namesFit = doc.items.every((it, i) => nameOf(it, i).length <= nameW)
    const table = s.itemLayout === 'table' && nameW >= minName && (nameW >= 22 || namesFit)
    const G = ' '.repeat(gut)
    if (table) {
      line(padR(h.item, nameW) + G + padL(h.qty, qtyW) + G + padL(h.rate, rateW) + G + padL(h.amount, amtW), { bold: true })
      if (polished) rule()
      doc.items.forEach((it, i) => {
        const parts = wrap(nameOf(it, i), nameW)
        parts.forEach((p, k) => {
          line(k === 0 ? padR(p, nameW) + G + padL(it.qty, qtyW) + G + padL(it.rate, rateW) + G + padL(it.amount, amtW) : p)
        })
        if (s.spacing === 'loose') gap(1)
      })
    } else {
      // Stacked: name on its own line(s); "qty x rate" left, amount right. Used when the paper is too narrow for four columns.
      doc.items.forEach((it, i) => {
        for (const p of wrap(nameOf(it, i), W)) line(p, { bold: true })
        for (const l of leftRight(`${it.qty} x ${it.rate}`, it.amount, W - 2)) line('  ' + l)
        if (s.spacing === 'loose') gap(1)
      })
    }
  }
  rule()
  sectionGap()

  // --- totals
  const count =
    doc.itemCount && doc.items.length > 0 && s.showItemCount
      ? `${doc.itemCount.lines} item${doc.itemCount.lines === 1 ? '' : 's'}, qty ${doc.itemCount.qty}`
      : ''
  if (polished && count) line(count, { align: 'center', bold: true })
  for (const l of doc.summary) for (const t of leftRight(l.label, l.value, W)) line(t, { bold: l.strong })
  if (doc.net) {
    const lbl = toPrintable(doc.net.label)
    const val = toPrintable(doc.net.value)
    heavy()
    if (lbl.length + 1 + val.length <= half) {
      line(leftRight(lbl, val, half)[0], { bold: true, big: true })
    } else if (val.length <= half) {
      // Label small above, the amount large on its own line: nothing wraps and the figure stays the biggest thing on the slip.
      line(lbl, { bold: true })
      line(val, { bold: true, big: true, align: 'right' })
    } else {
      for (const t of leftRight(lbl, val, W)) line(t, { bold: true })
    }
    heavy()
  }
  // Classic style: "2 items, qty 3" shares a row with the payment mode when it fits.
  let settle = doc.settle
  if (!polished && count) {
    const pay = settle.length === 1 ? `${settle[0].label}: ${settle[0].value}` : ''
    if (pay && count.length + 1 + pay.length <= W) {
      line(leftRight(count, pay, W)[0])
      settle = []
    } else line(count)
  }
  for (const l of settle) for (const t of leftRight(l.label, l.value, W)) line(t, { bold: l.strong })

  // --- footer
  const footer = doc.footer.flatMap((f) => f.split('\n')).map(toPrintable).filter(Boolean)
  if (footer.length) {
    if (polished) gap(1)
    else rule()
    footer.forEach((f, i) => {
      for (const l of wrap(f, W)) line(l, { align: 'center', bold: polished && i === 0 })
    })
  }
  if (doc.code && s.code !== 'none') {
    gap(1)
    b.push({ t: 'code', kind: s.code, value: doc.code })
  }
  return { blocks: b, cols: W }
}

/** Plain-text rendering (tests, logs, the text preview). Big lines are shown at half width as the paper prints them. */
export function blocksToText(blocks: Block[], cols: number): string[] {
  const out: string[] = []
  for (const x of blocks) {
    if (x.t === 'feed') for (let i = 0; i < x.n; i++) out.push('')
    else if (x.t === 'code') out.push(`[${x.kind.toUpperCase()}: ${x.value}]`)
    else if (x.t === 'font') continue
    else {
      const w = x.big ? Math.floor(cols / 2) : cols
      const pad = x.align === 'center' ? Math.floor((w - x.text.length) / 2) : x.align === 'right' ? w - x.text.length : 0
      out.push(' '.repeat(Math.max(0, pad)) + x.text)
    }
  }
  return out
}
