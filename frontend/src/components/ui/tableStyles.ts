/**
 * Class strings for the product's table cells. Padding is kept separate from the
 * rest: the standard list table (`DataTable`) uses the padding below, while denser
 * editable tables (e.g. the importer's review grid) apply their own per-cell padding.
 */

/** Header cell, everything except padding. */
export const TH_BASE =
  'sticky top-0 z-1 border-b border-line bg-layer text-left align-middle text-s12 font-semibold uppercase tracking-th text-muted whitespace-nowrap compact:text-s11 narrow:tracking-fine'

/** Body cell, everything except padding. */
export const TD_BASE =
  'border-b border-line align-middle text-s14 leading-l135 text-ink whitespace-nowrap compact:text-s12h'

/** Standard list-table cell padding (comfortable 16/12, compact 10/5, mobile 8/7). */
export const TH_PAD = 'px-16 py-12 compact:px-10 compact:py-5 narrow:px-8 narrow:py-7'

/** Extra mobile type sizes that only apply inside the list table wrapper (`.dt` in the original). */
export const TH_LIST_NARROW = 'narrow:text-s11'
export const TD_LIST_NARROW = 'narrow:text-s12h'
export const TD_PAD = 'px-16 py-11 compact:px-10 compact:py-4 narrow:px-8 narrow:py-7'
