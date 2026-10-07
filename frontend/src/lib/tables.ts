import type { TablesConfig } from '@/types'

export const DEFAULT_TABLES: TablesConfig = {
  enabled: false,
  tips: false,
  rows: 2,
  cols: 4,
  pattern: 'numeric',
  prefix: 'T',
}

/** 1 → A, 2 → B … 27 → AA (spreadsheet-style column letters). */
function colName(n: number): string {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function normalizeTablesConfig(cfg: Partial<TablesConfig> | undefined | null): TablesConfig {
  const c = cfg ?? {}
  return {
    enabled: c.enabled === true,
    // Absent key defaults OFF: both floor-mode switches ship disabled for all users.
    tips: c.tips === true,
    rows: Math.min(8, Math.max(1, Math.round(Number(c.rows) || DEFAULT_TABLES.rows))),
    cols: Math.min(12, Math.max(1, Math.round(Number(c.cols) || DEFAULT_TABLES.cols))),
    pattern: (['numeric', 'letters', 'grid', 'custom'] as const).includes(c.pattern as never)
      ? (c.pattern as TablesConfig['pattern'])
      : DEFAULT_TABLES.pattern,
    // Empty stays empty while typing: the 'T' fallback only kicks in when a
    // label is RENDERED (tableLabel), so the field can be cleared.
    prefix: typeof c.prefix === 'string' ? c.prefix.trim().toUpperCase().slice(0, 8) : DEFAULT_TABLES.prefix,
  }
}

/** Stable Firestore doc id for a table label, labels are display-friendly,
 *  ids must be URL/key-safe. */
export function tableId(label: string): string {
  return 'T-' + label.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Display label of the index-th table (0-based, row-major across the grid). */
export function tableLabel(cfg: TablesConfig, index: number): string {
  const row = Math.floor(index / cfg.cols) + 1
  const col = (index % cfg.cols) + 1
  switch (cfg.pattern) {
    case 'letters':
      return colName(index + 1)
    case 'grid':
      return `${colName(row)}${col}`
    case 'custom':
      return `${cfg.prefix || DEFAULT_TABLES.prefix}${index + 1}`
    case 'numeric':
    default:
      return String(index + 1)
  }
}

export function tableLabels(cfg: TablesConfig): string[] {
  const n = Math.min(96, Math.max(1, cfg.rows * cfg.cols))
  return Array.from({ length: n }, (_, i) => tableLabel(cfg, i))
}