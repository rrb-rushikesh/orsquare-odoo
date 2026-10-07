/**
 * Column width model for the register grid.
 *
 * The single rule (docs/CONVENTIONS.md §3.2): a column's BASELINE width comes
 * from the numeric magnitude it normally holds, and real content may expand it
 * within a hard cap. Sizing from the widest value that happens to appear is what
 * made the Sheet waste most of the screen on empty space; sizing purely from
 * content is what made it jump around every refresh.
 *
 * Baselines are derived from the rendered glyph run, not from a magic pixel
 * count per column: each digit in IBM Plex Mono at 11px plus a small gutter.
 */

/** Characters-per-digit allowance, tuned against IBM Plex Mono at the grid's
 *  11px body / 10px header sizes, plus horizontal cell padding. */
const DIGIT_PX = 7.4;
const CELL_PADDING_PX = 12;

/** Digits a column is *expected* to hold in normal operation. Anything wider is
 *  an outlier and must not permanently widen the column. */
export type TypicalDigits = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

/** Baseline for a numeric column, by typical digit count. */
export function digitBaseline(digits: number): number {
  return Math.round(digits * DIGIT_PX + CELL_PADDING_PX);
}

/** Baselines for the four magnitudes the register actually uses. Exported so a
 *  page declares intent ("this is a 3-digit piece count") rather than pixels. */
export const BASELINE = {
  /** OPN / INW / CLS / SLD — a handful of bottles. */
  pieces1: digitBaseline(1),
  /** The common case for a busy day at one bottle size. */
  pieces2: digitBaseline(2),
  /** A strong day, or a pallet-level count. */
  pieces3: digitBaseline(3),
  /** Depot-scale stock. */
  pieces4: digitBaseline(4),
  /** A row total across every size. */
  pieces5: digitBaseline(5),
  /** Rupee amounts with grouping ("12,480"). */
  money4: digitBaseline(6),
  /** A rate cell wide enough for "1120 – 1340". */
  rate: digitBaseline(9),
  /** Brand / item text. */
  label: 220,
} as const;

const OUTLIER_CAP: Record<TypicalDigits, number> = {
  1: digitBaseline(4),
  2: digitBaseline(5),
  3: digitBaseline(6),
  4: digitBaseline(7),
  5: digitBaseline(8),
  6: digitBaseline(9),
  7: digitBaseline(10),
  8: digitBaseline(11),
  9: digitBaseline(12),
  10: digitBaseline(13),
  11: digitBaseline(14),
  12: digitBaseline(15),
  13: digitBaseline(16),
  14: digitBaseline(17),
};

const CHAR_PX = 6.6;

function textWidth(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  return String(value).length * CHAR_PX + CELL_PADDING_PX;
}

/**
 * Final width for one column: the declared baseline, widened to fit the widest
 * real value in the column, and clamped to the outlier cap for that magnitude.
 */
export function resolveColumnWidth(options: {
  typical: TypicalDigits;
  header?: string;
  values?: readonly unknown[];
  min?: number;
  max?: number;
}): number {
  const { typical, header, values = [], min, max } = options;
  let needed = header ? textWidth(header) : 0;
  for (const value of values) needed = Math.max(needed, textWidth(value));

  const baseline = Math.max(digitBaseline(typical), min ?? 0);
  const capped = Math.min(needed, OUTLIER_CAP[typical]);
  const width = Math.max(baseline, capped, header ? textWidth(header) : 0);
  return max ? Math.min(max, width) : width;
}

/**
 * Fixed floor for a column whose real content is not in the data — the brand
 * column holds a pin button, a status dot, the name and the items control, so
 * its data value is not a proxy for its width.
 */
export const LABEL_MIN_WIDTH = 200;
