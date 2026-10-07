/**
 * Blocks -> HTML, for two uses that must match the paper:
 *  - the live preview in Settings (exact columns, same blocks as the bytes)
 *  - the browser-print fallback (backend 'browser', or "print via browser" on a stuck QZ queue)
 *
 * Width is expressed in `ch`, so N columns is N monospace cells wide at any zoom.
 */
import type { Block } from './layout'
import { paperGeometry, type PrintSettings } from './presets'

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export const PREVIEW_CSS = `
.rcpt{box-sizing:content-box;background:#fff;color:#161616;font-family:'Courier New',ui-monospace,Consolas,monospace;font-size:13px;line-height:1.18;white-space:pre;padding:10px 12px;border:1px solid #e0e0e0;overflow:hidden}
.rcpt .rl{height:1.18em}
.rcpt .rb{font-weight:700}
.rcpt .r2{font-size:2em;line-height:1.05;height:1.05em}
.rcpt .ri{background:#161616;color:#fff}
.rcpt .rc{border:1px dashed #8d8d8d;text-align:center;padding:4px 0;margin:3px 0;white-space:normal;font-size:.85em}
.rcpt .rbar{height:44px;margin:4px auto 0;width:78%;background:repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px,#000 4px 5px,#fff 5px 8px,#000 8px 11px,#fff 11px 12px,#000 12px 13px,#fff 13px 16px)}
.rcpt .rhri{text-align:center;font-size:.9em;letter-spacing:.08em}
`

function line(b: Extract<Block, { t: 'line' }>, cols: number): string {
  const w = b.big ? Math.floor(cols / 2) : cols
  const pad = b.align === 'center' ? Math.floor((w - b.text.length) / 2) : b.align === 'right' ? w - b.text.length : 0
  const text = ' '.repeat(Math.max(0, pad)) + b.text
  const cls = ['rl', b.bold ? 'rb' : '', b.big ? 'r2' : '', b.invert ? 'ri' : ''].filter(Boolean).join(' ')
  return `<div class="${cls}">${esc(text) || '&nbsp;'}</div>`
}

export function blocksToHtml(blocks: Block[], cols: number): string {
  return blocks
    .map((b) => {
      if (b.t === 'line') return line(b, cols)
      if (b.t === 'feed') return '<div class="rl">&nbsp;</div>'.repeat(b.n)
      if (b.t === 'font') return ''
      if (b.kind === 'code128') return `<div class="rbar"></div><div class="rhri">${esc(b.value)}</div>`
      return `<div class="rc">QR &middot; ${esc(b.value)}</div>`
    })
    .join('')
}

/** The preview element's inline style: exactly `cols` cells wide. */
export function previewWidthStyle(s: PrintSettings): string {
  return `width:${paperGeometry(s).usableCols}ch`
}

/** Standalone document for window.print() on any printer/driver: paper-width page, zero margin. */
export function printableDocument(title: string, blocks: Block[], cols: number, s: PrintSettings): string {
  const g = paperGeometry(s)
  // Courier-class advance is 0.6em; size the font so `cols` cells span the printable width.
  const fontMm = (g.printableMm / cols / 0.6).toFixed(3)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:${g.paperMm}mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}
body{width:${g.paperMm}mm;padding:2mm ${(g.paperMm - g.printableMm) / 2}mm 6mm}
.rcpt{width:${cols}ch;font-family:'Courier New',Consolas,monospace;font-size:${fontMm}mm;line-height:1.18;white-space:pre;color:#000;padding:0;border:0}
.rcpt .rbar{height:11mm;margin:1mm auto 0;width:78%;background:repeating-linear-gradient(90deg,#000 0 .5mm,#fff .5mm 1mm,#000 1mm 1.3mm,#fff 1.3mm 2.2mm,#000 2.2mm 3mm,#fff 3mm 3.3mm)}.rcpt .rhri{text-align:center;letter-spacing:.08em}.rcpt .rl{height:1.18em}.rcpt .rb{font-weight:700}.rcpt .r2{font-size:2em;line-height:1.05;height:1.05em}.rcpt .ri{background:#000;color:#fff}
.rcpt .rc{text-align:center;border:1px dashed #000;margin:2px 0;font-size:.85em;white-space:normal}</style>
</head><body><div class="rcpt">${blocksToHtml(blocks, cols)}</div></body></html>`
}

/** Opens the (blank) popup. Call synchronously inside the user gesture: a window.open after an await is blocked. */
export function openPrintWindow(): Window | null {
  const w = window.open('', '_blank', 'width=420,height=680')
  if (w) w.opener = null
  return w
}

/** Writes a document into a window from openPrintWindow() and prints it, closing the window afterwards. */
export function printIntoWindow(w: Window, html: string): void {
  w.document.write(html)
  w.document.close()
  const go = () => {
    try {
      w.focus()
      w.print()
    } catch {
      /* window closed by the user */
    }
  }
  if (w.document.readyState === 'complete') go()
  else w.onload = go
  w.onafterprint = () => w.close()
}
