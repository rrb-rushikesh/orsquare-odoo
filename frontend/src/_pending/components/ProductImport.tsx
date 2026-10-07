import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import {
  commitOnboarding,
  createAccount,
  listAccounts,
  listShopLibraries,
  previewOnboarding,
  repairImportRows,
} from '@/lib/repo'
import { ApiError } from '@/lib/api'
import type {
  OnboardingIssue,
  OnboardingPlan,
  OnboardingResult,
  PAccount,
  ShopLibraryOption,
} from '@/lib/repo'
import { Btn, Drawer, NumInput, Tag, useToast } from '@/components/ui'
import { IconDownload, IconPlus, IconSheet, IconTrash } from '@/components/icons'

/** One product parsed from the workbook, editable in the review step. */
export type ImportRow = {
  key: string
  name: string
  brand: string
  flavour?: string
  barcode: string
  category: string
  unit: string
  mrp: number
  rate: number
  piecesPerBox: number
  lowLevel: number
  godown: string | number
  counter: string | number
  checked: boolean
  originalBrand?: string
  autoEdited?: {
    field: string
    from: string
    to: string
    source: string
  }
}

type FieldKey =
  | 'name'
  | 'brand'
  | 'flavour'
  | 'barcode'
  | 'category'
  | 'unit'
  | 'mrp'
  | 'rate'
  | 'piecesPerBox'
  | 'lowLevel'
  | 'godown'
  | 'counter'
  | 'stock'

/** Fast Levenshtein distance for fuzzy typo tolerance. */
function levenshtein(a: string, b: string): number {
  const al = a.length
  const bl = b.length
  if (!al) return bl
  if (!bl) return al
  const row = new Array<number>(bl + 1)
  for (let j = 0; j <= bl; j++) row[j] = j
  for (let i = 1; i <= al; i++) {
    let prev = i - 1
    row[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= bl; j++) {
      const temp = row[j]
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = temp
    }
  }
  return row[bl]
}

const normKey = (s: unknown): string =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Universal column aliases including common Indian accounting & retail formats. */
const FIELD_ALIASES: Record<FieldKey, string[]> = {
  name: [
    'name', 'product', 'productname', 'item', 'itemname', 'itemdescription',
    'description', 'particulars', 'title', 'items', 'articlename', 'goodsdescription',
    'produc', 'prodcut', 'itemname', 'pname', 'producttitle', 'itemtitle'
  ],
  brand: [
    'brand', 'brandname', 'make', 'mfg', 'manufacturer', 'distillery', 'brewery', 'label'
  ],
  flavour: [
    'flavour', 'flavor', 'variant', 'variantname', 'flavourname', 'flavorname',
    'subvariant', 'subbrand', 'subname', 'flvr', 'flav'
  ],
  barcode: [
    'barcode', 'barcodenumber', 'bar', 'scancode', 'ean', 'upc', 'code',
    'itemcode', 'sku', 'productcode', 'serial', 'barcod', 'bcode', 'ean13', 'upca'
  ],
  category: [
    'category', 'cat', 'categories', 'categoryname', 'type', 'itemgroup',
    'group', 'department', 'class', 'classification', 'catgory', 'categry'
  ],
  unit: [
    'unit', 'units', 'size', 'measure', 'measurement', 'packsize', 'uom', 'packing'
  ],
  mrp: [
    'mrp', 'maxretailprice', 'maximumretailprice', 'retailprice', 'printprice',
    'mrpprice', 'mrpinr', 'mrprs', 'mrrp', 'printrate', 'maxretail'
  ],
  rate: [
    'ourrate', 'rate', 'sellingprice', 'saleprice', 'salesprice', 'sellingrate',
    'salerate', 'price', 'offerprice', 'costprice', 'purchaseprice', 'purchaserate',
    'cost', 'sellprice', 'sprice', 'posprice'
  ],
  piecesPerBox: [
    'piecesperbox', 'pcsperbox', 'pcs/box', 'boxsize', 'perbox', 'pack',
    'boxqty', 'packingqty', 'ppb', 'piecesinbox'
  ],
  lowLevel: [
    'lowlevel', 'lowstock', 'minimum', 'minimumlevel', 'reorder',
    'reorderlevel', 'min', 'threshold', 'alertlevel', 'minstock', 'reorderqty'
  ],
  godown: [
    'godown', 'godownstock', 'godownqty', 'godownpcs', 'store', 'storestock',
    'storeqty', 'bulk', 'bulkstock', 'warehouse', 'warehousestock', 'godam',
    'godan', 'storage', 'godwon', 'godownstok', 'godawn'
  ],
  counter: [
    'counter', 'counterstock', 'counterqty', 'counterpcs', 'display',
    'displaystock', 'shop', 'shopstock', 'front', 'frontstock', 'saleable',
    'shelf', 'shelfstock', 'countr', 'counterstok', 'counte', 'posstock'
  ],
  stock: [
    'stock', 'qty', 'quantity', 'openingstock', 'openingqty', 'balance',
    'balanceqty', 'currentstock', 'totalstock', 'totalqty', 'available',
    'closingstock', 'pcs', 'pieces', 'stok', 'quantiy', 'qnty', 'balqty', 'opstock'
  ],
}

/** Resolves any raw spreadsheet header with exact, substring, and typo tolerance. */
export function resolveHeader(raw: string): FieldKey | null {
  const n = normKey(raw)
  if (!n) return null

  // 1. Exact alias match
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [FieldKey, string[]][]) {
    if (aliases.includes(n)) return field
  }

  // 2. High-confidence token / substring inclusion
  if (n.includes('godown') || n.includes('godam') || n.includes('warehous') || n.includes('godwon')) return 'godown'
  if (n.includes('counter') || n.includes('countr') || n.includes('display') || n.includes('shelf')) return 'counter'
  if (n.includes('barcode') || n.includes('scancode') || n.includes('barcod')) return 'barcode'
  if (n.includes('mrp') || n.includes('maxretail')) return 'mrp'
  if (n.includes('selling') || n.includes('ourrate') || n.includes('saleprice')) return 'rate'
  // Must be tested before the generic stock rule below: "low stock level" (the
  // header this app's own sample template ships) contains the substring
  // "stock" and would otherwise be read as a stock quantity, silently turning
  // a plain catalogue import into an opening-stock purchase that then demands
  // a supplier.
  if (n.includes('reorder') || n.includes('lowstock') || n.includes('minlevel')) return 'lowLevel'
  if (n.includes('stock') || n.includes('qty') || n.includes('quant') || n.includes('balance') || n.includes('opening')) return 'stock'
  if (n.includes('product') || n.includes('item') || n.includes('particular') || n.includes('descrip')) return 'name'
  if (n.includes('brand') || n.includes('mfg') || n.includes('distill') || n.includes('brewer')) return 'brand'
  if (n.includes('flavour') || n.includes('flavor') || n.includes('variant')) return 'flavour'
  if (n.includes('categor') || n.includes('group') || n.includes('dept')) return 'category'
  if (n.includes('unit') || n.includes('uom')) return 'unit'
  if (n.includes('box') || n.includes('pack')) return 'piecesPerBox'

  // 3. Typo tolerance: Levenshtein distance <= 2 for words of length >= 5
  if (n.length >= 5) {
    for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [FieldKey, string[]][]) {
      for (const a of aliases) {
        if (Math.abs(n.length - a.length) <= 2 && levenshtein(n, a) <= 2) {
          return field
        }
      }
    }
  }

  return null
}

const toStr = (v: unknown): string => {
  if (v == null) return ''
  return String(v)
    .replace(/[\u0000-\u001f\u007f\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (v == null) return 0
  const cleaned = String(v)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^0-9.-]/g, '')
  const n = parseFloat(cleaned)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

const intVal = (v: unknown): number => Math.max(0, Math.round(toNum(v)))

let rowSeq = 0

type ParseSheetResult = {
  rows: ImportRow[]
  foundHeaders: Record<FieldKey, string>
  hasGodownCol: boolean
  hasCounterCol: boolean
  hasStockCol: boolean
  stockColName: string
}

/** Parses matrix rows into structured ImportRow items. */
function parseSheet(
  matrix: unknown[][],
  stockDest: 'counter' | 'godown'
): ParseSheetResult {
  const emptyRes: ParseSheetResult = {
    rows: [],
    foundHeaders: {} as Record<FieldKey, string>,
    hasGodownCol: false,
    hasCounterCol: false,
    hasStockCol: false,
    stockColName: '',
  }
  if (!matrix.length) return emptyRes

  const scanRows = Math.min(matrix.length, 25)
  let bestHi = -1
  let bestField: Record<FieldKey, number> | null = null
  let bestScore = 0

  for (let i = 0; i < scanRows; i++) {
    const row = matrix[i] || []
    const field = {} as Record<FieldKey, number>
    for (let ci = 0; ci < row.length; ci++) {
      const f = resolveHeader(toStr(row[ci]))
      if (f && field[f] == null) field[f] = ci
    }
    const score = Object.keys(field).length
    if (score > bestScore) {
      bestScore = score
      bestHi = i
      bestField = field
    }
  }

  if (bestHi < 0 || !bestField || bestScore === 0) return emptyRes

  const headerRow = matrix[bestHi] || []
  const foundHeaders = {} as Record<FieldKey, string>
  for (const [fk, ci] of Object.entries(bestField) as [FieldKey, number][]) {
    foundHeaders[fk] = toStr(headerRow[ci])
  }

  const hasGodownCol = bestField.godown != null
  const hasCounterCol = bestField.counter != null
  const hasStockCol = bestField.stock != null
  const stockColName = hasStockCol ? toStr(headerRow[bestField.stock]) : ''

  const rows: ImportRow[] = []
  const seenB = new Set<string>()

  for (let i = bestHi + 1; i < matrix.length; i++) {
    const row = matrix[i] || []
    const get = (f: FieldKey): unknown => (bestField[f] != null ? row[bestField[f]] : undefined)
    const name = toStr(get('name'))
    const barcode = toStr(get('barcode'))
    const mrp = toNum(get('mrp'))
    const rate = toNum(get('rate'))

    let godownVal: unknown = get('godown')
    let counterVal: unknown = get('counter')

    // Single generic stock column routing
    if (!hasGodownCol && !hasCounterCol && hasStockCol) {
      const genericStock = get('stock')
      if (stockDest === 'counter') {
        counterVal = genericStock
        godownVal = ''
      } else {
        godownVal = genericStock
        counterVal = ''
      }
    }

    const hasStock = toStr(godownVal) !== '' || toStr(counterVal) !== ''
    if (!name && !barcode && mrp <= 0 && rate <= 0 && !hasStock) continue

    const b = barcode.toLowerCase()
    const duplicateInFile = !!b && seenB.has(b)
    if (b) seenB.add(b)

    rows.push({
      key: `imp-${++rowSeq}`,
      name,
      brand: toStr(get('brand')),
      flavour: toStr(get('flavour')),
      barcode,
      category: toStr(get('category')),
      unit: toStr(get('unit')),
      mrp,
      rate: rate > 0 ? rate : mrp,
      piecesPerBox: Math.max(1, intVal(get('piecesPerBox')) || 1),
      lowLevel: intVal(get('lowLevel')),
      godown: godownVal == null ? '' : String(godownVal).trim(),
      counter: counterVal == null ? '' : String(counterVal).trim(),
      checked: !duplicateInFile && !!(name || barcode),
    })
  }

  return {
    rows,
    foundHeaders,
    hasGodownCol,
    hasCounterCol,
    hasStockCol,
    stockColName,
  }
}

function downloadTemplate() {
  void (async () => {
    const XLSX = await import('xlsx')
    const rows: (string | number)[][] = [
      ['Product Name', 'Brand', 'Flavour / Variant', 'Barcode', 'Category', 'Unit', 'MRP', 'Sales Rate', 'Pieces Per Box', 'Low Stock Level'],
      ['Classic Cola 500 ML', 'Classic', 'Original', '8901234567890', 'BEVERAGES', '500 ML', 40, 34, 12, 5],
      ['Potato Chips Salted', 'Crispy', 'Salted', '8909876543210', 'SNACKS', 'PACK', 20, 18, 24, 10],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = rows[0].map((_, i) => ({ wch: i === 0 ? 24 : 14 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Products')
    XLSX.writeFile(wb, 'xpo-products-template.xlsx')
  })()
}

const IMPORT_STEPS = [
  { id: 'upload', label: '1. Select File & Setup', sub: 'Upload & stock settings' },
  { id: 'review', label: '2. Review & Verify', sub: 'Verify columns & simulation' },
  { id: 'complete', label: '3. Completed', sub: 'Atomic commit confirmation' },
]

export function ProductImportDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeShop } = useAuth()
  const d = useData()
  const toast = useToast()
  const shopId = activeShop?.id || ''

  const [step, setStep] = useState<'upload' | 'review' | 'complete'>('upload')
  const [matrixData, setMatrixData] = useState<unknown[][]>([])
  const [rows, setRows] = useState<ImportRow[]>([])
  const [foundHeaders, setFoundHeaders] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>)
  const [drag, setDrag] = useState(false)
  const [parseErr, setParseErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [importId, setImportId] = useState('')

  // Stock options
  const [hasGenericStockCol, setHasGenericStockCol] = useState(false)
  const [genericStockColName, setGenericStockColName] = useState('')
  const [stockDestination, setStockDestination] = useState<'counter' | 'godown'>('counter')
  const [initStock, setInitStock] = useState(true)
  const [directOpeningStock, setDirectOpeningStock] = useState(true)

  // Reference library for automatic brand matching
  const [libraries, setLibraries] = useState<ShopLibraryOption[]>([])
  const [selectedLibraryKey, setSelectedLibraryKey] = useState<string>('')

  // Supplier state
  const [suppliers, setSuppliers] = useState<PAccount[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [quickPhone, setQuickPhone] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)

  // Simulation & commit
  const [plan, setPlan] = useState<OnboardingPlan | null>(null)
  const [result, setResult] = useState<OnboardingResult | null>(null)
  const [failInfo, setFailInfo] = useState<{ message: string; issues: OnboardingIssue[] } | null>(null)

  // Table filtering & pagination
  const [filterTab, setFilterTab] = useState<'all' | 'ready' | 'issues' | 'auto_edited'>('all')
  const [pinnedIssueKeys, setPinnedIssueKeys] = useState<Set<string>>(new Set())
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100

  const inputRef = useRef<HTMLInputElement>(null)
  const fileParseIdRef = useRef(0)

  const resetImportState = useCallback(() => {
    fileParseIdRef.current++
    setFileName('')
    setMatrixData([])
    setRows([])
    setFoundHeaders({} as Record<FieldKey, string>)
    setHasGenericStockCol(false)
    setGenericStockColName('')
    setDirectOpeningStock(true)
    setParseErr('')
    setPlan(null)
    setResult(null)
    setFailInfo(null)
    setPinnedIssueKeys(new Set())
    setHasUnsavedChanges(false)
    setShowQuickAdd(false)
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  useEffect(() => {
    if (!open) {
      setStep('upload')
      resetImportState()
      setDrag(false)
      setBusy(false)
      setFilterTab('all')
      setSearchQuery('')
      setPage(1)
    }
  }, [open, resetImportState])

  useEffect(() => {
    if (!open || !shopId) return
    void listAccounts(shopId, { type: 'Supplier' })
      .then((accs) => {
        setSuppliers(accs)
        if (accs.length === 1 && !supplierId) {
          setSupplierId(accs[0].id)
        }
      })
      .catch(() => setSuppliers([]))
  }, [open, shopId])

  useEffect(() => {
    if (!open) return
    void listShopLibraries(shopId || '')
      .then((libs) => {
        setLibraries(libs)
        if (libs.length > 0) {
          setSelectedLibraryKey((prev) => (prev ? prev : libs[0].key))
        }
      })
      .catch(() => setLibraries([]))
  }, [open, shopId])

  const toPayloadRow = (r: ImportRow) => ({
    row_id: r.key,
    name: r.name.trim(),
    brand: r.brand.trim(),
    flavour: (r.flavour || '').trim(),
    barcode: r.barcode.trim(),
    category: r.category.trim().toUpperCase() || null,
    unit: r.unit.trim().toUpperCase() || 'PCS',
    mrp: r.mrp,
    rate: r.rate > 0 ? r.rate : r.mrp,
    pieces_per_box: Math.max(1, r.piecesPerBox || 1),
    low_level: r.lowLevel,
    godown: initStock ? r.godown : 0,
    counter: initStock ? r.counter : 0,
    include: r.checked,
  })

  function handleStockDestChange(newDest: 'counter' | 'godown') {
    setStockDestination(newDest)
    if (matrixData.length) {
      const parsed = parseSheet(matrixData, newDest)
      setRows(parsed.rows)
    }
  }

  async function handleFile(file: File) {
    const parseId = ++fileParseIdRef.current
    setParseErr('')
    if (file.size > 15 * 1024 * 1024) {
      setParseErr('That file is larger than 15 MB. Split the catalogue into smaller workbooks and try again.')
      return
    }
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      if (parseId !== fileParseIdRef.current) return
      const wb = XLSX.read(buf, { type: 'array', dense: true })
      if (!wb.SheetNames.length) throw new Error('The workbook has no sheets.')

      let bestParsed: ParseSheetResult | null = null
      let bestMatrix: unknown[][] = []
      let bestCount = 0

      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName]
        if (!sheet || !sheet['!ref']) continue
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false }) as unknown[][]
        if (!matrix.length) continue
        const res = parseSheet(matrix, stockDestination)
        if (res.rows.length > bestCount) {
          bestCount = res.rows.length
          bestParsed = res
          bestMatrix = matrix
        }
      }

      if (parseId !== fileParseIdRef.current) return

      if (!bestParsed || !bestParsed.rows.length) {
        throw new Error('No product records could be identified. Make sure the workbook has column headers like Product Name, Barcode, MRP, Rate.')
      }

      setMatrixData(bestMatrix)
      setRows(bestParsed.rows)
      setFoundHeaders(bestParsed.foundHeaders)
      setFileName(file.name)
      setHasGenericStockCol(bestParsed.hasStockCol && !bestParsed.hasGodownCol && !bestParsed.hasCounterCol)
      setGenericStockColName(bestParsed.stockColName)

      // Check if file has any stock numbers
      const anyStock = bestParsed.rows.some((r) => {
        const g = typeof r.godown === 'number' ? r.godown : parseFloat(String(r.godown || 0))
        const c = typeof r.counter === 'number' ? r.counter : parseFloat(String(r.counter || 0))
        return (Number.isFinite(g) && g > 0) || (Number.isFinite(c) && c > 0)
      })
      setInitStock(anyStock)
      toast(`${bestParsed.rows.length} products loaded from ${file.name}.`, 'ok')
    } catch (e) {
      if (parseId === fileParseIdRef.current) {
        setParseErr(e instanceof Error ? e.message : 'Failed to read spreadsheet file.')
      }
    }
  }

  async function proceedToReview() {
    if (!rows.length) {
      toast('Upload a spreadsheet before continuing.', 'warn')
      return
    }
    if (initStock && !directOpeningStock && !supplierId) {
      toast('Please select an opening purchase supplier, use + to add one, or select Direct Opening Stock.', 'warn')
      return
    }

    setBusy(true)
    setParseErr('')
    try {
      let workingRows = [...rows]
      const opId = importId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `imp-${Date.now()}`)
      setImportId(opId)

      // Automatic Brand Resolution from Reference Library if user has rows with empty brand and library is chosen
      const libKey = selectedLibraryKey
      const rowsNeedingBrand = workingRows.filter((r) => !r.brand || !r.brand.trim())
      if (libKey && rowsNeedingBrand.length > 0) {
        try {
          const payload = workingRows.map(toPayloadRow)
          const repaired = await repairImportRows(shopId, libKey, payload)
          const repMap = new Map(repaired.rows.map((r: any) => [r.row_id, r]))
          let brandResolvedCount = 0
          workingRows = workingRows.map((r) => {
            const rep = repMap.get(r.key)
            if (rep && rep.brand && (!r.brand || !r.brand.trim())) {
              brandResolvedCount++
              return {
                ...r,
                brand: rep.brand,
                originalBrand: '',
                autoEdited: {
                  field: 'Brand',
                  from: '(empty)',
                  to: rep.brand,
                  source: 'Reference Library',
                },
                category: r.category || rep.category || '',
                unit: r.unit || rep.unit || '',
              }
            }
            return r
          })
          setRows(workingRows)
          if (brandResolvedCount > 0) {
            const libLabel = libraries.find((l) => l.key === libKey)?.label || 'reference library'
            toast(`Auto-resolved ${brandResolvedCount} brand(s) from ${libLabel}.`, 'ok')
          }
        } catch {
          // Gracefully continue if library lookup is unavailable
        }
      }

      const payloadRows = workingRows.map(toPayloadRow)
      const p = await previewOnboarding(shopId, {
        products: payloadRows,
        initialize_stock: initStock,
        direct_opening_stock: initStock ? directOpeningStock : false,
        supplier_id: initStock && !directOpeningStock ? supplierId : undefined,
        library_key: selectedLibraryKey || undefined,
      })

      setPlan(p)

      // Snapshot issue keys for top-sorting so they are placed at top without shifting mid-typing
      const issueKeys = new Set((p.blocking_errors || []).map((e) => e.row_id).filter(Boolean))
      for (const r of workingRows) {
        if (r.checked && (!r.name.trim() || !r.unit.trim() || !r.mrp || r.mrp <= 0)) {
          issueKeys.add(r.key)
        }
      }
      setPinnedIssueKeys(issueKeys)
      setHasUnsavedChanges(false)
      setStep('review')
      setPage(1)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not generate import simulation.'
      setParseErr(msg)
      toast(msg, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function addQuickSupplier() {
    if (!quickName.trim()) return
    if (!quickPhone.trim()) {
      toast('Enter the supplier phone number — it is required for the ledger.', 'err')
      return
    }
    setQuickBusy(true)
    try {
      const acc = await createAccount(shopId, {
        name: quickName.trim(),
        type: 'Supplier',
        phone: quickPhone.trim(),
      })
      setSuppliers((prev) => [acc, ...prev])
      setSupplierId(acc.id)
      setShowQuickAdd(false)
      setQuickName('')
      setQuickPhone('')
      toast(`Supplier "${acc.name}" added and selected.`, 'ok')
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to create supplier'
      toast(msg, 'err')
    } finally {
      setQuickBusy(false)
    }
  }

  function excludeAllErrors() {
    const badKeys = new Set(Array.from(activeIssuesMap.keys()))
    if (!badKeys.size) return
    setRows((prev) => prev.map((r) => (badKeys.has(r.key) ? { ...r, checked: false } : r)))
    setHasUnsavedChanges(true)
    toast(`${badKeys.size} invalid row(s) excluded.`, 'info')
  }

  async function saveAndReSimulate() {
    if (!shopId) return
    setBusy(true)
    try {
      const payloadRows = rows.map(toPayloadRow)
      const opId = importId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `imp-${Date.now()}`)
      setImportId(opId)
      const p = await previewOnboarding(shopId, {
        products: payloadRows,
        initialize_stock: initStock,
        direct_opening_stock: initStock ? directOpeningStock : false,
        supplier_id: initStock && !directOpeningStock ? supplierId : undefined,
        library_key: selectedLibraryKey || undefined,
      })
      setPlan(p)
      const newIssues = new Set((p.blocking_errors || []).map((e) => e.row_id).filter(Boolean))
      for (const r of rows) {
        if (r.checked && (!r.name.trim() || !r.unit.trim() || !r.mrp || r.mrp <= 0)) {
          newIssues.add(r.key)
        }
      }
      setPinnedIssueKeys(newIssues)
      setHasUnsavedChanges(false)
      toast('Changes saved and verified with server.', 'ok')
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Simulation failed'
      toast(msg, 'err')
    } finally {
      setBusy(false)
    }
  }

  function revertAutoEdit(key: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r
        return {
          ...r,
          brand: r.originalBrand ?? '',
          autoEdited: undefined,
        }
      })
    )
    setHasUnsavedChanges(true)
    toast('Reverted brand to original.', 'info')
  }

  function revertAllAutoEdits() {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.autoEdited) return r
        return {
          ...r,
          brand: r.originalBrand ?? '',
          autoEdited: undefined,
        }
      })
    )
    setHasUnsavedChanges(true)
    toast('Reverted all brand auto-edits.', 'info')
  }

  async function runCommit() {
    if (!plan || !shopId) return
    if (activeIssuesCount > 0) {
      toast('Resolve all blocking issues before committing.', 'warn')
      return
    }
    setBusy(true)
    setParseErr('')
    try {
      const payloadRows = rows.map(toPayloadRow)
      const res = await commitOnboarding(shopId, {
        import_id: importId,
        products: payloadRows,
        initialize_stock: initStock,
        direct_opening_stock: initStock ? directOpeningStock : false,
        supplier_id: initStock && !directOpeningStock ? supplierId : undefined,
      })
      setResult(res.result)
      setStep('complete')
      await d.refresh()
      toast(`${res.result.products_created} products created, ${res.result.products_matched} matched.`, 'ok')
    } catch (err) {
      let msg = 'Import failed.'
      let issues: OnboardingIssue[] = []
      if (err instanceof ApiError) {
        msg = err.message
        const data = err.data as { issues?: OnboardingIssue[] } | undefined
        if (data?.issues) issues = data.issues
      }
      setFailInfo({ message: msg, issues })
      setStep('complete')
      toast(msg, 'err')
    } finally {
      setBusy(false)
    }
  }

  function update(key: string, patch: Partial<ImportRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r
        const updated = { ...r, ...patch }
        // If user manually altered the brand away from auto-edit, remove the badge
        if (patch.brand !== undefined && r.autoEdited?.field === 'Brand' && patch.brand !== r.autoEdited.to) {
          updated.autoEdited = undefined
        }
        return updated
      })
    )
    setHasUnsavedChanges(true)
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
    setHasUnsavedChanges(true)
  }

  function toggleAll(checked: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, checked })))
    setHasUnsavedChanges(true)
  }

  // Live barcode counts across checked rows for instant duplicate detection
  const barcodeCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      if (!r.checked) continue
      const bc = r.barcode.trim().toLowerCase()
      if (bc) map.set(bc, (map.get(bc) || 0) + 1)
    }
    return map
  }, [rows])

  // Server reported errors from simulation
  const serverIssuesMap = useMemo(() => {
    const map = new Map<string, OnboardingIssue>()
    if (plan?.blocking_errors) {
      for (const e of plan.blocking_errors) {
        if (e.row_id) map.set(e.row_id, e)
      }
    }
    return map
  }, [plan])

  // Real-time dynamic evaluation of whether a row has an active issue
  const getRowIssue = useCallback(
    (r: ImportRow): OnboardingIssue | null => {
      if (!r.checked) return null

      // Client-clearable instant checks:
      const rowNum = Number(r.key.split('-')[1]) || 0
      if (!r.name.trim()) {
        return {
          row_id: r.key,
          row: rowNum,
          name: r.name,
          code: 'missing_name',
          message: 'Product name is required.',
          fix: 'Enter a product name.',
        }
      }
      if (!r.unit.trim()) {
        return {
          row_id: r.key,
          row: rowNum,
          name: r.name,
          code: 'missing_unit',
          message: 'Unit (measure) is required.',
          fix: 'Enter a unit such as PCS, BTL, CAN.',
        }
      }
      if (!r.mrp || r.mrp <= 0) {
        return {
          row_id: r.key,
          row: rowNum,
          name: r.name,
          code: 'invalid_mrp',
          message: 'MRP must be greater than zero.',
          fix: 'Enter a valid MRP.',
        }
      }
      const bc = r.barcode.trim().toLowerCase()
      if (bc && (barcodeCounts.get(bc) || 0) > 1) {
        return {
          row_id: r.key,
          row: rowNum,
          name: r.name,
          code: 'duplicate_barcode',
          message: `Duplicate barcode "${r.barcode}" in file.`,
          fix: 'Ensure barcodes are unique.',
        }
      }

      // Check server issue: if client-clearable, it's already validated above
      const sIssue = serverIssuesMap.get(r.key)
      if (sIssue) {
        const clientClearable = ['missing_name', 'missing_unit', 'invalid_mrp', 'duplicate_barcode', 'duplicate_in_file']
        if (!clientClearable.includes(sIssue.code)) {
          return sIssue
        }
      }

      return null
    },
    [barcodeCounts, serverIssuesMap]
  )

  const activeIssuesMap = useMemo(() => {
    const map = new Map<string, OnboardingIssue>()
    for (const r of rows) {
      const issue = getRowIssue(r)
      if (issue) map.set(r.key, issue)
    }
    return map
  }, [rows, getRowIssue])

  const autoEditedRows = useMemo(() => rows.filter((r) => !!r.autoEdited), [rows])
  const activeIssuesCount = activeIssuesMap.size
  const readyCount = rows.filter((r) => r.checked && !activeIssuesMap.has(r.key)).length

  // Filtered and sorted rows (pinned issues sorted to top in 'all' view)
  const filteredRows = useMemo(() => {
    let list = rows
    if (filterTab === 'ready') {
      list = list.filter((r) => r.checked && !activeIssuesMap.has(r.key))
    } else if (filterTab === 'issues') {
      list = list.filter((r) => activeIssuesMap.has(r.key) || pinnedIssueKeys.has(r.key))
    } else if (filterTab === 'auto_edited') {
      list = list.filter((r) => !!r.autoEdited)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.brand.toLowerCase().includes(q) ||
          (r.flavour && r.flavour.toLowerCase().includes(q)) ||
          r.barcode.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q)
      )
    }

    // Sort pinned issues to the top in 'all' view so user never has to scroll to find them
    if (filterTab === 'all' && pinnedIssueKeys.size > 0) {
      list = [...list].sort((a, b) => {
        const aPinned = pinnedIssueKeys.has(a.key) ? 1 : 0
        const bPinned = pinnedIssueKeys.has(b.key) ? 1 : 0
        return bPinned - aPinned
      })
    }

    return list
  }, [rows, filterTab, searchQuery, activeIssuesMap, pinnedIssueKeys])

  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE) || 1
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredRows.slice(start, start + PAGE_SIZE)
  }, [filteredRows, page])

  const allChecked = rows.length > 0 && rows.every((r) => r.checked)

  const stepIndex = step === 'upload' ? 0 : step === 'review' ? 1 : 2

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Product Catalogue Import — Fast Onboarding"
      className="drawer-import"
      xwide
      footer={
        step === 'upload' ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)', letterSpacing: '0.16px' }}>
              {rows.length > 0 ? `${rows.length.toLocaleString('en-IN')} products ready for review` : 'Upload a spreadsheet to begin'}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="ghost" onClick={onClose}>
                Cancel
              </Btn>
              <Btn
                variant="primary"
                disabled={busy || rows.length === 0}
                onClick={() => void proceedToReview()}
              >
                {busy ? 'Analyzing…' : 'Continue to Review →'}
              </Btn>
            </div>
          </div>
        ) : step === 'review' ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <Btn variant="ghost" disabled={busy} onClick={() => setStep('upload')}>
              ← Back to File Setup
            </Btn>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Btn variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Btn>
              <Btn
                variant="primary"
                disabled={busy || !plan || activeIssuesCount > 0 || readyCount === 0}
                onClick={() => void runCommit()}
              >
                {busy ? 'Importing Products…' : `Complete Import (${readyCount} Products) →`}
              </Btn>
            </div>
          </div>
        ) : step === 'complete' && !busy ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', gap: 8 }}>
            <Btn
              variant="secondary"
              onClick={() => {
                setStep('upload')
                setMatrixData([])
                setRows([])
                setPlan(null)
                setResult(null)
                setFailInfo(null)
              }}
            >
              Import Another File
            </Btn>
            <Btn variant="primary" onClick={onClose}>
              Done / Go to POS
            </Btn>
          </div>
        ) : undefined
      }
    >
      {/* Carbon Flat Progress Stepper */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          borderBottom: '1px solid var(--line)',
          background: 'var(--layer)',
          marginBottom: 20,
        }}
      >
        {IMPORT_STEPS.map((s, idx) => {
          const isActive = stepIndex === idx
          const isDone = stepIndex > idx
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                if (idx === 0 && !busy) setStep('upload')
                else if (idx === 1 && rows.length > 0 && !busy) void proceedToReview()
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '12px 16px',
                border: 'none',
                background: isActive ? 'var(--canvas)' : 'transparent',
                cursor: idx <= stepIndex || (idx === 1 && rows.length > 0) ? 'pointer' : 'default',
                borderBottom: isActive ? '2px solid var(--blue)' : '2px solid transparent',
                textAlign: 'left',
                transition: 'background 120ms ease',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: isActive ? 'var(--blue)' : isDone ? 'var(--ok-fg)' : 'var(--subtle)',
                }}
              >
                {isDone ? '✓ ' : ''}0{idx + 1} / {s.id}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--ink)' : 'var(--muted)',
                  marginTop: 2,
                  letterSpacing: '0.16px',
                }}
              >
                {s.label.replace(/^\d+\.\s*/, '')}
              </span>
            </button>
          )
        })}
      </div>

      {/* ==================== STEP 1: UPLOAD & SETUP ==================== */}
      {step === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Section Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)', margin: 0 }}>
                Upload Retail Catalogue
              </h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '2px 0 0', letterSpacing: '0.16px' }}>
                Import products and inventory from Excel (.xlsx, .xls) or CSV. Typo-tolerant mapping resolves Indian retail column formats.
              </p>
            </div>
            {(!fileName || rows.length === 0) && (
              <Btn variant="tertiary" sm onClick={downloadTemplate}>
                <IconDownload size={13} style={{ marginRight: 6 }} />
                Download Template (.xlsx)
              </Btn>
            )}
          </div>

          {/* Reference Library selector toolbar (before upload) */}
          {(!fileName || rows.length === 0) && libraries.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                padding: '10px 14px',
                background: 'var(--layer)',
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label htmlFor="imp-lib-select" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  Reference Library:
                </label>
                <select
                  id="imp-lib-select"
                  style={{
                    height: 32,
                    padding: '0 10px',
                    background: 'var(--canvas)',
                    border: '1px solid var(--line)',
                    color: 'var(--ink)',
                    fontSize: 13,
                    minWidth: 220,
                    borderRadius: 0,
                  }}
                  value={selectedLibraryKey}
                  onChange={(e) => setSelectedLibraryKey(e.target.value)}
                >
                  {libraries.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.label}
                    </option>
                  ))}
                  <option value="">-- None (Do not match with library) --</option>
                </select>
              </div>
              <span style={{ fontSize: 12, color: 'var(--subtle)' }}>
                {selectedLibraryKey
                  ? 'Auto-resolves brands, units & categories from this library.'
                  : 'Library auto-matching disabled.'}
              </span>
            </div>
          )}

          {/* If NO file selected: Show Dropzone */}
          {(!fileName || rows.length === 0) && (
            <label
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void handleFile(f)
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '36px 24px',
                background: drag ? 'var(--layer-hover)' : 'var(--layer)',
                border: drag ? '1px solid var(--blue)' : '1px dashed var(--line)',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 120ms ease',
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFile(f)
                  e.target.value = ''
                }}
              />
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', letterSpacing: '0.16px' }}>
                Drag and drop your spreadsheet here
              </span>
              <span style={{ fontSize: 13, color: 'var(--subtle)', marginTop: 4, letterSpacing: '0.16px' }}>
                or click to browse (.xlsx, .xls, .csv up to 15 MB)
              </span>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Tag tone="gray">.XLSX</Tag>
                <Tag tone="gray">.XLS</Tag>
                <Tag tone="gray">.CSV</Tag>
              </div>
            </label>
          )}

          {parseErr && (
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--err-bg)',
                borderLeft: '3px solid var(--err)',
                color: 'var(--err-fg)',
                fontSize: 13,
                letterSpacing: '0.16px',
              }}
            >
              <strong>Upload Error:</strong> {parseErr}
            </div>
          )}

          {/* If file is selected: 1-line file bar + compact config */}
          {rows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 1-Line File Summary Bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--layer)',
                  border: '1px solid var(--line)',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', color: 'var(--blue)' }}>
                    <IconSheet size={18} />
                  </span>
                  <strong style={{ fontSize: 13.5, color: 'var(--ink)' }}>{fileName}</strong>
                  <Tag tone="blue">{rows.length.toLocaleString('en-IN')} products detected</Tag>
                  <Tag tone="gray">{Object.keys(foundHeaders).length} columns mapped</Tag>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void handleFile(f)
                      e.target.value = ''
                    }}
                  />
                  <Btn variant="ghost" sm onClick={() => inputRef.current?.click()}>
                    Change File
                  </Btn>
                  <Btn variant="ghost" sm onClick={resetImportState} title="Remove file and start over">
                    <IconTrash size={13} style={{ marginRight: 4 }} />
                    Remove
                  </Btn>
                </div>
              </div>

              {/* Compact Options Box: Mode & Supplier */}
              <div
                style={{
                  padding: 14,
                  background: 'var(--canvas)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* Import Mode Row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    Import Mode:
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="initStockMode"
                      checked={initStock}
                      onChange={() => setInitStock(true)}
                    />
                    <span><strong>Opening Stock</strong> (Initialize inventory from file)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="initStockMode"
                      checked={!initStock}
                      onChange={() => setInitStock(false)}
                    />
                    <span><strong>Catalogue Only</strong> (0 Stock)</span>
                  </label>
                </div>

                {/* Direct Opening Stock & Supplier Row */}
                {initStock && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={directOpeningStock}
                          onChange={(e) => setDirectOpeningStock(e.target.checked)}
                        />
                        <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                          <strong>Direct Opening Stock</strong> &mdash; Pure stock balance without supplier debt or bill
                        </span>
                      </label>
                      {directOpeningStock && (
                        <Tag tone="ok">Pure Inventory Intake</Tag>
                      )}
                    </div>

                    {directOpeningStock ? (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: 'var(--muted)',
                          background: 'var(--layer)',
                          padding: '8px 12px',
                          border: '1px solid var(--line)',
                          borderLeft: '3px solid var(--ok, #24a148)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ color: 'var(--ok-fg)', fontWeight: 600 }}>Zero Supplier Debt:</span>
                        <span>
                          Stock is directly loaded into Godown and Counter with an official opening audit trail. No supplier account is billed, and no Khata liability is created.
                        </span>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <label htmlFor="imp-supplier" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                            Purchase Supplier <span style={{ color: 'var(--err)' }}>*</span>
                          </label>
                          <select
                            id="imp-supplier"
                            style={{
                              height: 32,
                              padding: '0 10px',
                              background: 'var(--layer)',
                              border: '1px solid var(--line)',
                              color: 'var(--ink)',
                              fontSize: 13,
                              minWidth: 240,
                              maxWidth: 380,
                              borderRadius: 0,
                            }}
                            value={supplierId}
                            onChange={(e) => setSupplierId(e.target.value)}
                          >
                            <option value="">-- Choose Supplier --</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} {s.phone ? `(${s.phone})` : ''}
                              </option>
                            ))}
                          </select>
                          <Btn
                            type="button"
                            variant="secondary"
                            sm
                            onClick={() => setShowQuickAdd((prev) => !prev)}
                            title="Quick-add a new supplier"
                          >
                            <IconPlus size={13} style={{ marginRight: 4 }} />
                            New Supplier
                          </Btn>
                          {!supplierId && (
                            <span style={{ fontSize: 12, color: 'var(--err)' }}>
                              Select a supplier to attribute opening stock intake.
                            </span>
                          )}
                        </div>

                        {/* Quick Add Supplier inline fields */}
                        {showQuickAdd && (
                          <div
                            style={{
                              display: 'flex',
                              gap: 8,
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              padding: '8px 12px',
                              background: 'var(--layer)',
                              border: '1px solid var(--line)',
                            }}
                          >
                            <input
                              style={{
                                height: 32,
                                padding: '0 8px',
                                background: 'var(--canvas)',
                                border: '1px solid var(--line)',
                                fontSize: 13,
                                borderRadius: 0,
                                width: 180,
                              }}
                              placeholder="Supplier Name *"
                              value={quickName}
                              onChange={(e) => setQuickName(e.target.value)}
                            />
                            <input
                              style={{
                                height: 32,
                                padding: '0 8px',
                                background: 'var(--canvas)',
                                border: '1px solid var(--line)',
                                fontSize: 13,
                                borderRadius: 0,
                                width: 140,
                              }}
                              placeholder="Phone *"
                              value={quickPhone}
                              onChange={(e) => setQuickPhone(e.target.value)}
                            />
                            <Btn
                              type="button"
                              variant="primary"
                              sm
                              disabled={quickBusy || !quickName.trim() || !quickPhone.trim()}
                              onClick={() => void addQuickSupplier()}
                            >
                              {quickBusy ? 'Saving…' : 'Save Supplier'}
                            </Btn>
                            <Btn
                              type="button"
                              variant="ghost"
                              sm
                              onClick={() => setShowQuickAdd(false)}
                            >
                              Cancel
                            </Btn>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Single Stock Column Destination Router (if applicable) */}
                {hasGenericStockCol && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--line)', fontSize: 12.5 }}>
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                      Single Stock Column (&ldquo;{genericStockColName}&rdquo;):
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="stockDest"
                        checked={stockDestination === 'counter'}
                        onChange={() => handleStockDestChange('counter')}
                      />
                      <span><strong>Counter Stock</strong> (POS checkout shelf)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="stockDest"
                        checked={stockDestination === 'godown'}
                        onChange={() => handleStockDestChange('godown')}
                      />
                      <span><strong>Godown Stock</strong> (Bulk storage warehouse)</span>
                    </label>
                  </div>
                )}

                {/* Reference Library Selection Row */}
                {libraries.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                    <label htmlFor="imp-lib-select-cfg" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                      Reference Library:
                    </label>
                    <select
                      id="imp-lib-select-cfg"
                      style={{
                        height: 32,
                        padding: '0 10px',
                        background: 'var(--layer)',
                        border: '1px solid var(--line)',
                        color: 'var(--ink)',
                        fontSize: 13,
                        minWidth: 240,
                        maxWidth: 380,
                        borderRadius: 0,
                      }}
                      value={selectedLibraryKey}
                      onChange={(e) => setSelectedLibraryKey(e.target.value)}
                    >
                      {libraries.map((l) => (
                        <option key={l.key} value={l.key}>
                          {l.label}
                        </option>
                      ))}
                      <option value="">-- None (Do not match with library) --</option>
                    </select>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {selectedLibraryKey
                        ? 'Auto-resolves brands, units & categories from this library.'
                        : 'Library auto-matching disabled.'}
                    </span>
                  </div>
                )}
              </div>

              {/* Resolved Schema Tag Pills */}
              <div
                style={{
                  padding: '10px 14px',
                  background: 'var(--layer)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--subtle)' }}>
                  Resolved Columns ({Object.keys(foundHeaders).length})
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(foundHeaders).map(([field, rawName]) => (
                    <Tag key={field} tone="blue">
                      ✓ {rawName} &rarr; <strong>{field}</strong>
                    </Tag>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Reference Info when no file is chosen yet */}
          {rows.length === 0 && (
            <div
              style={{
                padding: 14,
                background: 'var(--canvas)',
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.16px' }}>
                  Supported Columns & Spreadsheet Format
                </span>
                <p style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 2, letterSpacing: '0.32px' }}>
                  The importer tolerates typos, common abbreviations, and standard distributor Excel exports.
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 8,
                  marginTop: 12,
                }}
              >
                {[
                  { name: 'Product Name / Title', req: true },
                  { name: 'MRP (Printed Price)', req: true },
                  { name: 'Unit (e.g. 750 ML, PCS, KG)', req: true },
                  { name: 'Brand', req: false },
                  { name: 'Flavour / Variant', req: false },
                  { name: 'Barcode / EAN / Code', req: false },
                  { name: 'Category / Group', req: false },
                  { name: 'Sales Rate / Selling Price', req: false },
                  { name: 'Pieces Per Box', req: false },
                  { name: 'Low Stock Level', req: false },
                ].map((c) => (
                  <div
                    key={c.name}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 10px',
                      background: 'var(--layer)',
                      border: '1px solid var(--line)',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: 'var(--ink)' }}>{c.name}</span>
                    <Tag tone={c.req ? 'blue' : 'gray'}>{c.req ? 'Required' : 'Optional'}</Tag>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== STEP 2: REVIEW & VERIFY ==================== */}
      {step === 'review' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Carbon KPI Summary Tiles */}
          {plan && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 1,
                background: 'var(--line)',
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)', letterSpacing: '0.32px' }}>
                  Total in File
                </span>
                <span style={{ display: 'block', fontSize: 20, fontWeight: 300, color: 'var(--ink)', marginTop: 2 }}>
                  {plan.summary.rows_total.toLocaleString('en-IN')}
                </span>
              </div>
              <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)', letterSpacing: '0.32px' }}>
                  Ready to Import
                </span>
                <span style={{ display: 'block', fontSize: 20, fontWeight: 300, color: 'var(--ok-fg)', marginTop: 2 }}>
                  {readyCount.toLocaleString('en-IN')}
                </span>
              </div>
              <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)', letterSpacing: '0.32px' }}>
                  Issues Flagged
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 20,
                    fontWeight: 300,
                    color: activeIssuesCount > 0 ? 'var(--err)' : 'var(--subtle)',
                    marginTop: 2,
                  }}
                >
                  {activeIssuesCount}
                </span>
              </div>
              {plan.summary.initialize_stock && (
                <>
                  <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)', letterSpacing: '0.32px' }}>
                      Opening Stock Qty
                    </span>
                    <span style={{ display: 'block', fontSize: 20, fontWeight: 300, color: 'var(--ink)', marginTop: 2 }}>
                      {plan.summary.opening_qty.toLocaleString('en-IN')} pcs
                    </span>
                  </div>
                  <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)', letterSpacing: '0.32px' }}>
                      {plan.summary.direct_opening_stock ? 'Opening Stock Valuation' : 'Simulated Purchase Bill'}
                    </span>
                    <span style={{ display: 'block', fontSize: 20, fontWeight: 300, color: 'var(--blue)', marginTop: 2 }}>
                      ₹{Number(plan.summary.bill_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Issue Banner with 1-Click Exclude */}
          {activeIssuesCount > 0 ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                padding: '10px 16px',
                background: 'var(--warn-bg)',
                borderLeft: '4px solid var(--err, #da1e28)',
                color: 'var(--warn-fg)',
              }}
            >
              <div>
                <strong style={{ fontSize: 13 }}>{activeIssuesCount} issue(s) detected:</strong>
                <span style={{ fontSize: 13, marginLeft: 6, letterSpacing: '0.16px' }}>
                  Issues are sorted to the top. Edit them directly in the table or exclude invalid rows.
                </span>
              </div>
              <Btn variant="secondary" sm onClick={excludeAllErrors}>
                Exclude All {activeIssuesCount} Invalid
              </Btn>
            </div>
          ) : plan && plan.blocking_errors.length > 0 ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                padding: '10px 16px',
                background: 'rgba(36, 161, 72, 0.08)',
                borderLeft: '4px solid var(--ok, #24a148)',
                color: 'var(--ok-fg, #24a148)',
              }}
            >
              <div>
                <strong style={{ fontSize: 13 }}>All issues resolved:</strong>
                <span style={{ fontSize: 13, marginLeft: 6, letterSpacing: '0.16px' }}>
                  Your inline changes corrected all invalid rows. Save changes or proceed with import.
                </span>
              </div>
              {hasUnsavedChanges && (
                <Btn variant="primary" sm disabled={busy} onClick={() => void saveAndReSimulate()}>
                  Save & Verify Changes
                </Btn>
              )}
            </div>
          ) : null}

          {/* Table Controls Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
              padding: '8px 12px',
              background: 'var(--layer)',
              border: '1px solid var(--line)',
            }}
          >
            {/* Filter Tabs */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: 'all', label: `All (${rows.length})` },
                { id: 'ready', label: `Ready (${readyCount})` },
                ...(activeIssuesCount > 0 || pinnedIssueKeys.size > 0
                  ? [{ id: 'issues', label: `Issues (${activeIssuesCount})`, isErr: activeIssuesCount > 0 }]
                  : []),
                ...(autoEditedRows.length > 0
                  ? [{ id: 'auto_edited', label: `Auto-Edited (${autoEditedRows.length})`, isBlue: true }]
                  : []),
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setFilterTab(t.id as any); setPage(1); }}
                  style={{
                    height: 32,
                    padding: '0 12px',
                    border: 'none',
                    background: filterTab === t.id ? 'var(--canvas)' : 'transparent',
                    color: t.isErr && filterTab !== t.id
                      ? 'var(--err, #da1e28)'
                      : t.isBlue && filterTab !== t.id
                      ? 'var(--blue, #0f62fe)'
                      : filterTab === t.id
                      ? 'var(--ink)'
                      : 'var(--muted)',
                    fontWeight: filterTab === t.id ? 600 : 500,
                    fontSize: 12,
                    cursor: 'pointer',
                    borderRadius: 0,
                    borderBottom: filterTab === t.id
                      ? t.isErr
                        ? '2px solid var(--err, #da1e28)'
                        : '2px solid var(--blue, #0f62fe)'
                      : '2px solid transparent',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Search & Actions */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                style={{
                  height: 32,
                  width: 200,
                  padding: '0 10px',
                  background: 'var(--canvas)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)',
                  fontSize: 12,
                  borderRadius: 0,
                }}
                placeholder="Search products in file…"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              />
              {hasUnsavedChanges && (
                <Btn variant="primary" sm disabled={busy} onClick={() => void saveAndReSimulate()}>
                  Save Changes
                </Btn>
              )}
              <Btn variant="ghost" sm disabled={busy} onClick={() => void saveAndReSimulate()}>
                Re-simulate
              </Btn>
            </div>
          </div>

          {/* Sub-bar for Auto-Edited tab */}
          {filterTab === 'auto_edited' && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                background: 'var(--layer)',
                border: '1px solid var(--line)',
                fontSize: 12,
              }}
            >
              <span style={{ color: 'var(--ink)' }}>
                Showing <strong>{autoEditedRows.length}</strong> product(s) with brands auto-filled from reference library. You can edit any brand or revert.
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="ghost" sm onClick={revertAllAutoEdits}>
                  Revert All Brands
                </Btn>
                {hasUnsavedChanges && (
                  <Btn variant="primary" sm disabled={busy} onClick={() => void saveAndReSimulate()}>
                    Save Changes
                  </Btn>
                )}
              </div>
            </div>
          )}

          {/* High-density Carbon Table */}
          <div
            className="tbl-scroll"
            style={{
              maxHeight: 'calc(100vh - 360px)',
              minHeight: '440px',
              border: '1px solid var(--line)',
              background: 'var(--canvas)',
              overflowX: 'auto',
            }}
          >
            <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--layer)', zIndex: 10 }}>
                <tr>
                  <th style={{ width: 36, textAlign: 'center', padding: '8px 4px' }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => toggleAll(e.target.checked)}
                      title="Toggle select all"
                    />
                  </th>
                  <th style={{ width: 40, padding: '8px 4px', fontSize: 11, color: 'var(--subtle)' }}>#</th>
                  <th style={{ padding: '8px 8px', minWidth: 180 }}>Product Name *</th>
                  <th style={{ padding: '8px 8px', width: 140 }}>Brand</th>
                  <th style={{ padding: '8px 8px', width: 130 }}>Flavour / Variant</th>
                  <th style={{ padding: '8px 8px', width: 130 }}>Barcode</th>
                  <th style={{ padding: '8px 8px', width: 85 }}>Unit *</th>
                  <th style={{ padding: '8px 8px', width: 100, textAlign: 'right' }}>Cost / Rate (₹)</th>
                  <th style={{ padding: '8px 8px', width: 95, textAlign: 'right' }}>MRP (₹) *</th>
                  <th style={{ padding: '8px 8px', width: 75, textAlign: 'right' }}>Counter</th>
                  <th style={{ padding: '8px 8px', width: 75, textAlign: 'right' }}>Godown</th>
                  <th style={{ padding: '8px 8px', width: 110 }}>Category</th>
                  <th style={{ padding: '8px 8px', width: 105 }}>Status</th>
                  <th style={{ width: 36, textAlign: 'center' }} />
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((r, idx) => {
                  const issue = activeIssuesMap.get(r.key)
                  const hasErr = !!issue
                  const wasPinnedAsIssue = pinnedIssueKeys.has(r.key)
                  const wasAutoEdited = !!r.autoEdited
                  return (
                    <tr
                      key={r.key}
                      style={{
                        background: !r.checked
                          ? 'var(--layer)'
                          : hasErr
                          ? 'rgba(218, 30, 40, 0.05)'
                          : wasPinnedAsIssue
                          ? 'rgba(15, 98, 254, 0.04)'
                          : undefined,
                        borderBottom: '1px solid var(--line)',
                        borderLeft: hasErr
                          ? '4px solid var(--err)'
                          : wasPinnedAsIssue
                          ? '4px solid var(--blue)'
                          : '4px solid transparent',
                      }}
                    >
                      <td style={{ textAlign: 'center', padding: '6px 4px' }}>
                        <input
                          type="checkbox"
                          checked={r.checked}
                          onChange={(e) => update(r.key, { checked: e.target.checked })}
                        />
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--subtle)', padding: '6px 4px', fontVariantNumeric: 'tabular-nums' }}>
                        {(page - 1) * PAGE_SIZE + idx + 1}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input
                          style={{
                            width: '100%',
                            height: 28,
                            padding: '0 6px',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: 13,
                            color: 'var(--ink)',
                            borderRadius: 0,
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                          onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                          value={r.name}
                          onChange={(e) => update(r.key, { name: e.target.value })}
                          placeholder="Product Name"
                        />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            style={{
                              width: '100%',
                              height: 28,
                              padding: '0 6px',
                              background: 'transparent',
                              border: '1px solid transparent',
                              fontSize: 12,
                              color: 'var(--ink)',
                              borderRadius: 0,
                            }}
                            onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                            onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                            value={r.brand}
                            onChange={(e) => update(r.key, { brand: e.target.value })}
                            placeholder="Brand"
                          />
                          {r.autoEdited && (
                            <button
                              type="button"
                              onClick={() => revertAutoEdit(r.key)}
                              title={`Auto-resolved from library. Click to revert.`}
                              style={{
                                background: 'transparent',
                                border: '1px solid var(--line)',
                                borderRadius: 0,
                                fontSize: 10,
                                padding: '1px 5px',
                                color: 'var(--blue)',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Revert
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input
                          style={{
                            width: '100%',
                            height: 28,
                            padding: '0 6px',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: 12,
                            color: 'var(--ink)',
                            borderRadius: 0,
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                          onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                          value={r.flavour || ''}
                          onChange={(e) => update(r.key, { flavour: e.target.value })}
                          placeholder="Flavour / Variant"
                        />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input
                          style={{
                            width: '100%',
                            height: 28,
                            padding: '0 6px',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: 12,
                            color: 'var(--ink)',
                            borderRadius: 0,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                          onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                          value={r.barcode}
                          onChange={(e) => update(r.key, { barcode: e.target.value })}
                          placeholder="Barcode"
                        />
                      </td>
                      <td style={{ padding: '6px 10px', width: 90 }}>
                        <input
                          style={{
                            width: '100%',
                            height: 28,
                            padding: '0 6px',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: 12,
                            color: 'var(--ink)',
                            borderRadius: 0,
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                          onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                          value={r.unit}
                          onChange={(e) => update(r.key, { unit: e.target.value.toUpperCase() })}
                          placeholder="Unit *"
                        />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <NumInput
                          style={{
                            width: '100%',
                            height: 28,
                            textAlign: 'right',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: 12,
                            color: 'var(--ink)',
                            borderRadius: 0,
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                          onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                          min="0"
                          step="0.01"
                          value={r.rate}
                          onChange={(n) => update(r.key, { rate: n })}
                        />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <NumInput
                          style={{
                            width: '100%',
                            height: 28,
                            textAlign: 'right',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: 12,
                            color: 'var(--ink)',
                            borderRadius: 0,
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                          onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                          min="0"
                          step="0.01"
                          value={r.mrp}
                          onChange={(n) => update(r.key, { mrp: n })}
                        />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <input
                          style={{
                            width: '100%',
                            height: 28,
                            textAlign: 'right',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: 12,
                            color: 'var(--ink)',
                            borderRadius: 0,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                          onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                          value={String(r.counter)}
                          onChange={(e) => update(r.key, { counter: e.target.value })}
                          placeholder="0"
                        />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <input
                          style={{
                            width: '100%',
                            height: 28,
                            textAlign: 'right',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: 12,
                            color: 'var(--ink)',
                            borderRadius: 0,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                          onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                          value={String(r.godown)}
                          onChange={(e) => update(r.key, { godown: e.target.value })}
                          placeholder="0"
                        />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input
                          style={{
                            width: '100%',
                            height: 28,
                            padding: '0 6px',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: 12,
                            color: 'var(--ink)',
                            borderRadius: 0,
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--blue)')}
                          onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                          value={r.category}
                          onChange={(e) => update(r.key, { category: e.target.value.toUpperCase() })}
                          placeholder="General"
                        />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        {hasErr ? (
                          <Tag tone="err">
                            {issue.code.replace(/_/g, ' ')}
                          </Tag>
                        ) : wasPinnedAsIssue ? (
                          <Tag tone="blue">Fixed</Tag>
                        ) : wasAutoEdited ? (
                          <Tag tone="blue">Auto-Edited</Tag>
                        ) : r.checked ? (
                          <Tag tone="ok">Ready</Tag>
                        ) : (
                          <Tag tone="gray">Excluded</Tag>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', padding: '6px 4px' }}>
                        <button
                          type="button"
                          onClick={() => removeRow(r.key)}
                          title="Remove row from import"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--subtle)',
                            padding: 4,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--err)')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--subtle)')}
                        >
                          <IconTrash size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Table Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
              <span>
                Showing {(page - 1) * PAGE_SIZE + 1} &ndash;{' '}
                {Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length} rows
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn variant="ghost" sm disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Btn>
                <span style={{ padding: '4px 8px', alignSelf: 'center', color: 'var(--ink)' }}>
                  Page {page} of {totalPages}
                </span>
                <Btn variant="ghost" sm disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== STEP 3: COMPLETED ==================== */}
      {step === 'complete' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {result ? (
            <div
              style={{
                padding: 24,
                background: 'var(--canvas)',
                border: '1px solid var(--line)',
                borderLeft: '4px solid var(--ok)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: 'var(--ok-bg)',
                    color: 'var(--ok-fg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                  }}
                >
                  ✓
                </div>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)', margin: 0 }}>
                    Product Catalogue Import Successful
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2, letterSpacing: '0.16px' }}>
                    All products and initial stock reconciliations have been committed.
                  </p>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 1,
                  background: 'var(--line)',
                  border: '1px solid var(--line)',
                  marginTop: 20,
                }}
              >
                <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)' }}>New Products Created</span>
                  <span style={{ display: 'block', fontSize: 22, fontWeight: 300, color: 'var(--ink)', marginTop: 2 }}>
                    {result.products_created}
                  </span>
                </div>
                <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)' }}>Existing Matched</span>
                  <span style={{ display: 'block', fontSize: 22, fontWeight: 300, color: 'var(--ink)', marginTop: 2 }}>
                    {result.products_matched}
                  </span>
                </div>
                {result.bill_no ? (
                  <>
                    <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)' }}>
                        {result.direct_opening_stock ? 'Opening Stock Ref #' : 'Purchase Bill #'}
                      </span>
                      <span style={{ display: 'block', fontSize: 18, fontWeight: 600, color: 'var(--blue)', marginTop: 4 }}>
                        {result.bill_no}
                      </span>
                    </div>
                    <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)' }}>
                        {result.direct_opening_stock ? 'Opening Stock Valuation' : 'Total Bill Amount'}
                      </span>
                      <span style={{ display: 'block', fontSize: 22, fontWeight: 300, color: 'var(--ink)', marginTop: 2 }}>
                        ₹{Number(result.bill_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '12px 16px', background: 'var(--canvas)' }}>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--subtle)' }}>Opening Stock Mode</span>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--muted)', marginTop: 6 }}>
                      0 Stock (Catalogue Only)
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : failInfo ? (
            <div
              style={{
                padding: 24,
                background: 'var(--canvas)',
                border: '1px solid var(--line)',
                borderLeft: '4px solid var(--err)',
              }}
            >
              <h3 style={{ fontSize: 18, fontWeight: 400, color: 'var(--err)', margin: 0 }}>
                Import Transaction Rolled Back
              </h3>
              <p style={{ fontSize: 14, color: 'var(--ink)', marginTop: 6 }}>{failInfo.message}</p>

              {failInfo.issues.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Detailed Issues:</span>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13, color: 'var(--muted)' }}>
                    {failInfo.issues.map((iss, i) => (
                      <li key={i}>{iss.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  )
}
