import { Document, Page, Text, View, pdf, StyleSheet } from '@react-pdf/renderer'
import type { SheetPrintSection, SheetPrintSummaryRow } from './sheetPrint'
import {
  estimateSlipHeightMm,
  groupByBrand,
  type ClosingLayout,
  type PrintableClosingItem,
} from './sheetPrintOrder'

export type SheetPaper = 'A4' | '80mm' | '58mm'
export type { ClosingLayout }

/** Printable rows are exactly the shape the ordering helpers operate on. */
export interface SheetClosingItem extends PrintableClosingItem {}
export interface SheetPdfOptions {
  paper: SheetPaper
  orientation: 'portrait' | 'landscape'
  marginMm: number
  fontSize: number
  headerFooter: boolean
  mode: 'full' | 'closing'
  selectedSections: string[]
  /** closing-stock only: one block per brand, or a flat list of every variant. */
  closingLayout: ClosingLayout
}
export interface SheetPdfData {
  title: string
  period: string
  sections: SheetPrintSection[]
  summary: SheetPrintSummaryRow[]
  /** In the application's own order: pinned brands first, then the demand
   *  ranking. The print must match the screen, so this is never re-sorted. */
  closingItems: SheetClosingItem[]
}

const mm = (value: number) => value * 72 / 25.4

type Styles = ReturnType<typeof buildStyles>

function buildStyles(textSize: number, margin: number, thermal: boolean) {
  return StyleSheet.create({
    page: { padding: margin, fontFamily: 'Helvetica', fontSize: textSize, color: '#161616' },
    heading: { fontSize: textSize + 2, fontWeight: 'bold', marginBottom: 3 },
    muted: { fontSize: Math.max(6, textSize - 1), color: '#525252', marginBottom: 5 },
    section: { fontWeight: 'bold', marginTop: 9, marginBottom: 3 },
    row: {
      flexDirection: 'row',
      borderBottomWidth: 0.35,
      borderBottomColor: '#c6c6c6',
      paddingVertical: thermal ? 3 : 2,
    },
    header: { backgroundColor: '#f4f4f4', fontWeight: 'bold' },
    cell: { flex: 1, paddingRight: 2 },
    // Fixed flex ratios rather than an unbounded `flex: 1` on both label
    // columns, so a long product name can never squeeze the quantity and tick
    // columns off the edge of the page.
    itemName: { flex: 3, paddingRight: 2 },
    brandRow: { backgroundColor: '#e8e8e8' },
    brandName: { flex: 4, paddingRight: 2, fontWeight: 'bold' },
    gName: { flex: 3, paddingRight: 2, paddingLeft: 8 },
    qty: { width: 26, textAlign: 'right' },
    tick: { width: 14, textAlign: 'right' },
    footer: {
      position: 'absolute',
      bottom: margin,
      left: margin,
      right: margin,
      color: '#525252',
      fontSize: 7,
    },
  })
}

function ClosingStockPage({ data, options, styles, items }: {
  data: SheetPdfData
  options: SheetPdfOptions
  styles: Styles
  items: SheetClosingItem[]
}) {
  const grouped = options.closingLayout === 'grouped'
  const groups = grouped ? groupByBrand(items) : []
  return <>
    {options.headerFooter && <View fixed>
      <Text style={styles.heading}>{data.title}</Text>
      <Text style={styles.muted}>
        {data.period} · Closing stock · {grouped ? 'grouped by brand' : 'every variant'}
      </Text>
    </View>}
    <View style={[styles.row, styles.header]} fixed>
      <Text style={grouped ? styles.gName : styles.itemName}>
        {grouped ? 'Brand / Product / Size' : 'Product / Size'}
      </Text>
      <Text style={styles.qty}>Close</Text>
      <Text style={styles.tick}>Tick</Text>
    </View>
    {grouped
      ? groups.map(group => <View key={`${group.section}::${group.brand}`} wrap={false}>
          <View style={[styles.row, styles.brandRow]} wrap={false}>
            <Text style={styles.brandName}>{group.brand}</Text>
            <Text style={styles.qty}>
              {group.items.reduce((total, item) => total + item.closing, 0)}
            </Text>
            <Text style={styles.tick}>{''}</Text>
          </View>
          {group.items.map(item => <View key={item.id} style={styles.row} wrap={false}>
            <Text style={styles.gName}>{item.name} {item.size}</Text>
            <Text style={styles.qty}>{String(item.closing)}</Text>
            <Text style={styles.tick}>[ ]</Text>
          </View>)}
        </View>)
      : items.map(item => <View key={item.id} style={styles.row} wrap={false}>
          <Text style={styles.itemName}>{item.name} {item.size}</Text>
          <Text style={styles.qty}>{String(item.closing)}</Text>
          <Text style={styles.tick}>[ ]</Text>
        </View>)}
    {items.length === 0 && <Text style={styles.muted}>No products in the selected sections.</Text>}
  </>
}

function PdfDocument({ data, options }: { data: SheetPdfData; options: SheetPdfOptions }) {
  const thermal = options.paper !== 'A4'
  const chosen = data.sections.filter(s => options.selectedSections.includes(s.tabLabel.toLowerCase()))
  const items = data.closingItems.filter(item => options.selectedSections.includes(item.section.toLowerCase()))
  const margin = thermal ? mm(options.paper === '58mm' ? 4 : 3) : mm(options.marginMm)
  const textSize = thermal ? (options.paper === '58mm' ? 7 : 8) : options.fontSize
  const width = mm(options.paper === '58mm' ? 58 : 80)
  const charsPerLine = options.paper === '58mm' ? 17 : 28
  const slipHeightMm = estimateSlipHeightMm(items, options.closingLayout, charsPerLine, 5.5)
  const pageSize: [number, number] | 'A4' = thermal
    ? [width, mm(Math.max(45, slipHeightMm))]
    : 'A4'
  const styles = buildStyles(textSize, margin, thermal)
  const selectedSummary = options.selectedSections.includes('day summary')
  return <Document title={`${data.title} ${data.period}`}>
    {(options.mode === 'closing' || thermal)
      ? <Page size={pageSize} orientation={thermal ? 'portrait' : options.orientation} style={styles.page} wrap={!thermal}>
        <ClosingStockPage data={data} options={options} styles={styles} items={items} />
        {options.headerFooter && !thermal && (
          <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) =>
            `${data.period} · Closing stock · ${pageNumber} / ${totalPages}`} />
        )}
      </Page>
      : <>
        {chosen.map(section => <Page key={section.tabLabel} size="A4" orientation={options.orientation} style={styles.page} wrap>
          {options.headerFooter && <View fixed><Text style={styles.heading}>{data.title}</Text><Text style={styles.muted}>{data.period}</Text></View>}
          <Text style={styles.section}>{section.tabLabel.toUpperCase()}</Text>
          {!!section.hiddenCount && <Text style={styles.muted}>{section.hiddenCount} rows hidden by filters. Totals include hidden rows.</Text>}
          <View style={[styles.row, styles.header]} fixed>{section.headers.map((h, index) => <Text key={index} style={index === 0 ? styles.itemName : styles.cell}>{h}</Text>)}</View>
          {section.rows.map((row, index) => <View key={index} style={styles.row} wrap={false}>{row.map((value, cellIndex) =>
            <Text key={cellIndex} style={cellIndex === 0 ? styles.itemName : styles.cell}>{String(value)}</Text>
          )}</View>)}
          <View style={[styles.row, styles.header]} wrap={false}>{section.totals.map((value, index) => <Text key={index} style={index === 0 ? styles.itemName : styles.cell}>{String(value)}</Text>)}</View>
          {options.headerFooter && <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${data.period} · ${pageNumber} / ${totalPages}`} />}
        </Page>)}
        {selectedSummary && data.summary.length > 0 && <Page size="A4" orientation={options.orientation} style={styles.page} wrap>
          {options.headerFooter && <View fixed><Text style={styles.heading}>{data.title}</Text><Text style={styles.muted}>{data.period}</Text></View>}
          <Text style={styles.section}>DAY SUMMARY</Text>
          {data.summary.map((item, index) => <View key={index} style={styles.row} wrap={false}>
            <Text style={styles.itemName}>{item.item}</Text>
            <Text style={styles.cell}>{item.amount}</Text>
            <Text style={styles.itemName}>{item.note}</Text>
          </View>)}
        </Page>}
        {chosen.length === 0 && (!selectedSummary || data.summary.length === 0) && <Page size="A4" orientation={options.orientation} style={styles.page}><Text>No sections selected.</Text></Page>}
      </>}
  </Document>
}

/** One PDF blob is used by both the embedded preview and the print action. */
export async function makeSheetPdf(data: SheetPdfData, options: SheetPdfOptions): Promise<Blob> {
  return pdf(<PdfDocument data={data} options={options} />).toBlob()
}
