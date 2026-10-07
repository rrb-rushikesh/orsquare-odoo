/**
 * Sheet print document model — TYPES ONLY.
 *
 * The HTML `document.write` -> `window.print()` pipeline that used to live here
 * was replaced by the single `@react-pdf/renderer` pipeline (`sheetPdf.tsx`),
 * which the print specification requires: the on-screen preview and the print
 * action must consume the SAME PDF bytes, and the interactive register DOM must
 * never be printed. With that renderer in place the HTML document builder
 * (`sheetDocument`, `gridTable`, `summaryTable`, `SHEET_PRINT_CSS` and
 * `printSheetDocument`) had no remaining caller and was removed rather than
 * left as a second, subtly different print path.
 *
 * These types are the shared contract between the Sheet page (which builds the
 * document model from register data) and the PDF renderer (which draws it), so
 * they stay here. See docs/tabs/sheet.md and docs/CONVENTIONS.md.
 */

export interface SheetPrintSummaryRow {
  item: string
  amount: string
  note: string
  /** 1 = indented sub-row (an expense head under the Expenses total). */
  depth?: number
}

export interface SheetPrintSection {
  tabLabel: string
  headers: string[]
  rows: (string | number)[][]
  totals: (string | number)[]
  numericFrom: number
  hiddenCount?: number
}
