/**
 * Pure layout helpers for the Sheet printout.
 *
 * Split out of `sheetPdf.tsx` deliberately: this file imports nothing, so the
 * ordering and page-height rules that the paper depends on can be tested
 * directly, in Node, against the code the PDF actually uses. A test that
 * re-implements the logic proves nothing about the printout.
 *
 * The governing rule is that **the paper must match the screen**. The screen
 * shows pinned brands in their exact manual order, then the rolling
 * four-business-day demand ranking (`src/lib/pinnedSorting.ts`). Nothing here
 * may re-sort: grouping only ever merges *consecutive* items that already share
 * a brand, so the incoming order passes through untouched.
 */

export interface PrintableClosingItem {
  id: string
  section: string
  brand: string
  name: string
  size: string
  closing: number
}

export type ClosingLayout = 'grouped' | 'flat'

export interface ClosingBrandGroup {
  brand: string
  section: string
  items: PrintableClosingItem[]
}

/** How many text lines a label needs at a given characters-per-line width. */
export function linesFor(label: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(label.length / Math.max(1, charsPerLine)))
}

/**
 * Merge consecutive items of the same brand and section, preserving order.
 *
 * Consecutive-only is the whole point: a naive `groupBy` keyed on brand would
 * collapse two runs of the same brand together and silently move the second run
 * up next to the first, which changes the walk order of the count sheet.
 */
export function groupByBrand(items: PrintableClosingItem[]): ClosingBrandGroup[] {
  const groups: ClosingBrandGroup[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.brand === item.brand && last.section === item.section) last.items.push(item)
    else groups.push({ brand: item.brand, section: item.section, items: [item] })
  }
  return groups
}

/**
 * Estimate the slip height for a thermal roll, so the page is long enough to
 * hold every printed line.
 *
 * The previous estimate ignored the brand header rows the grouped layout adds,
 * so a grouped thermal slip overflowed the page length it was told it had and
 * the tail ran off the roll with no error.
 */
export function estimateSlipHeightMm(
  items: PrintableClosingItem[],
  layout: ClosingLayout,
  charsPerLine: number,
  rowMm: number,
): number {
  let total = 25
  if (layout === 'grouped') {
    const seen = new Set<string>()
    for (const item of items) {
      const key = `${item.section}::${item.brand}`
      if (!seen.has(key)) {
        seen.add(key)
        total += rowMm * 1.2
      }
      total += rowMm * linesFor(`${item.name} ${item.size}`, charsPerLine)
    }
    return total
  }
  for (const item of items) total += rowMm * linesFor(`${item.name} ${item.size}`, charsPerLine)
  return total
}

/**
 * Apply the same ordering the screen uses to a set of closing items.
 *
 * `pinnedKeys` are the pin keys in their exact manual order; `orderOf` returns
 * the on-screen index of an item. Unpinned items keep the incoming order, which
 * is already the backend's deterministic order. This exists so a caller that
 * assembles items from a different source can still land on the screen's order
 * rather than falling back to alphabetical.
 */
export function orderClosingItems<T extends PrintableClosingItem>(
  items: T[],
  pinnedKeys: string[],
  pinKeyOf: (item: T) => string,
  orderOf: (item: T) => number,
): T[] {
  if (items.length <= 1) return items
  const rank = new Map<string, number>()
  pinnedKeys.forEach((key, index) => rank.set(key, index))
  const withOrder = items.map((item, index) => ({ item, index }))
  withOrder.sort((a, b) => {
    const ra = rank.get(pinKeyOf(a.item))
    const rb = rank.get(pinKeyOf(b.item))
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    const oa = orderOf(a.item)
    const ob = orderOf(b.item)
    if (oa !== ob) return oa - ob
    return a.index - b.index
  })
  return withOrder.map(entry => entry.item)
}
