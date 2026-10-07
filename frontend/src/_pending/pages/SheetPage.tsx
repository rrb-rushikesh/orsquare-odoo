import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import {
  getSheet,
  type SheetAllRow,
  type SheetCell,
  type SheetRegister,
  type SheetResponse,
  type SheetRow,
  type SheetTotals,
} from '@/lib/repo';
import { Btn, Drawer, EmptyState, Tag, useToast } from '@/components/ui';
import { MiniCalendar, ddisplay, useDateRange } from '@/components/DateRangeFilter';
import { useCurrentBusinessDate } from '@/lib/businessDay';
import { dayKeyShift, downloadCsv } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCal,
  IconCheckCircle,
  IconDownload,
  IconPrinter,
  IconRefresh,
  IconSearch,
  IconPin,
  IconPinFilled,
  IconZap,
} from '@/components/icons';
import { RegisterGrid, type GridColumn, type NestedHeader } from '@/components/grid/RegisterGrid';
import { LABEL_MIN_WIDTH } from '@/components/grid/columnWidths';
import { type SheetPrintSection, type SheetPrintSummaryRow } from '@/lib/sheetPrint';
import { SheetPrintPanel } from '@/components/SheetPrintPanel';
import type { SheetPdfData, SheetClosingItem } from '@/lib/sheetPdf';
import { usePinnedSorting, sortWithPinned } from '@/lib/pinnedSorting';
import { CompactSortHeader, PinManagementModal } from '@/components/CompactSortHeader';
import '@/styles/sheet-register.css';

const ALL_TAB = '__all__';
const BUCKET_KEYS = ['opn', 'inw', 'cls', 'sld'] as const;
const BUCKET_LABELS: Record<(typeof BUCKET_KEYS)[number], string> = {
  opn: 'OPN',
  inw: 'INW',
  cls: 'CLS',
  sld: 'SLD',
};
const ZERO_TOTALS: SheetTotals = { opn: 0, inw: 0, out: 0, sld: 0, cls: 0 };

interface SheetColumnDef {
  key: string;
  title: import('react').ReactNode;
  flat: string;
  /** Short header used for width measurement only. Defaults to `flat`. The
   *  bucket/amount columns sit under a size group header, so their measured
   *  text must be "OPN", not "90 ML OPN" — otherwise every column inherits the
   *  width of a label that is already on screen one row above it. */
  widthText?: string;
  /** Digits this column normally holds — the width baseline (CONVENTIONS §3.2).
   *  Never a pixel value: the grid measures real content on top of this. */
  typicalDigits: number;
  minWidth?: number;
  maxWidth?: number;
  align: 'left' | 'right' | 'center';
  divider?: boolean;
}

interface RegisterViewModel {
  key: string;
  label: string;
  sizesMl: number[];
  gridColumns: GridColumn[];
  nestedHeaders?: NestedHeader[][];
  rows: Record<string, string | number>[];
  rawRows: SheetRow[];
  footer: (string | number)[];
  headers: string[];
  exportRows: (string | number)[][];
  numericFrom: number;
  totalRowCount: number;
  visibleRowCount: number;
  hiddenCount: number;
}

function moneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plainPaise(paise?: number): string {
  if (paise === undefined || paise === null) return '';
  const val = paise / 100;
  return val.toLocaleString('en-IN', {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function cleanRate(s?: string): string {
  if (!s) return '';
  return s.replace(/\.00\b/g, '').replace(/\s*-\s*/g, '–');
}

function brandLabel(row: { brand: string; is_unbranded: boolean }): string {
  return row.is_unbranded ? `${row.brand} (Item)` : row.brand;
}

/**
 * Normalized search haystack for a register row: brand + contributing product
 * names + flavour names + bottle sizes, folded and punctuation-stripped so
 * "Blenders" matches "Blender's Pride", "Sula Shiraz" matches the product
 * under brand "Sula", and "750ml" matches a 750 ML cell. Matching is token
 * AND across words; a token hits when it shares a word with the haystack.
 */
function sheetRowHaystack(row: SheetRow, sizes: number[]): string {
  const parts: string[] = [row.brand, row.name || ''];
  if (row.product_names) parts.push(...row.product_names);
  for (const c of row.children || []) parts.push(c.name || '', c.flavour || '');
  for (const s of sizes) parts.push(`${s}ml`, `${s} ml`);
  return foldTextForSearch(parts.filter(Boolean).join(' '));
}

/** Lowercase, keep only letters/digits/spaces ("Blender's" → "blenders"). */
function foldTextForSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when every whitespace-separated query token shares a word with the
 *  haystack (either side may contain the other). Empty query matches all. */
function haystackMatches(haystack: string, q: string): boolean {
  const words = haystack.split(' ');
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .every((tok) =>
      words.some((w) => (w.includes(tok) || tok.includes(w)) && Math.min(w.length, tok.length) >= 2),
    );
}

function rowIsEmpty(row: SheetAllRow | SheetRow): boolean {
  if ('categories' in row && Array.isArray((row as SheetAllRow).categories)) {
    const a = row as SheetAllRow;
    return !(a.opn || a.inw || a.out || a.sld || a.cls || a.amt_paise);
  }
  const r = row as SheetRow;
  const t = r.row_totals || ZERO_TOTALS;
  return !(t.opn || t.inw || t.out || t.sld || t.cls || t.amt_paise);
}

function fileToken(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sheet';
}

function buildRegisterView(
  reg: SheetRegister,
  search: string,
  category: string,
  brandCategoriesMap: Map<string, string[]>,
  hideEmpty: boolean,
  seesMoney: boolean,
  sizeFilter: string,
  expanded: Record<string, boolean>,
  onToggleBrand?: (brandKey: string) => void,
  sortMode: import('@/lib/pinnedSorting').SortMode = 'most-sold',
  pinnedKeys: string[] = [],
  pinnedSet: Set<string> = new Set(),
  onToggleSort?: () => void,
  onOpenPinModal?: () => void,
  onTogglePin?: (key: string) => void,
  showSortControl = true,
  liveOrder = false,
): RegisterViewModel {
  const q = search.trim().toLowerCase();
  const cat = category.trim().toUpperCase();

  const filteredRows = reg.rows.filter((row) => {
    if (hideEmpty && rowIsEmpty(row)) return false;
    if (cat) {
      const cats = brandCategoriesMap.get(row.brand) || [];
      if (!cats.some((c) => c.toUpperCase() === cat)) return false;
    }
    if (q && !haystackMatches(sheetRowHaystack(row, reg.sizes_ml || []), q)) return false;
    return true;
  });
  const orderedRows = sortWithPinned({
    items: filteredRows,
    keyExtractor: (row) => row.parent_id || row.brand,
    pinnedKeys,
    sortMode: liveOrder ? 'most-sold' : sortMode,
    // Application-wide ordering standard: rolling 4-business-day sold
    // quantity including today (apps.catalog.ordering). Live mode switches the
    // demand window to today only; the tiebreak and pinned rule are identical.
    salesValueExtractor: (row) => (liveOrder ? row.sold_today || 0 : row.sold_4d || 0),
    recencyValueExtractor: (row) => Date.parse(row.order_last_sold_at || '') || 0,
    alphaValueExtractor: (row) => brandLabel(row),
  });

  const cols: SheetColumnDef[] = [];
  const nested: NestedHeader[] = [];

  const brandHeader = showSortControl ? (
    <CompactSortHeader label="Brand / Item" sortMode={sortMode} onToggleSort={() => onToggleSort?.()} pinnedCount={pinnedKeys.length} onOpenPinModal={() => onOpenPinModal?.()} />
  ) : 'Brand / Item';
  cols.push({ key: 'brand', title: brandHeader, flat: 'Brand / Item', typicalDigits: 1, minWidth: LABEL_MIN_WIDTH, maxWidth: 300, align: 'left' });
  nested.push({ title: brandHeader, colspan: 1 });

  // Only the register's configured sizes are columns. A product whose volume
  // is not one of them lives in the row's `unmapped` group and is reachable
  // from that row's items dropdown — it must never widen this matrix.
  const allSizes = [...(reg.sizes_ml || [])].sort((a, b) => a - b);
  const activeSizes =
    sizeFilter !== 'all' && allSizes.includes(Number(sizeFilter)) ? [Number(sizeFilter)] : allSizes;

  if (activeSizes.length) {
    for (const s of activeSizes) {
      nested.push({ title: `${s} ML`, colspan: seesMoney ? 6 : 4 });
      for (const b of BUCKET_KEYS) {
        cols.push({
          key: `${b}_${s}`,
          title: BUCKET_LABELS[b],
          flat: `${s} ML ${BUCKET_LABELS[b]}`,
          widthText: BUCKET_LABELS[b],
          // One bottle size at a time is normally a 1-2 digit piece count.
          typicalDigits: 2,
          align: 'center',
          divider: !seesMoney && b === 'sld',
        });
      }
      if (seesMoney) cols.push({ key: `rate_${s}`, title: 'RATE', flat: `${s} ML RATE`, widthText: 'RATE', typicalDigits: 4, align: 'center' });
      if (seesMoney) cols.push({ key: `amt_${s}`, title: 'AMT', flat: `${s} ML AMT`, widthText: 'AMT', typicalDigits: 4, align: 'center', divider: true });
    }
  } else if (!allSizes.length) {
    nested.push({ title: 'Quantity & Sales', colspan: seesMoney ? 6 : 4 });
    for (const b of BUCKET_KEYS) {
      cols.push({
        key: `${b}_gen`,
        title: BUCKET_LABELS[b],
        flat: BUCKET_LABELS[b],
        // A whole register rolled into one row, so a wider count than a single
        // size cell — this is the row total, not one product.
        typicalDigits: 3,
        align: 'center',
        divider: !seesMoney && b === 'sld',
      });
    }
    if (seesMoney) cols.push({ key: 'rate_gen', title: 'RATE', flat: 'RATE', typicalDigits: 4, align: 'center' });
    if (seesMoney) cols.push({ key: 'amt_gen', title: 'AMT', flat: 'AMT', typicalDigits: 5, align: 'center', divider: true });
  }

  nested.push({ title: 'Total', colspan: seesMoney ? 5 : 4 });
  for (const b of BUCKET_KEYS) {
    cols.push({ key: `tot_${b}`, title: BUCKET_LABELS[b], flat: `Total ${BUCKET_LABELS[b]}`, widthText: BUCKET_LABELS[b], typicalDigits: 3, align: 'center' });
  }
  if (seesMoney) cols.push({ key: 'tot_amt', title: 'AMT', flat: 'Total AMT', widthText: 'AMT', typicalDigits: 6, align: 'center' });

  const buildRow = (r: SheetRow, label: string, isChild = false, childCount = 0) => {
    const obj: Record<string, any> = { brand: label };
    // Row metadata for the expand/collapse click handler and clean rendering
    obj.__parentKey = r.row_id || r.parent_id || r.brand;
    obj.__pinKey = r.parent_id || r.brand;
    obj.__hasChildren = childCount > 0 ? 1 : 0;
    obj.__childCount = childCount;
    obj.__isChild = isChild ? 1 : 0;
    obj.__rawRow = r;
    // Bottle sizes and separate SKUs are not variants. Only explicit flavour
    // rows belong in the flavour section of the expandable items drawer.
    obj.__children = (r.children || []).filter((child) => Boolean(child.flavour));
    // Non-standard units (a size this register has no column for, or a unit
    // with no volume) are not columns either — they are listed here so they
    // stay inspectable and countable.
    obj.__unmapped = Object.entries(r.unmapped || {}).map(([key, cell]) => ({
      key, size_ml: cell.size_ml ?? null, cell,
      name: (r.product_rows || [])
        .find((p) => p.id && cell.product_ids?.includes(p.id))?.name || r.brand,
    }));
    const t = r.row_totals || ZERO_TOTALS;
    obj.__tone = t.cls === 0 ? 'err' : t.cls <= 2 ? 'warn' : 'ok';
    if (activeSizes.length) {
      for (const s of activeSizes) {
        const c = r.cells?.[String(s)];
        for (const b of BUCKET_KEYS) obj[`${b}_${s}`] = c ? c[b] : '';
        if (seesMoney) obj[`rate_${s}`] = cleanRate(c?.rate_display);
        if (seesMoney) obj[`amt_${s}`] = c && c.amt_paise !== undefined ? plainPaise(c.amt_paise) : '';
      }
    } else {
      // A register with no size columns (Others) shows the ROW totals. Reading
      // the first cell only would display one product's buckets while the
      // TOTAL column correctly summed them all.
      for (const b of BUCKET_KEYS) obj[`${b}_gen`] = t[b];
      if (seesMoney) obj.rate_gen = '';
      if (seesMoney) obj.amt_gen = t.amt_paise !== undefined ? plainPaise(t.amt_paise) : '';
    }
    for (const b of BUCKET_KEYS) obj[`tot_${b}`] = t[b];
    if (seesMoney) obj.tot_amt = t.amt_paise !== undefined ? plainPaise(t.amt_paise) : '';
    return obj;
  };

  // Top-level register contains parent brand rows. The items drawer opens when
  // the catalog has explicit flavours and/or the row holds non-standard units;
  // bottle sizes stay as columns in the same row.
  const rows: Record<string, any>[] = [];
  for (const r of orderedRows) {
    const details = (r.children || []).filter((child) => Boolean(child.flavour));
    const flavours = r.has_flavours ? details.length : 0;
    const others = Object.keys(r.unmapped || {}).length;
    rows.push(buildRow(r, brandLabel(r), false, flavours + others));
  }

  const footer: (string | number)[] = ['TOTAL'];
  if (activeSizes.length) {
    for (const s of activeSizes) {
      const t = reg.totals_by_size?.[String(s)] || ZERO_TOTALS;
      for (const b of BUCKET_KEYS) footer.push(t[b]);
      if (seesMoney) footer.push('-');
      if (seesMoney) footer.push(t.amt_paise !== undefined ? plainPaise(t.amt_paise) : '-');
    }
  } else if (!allSizes.length) {
    const t = reg.totals || ZERO_TOTALS;
    for (const b of BUCKET_KEYS) footer.push(t[b]);
    if (seesMoney) footer.push('-');
    if (seesMoney) footer.push(t.amt_paise !== undefined ? plainPaise(t.amt_paise) : '-');
  }
  const tt = reg.totals || ZERO_TOTALS;
  for (const b of BUCKET_KEYS) footer.push(tt[b]);
  if (seesMoney) footer.push(tt.amt_paise !== undefined ? plainPaise(tt.amt_paise) : '-');

  const gridColumns: GridColumn[] = cols.map((c) => ({
    key: c.key,
    title: c.title,
    headerText: c.widthText || c.flat,
    typicalDigits: Math.max(1, c.typicalDigits),
    minWidth: c.minWidth,
    maxWidth: c.maxWidth,
    align: c.align,
    divider: c.divider,
    ...(c.key.startsWith('rate_') ? {
      render: (value: unknown, row: any) => {
        if (c.key === 'rate_gen') {
          return <span title="This register has no bottle-size columns, so no single rate applies. Open items to see each product's rate.">{String(value ?? '')}</span>;
        }
        const cellKey = c.key.slice(5);
        const cell = row.__rawRow.cells?.[cellKey] as SheetCell | undefined;
        const count = cell?.product_count || 0;
        const flavours = cell?.flavour_count || 0;
        const note = (flavours ?? 0) >= 2
          ? `${flavours} flavours share this size, so the range is their rate spread.`
          : count > 1
            ? `${count} separate products share this size and are not variants. Showing the top-selling product's rate — open items to see each rate.`
            : 'Rate from billed sales, or catalogue when there were no sales.';
        return <span title={note}>{String(value ?? '')}</span>;
      },
    } : {}),
    ...(c.key === 'brand'
      ? {
          render: (_v: unknown, row: any) => {
            if (row.__isChild) {
              return <span className="rg-indent">{String(row.brand)}</span>;
            }
            const hasChildren = Boolean(row.__hasChildren);
            const parentKey = String(row.__parentKey || row.brand);
            const open = hasChildren && Boolean(expanded[parentKey]);
            const childCount = Number(row.__childCount || 0);

            return (
              <div className="rg-brandline">
                <button
                  type="button"
                  className={`rg-row-pin-btn ${pinnedSet.has(String(row.__pinKey)) ? 'pinned' : ''}`}
                  aria-label={pinnedSet.has(String(row.__pinKey)) ? 'Unpin brand' : 'Pin brand to top'}
                  title={pinnedSet.has(String(row.__pinKey)) ? 'Unpin brand' : 'Pin brand to top'}
                  onClick={(e) => { e.stopPropagation(); onTogglePin?.(String(row.__pinKey)); }}
                >
                  {pinnedSet.has(String(row.__pinKey)) ? <IconPinFilled size={13} /> : <IconPin size={13} />}
                </button>
                {row.__tone && <span aria-hidden="true" className={`rg-dot ${row.__tone}`} />}
                <div className="rg-brandinfo">
                  <span className="rg-brandcode">{String(row.brand)}</span>
                  {row.__rawRow?.name && row.__rawRow.name !== row.brand && (
                    <span className="rg-brandsub" title={row.__rawRow.name}>{row.__rawRow.name}</span>
                  )}
                </div>
                {hasChildren && (
                  <button
                    type="button"
                    className="rg-chip rg-chip--variant"
                    aria-expanded={open}
                    aria-label={`${open ? 'Hide' : 'Show'} ${childCount} items for ${row.brand}`}
                    title={`${childCount} items — flavours and other units`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleBrand?.(parentKey);
                    }}
                  >
                    <span className="rg-chip__count">{childCount}</span>
                    <span className="rg-chip__caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
                  </button>
                )}
              </div>
            );
          },
        }
      : {}),
  }));
  const headers = cols.map((c) => c.flat);
  const exportRows = rows.map((r) => cols.map((c) => r[c.key] ?? ''));

  return {
    key: reg.key,
    label: reg.label,
    sizesMl: activeSizes,
    gridColumns,
    nestedHeaders: nested.length ? [nested] : undefined,
    rows,
    rawRows: orderedRows,
    footer,
    headers,
    exportRows,
    numericFrom: cols.findIndex((c) => c.align === 'right'),
    totalRowCount: reg.rows.length,
    visibleRowCount: filteredRows.length,
    hiddenCount: reg.rows.length - filteredRows.length,
  };
}

/** Non-standard-unit rows: a size this register has no column for, or a unit
 *  with no volume. Listed so their stock stays inspectable and countable. */
function renderSheetUnmappedTable(unmapped: any[], seesMoney: boolean) {
  if (!unmapped.length) return null;
  return (
    <div className="rg-drawer-wrapper">
      <div className="rg-drawer-header">
        <div className="rg-drawer-header-left">
          <span className="rg-drawer-title">OTHER UNITS</span>
          <span className="rg-drawer-note">
            Not one of this register&rsquo;s bottle-size columns. Still counted in the row total.
          </span>
        </div>
        <div className="rg-drawer-header-right">
          <span>{unmapped.length} items</span>
        </div>
      </div>
      <div className="rg-drawer-table-wrap">
        <table className="rg-subtable">
          <thead>
            <tr>
              <th style={{ width: 240, minWidth: 180, textAlign: 'left' }}>PRODUCT</th>
              <th className="num" style={{ width: 90, minWidth: 80 }}>SIZE</th>
              <th className="num">OPN</th>
              <th className="num">INW</th>
              <th className="num">CLS</th>
              <th className="num">SLD</th>
              {seesMoney && <th className="num">RATE</th>}
              {seesMoney && <th className="num">AMT</th>}
            </tr>
          </thead>
          <tbody>
            {unmapped.map((item, idx) => {
              const c = item.cell as SheetCell;
              return (
                <tr key={item.key || idx}>
                  <td style={{ width: 240, minWidth: 180 }}>
                    <span className="rg-variant-title">{item.name}</span>
                  </td>
                  <td className="num">{item.size_ml ? `${item.size_ml} ML` : '—'}</td>
                  <td className="num">{c.opn}</td>
                  <td className="num">{c.inw}</td>
                  <td className="num">{c.cls}</td>
                  <td className="num"><strong>{c.sld}</strong></td>
                  {seesMoney && <td className="num">{cleanRate(c.rate_display) || '—'}</td>}
                  {seesMoney && (
                    <td className="num">{c.amt_paise !== undefined ? plainPaise(c.amt_paise) : '—'}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderSheetVariantDrawer(row: any, activeSizes: number[], seesMoney: boolean) {
  const children: SheetRow[] = row.__children || [];
  const unmapped: any[] = row.__unmapped || [];
  if (!children.length && !unmapped.length) return null;

  // Filter activeSizes to ONLY sizes that exist in at least one variant child of this brand
  const relevantSizes = activeSizes.filter((s) =>
    children.some((c) => c.cells && c.cells[String(s)] !== undefined)
  );
  const drawerSizes = relevantSizes.length > 0 ? relevantSizes : activeSizes;

  const flavoursBlock = children.length ? (
    <div className="rg-drawer-wrapper">
      <div className="rg-drawer-header">
        <div className="rg-drawer-header-left">
          <span className="rg-drawer-title">FLAVOURS — {row.brand}</span>
          <span className="rg-drawer-note">Each row is a flavour. Bottle sizes are shown as columns.</span>
        </div>
        <div className="rg-drawer-header-right">
          <span>{children.length} flavours</span>
        </div>
      </div>
      <div className="rg-drawer-table-wrap">
        <table className="rg-subtable">
          <thead>
            <tr>
              <th style={{ width: 180, minWidth: 160, textAlign: 'left' }}>VARIANT / FLAVOUR</th>
              {drawerSizes.map((s) => (
                <th key={s} colSpan={seesMoney ? 6 : 4} className="rg-center">
                  {s} ML
                </th>
              ))}
              <th colSpan={seesMoney ? 5 : 4} className="rg-center">
                TOTAL
              </th>
            </tr>
            <tr>
              <th></th>
              {drawerSizes.map((s) => (
                <Fragment key={s}>
                  <th className="num" style={{ width: 48, minWidth: 44 }}>OPN</th>
                  <th className="num" style={{ width: 48, minWidth: 44 }}>INW</th>
                  <th className="num" style={{ width: 48, minWidth: 44 }}>CLS</th>
                  <th className="num" style={{ width: 48, minWidth: 44 }}>SLD</th>
                  {seesMoney && <th className="num" style={{ width: 72, minWidth: 68 }}>RATE</th>}
                  {seesMoney && <th className="num" style={{ width: 84, minWidth: 76 }}>AMT</th>}
                </Fragment>
              ))}
              <th className="num" style={{ width: 52, minWidth: 46 }}>OPN</th>
              <th className="num" style={{ width: 52, minWidth: 46 }}>INW</th>
              <th className="num" style={{ width: 52, minWidth: 46 }}>CLS</th>
              <th className="num" style={{ width: 52, minWidth: 46 }}>SLD</th>
              {seesMoney && <th className="num" style={{ width: 96, minWidth: 84 }}>AMT</th>}
            </tr>
          </thead>
          <tbody>
            {children.map((c, idx) => {
              const t = c.row_totals || ZERO_TOTALS;
              return (
                <tr key={c.id || c.flavour || c.name || idx}>
                  <td style={{ width: 180, minWidth: 160 }}>
                    <span className="rg-variant-title">{c.name || c.flavour || c.brand}{c.code ? ` (${c.code})` : ''}</span>
                  </td>
                  {drawerSizes.map((s) => {
                    const cell = c.cells?.[String(s)];
                    return (
                      <Fragment key={s}>
                        <td className="num">{cell ? cell.opn : '—'}</td>
                        <td className="num">{cell ? cell.inw : '—'}</td>
                        <td className="num">{cell ? cell.cls : '—'}</td>
                        <td className="num"><strong>{cell ? cell.sld : '—'}</strong></td>
                        {seesMoney && (
                          <td className="num" title={cell?.rate_display}>
                            {cell?.rate_display ? cleanRate(cell.rate_display) : '—'}
                          </td>
                        )}
                        {seesMoney && (
                          <td className="num">
                            {cell && cell.amt_paise !== undefined ? plainPaise(cell.amt_paise) : '—'}
                          </td>
                        )}
                      </Fragment>
                    );
                  })}
                  <td className="num">{t.opn || '—'}</td>
                  <td className="num">{t.inw || '—'}</td>
                  <td className="num">{t.cls || '—'}</td>
                  <td className="num"><strong>{t.sld || '—'}</strong></td>
                  {seesMoney && (
                    <td className="num">
                      <strong>{t.amt_paise !== undefined ? plainPaise(t.amt_paise) : '—'}</strong>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  ) : null;

  return (
    <>
      {flavoursBlock}
      {renderSheetUnmappedTable(unmapped, seesMoney)}
    </>
  );
}

export default function SheetPage() {
  const { wsUid, seesMoney, seesValuation, activeShop } = useAuth();
  const shopId = wsUid;
  const toast = useToast();
  const navigate = useNavigate();

  const todayBiz = useCurrentBusinessDate(activeShop?.lockInTime);
  const [dateState, setDateState, effRange] = useDateRange('today', todayBiz);

  const range = useMemo(() => {
    if (effRange.from && effRange.to) return { from: effRange.from, to: effRange.to };
    return { from: dayKeyShift(todayBiz, -91), to: todayBiz };
  }, [effRange, todayBiz]);
  const rangeLabel = range.from === range.to ? ddisplay(range.from) : `${ddisplay(range.from)} – ${ddisplay(range.to)}`;

  const shiftRange = useCallback(
    (delta: number) => {
      setDateState({
        mode: 'custom',
        from: dayKeyShift(range.from, delta),
        to: dayKeyShift(range.to, delta),
      });
    },
    [range.from, range.to, setDateState],
  );

  const [data, setData] = useState<SheetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [sizeFilter, setSizeFilter] = useState<string>('all');
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({});
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [liveMotion, setLiveMotion] = useState(() => { try { return localStorage.getItem('xpo_sheet_live_motion') === 'true'; } catch { return false; } });
  const liveToday = range.from === todayBiz && range.to === todayBiz;
  /** Live ordering only means anything for the day that is actually selling. */
  const liveOrder = liveMotion && liveToday;
  /**
   * Per-row sold increase since the previous poll, consumed by the grid as a
   * "+N" ticker. A ref, not state: it is written during the poll and read by
   * the grid on the next render, and it must NOT itself trigger a render.
   */
  const saleTicks = useRef<Record<string, number>>({});
  const [tickVersion, setTickVersion] = useState(0);
  const previousSoldRef = useRef<Record<string, number> | null>(null);
  useEffect(() => { try { localStorage.setItem('xpo_sheet_live_motion', String(liveMotion)); } catch { /* optional preference */ } }, [liveMotion]);
  const { sortMode, toggleSortMode, pinnedKeys, pinnedSet, pinItem, unpinItem, movePinnedItem, togglePin } =
    usePinnedSorting('sheet_brands', 'most-sold');
  const toggleBrand = useCallback((brandKey: string) => {
    setExpandedBrands((prev) => ({ ...prev, [brandKey]: !prev[brandKey] }));
  }, []);

  const [physicalCash, setPhysicalCash] = useState<string>('');

  useEffect(() => {
    if (data?.cash?.closing_cash_paise != null) {
      setPhysicalCash(String(data.cash.closing_cash_paise / 100));
    } else {
      setPhysicalCash('');
    }
  }, [data?.cash?.closing_cash_paise, data?.meta?.date]);

  const handleGridCell = useCallback((colKey: string, row: Record<string, unknown>) => {
    if (colKey !== 'brand') return;
    if (!row || !row.__hasChildren) return;
    const key = String(row.__parentKey);
    setExpandedBrands((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [showDiscrepanciesDrawer, setShowDiscrepanciesDrawer] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 672);
  const [calOpen, setCalOpen] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!calOpen) return;
    const onDown = (e: MouseEvent) => {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        setCalOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [calOpen]);

  const requestRef = useRef(0);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 672);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    const reqId = ++requestRef.current;
    let alive = true;
    setLoading(prev => data ? prev : true);
    setError(null);
    const query = range.from === range.to ? range.from : { from: range.from, to: range.to };
    getSheet(shopId, query)
      .then((res) => {
        if (!alive || reqId !== requestRef.current) return;
        // Snapshot the per-row sold quantities BEFORE replacing the data, so
        // the delta is against the previous poll rather than against nothing.
        const previousSold = previousSoldRef.current;
        if (previousSold) {
          const next: Record<string, number> = {};
          for (const reg of res.registers || []) {
            for (const row of reg.rows || []) {
              const key = String(row.row_id || row.parent_id || row.brand);
              const sold = row.row_totals?.sld || 0;
              const before = previousSold[key];
              if (before !== undefined && sold > before) next[key] = sold - before;
            }
          }
          if (Object.keys(next).length) {
            saleTicks.current = next;
            setTickVersion(v => v + 1);
          } else {
            saleTicks.current = {};
          }
        }
        const soldMap: Record<string, number> = {};
        for (const reg of res.registers || []) {
          for (const row of reg.rows || []) {
            soldMap[String(row.row_id || row.parent_id || row.brand)] = row.row_totals?.sld || 0;
          }
        }
        previousSoldRef.current = soldMap;
        setData(res);
      })
      .catch((err: unknown) => {
        if (alive && reqId === requestRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load the sheet register.');
        }
      })
      .finally(() => {
        if (alive && reqId === requestRef.current) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [shopId, range.from, range.to, reloadTick]);

  // A different shop or date is a different register: stale deltas and stale
  // ticker values would fire on the first poll of the new selection.
  useEffect(() => {
    previousSoldRef.current = null;
    saleTicks.current = {};
  }, [shopId, range.from, range.to]);

  useEffect(() => {
    if (!liveMotion || !liveToday || loading) return;
    const timer = window.setTimeout(() => { if (!document.hidden) setReloadTick(t => t + 1); }, 5000);
    const onVisible = () => { if (!document.hidden) setReloadTick(t => t + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [liveMotion, liveToday, loading, data, reloadTick]);

  const retry = useCallback(() => setReloadTick((t) => t + 1), []);

  const registers = useMemo(() => data?.registers || [], [data]);
  const isAll = activeTab === ALL_TAB;
  const allRegister = data?.all_register;

  useEffect(() => {
    if (data && activeTab !== ALL_TAB && !registers.some((r) => r.key === activeTab)) {
      setActiveTab(ALL_TAB);
    }
  }, [data, activeTab, registers]);

  const tabs = useMemo(
    () => [{ key: ALL_TAB, label: 'All' }, ...registers.map((r) => ({ key: r.key, label: r.label }))],
    [registers],
  );

  const brandCategoriesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of allRegister?.rows || []) {
      if (row.brand && row.categories) {
        map.set(row.brand, row.categories);
      }
    }
    return map;
  }, [allRegister]);

  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    if (isAll) {
      for (const row of allRegister?.rows || []) {
        for (const c of row.categories || []) {
          const k = c.toUpperCase();
          if (!seen.has(k)) seen.set(k, c);
        }
      }
    } else {
      const activeReg = registers.find((r) => r.key === activeTab);
      for (const row of activeReg?.rows || []) {
        const cats = brandCategoriesMap.get(row.brand) || [];
        for (const c of cats) {
          const k = c.toUpperCase();
          if (!seen.has(k)) seen.set(k, c);
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [allRegister, registers, activeTab, isAll, brandCategoriesMap]);

  // Automatically reset category when switching tabs if it doesn't exist in the active register
  useEffect(() => {
    if (category && categoryOptions.length > 0) {
      const match = categoryOptions.some((c) => c.toUpperCase() === category.toUpperCase());
      if (!match) setCategory('');
    }
  }, [activeTab, categoryOptions, category]);

  // Build views for all registers
  const registerViews = useMemo(() => {
    return registers.map((reg, index) =>
      buildRegisterView(
        reg, search, category, brandCategoriesMap, hideEmpty, seesMoney, sizeFilter, expandedBrands, toggleBrand,
        sortMode, pinnedKeys, pinnedSet, toggleSortMode, () => setPinModalOpen(true), togglePin, !isAll || index === 0, liveOrder,
      ),
    );
  }, [registers, search, category, brandCategoriesMap, hideEmpty, seesMoney, sizeFilter, expandedBrands, toggleBrand, sortMode, pinnedKeys, pinnedSet, toggleSortMode, togglePin, isAll, liveOrder]);

  const pinnedItems = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; sold: number }>();
    for (const reg of registers) for (const row of reg.rows) {
      const key = row.parent_id || row.brand;
      const current = seen.get(key);
      // Same signal the ordering uses, so the pin manager never contradicts
      // the order on screen.
      const sold = row.sold_4d || 0;
      if (!current) seen.set(key, { key, label: brandLabel(row), sold });
      else current.sold += sold;
    }
    return [...seen.values()].map((item) => ({ key: item.key, label: item.label, soldText: `${item.sold} sold / 4 days` }));
  }, [registers]);

  const currentRegisterView = useMemo(() => {
    if (isAll) return undefined;
    return registerViews.find((v) => v.key === activeTab);
  }, [isAll, registerViews, activeTab]);

  const totalRawCount = useMemo(() => {
    if (isAll) return registerViews.reduce((acc, v) => acc + v.totalRowCount, 0);
    return currentRegisterView?.totalRowCount || 0;
  }, [isAll, registerViews, currentRegisterView]);

  const totalVisibleCount = useMemo(() => {
    if (isAll) return registerViews.reduce((acc, v) => acc + v.visibleRowCount, 0);
    return currentRegisterView?.visibleRowCount || 0;
  }, [isAll, registerViews, currentRegisterView]);

  const totalHiddenCount = totalRawCount - totalVisibleCount;

  const sizeOptions = useMemo(() => {
    if (!isAll && currentRegisterView) return currentRegisterView.sizesMl;
    const set = new Set<number>();
    for (const r of registers) for (const s of r.sizes_ml) set.add(s);
    return [...set].sort((a, b) => a - b);
  }, [isAll, currentRegisterView, registers]);

  // Automatically reset sizeFilter when switching tabs if not available
  useEffect(() => {
    if (sizeFilter !== 'all') {
      const num = Number(sizeFilter);
      if (!sizeOptions.includes(num)) setSizeFilter('all');
    }
  }, [activeTab, sizeOptions, sizeFilter]);

  const summary = useMemo(() => {
    const audit = data?.audit;
    const multiDay = range.from !== range.to;
    const title = multiDay
      ? `Range summary (${ddisplay(range.from)} – ${ddisplay(range.to)})`
      : 'Day summary';
    if (!audit) return { title, rows: null as SheetPrintSummaryRow[] | null };
    const rows: SheetPrintSummaryRow[] = [
      {
        item: 'Total Billed Turnover',
        amount: moneyPaise(audit.turnover_paise),
        note: 'Sum of the AMT column for the whole selection (net of returns and voids).',
      },
      {
        item: 'Rate-Card Margin',
        amount: moneyPaise(audit.rate_card_margin_paise),
        note: "Units sold (Σ SLD) multiplied by each bottle size's rate-card margin.",
      },
      {
        item: 'Expenses',
        amount: moneyPaise(audit.expenses_paise),
        note: 'Total expenses recorded in Cash Flow for the period.',
      },
    ];
    for (const line of audit.expense_lines || []) {
      rows.push({
        item: line.label,
        amount: moneyPaise(line.amount_paise),
        note: 'Expense voucher head recorded in Cash Flow.',
        depth: 1,
      });
    }
    rows.push({
      item: 'Rate-Card Net Profit',
      amount: moneyPaise(audit.rate_card_net_paise),
      note: 'Rate-Card Margin minus total expenses.',
    });
    if (seesValuation && audit.cost_based_gross_profit_paise !== undefined) {
      rows.push({
        item: 'Cost-Based Gross Profit',
        amount: moneyPaise(audit.cost_based_gross_profit_paise),
        note: 'Cost-based gross profit from the Dashboard (sale value minus cost of goods).',
      });
    }
    if (seesValuation && audit.cost_based_net_profit_paise !== undefined) {
      rows.push({
        item: 'Cost-Based Net Profit',
        amount: moneyPaise(audit.cost_based_net_profit_paise),
        note: 'Cost-based gross profit minus total expenses.',
      });
    }
    return { title, rows };
  }, [data, range.from, range.to, seesValuation]);

  const freeze = useMemo(() => {
    const meta = data?.meta;
    if (!meta) return null;
    const total = meta.days_total ?? 1;
    const sealed = meta.days_sealed ?? (meta.sealed ? 1 : 0);
    if (meta.all_sealed ?? (meta.sealed && total === 1)) return { label: 'Frozen', tone: 'gray' as const };
    if (sealed > 0 && sealed < total) {
      return { label: `Partially frozen (${sealed} of ${total})`, tone: 'warn' as const };
    }
    return { label: 'Live', tone: 'ok' as const };
  }, [data]);

  const printData = useMemo<SheetPdfData | null>(() => {
    if (!data) return null;
    const sections: SheetPrintSection[] = registerViews.map(v => ({
      tabLabel: v.label, headers: v.headers, rows: v.exportRows,
      totals: v.footer, numericFrom: v.numericFrom, hiddenCount: v.hiddenCount,
    }));
    /**
     * Closing-count rows for the print.
     *
     * Built from `registerViews[i].rawRows`, which is the register's rows AFTER
     * the application-wide ordering standard (pinned brands in their exact manual
     * order, then the rolling four-business-day demand ranking). It used to walk
     * the raw `registers` payload, whose brand order is the backend's alphabetical
     * sort - so the closing stock printout came out alphabetically even when the
     * shop had pinned three brands to the top of the screen. The paper and the
     * screen disagreed, and a counter working off the printout walked the wrong
     * brands first.
     */
    const closingItems: SheetClosingItem[] = [];
    for (const view of registerViews) {
      for (const row of view.rawRows) {
        for (const product of row.product_rows || [row]) {
          for (const [size, cell] of Object.entries(product.cells || {})) {
            closingItems.push({
              id: `${view.key}:${product.id || row.row_id || row.brand}:${size}`,
              section: view.label,
              brand: brandLabel(row),
              name: product.name || row.brand,
              size: cell.size_ml ? `${cell.size_ml}ml` : size,
              closing: cell.cls,
            });
          }
        }
      }
    }
    return { title: 'Daily Sheet', period: rangeLabel, sections, summary: summary.rows || [], closingItems };
  }, [data, registerViews, rangeLabel, summary]);

  const handleExport = useCallback(async () => {
    if (!data) return;
    const filename = `sheet-${isAll ? 'all' : fileToken(currentRegisterView?.label || 'register')}-${range.from}_${range.to}`;

    if (isAll) {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        for (const regView of registerViews) {
          if (regView.exportRows.length === 0 && regView.totalRowCount === 0) continue;
          const aoa: (string | number)[][] = [regView.headers, ...regView.exportRows, regView.footer];
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          ws['!cols'] = regView.headers.map((_h, i) => ({ wch: i === 0 ? 24 : 14 }));
          XLSX.utils.book_append_sheet(wb, ws, regView.label.slice(0, 31) || 'Register');
        }
        if (summary.rows && summary.rows.length) {
          const sumAoa: (string | number)[][] = [
            [summary.title],
            ['Item', 'Amount', 'How this is calculated'],
            ...summary.rows.map((r) => [`${r.depth ? '    ' : ''}${r.item}`, r.amount, r.note]),
          ];
          const sumWs = XLSX.utils.aoa_to_sheet(sumAoa);
          sumWs['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 60 }];
          XLSX.utils.book_append_sheet(wb, sumWs, 'Day Summary');
        }
        XLSX.writeFile(wb, `${filename}.xlsx`);
        toast('Excel export downloaded.', 'ok');
      } catch {
        const csvRows: Record<string, unknown>[] = [];
        for (const regView of registerViews) {
          csvRows.push({ Brand: `--- ${regView.label.toUpperCase()} REGISTER ---` });
          regView.exportRows.forEach((r) => {
            const o: Record<string, unknown> = {};
            regView.headers.forEach((h, i) => {
              o[h] = r[i];
            });
            csvRows.push(o);
          });
          const tot: Record<string, unknown> = {};
          regView.headers.forEach((h, i) => {
            tot[h] = regView.footer[i];
          });
          csvRows.push(tot);
          csvRows.push({});
        }
        downloadCsv(`${filename}.csv`, csvRows);
        toast('Excel export unavailable — downloaded a CSV instead.', 'warn');
      }
    } else {
      const cur = currentRegisterView;
      if (!cur) return;
      const aoa: (string | number)[][] = [cur.headers, ...cur.exportRows, cur.footer];
      try {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = cur.headers.map((_h, i) => ({ wch: i === 0 ? 24 : 14 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, cur.label.slice(0, 31) || 'Sheet');
        XLSX.writeFile(wb, `${filename}.xlsx`);
        toast('Excel export downloaded.', 'ok');
      } catch {
        const rowsForCsv = cur.exportRows.map((r) => {
          const o: Record<string, unknown> = {};
          cur.headers.forEach((h, i) => {
            o[h] = r[i];
          });
          return o;
        });
        const totalObj: Record<string, unknown> = {};
        cur.headers.forEach((h, i) => {
          totalObj[h] = cur.footer[i];
        });
        downloadCsv(`${filename}.csv`, [...rowsForCsv, totalObj]);
        toast('Excel export unavailable — downloaded a CSV instead.', 'warn');
      }
    }
  }, [data, isAll, registerViews, currentRegisterView, summary, range.from, range.to, toast]);

  const recon = data?.reconciliation;
  const isBlocked = recon?.status === 'Blocked';
  const isDiscrepant = recon?.status === 'Discrepancy';
  const isSealed = Boolean(data?.meta?.sealed || data?.cash?.is_closed);
  const unbrandedCount = data?.diagnostics?.products_without_brand_count ?? 0;

  const liveVariance = useMemo(() => {
    if (!data?.cash) return null;
    if (isSealed) return data.cash.variance_paise;
    if (physicalCash.trim() === '') return data.cash.variance_paise;
    const countedPaise = Math.round(Number(physicalCash) * 100);
    if (isNaN(countedPaise)) return null;
    return countedPaise - data.cash.expected_cash_paise;
  }, [data?.cash, isSealed, physicalCash]);

  return (
    <div className="sheet-page">
      {/* Status strip. The page begins with the register itself: no title, no
          one-line description. The freeze / sealed / reconciliation state is
          operational information and stays, because a cashier must be able to
          tell a live day from a sealed one at a glance. */}
      <div className="sr-status-strip">
        {freeze && <Tag tone={freeze.tone}>{freeze.label}</Tag>}
        {data?.meta?.sealed && (
          <Tag tone="gray" title="Day is sealed and locked">
            SEALED
          </Tag>
        )}
        {data?.meta?.reconstructed && (
          <Tag tone="warn" title="Computed live from stock movements">
            RECONSTRUCTED
          </Tag>
        )}
        {recon && (
          <>
            {recon.status === 'Reconciled' && (
              <Tag tone="ok" title="All checks passed">
                <IconCheckCircle size={12} style={{ marginRight: 4 }} />
                Reconciled
              </Tag>
            )}
            {isDiscrepant && (
              <button
                type="button"
                onClick={() => setShowDiscrepanciesDrawer(true)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <Tag tone="warn" title="Click to view discrepancies">
                  Discrepancy ({recon.discrepancies.length})
                </Tag>
              </button>
            )}
            {isBlocked && (
              <Tag tone="err" title={recon.blocked_reason || 'Reconciliation blocked'}>
                Blocked
              </Tag>
            )}
          </>
        )}
      </div>

      {/* 2. Register tabs + unified controls — single consolidated, high-efficiency toolbar.
          Left: Register tabs + visible count.
          Center: Compact search (180px), size filter, category filter, hide-empty toggle.
          Right: Unified Date Stepper, Refresh, Print, Excel Export. */}
      <div className="sr-toolbar sr-toolbar--single">
        <div className="sr-toolbar-line">
          {/* Left: Registers + Counts */}
          <div className="sr-toolbar-left">
            <div className="seg" role="tablist" aria-label="Registers">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  className={`seg-btn ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <span className="sr-count">
              <strong>{totalVisibleCount}</strong> of {totalRawCount}
            </span>
          </div>

          {/* Center: Search & Filters */}
          <div className="sr-toolbar-center">
            <div className="sr-search" style={{ width: 180, minWidth: 150, flexShrink: 0 }}>
              <IconSearch size={13} className="sr-search-ico" />
              <input
                className="field-control"
                placeholder="Search brand…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search !== '' && (
                <button
                  type="button"
                  className="sr-search-clear"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {sizeOptions.length > 0 && (
              <select
                className="field-control"
                style={{ width: 104, flexShrink: 0 }}
                value={sizeFilter}
                onChange={(e) => setSizeFilter(e.target.value)}
                aria-label="Filter by bottle size"
              >
                <option value="all">All sizes</option>
                {sizeOptions.map((s) => (
                  <option key={s} value={String(s)}>
                    {s} ML
                  </option>
                ))}
              </select>
            )}

            {categoryOptions.length > 0 && (
              <select
                className="field-control"
                style={{ width: 130, flexShrink: 0 }}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              className={`sr-hide-btn ${hideEmpty ? 'active' : ''}`}
              onClick={() => setHideEmpty((v) => !v)}
              aria-pressed={hideEmpty}
              title="Toggle empty row visibility"
            >
              {hideEmpty ? 'Empty hidden' : 'Hide empty'}
            </button>
          </div>

          {/* Right: Unified Date Stepper & Actions */}
          <div className="sr-toolbar-right">
            <div className="sr-dategroup" ref={calRef}>
              <button
                type="button"
                className={`sr-date-btn ${dateState.mode === 'today' ? 'active' : ''}`}
                onClick={() => {
                  setDateState({ mode: 'today', from: null, to: null });
                  setCalOpen(false);
                }}
                title="Reset to today"
                aria-label="Reset to today"
              >
                Today
              </button>
              <button
                type="button"
                className="sr-date-btn sr-date-step"
                onClick={() => shiftRange(-1)}
                aria-label="Previous day"
                title="Previous day"
              >
                ‹
              </button>
              <button
                type="button"
                className="sr-date-btn sr-date-label-btn"
                onClick={() => setCalOpen((o) => !o)}
                aria-label="Select date range"
                title="Click to select single date, range or preset"
              >
                <IconCal size={14} style={{ color: 'var(--blue, #0f62fe)' }} />
                <span>{dateState.mode === 'all' ? 'All Time' : rangeLabel}</span>
              </button>
              <button
                type="button"
                className="sr-date-btn sr-date-step"
                onClick={() => shiftRange(1)}
                aria-label="Next day"
                title="Next day"
              >
                ›
              </button>
              <button
                type="button"
                className={`sr-date-btn ${dateState.mode === 'all' ? 'active' : ''}`}
                onClick={() => {
                  setDateState({ mode: 'all', from: null, to: null });
                  setCalOpen(false);
                }}
                title="All time register"
                aria-label="All time register"
              >
                All
              </button>

              {calOpen && (
                <div className="sr-date-popover">
                  <MiniCalendar
                    from={dateState.from}
                    to={dateState.to}
                    todayKey={todayBiz}
                    onClose={() => setCalOpen(false)}
                    onClear={() => {
                      setDateState({ mode: 'all', from: null, to: null });
                      setCalOpen(false);
                    }}
                    onPreset={(r) => {
                      setDateState({ mode: 'custom', from: r.from, to: r.to });
                      setCalOpen(false);
                    }}
                    onPick={(k) => {
                      setDateState((cur) => {
                        if (!cur || !cur.from || (cur.from && cur.to && cur.from !== cur.to) || cur.from === k) {
                          return { mode: 'custom', from: k, to: k };
                        }
                        return k < cur.from
                          ? { mode: 'custom', from: k, to: cur.from }
                          : { mode: 'custom', from: cur.from, to: k };
                      });
                    }}
                  />
                </div>
              )}
            </div>

            <Btn
              variant="ghost"
              className="btn-icon"
              onClick={retry}
              title="Refresh"
              aria-label="Refresh register"
              style={{ width: 32, height: 32, padding: 0 }}
            >
              <IconRefresh size={14} />
            </Btn>
            {loading && data && <span className="sr-refreshing">Refreshing…</span>}

            {/* Live ordering: a compact icon toggle, never a text label. The
                toolbar row is dense and "Live Motion On" pushed the print and
                export controls off screen. State is still in the title/tooltip
                and the pressed colour, so nothing is hidden from a screen
                reader or a hover. */}
            <button
              type="button"
              className={`sr-icon-toggle${liveMotion ? ' active' : ''}`}
              aria-pressed={liveMotion}
              onClick={() => setLiveMotion(v => !v)}
              title={liveMotion
                ? 'Live ordering is on — rows re-order as the day sells. Click to switch to the default 4-day order.'
                : 'Live ordering is off — rows follow the default 4-day sold order. Click to follow today\'s sales live.'}
              aria-label="Live ordering"
            >
              <IconZap size={14} />
            </button>

            <Btn
              variant="ghost"
              className="btn-icon"
              onClick={() => setPrintOpen(true)}
              style={{ width: 32, height: 32, padding: 0 }}
              aria-label="Print sheet"
              title="Print sheet"
              data-tooltip="Print sheet"
            >
              <IconPrinter size={14} />
            </Btn>
            <Btn
              variant="ghost"
              className="btn-icon"
              onClick={() => void handleExport()}
              style={{ width: 32, height: 32, padding: 0 }}
              aria-label="Export to Excel"
              title="Export to Excel"
              data-tooltip="Export to Excel"
            >
              <IconDownload size={14} />
            </Btn>
          </div>
        </div>
      </div>

      {totalHiddenCount > 0 && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            background: 'var(--layer)',
            border: '1px solid var(--line)',
            fontSize: 12,
            color: 'var(--subtle)',
          }}
        >
          Filters active: {totalHiddenCount} row{totalHiddenCount === 1 ? '' : 's'} hidden from the table and export. The totals row is
          the server total for the whole selection and still includes hidden rows.
        </div>
      )}

      {isBlocked && (
        <div role="alert" className="sr-banner sr-banner--err">
          <span className="sr-banner-body">
            <strong>Reconciliation Blocked:</strong> {recon?.blocked_reason || 'Invariants failed.'} Numbers are
            withheld until the unclassified movement or invariant violation is corrected.
          </span>
        </div>
      )}

      {!isBlocked && unbrandedCount > 0 && (
        <div className="sr-banner sr-banner--warn">
          <div className="sr-banner-body">
            <strong>Notice:</strong> {unbrandedCount} products have no Brand assigned and appear as individual rows.
          </div>
          <Btn
            variant="ghost"
            onClick={() => navigate('/products')}
            style={{ fontSize: 11, height: 26, padding: '0 8px', flexShrink: 0 }}
          >
            Assign Brands <IconArrowRight size={12} style={{ marginLeft: 4 }} />
          </Btn>
        </div>
      )}

      {error && data && (
        <div role="alert" className="sr-banner sr-banner--warn">
          <IconAlertTriangle size={14} style={{ color: 'var(--warn-fg)', flexShrink: 0 }} />
          <span className="sr-banner-body">
            Could not refresh this selection — showing the last loaded data. {error}
          </span>
          <Btn variant="ghost" onClick={retry} style={{ height: 26, fontSize: 11, flexShrink: 0 }}>
            Retry
          </Btn>
        </div>
      )}

      {loading && !data ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : !data && error ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <IconAlertTriangle size={22} style={{ color: 'var(--warn-fg)' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', margin: '8px 0 4px' }}>
            Could not load the sheet register
          </div>
          <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 12 }}>{error}</div>
          <Btn variant="primary" onClick={retry}>
            <IconRefresh size={14} style={{ marginRight: 6 }} />
            Retry
          </Btn>
        </div>
      ) : isBlocked ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--subtle)', fontSize: 14 }}>
          No data displayed while Sheet is blocked.
        </div>
      ) : registers.length === 0 ? (
        <EmptyState title="No register data" hint="This response did not include registers for the selected period." />
      ) : totalRawCount === 0 ? (
        <EmptyState title="No rows for this selection" hint="Nothing was recorded for the selected period." />
      ) : totalVisibleCount === 0 ? (
        <EmptyState
          title="Nothing matches the current filters"
          hint="Clear the search, category, or hide-empty filter to see the rows again."
        />
      ) : isMobile ? (
        /* Mobile presentation */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <CompactSortHeader label="Brand / Item" sortMode={sortMode} onToggleSort={toggleSortMode} pinnedCount={pinnedKeys.length} onOpenPinModal={() => setPinModalOpen(true)} />
          </div>
          {(isAll ? registerViews : currentRegisterView ? [currentRegisterView] : []).map((regView) => (
            <div key={regView.key}>
              {isAll && (
                <div
                  style={{
                    padding: '8px 10px',
                    background: 'var(--layer)',
                    border: '1px solid var(--line)',
                    fontWeight: 600,
                    fontSize: 12,
                    textTransform: 'uppercase',
                    marginBottom: 8,
                  }}
                >
                  {regView.label} ({regView.visibleRowCount})
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {regView.rawRows.map((r) => (
                  <div
                    key={`${r.brand}-${r.is_unbranded}`}
                    style={{ background: 'var(--canvas)', border: '1px solid var(--line)', padding: 10 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                      <button
                        type="button"
                        className={`rg-row-pin-btn ${pinnedSet.has(r.parent_id || r.brand) ? 'pinned' : ''}`}
                        aria-label={pinnedSet.has(r.parent_id || r.brand) ? 'Unpin brand' : 'Pin brand to top'}
                        onClick={() => togglePin(r.parent_id || r.brand)}
                      >
                        {pinnedSet.has(r.parent_id || r.brand) ? <IconPinFilled size={13} /> : <IconPin size={13} />}
                      </button>
                      {brandLabel(r)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
                      {(regView.sizesMl.length ? regView.sizesMl : [null]).map((size) => {
                        // No size columns: show the row total, not the first
                        // cell, so a multi-product row is never under-reported.
                        const c = size != null ? r.cells[String(size)] : r.row_totals;
                        if (!c) return null;
                        return (
                          <div
                            key={size ?? 'gen'}
                            style={{ background: 'var(--layer)', padding: '6px 8px', border: '1px solid var(--line)', fontSize: 12 }}
                          >
                            {size != null && (
                              <div style={{ fontWeight: 600, color: 'var(--muted)', marginBottom: 2 }}>{size}ml</div>
                            )}
                            <div className="num" style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>OPN {c.opn}</span>
                              <span>CLS {c.cls}</span>
                            </div>
                            <div className="num" style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>INW {c.inw}</span>
                              <span>OUT {c.out}</span>
                            </div>
                            <div className="num" style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <strong>SLD {c.sld}</strong>
                              {seesMoney && c.amt_paise !== undefined && <span>₹{(c.amt_paise / 100).toFixed(2)}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Desktop presentation — one shared scroll viewport so the toolbar
           above stays pinned while only the register rows scroll, and (on
           the All tab) several stacked registers share ONE scrollbar instead
           of each owning its own nested one. */
        <div className="sr-viewport sr-viewport--sheet">
          {isAll ? (
            /* One continuous sheet: register groups flow together — no
               separate boxed cards, no separate scrollbar per register. */
            <div className="sheet-stream">
              {registerViews.map((regView, idx) => (
                <div key={regView.key}>
                  <div
                    className="sheet-group-head"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '4px 10px',
                      background: 'var(--layer)',
                      borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                      fontWeight: 600,
                      fontSize: 11,
                      letterSpacing: '0.6px',
                      textTransform: 'uppercase',
                      color: 'var(--ink)',
                    }}
                  >
                    <span>
                      {regView.label}
                      <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--subtle)', textTransform: 'none', letterSpacing: 0 }}>
                        {regView.visibleRowCount} brand{regView.visibleRowCount === 1 ? '' : 's'}
                        {regView.hiddenCount > 0 ? ` (${regView.hiddenCount} hidden)` : ''}
                      </span>
                    </span>
                    {regView.sizesMl.length > 0 && (
                      <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--muted)', textTransform: 'none', letterSpacing: 0 }}>
                        Sizes: {regView.sizesMl.map((s) => `${s}ml`).join(' · ')}
                      </span>
                    )}
                  </div>
                  {regView.rows.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--subtle)', fontSize: 12 }}>
                      No {regView.label.toLowerCase()} brands match the current filters.
                    </div>
                  ) : (
                    <div className="sr-grid-scroll">
                      <RegisterGrid
                        columns={regView.gridColumns}
                        data={regView.rows}
                        nestedHeaders={regView.nestedHeaders}
                        footers={[regView.footer]}
                        freezeColumns={1}
                        fitWidth={true}
                        rowKey={(row) => String(row.__parentKey)}
                        animateChanges={liveOrder}
                        animationScope={`${shopId}:${range.from}:${range.to}:${activeTab}`}
                        soldCount={(row) => Number(row.tot_sld || 0)}
                        saleTicks={saleTicks.current}
                        tickVersion={tickVersion}
                        isDrawerOpen={(row) => Boolean(expandedBrands[row.__parentKey])}
                        renderDrawer={(row) => renderSheetVariantDrawer(row, regView.sizesMl, seesMoney)}
                        onCellClick={handleGridCell}
                        ariaLabel={`Counter register: ${regView.label}`}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : currentRegisterView ? (
            /* Single active register view */
            currentRegisterView.rows.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--subtle)', fontSize: 12 }}>
                No {currentRegisterView.label.toLowerCase()} brands match the current filters.
              </div>
            ) : (
              <div className="sr-grid-scroll">
                <RegisterGrid
                  columns={currentRegisterView.gridColumns}
                  data={currentRegisterView.rows}
                  nestedHeaders={currentRegisterView.nestedHeaders}
                  footers={[currentRegisterView.footer]}
                  freezeColumns={1}
                  fitWidth={true}
                  rowKey={(row) => String(row.__parentKey)}
                  animateChanges={liveOrder}
                  animationScope={`${shopId}:${range.from}:${range.to}:${activeTab}`}
                  soldCount={(row) => Number(row.tot_sld || 0)}
                  saleTicks={saleTicks.current}
                  isDrawerOpen={(row) => Boolean(expandedBrands[row.__parentKey])}
                  renderDrawer={(row) => renderSheetVariantDrawer(row, currentRegisterView.sizesMl, seesMoney)}
                  onCellClick={handleGridCell}
                  ariaLabel={`Counter register: ${currentRegisterView.label}`}
                />
              </div>
            )
          ) : null}
        </div>
      )}

      {/* Day Summary & Register Settlement (inspired by real branch owner Excel & register mental model) */}
      {data && !isBlocked && (
        <div className="sr-summary-panel">
          <div className="sr-summary-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{summary.title}</span>
              {recon && (
                <Tag
                  tone={recon.status === 'Reconciled' ? 'ok' : recon.status === 'Blocked' ? 'err' : 'warn'}
                  title={recon.discrepancies?.join('; ') || undefined}
                >
                  {recon.status.toUpperCase()}
                </Tag>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {data.audit && (
                <Btn
                  variant="ghost"
                  onClick={() => setShowAuditDrawer(true)}
                  style={{ fontSize: 11, height: 26, padding: '0 8px' }}
                >
                  Audit Details
                </Btn>
              )}
            </div>
          </div>

          <div className="sr-summary-cards">
            {/* 1. Category Sales Breakdown */}
            <div className="sr-summary-card">
              <div className="sr-summary-card-title">
                <span>REGISTER SALES BREAKDOWN</span>
                <span style={{ fontSize: 10, color: 'var(--subtle)' }}>UNITS & TURNOVER</span>
              </div>
              <div className="sr-summary-metrics">
                {registers.map((r) => (
                  <div key={r.key} className="sr-summary-row">
                    <span style={{ color: 'var(--ink)' }}>{r.label}</span>
                    <span className="sr-summary-val">
                      <span style={{ color: 'var(--subtle)', marginRight: 6 }}>
                        {r.totals.sld.toLocaleString('en-IN')} pcs
                      </span>
                      {seesMoney ? (r.totals.amt_paise ? moneyPaise(r.totals.amt_paise) : '—') : ''}
                    </span>
                  </div>
                ))}
                <div className="sr-summary-row sr-summary-row--total">
                  <span>Gross Counter Sales</span>
                  <span className="sr-summary-val" style={{ color: 'var(--blue-link, #0f62fe)' }}>
                    <span style={{ color: 'var(--subtle)', marginRight: 6, fontWeight: 400 }}>
                      {data.grand_totals.sld.toLocaleString('en-IN')} pcs
                    </span>
                    {seesMoney ? moneyPaise(data.grand_totals.amt_paise ?? 0) : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Operational Deductions & Profit */}
            {seesMoney && data.audit && (
              <div className="sr-summary-card">
                <div className="sr-summary-card-title">
                  <span>FINANCIAL SETTLEMENT</span>
                  <span style={{ fontSize: 10, color: 'var(--subtle)' }}>TURNOVER & KHARCH</span>
                </div>
                <div className="sr-summary-metrics">
                  <div className="sr-summary-row">
                    <span>Total Billed Turnover</span>
                    <span className="sr-summary-val">{moneyPaise(data.audit.turnover_paise)}</span>
                  </div>
                  <div className="sr-summary-row">
                    <span>Rate-Card Margin</span>
                    <span className="sr-summary-val" style={{ color: 'var(--ok-fg)' }}>
                      +{moneyPaise(data.audit.rate_card_margin_paise)}
                    </span>
                  </div>
                  <div className="sr-summary-row">
                    <span>Operational Expenses</span>
                    <span className="sr-summary-val" style={{ color: 'var(--err-fg)' }}>
                      -{moneyPaise(data.audit.expenses_paise)}
                    </span>
                  </div>
                  <div className="sr-summary-row sr-summary-row--total">
                    <span>Rate-Card Net Profit</span>
                    <span
                      className="sr-summary-val"
                      style={{
                        color:
                          data.audit.rate_card_net_paise >= 0 ? 'var(--ink)' : 'var(--err-fg)',
                      }}
                    >
                      {moneyPaise(data.audit.rate_card_net_paise)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 3. Physical Drawer Cash Count & Reconciliation */}
            {seesMoney && data.cash && (
              <div className="sr-summary-card">
                <div className="sr-summary-card-title">
                  <span>DRAWER CASH RECONCILIATION</span>
                  {liveVariance != null &&
                    (() => {
                      const v = liveVariance;
                      const tone =
                        v === 0
                          ? { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)', border: 'var(--ok)', label: 'BALANCED' }
                          : v > 0
                          ? { bg: 'var(--layer-accent)', fg: 'var(--blue-link, #0f62fe)', border: 'var(--blue, #0f62fe)', label: `+${moneyPaise(v)} EXCESS` }
                          : { bg: 'var(--err-bg)', fg: 'var(--err-fg)', border: 'var(--err)', label: `-${moneyPaise(Math.abs(v))} SHORTAGE` };
                      return (
                        <span
                          className="tag"
                          style={{
                            background: tone.bg,
                            color: tone.fg,
                            borderColor: tone.border,
                            fontWeight: 700,
                            fontSize: 10,
                            padding: '1px 6px',
                            borderWidth: 1,
                            borderStyle: 'solid',
                          }}
                        >
                          {tone.label}
                        </span>
                      );
                    })()}
                </div>
                <div className="sr-summary-metrics">
                  <div className="sr-summary-row">
                    <span>Expected Drawer Cash</span>
                    <span className="sr-summary-val">{moneyPaise(data.cash.expected_cash_paise)}</span>
                  </div>
                  <div className="sr-summary-row" style={{ alignItems: 'center' }}>
                    <span>Physical Drawer Cash</span>
                    {isSealed ? (
                      <span className="sr-summary-val">
                        {data.cash.closing_cash_paise != null ? moneyPaise(data.cash.closing_cash_paise) : '—'}
                      </span>
                    ) : (
                      <div className="sr-drawer-input-wrap" style={{ width: 130 }}>
                        <span className="sr-currency">₹</span>
                        <input
                          id="sr-drawer-input"
                          type="number"
                          min="0"
                          className="sr-drawer-input"
                          placeholder="0"
                          value={physicalCash}
                          onChange={(e) => setPhysicalCash(e.target.value)}
                          aria-label="Physical drawer cash"
                        />
                      </div>
                    )}
                  </div>
                  <div className="sr-summary-row sr-summary-row--total">
                    <span>Reconciliation Variance</span>
                    <span
                      className="sr-summary-val"
                      style={{
                        color:
                          liveVariance === 0
                            ? 'var(--ok-fg)'
                            : liveVariance && liveVariance > 0
                            ? 'var(--blue-link, #0f62fe)'
                            : 'var(--err-fg)',
                      }}
                    >
                      {liveVariance != null ? (liveVariance >= 0 ? `+${moneyPaise(liveVariance)}` : `-${moneyPaise(Math.abs(liveVariance))}`) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Itemized Profit & Expenses Details */}
          {summary.rows && (
            <div style={{ padding: '12px 16px' }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.32px',
                  marginBottom: 8,
                }}
              >
                Itemized Summary & Expense Details
              </div>
              <div className="tbl-scroll" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>How this is calculated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((row, i) => (
                      <tr key={`${row.item}-${i}`}>
                        <td style={row.depth ? { paddingLeft: 28, color: 'var(--subtle)' } : { fontWeight: 600 }}>
                          {row.item}
                        </td>
                        <td
                          className="num"
                          style={{
                            textAlign: 'right',
                            fontWeight: row.depth ? 400 : 600,
                            color: row.depth ? 'var(--subtle)' : 'var(--ink)',
                          }}
                        >
                          {row.amount}
                        </td>
                        <td style={{ whiteSpace: 'normal', color: 'var(--subtle)', minWidth: 260 }}>{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rate-Card Audit Drawer */}
      <Drawer open={showAuditDrawer} onClose={() => setShowAuditDrawer(false)} title="Daily Profit Audit">
        {data?.audit ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--subtle)', margin: 0 }}>
              Audit panel comparing bottle rate-card margin against operational expenses and cost-based profit.
            </p>

            <div
              style={{
                padding: '16px',
                background: 'var(--layer)',
                border: '1px solid var(--line)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--subtle)' }}>Rate-Card Margin (Σ SLD × margin)</span>
                <span style={{ fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {moneyPaise(data.audit.rate_card_margin_paise)}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--subtle)' }}>Cash Flow Expenses</span>
                <span style={{ fontWeight: 600, color: 'var(--err)', fontVariantNumeric: 'tabular-nums' }}>
                  - {moneyPaise(data.audit.expenses_paise)}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 14,
                  fontWeight: 600,
                  paddingTop: 8,
                  borderTop: '1px solid var(--line)',
                }}
              >
                <span style={{ color: 'var(--blue)' }}>Rate-Card Net Profit</span>
                <span style={{ color: 'var(--blue)', fontVariantNumeric: 'tabular-nums' }}>
                  {moneyPaise(data.audit.rate_card_net_paise)}
                </span>
              </div>
            </div>

            <div
              style={{
                padding: '12px 16px',
                background: 'var(--canvas)',
                border: '1px solid var(--line)',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
              }}
            >
              <span style={{ color: 'var(--subtle)' }}>Total Billed Turnover (Σ AMT)</span>
              <span style={{ fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {moneyPaise(data.audit.turnover_paise)}
              </span>
            </div>

            {seesValuation && data.audit.cost_based_gross_profit_paise !== undefined && (
              <div
                style={{
                  padding: '16px',
                  background: 'var(--layer)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--subtle)' }}>
                  Cost-Based Comparison (From Dashboard)
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--subtle)' }}>Cost-Based Gross Profit</span>
                  <span style={{ fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                    {moneyPaise(data.audit.cost_based_gross_profit_paise)}
                  </span>
                </div>

                {data.audit.cost_based_net_profit_paise !== undefined && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--subtle)' }}>Cost-Based Net Profit</span>
                    <span style={{ fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                      {moneyPaise(data.audit.cost_based_net_profit_paise)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--subtle)' }}>Audit data unavailable.</p>
        )}
      </Drawer>

      {/* Discrepancies Drawer */}
      <Drawer
        open={showDiscrepanciesDrawer}
        onClose={() => setShowDiscrepanciesDrawer(false)}
        title="Reconciliation Discrepancies"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--subtle)', margin: 0 }}>
            The following discrepancies were detected between the Sheet ledger reconstruction and reporting selectors:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(recon?.discrepancies || []).map((disc, idx) => (
              <li key={idx} style={{ fontSize: 13, color: 'var(--ink)' }}>
                {disc}
              </li>
            ))}
          </ul>
        </div>
      </Drawer>
      <PinManagementModal
        open={pinModalOpen}
        onClose={() => setPinModalOpen(false)}
        title="Pinned Brands Priority"
        pinnedKeys={pinnedKeys}
        allItems={pinnedItems}
        onMovePinned={movePinnedItem}
        onPin={pinItem}
        onUnpin={unpinItem}
      />
      <SheetPrintPanel open={printOpen} onClose={() => setPrintOpen(false)} data={printData} />
    </div>
  );
}
