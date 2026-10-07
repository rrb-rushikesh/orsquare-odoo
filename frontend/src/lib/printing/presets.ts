/**
 * Paper / printer presets and the per-device print settings.
 *
 * A preset is a *physical* description of a receipt printer class, not a
 * visual theme. Everything the renderer needs (character columns, dot width,
 * font) derives from it, so the layout adapts to any printer by changing one
 * value. Figures are the published specifications of the common thermal
 * receipt mechanisms (see docs/PRINTING.md §3 for the sources):
 *
 *   dots / cols  =  printable dots / character cell width
 *   Font A cell = 12 dots wide (ESC/POS, 203 dpi heads), Font B cell = 9 dots.
 *   80 mm paper, 72 mm printable: 576 dots -> 48 cols (A) | 64 cols (B)
 *   80 mm Epson TM-T88 class,     512 dots -> 42 cols (A) | 56 cols (B)
 *   58 mm paper, 48 mm printable: 384 dots -> 32 cols (A) | 42 cols (B)
 *   76 mm impact (TM-U220 class):  40 cols (7x9 matrix)
 */

export type PrintLanguage = 'esc-pos' | 'star-line' | 'star-prnt'
export type FontId = 'a' | 'b'

export interface PaperPreset {
  id: string
  label: string
  /** One line shown under the label: who this is for. */
  hint: string
  paperMm: number
  /** Printable width of the head in mm (what a ruler measures on the slip). */
  printableMm: number
  /** Printable dots per line at the head's native resolution. */
  dots: number
  font: FontId
  /** Characters per line at this preset's font. */
  cols: number
}

export const PAPER_PRESETS: readonly PaperPreset[] = [
  { id: '80-a', label: '80 mm standard', hint: 'Most 80 mm USB/LAN POS printers (Gobbler, Xprinter, Rongta, TVS, Epson TM-T20)', paperMm: 80, printableMm: 72, dots: 576, font: 'a', cols: 48 },
  { id: '80-b', label: '80 mm dense', hint: '80 mm with the small Font B: 64 columns for long item names', paperMm: 80, printableMm: 72, dots: 576, font: 'b', cols: 64 },
  { id: '80-epson', label: '80 mm Epson TM-T88', hint: '80 mm printers with a 512-dot head (TM-T88II to V class, some Star)', paperMm: 80, printableMm: 64, dots: 512, font: 'a', cols: 42 },
  { id: '58-a', label: '58 mm standard', hint: '58 mm mobile and mini printers (384-dot head)', paperMm: 58, printableMm: 48, dots: 384, font: 'a', cols: 32 },
  { id: '58-b', label: '58 mm dense', hint: '58 mm with Font B: 42 columns', paperMm: 58, printableMm: 48, dots: 384, font: 'b', cols: 42 },
  { id: '76-impact', label: '76 mm impact', hint: 'Dot-matrix receipt printers (Epson TM-U220 class), kitchen and bar tickets', paperMm: 76, printableMm: 63, dots: 360, font: 'a', cols: 40 },
] as const

export const CUSTOM_PRESET_ID = 'custom'
export type PresetId = (typeof PAPER_PRESETS)[number]['id'] | typeof CUSTOM_PRESET_ID

export const COLS_MIN = 16
export const COLS_MAX = 80

export type CutMode = 'full' | 'partial' | 'none'
export type DrawerMode = 'never' | 'cash' | 'always'
export type CodePageId = 'auto' | 'cp437' | 'cp850' | 'cp852' | 'cp858' | 'cp860' | 'cp863' | 'cp865' | 'cp866' | 'windows1252'
export type ItemLayout = 'table' | 'stacked'
export type CodeKind = 'none' | 'qr' | 'code128'
export type RuleChar = '-' | '=' | '.' | '*'
export type HeaderSize = 'normal' | 'large'
export type Spacing = 'tight' | 'normal' | 'loose'
export type PrintBackend = 'browser' | 'qz'
/** polished: titled, heavy rules around the total, barcode footer. classic: plain ruled sections. */
export type ReceiptStyle = 'polished' | 'classic'

export interface PrintSettings {
  /** 'browser' = OS print dialog (legacy, works anywhere). 'qz' = silent raw printing through QZ Tray. */
  backend: PrintBackend
  /** Command language of the printer. ESC/POS covers almost every receipt printer; Star models may need the Star ones. */
  language: PrintLanguage
  /** Windows printer name. Empty = discover automatically. */
  printer: string
  preset: PresetId
  /** Used only when preset === 'custom'. */
  customCols: number
  customDots: number
  customFont: FontId
  /** Left / right unprintable margin in dots (ESC/POS GS L + GS W). 0 = use the head's full width. */
  marginLeft: number
  marginRight: number
  /** Columns withheld at the right edge for printers that clip the last character. */
  colsTrim: number
  codePage: CodePageId
  /** Text printed before money on total lines ("Rs." because most receipt code pages lack the rupee sign). */
  currency: string
  style: ReceiptStyle
  /** Title line under the header ("SALES RECEIPT", "TAX INVOICE"). Empty = none. */
  receiptTitle: string
  itemLayout: ItemLayout
  headerSize: HeaderSize
  spacing: Spacing
  ruleChar: RuleChar
  showItemNumbers: boolean
  showUnit: boolean
  showStation: boolean
  showStaff: boolean
  showTime: boolean
  showItemCount: boolean
  /** Bill-number code printed at the bottom: scan it in Sales History to open the bill in a second. */
  code: CodeKind
  /** Feed lines after the last printed line, before cutting / tearing. */
  feedLines: number
  /** Blank lines before the shop name, e.g. to clear a cutter that eats the first line. */
  topFeed: number
  cut: CutMode
  drawer: DrawerMode
  /** ESC p pin: 0 = connector pin 2, 1 = pin 5. */
  drawerPin: 0 | 1
  copies: number
  /** Hold a job when QZ reports the printer offline / out of paper, instead of sending it into the spooler. */
  holdWhenOffline: boolean
}

export const defaultPrintSettings: PrintSettings = {
  backend: 'browser',
  language: 'esc-pos',
  printer: '',
  preset: '80-a',
  customCols: 48,
  customDots: 576,
  customFont: 'a',
  marginLeft: 0,
  marginRight: 0,
  colsTrim: 0,
  codePage: 'cp858',
  currency: 'Rs.',
  style: 'polished',
  receiptTitle: 'SALES RECEIPT',
  itemLayout: 'table',
  headerSize: 'large',
  spacing: 'tight',
  ruleChar: '-',
  showItemNumbers: false,
  showUnit: true,
  showStation: false,
  showStaff: true,
  showTime: true,
  showItemCount: true,
  code: 'code128',
  feedLines: 3,
  topFeed: 0,
  cut: 'full',
  drawer: 'never',
  drawerPin: 0,
  copies: 1,
  holdWhenOffline: true,
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt
}
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt

/** Coerces anything stored (old app version, hand-edited, partial) into a valid settings object. */
export function normalizePrintSettings(raw: unknown): PrintSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const d = defaultPrintSettings
  const presetIds = [...PAPER_PRESETS.map((p) => p.id), CUSTOM_PRESET_ID] as string[]
  const currency = typeof o.currency === 'string' ? o.currency.replace(/[^\x20-\x7e]/g, '').slice(0, 6) : d.currency
  return {
    backend: pick(o.backend, ['browser', 'qz'], d.backend),
    language: pick(o.language, ['esc-pos', 'star-line', 'star-prnt'], d.language),
    printer: typeof o.printer === 'string' ? o.printer.slice(0, 200) : d.printer,
    preset: pick(o.preset, presetIds as PresetId[], d.preset),
    customCols: clampInt(o.customCols, COLS_MIN, COLS_MAX, d.customCols),
    customDots: clampInt(o.customDots, 192, 832, d.customDots),
    customFont: pick(o.customFont, ['a', 'b'], d.customFont),
    marginLeft: clampInt(o.marginLeft, 0, 120, d.marginLeft),
    marginRight: clampInt(o.marginRight, 0, 120, d.marginRight),
    colsTrim: clampInt(o.colsTrim, 0, 4, d.colsTrim),
    codePage: pick(o.codePage, ['auto', 'cp437', 'cp850', 'cp852', 'cp858', 'cp860', 'cp863', 'cp865', 'cp866', 'windows1252'], d.codePage),
    currency,
    style: pick(o.style, ['polished', 'classic'], d.style),
    receiptTitle: typeof o.receiptTitle === 'string' ? o.receiptTitle.replace(/[^ -~]/g, '').slice(0, 32) : d.receiptTitle,
    itemLayout: pick(o.itemLayout, ['table', 'stacked'], d.itemLayout),
    headerSize: pick(o.headerSize, ['normal', 'large'], d.headerSize),
    spacing: pick(o.spacing, ['tight', 'normal', 'loose'], d.spacing),
    ruleChar: pick(o.ruleChar, ['-', '=', '.', '*'], d.ruleChar),
    showItemNumbers: typeof o.showItemNumbers === 'boolean' ? o.showItemNumbers : d.showItemNumbers,
    showUnit: typeof o.showUnit === 'boolean' ? o.showUnit : d.showUnit,
    showStation: typeof o.showStation === 'boolean' ? o.showStation : d.showStation,
    showStaff: typeof o.showStaff === 'boolean' ? o.showStaff : d.showStaff,
    showTime: typeof o.showTime === 'boolean' ? o.showTime : d.showTime,
    showItemCount: typeof o.showItemCount === 'boolean' ? o.showItemCount : d.showItemCount,
    code: pick(o.code, ['none', 'qr', 'code128'], d.code),
    feedLines: clampInt(o.feedLines, 0, 12, d.feedLines),
    topFeed: clampInt(o.topFeed, 0, 6, d.topFeed),
    cut: pick(o.cut, ['full', 'partial', 'none'], d.cut),
    drawer: pick(o.drawer, ['never', 'cash', 'always'], d.drawer),
    drawerPin: o.drawerPin === 1 ? 1 : 0,
    copies: clampInt(o.copies, 1, 3, d.copies),
    holdWhenOffline: typeof o.holdWhenOffline === 'boolean' ? o.holdWhenOffline : d.holdWhenOffline,
  }
}

/**
 * Settings that match what the Printer probe slip measured: the number of characters in row 1 of the Font A ruler.
 * Font A cells are 12 dots wide, so columns x 12 = head dots. A built-in preset is chosen when it matches exactly
 * (so its paper-width label is right); otherwise Custom carries the measured numbers.
 */
export function presetFromProbe(colsA: number): Partial<PrintSettings> | null {
  if (!Number.isFinite(colsA) || colsA < COLS_MIN || colsA > COLS_MAX) return null
  const hit = PAPER_PRESETS.find((p) => p.font === 'a' && p.cols === colsA)
  if (hit) return { preset: hit.id as PresetId, marginLeft: 0, marginRight: 0, colsTrim: 0 }
  return { preset: CUSTOM_PRESET_ID, customCols: colsA, customDots: Math.min(832, colsA * 12), customFont: 'a', marginLeft: 0, marginRight: 0, colsTrim: 0 }
}

export interface PaperGeometry {
  paperMm: number
  printableMm: number
  dots: number
  font: FontId
  /** Raw characters per line the head can hold at `font`. */
  cols: number
  /** Characters the layout may actually use after margins and trim. */
  usableCols: number
  /** Dots that remain printable after margins (GS W argument). */
  printWidthDots: number
}

/** The single place width math lives. Layout, bytes, preview and the browser fallback all read this. */
export function paperGeometry(s: PrintSettings): PaperGeometry {
  const preset = PAPER_PRESETS.find((p) => p.id === s.preset)
  const dots = preset ? preset.dots : s.customDots
  const font = preset ? preset.font : s.customFont
  const cols = preset ? preset.cols : s.customCols
  const cell = dots / cols
  const printWidthDots = Math.max(cell * 8, dots - s.marginLeft - s.marginRight)
  // Margins eat whole character cells off the line; round down so text never overruns the head.
  const fromMargins = Math.floor(printWidthDots / cell + 1e-9)
  const usableCols = Math.max(COLS_MIN, Math.min(cols, fromMargins) - s.colsTrim)
  const printableMm = preset ? preset.printableMm : Math.round((dots / 8) * 10) / 10 // 8 dots/mm at 203 dpi
  const paperMm = preset ? preset.paperMm : Math.round(printableMm + 8)
  return { paperMm, printableMm, dots, font, cols, usableCols, printWidthDots: Math.round(printWidthDots) }
}
