import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import type { PProduct } from '@/lib/repo'
import { downloadCsv, money, num0, unitMl } from '@/lib/utils'
import { searchGeneric } from '@/lib/search'
import {
  NoAccess,
  Btn,
  EmptyState,
  Panel,
  Tag,
} from '@/components/ui'
import {
  IconHistory,
  IconLowStock,
  IconSheet,
  IconTransfer,
  IconAlertTriangle,
  IconArrowRight,
  IconPin,
  IconPinFilled,
} from '@/components/icons'
import { RegisterGrid, type GridColumn, type NestedHeader } from '@/components/grid/RegisterGrid'
import { StockTransferDrawer, StockMovementHistory } from '@/components/stock'
import { getCapabilitySettings, SURFACE_SHEET } from '@/lib/experience'
import { useNavigate } from 'react-router-dom'
import { usePinnedSorting, sortWithPinned } from '@/lib/pinnedSorting'
import { CompactSortHeader, PinManagementModal } from '@/components/CompactSortHeader'
import '@/styles/sheet-register.css'

interface RegisterDef {
  key: string
  label: string
  sizes_ml: number[]
}

const OTHER_REG_KEY = '__other__'
const PCS_SIZE_KEY = 0
const KITCHEN_REG_KEY = 'kitchen'

const DEFAULT_REGISTERS: RegisterDef[] = [
  { key: 'liquor', label: 'Liquor', sizes_ml: [90, 180, 375, 750] },
  { key: 'beer', label: 'Beer', sizes_ml: [330, 500, 650] },
]

/** Kitchen is a real register here too, not a filter: it has no bottle-size
 *  columns (a kitchen item is a dish or an ingredient measured in pieces) and
 *  it only ever appears when the shop has the Kitchen feature on. */
const KITCHEN_REGISTER: RegisterDef = { key: KITCHEN_REG_KEY, label: 'Kitchen', sizes_ml: [] }

/** Whether a product's category belongs to a given register key — the same
 *  heuristic used to build the active register's row set, factored out so
 *  every register tab can show a live pcs badge, not just the active one. */
function productMatchesRegister(category: string | undefined, regKey: string): boolean {
  const cat = (category || '').toLowerCase()
  const key = regKey.toLowerCase()
  if (key === 'liquor') {
    return (
      cat.includes('liquor') ||
      cat.includes('spirits') ||
      cat.includes('whisky') ||
      cat.includes('rum') ||
      cat.includes('vodka') ||
      cat.includes('gin') ||
      cat.includes('brandy') ||
      cat === 'imfl' ||
      cat === 'cl' ||
      (!cat.includes('beer') && !cat.includes('food') && !cat.includes('other'))
    )
  }
  if (key === 'beer') {
    return cat.includes('beer') || cat.includes('wine') || cat.includes('cider')
  }
  return cat.includes(key)
}

interface BrandSizeCell {
  godown: number
  counter: number
  total: number
  product?: PProduct
}

interface BrandRow {
  brand: string
  hasExplicitBrand: boolean
  isChild?: boolean
  flavours?: BrandRow[]
  sizes: Record<number, BrandSizeCell>
  totalGodown: number
  totalCounter: number
  totalPcs: number
  totalValuation: number
  hasLowStock: boolean
  products: PProduct[]
}

const sizeLabel = (size: number): string => (size === PCS_SIZE_KEY ? 'PCS' : `${size}ml`)

const sizeDisplayLabel = (size: number): string => {
  if (size === PCS_SIZE_KEY) return 'PCS'
  if (size === 90) return '90 ML'
  if (size === 180) return '180 ML (Nip)'
  if (size === 375) return '375 ML (Half)'
  if (size === 750) return '750 ML (Full)'
  if (size === 330) return '330 ML (Pint)'
  if (size === 500) return '500 ML (Can)'
  if (size === 650) return '650 ML (Bottle)'
  if (size === 1000) return '1000 ML (1 L)'
  return `${size} ML`
}

function aggregateBrand(products: PProduct[], sizeKeyOf: (product: PProduct) => number | null, brand: string): BrandRow {
  const sizes: Record<number, BrandSizeCell> = {}
  let totalGodown = 0
  let totalCounter = 0
  let totalValuation = 0
  let hasLowStock = false

  for (const p of products) {
    const sizeKey = sizeKeyOf(p)
    const godown = p.godownPcs
    const counter = p.counterPcs
    const tot = godown + counter
    totalGodown += godown
    totalCounter += counter
    totalValuation += tot * p.mrp
    if (tot <= p.lowLevel) hasLowStock = true
    if (sizeKey !== null) sizes[sizeKey] = { godown, counter, total: tot, product: p }
  }

  return {
    brand,
    hasExplicitBrand: true,
    sizes,
    totalGodown,
    totalCounter,
    totalPcs: totalGodown + totalCounter,
    totalValuation,
    hasLowStock,
    products,
  }
}

/**
 * Group products by their explicit Parent master (falls back to brand, then
 * name). Within a parent, products split into flavour children — the parent
 * row aggregates every flavour so totals count a brand exactly once.
 */
function groupBrandRows(products: PProduct[], sizeKeyOf: (product: PProduct) => number | null): BrandRow[] {
  const map = new Map<string, PProduct[]>()

  for (const p of products) {
    const key = (p.parentName && p.parentName.trim()) || (p.brand && p.brand.trim()) || p.name.trim()
    const bucket = map.get(key)
    if (bucket) bucket.push(p)
    else map.set(key, [p])
  }

  const rows: BrandRow[] = []
  for (const [key, prods] of map.entries()) {
    const parent = aggregateBrand(prods, sizeKeyOf, key)
    const flavourMap = new Map<string, PProduct[]>()
    const unflavoured: PProduct[] = []
    for (const p of prods) {
      const f = (p.flavour || '').trim()
      if (!f) {
        unflavoured.push(p)
      } else {
        const bucket = flavourMap.get(f)
        if (bucket) bucket.push(p)
        else flavourMap.set(f, [p])
      }
    }
    if (flavourMap.size > 0) {
      const variantList: BrandRow[] = []
      if (unflavoured.length > 0) {
        variantList.push({ ...aggregateBrand(unflavoured, sizeKeyOf, `${key} (Base)`), isChild: true })
      }
      for (const [f, ps] of flavourMap.entries()) {
        variantList.push({ ...aggregateBrand(ps, sizeKeyOf, f), isChild: true })
      }
      parent.flavours = variantList.sort((a, b) => a.brand.localeCompare(b.brand))
    }
    rows.push(parent)
  }

  return rows.sort((a, b) => a.brand.localeCompare(b.brand))
}

function filterBrandRows(rows: BrandRow[], lowOnly: boolean, search: string, categoryFilter?: string): BrandRow[] {
  let list = rows
  if (categoryFilter && categoryFilter !== 'All') {
    const catLower = categoryFilter.toLowerCase()
    list = list.filter((r) => r.products.some((p) => (p.category || '').toLowerCase() === catLower))
  }
  if (lowOnly) {
    list = list.filter((r) => r.hasLowStock)
  }
  const q = search.trim()
  if (q) {
    list = searchGeneric(list, q, [
      { get: (r) => r.brand, weight: 3.0 },
      { get: (r) => r.products.map((p) => p.name).join(' '), weight: 1.5 },
      { get: (r) => r.products.map((p) => p.code).join(' '), weight: 2.0, isCode: true },
    ])
  }
  return list
}

type StockTone = 'ok' | 'warn' | 'err'

function stockTone(row: BrandRow): StockTone {
  if (row.totalPcs === 0) return 'err'
  if (row.hasLowStock) return 'warn'
  return 'ok'
}

function renderStockVariantDrawer(row: BrandRow, displaySizes: number[], seesValuation: boolean) {
  const flavours: BrandRow[] = row.flavours || []
  if (!flavours.length) return null

  // Filter displaySizes to ONLY sizes that exist in at least one flavour of this brand
  const relevantSizes = displaySizes.filter((s) =>
    flavours.some((f) => f.sizes && f.sizes[s] !== undefined)
  )
  const drawerSizes = relevantSizes.length > 0 ? relevantSizes : displaySizes

  return (
    <div className="rg-drawer-wrapper">
      <div className="rg-drawer-header">
        <div className="rg-drawer-header-left">
          <span className="rg-drawer-icon">✦</span>
          <span className="rg-drawer-title">VARIANTS / FLAVOURS — {row.brand}</span>
          <span className="rg-drawer-note">Variant on-hand counts; rolled up into the brand row above</span>
        </div>
        <div className="rg-drawer-header-right">
          <span>{flavours.length} variants</span>
        </div>
      </div>
      <div className="rg-drawer-table-wrap">
        <table className="rg-subtable">
          <thead>
            <tr>
              <th style={{ width: 180, minWidth: 160, textAlign: 'left' }}>VARIANT / FLAVOUR</th>
              {drawerSizes.map((s) => (
                <th key={s} colSpan={3} className="rg-center">
                  {sizeDisplayLabel(s)}
                </th>
              ))}
              <th colSpan={seesValuation ? 4 : 3} className="rg-center">
                TOTAL STOCK
              </th>
            </tr>
            <tr>
              <th></th>
              {drawerSizes.map((s) => (
                <Fragment key={s}>
                  <th className="num" style={{ width: 48, minWidth: 44 }}>GOD</th>
                  <th className="num" style={{ width: 48, minWidth: 44 }}>CNT</th>
                  <th className="num" style={{ width: 52, minWidth: 46 }}>TOT</th>
                </Fragment>
              ))}
              <th className="num" style={{ width: 56, minWidth: 48 }}>GOD</th>
              <th className="num" style={{ width: 56, minWidth: 48 }}>CNT</th>
              <th className="num" style={{ width: 64, minWidth: 54 }}>TOT</th>
              {seesValuation && <th className="num" style={{ width: 96, minWidth: 84 }}>VALUE</th>}
            </tr>
          </thead>
          <tbody>
            {flavours.map((f, idx) => (
              <tr key={f.brand || idx}>
                <td style={{ width: 180, minWidth: 160 }}>
                  <span className="rg-variant-title">{f.brand}</span>
                </td>
                {drawerSizes.map((s) => {
                  const c = f.sizes[s]
                  return (
                    <Fragment key={s}>
                      <td className="num">{c ? c.godown : '—'}</td>
                      <td className="num">{c ? c.counter : '—'}</td>
                      <td className="num"><strong>{c ? c.total : '—'}</strong></td>
                    </Fragment>
                  )
                })}
                <td className="num">{f.totalGodown}</td>
                <td className="num">{f.totalCounter}</td>
                <td className="num"><strong>{f.totalPcs}</strong></td>
                {seesValuation && <td className="num"><strong>{money(f.totalValuation)}</strong></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function WineStockPage() {
  const { activeShop, seesValuation, featureOn } = useAuth()
  const d = useData()
  const navigate = useNavigate()
  const shopId = activeShop?.id ?? ''

  const [mode, setMode] = useState<'matrix' | 'history'>('matrix')
  const [activeRegKey, setActiveRegKey] = useState<string>('liquor')
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [sizeFilter, setSizeFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [transferOpen, setTransferOpen] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | undefined>()
  const [expandedFlavours, setExpandedFlavours] = useState<Record<string, boolean>>({})
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const toggleFlavours = useCallback((brand: string) => {
    setExpandedFlavours((prev) => ({ ...prev, [brand]: !prev[brand] }))
  }, [])

  // Aggregate the app-wide ordering signal (rolling 4-business-day sold
  // quantity, including today — docs/CONVENTIONS.md §3.3) by brand, together
  // with the most recent sale so ties break the same way everywhere.
  const soldQtyByBrand = useMemo(() => {
    const map = new Map<string, { sold: number; last: number }>()
    for (const p of d.products) {
      const b = (p.parentName && p.parentName.trim()) || (p.brand && p.brand.trim()) || p.name.trim()
      const prev = map.get(b) || { sold: 0, last: 0 }
      const last = Date.parse(p.orderLastSoldAt || '') || 0
      map.set(b, {
        sold: prev.sold + (p.sold4d || 0),
        last: Math.max(prev.last, last),
      })
    }
    return map
  }, [d.products])

  // Persistent sorting & pinning for wine stock brands
  const {
    sortMode,
    toggleSortMode,
    pinnedKeys,
    pinnedSet,
    pinItem,
    unpinItem,
    movePinnedItem,
  } = usePinnedSorting('wine_stock_brands', 'most-sold')

  // Responsiveness: check window width for mobile card layout
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 672)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 672)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Resolve shop registers from experience settings or fall back to defaults
  const registers = useMemo<RegisterDef[]>(() => {
    const expSettings = getCapabilitySettings<{ registers?: RegisterDef[] }>(activeShop?.experience, SURFACE_SHEET)
    if (expSettings?.registers && Array.isArray(expSettings.registers) && expSettings.registers.length > 0) {
      return expSettings.registers.map((r) => ({
        key: r.key,
        label: r.label || r.key,
        sizes_ml: [...(r.sizes_ml || [])].sort((a, b) => a - b),
      }))
    }
    return DEFAULT_REGISTERS
  }, [activeShop])

  // Active register sizes
  const isOtherTab = activeRegKey === OTHER_REG_KEY
  const isKitchenTab = activeRegKey === KITCHEN_REG_KEY
  const activeRegister = registers.find((r) => r.key === activeRegKey) ?? registers[0]
  const configuredSizes = activeRegister?.sizes_ml ?? DEFAULT_REGISTERS[0].sizes_ml

  // Kitchen is a first-class stock view, gated on the shop's Kitchen feature.
  // Kitchen products never mix into a retail register: they are held out of
  // `stockProducts` and shown on their own register tab, under the same
  // ordering and pinning standard.
  const kitchenEnabled = featureOn('kitchen')
  const visibleRegisters = useMemo(
    () => (kitchenEnabled ? [...registers, KITCHEN_REGISTER] : registers),
    [registers, kitchenEnabled],
  )
  useEffect(() => { if (!kitchenEnabled && isKitchenTab) setActiveRegKey(registers[0]?.key || 'liquor') },
    [kitchenEnabled, isKitchenTab, registers])

  // Retail products only; kitchen is handled by its own register above.
  const stockProducts = useMemo(() => d.products.filter((p) => !p.isKitchen), [d.products])
  const kitchenProducts = useMemo(() => d.products.filter((p) => p.isKitchen), [d.products])
  // One product list per tab: the Kitchen tab reads kitchen products, every
  // retail tab reads retail products, and nothing else can cross over.
  const tabProducts = isKitchenTab ? kitchenProducts : stockProducts

  // Count unbranded products
  const unbrandedProducts = useMemo(
    () => stockProducts.filter((p) => !p.brand || !p.brand.trim()),
    [stockProducts]
  )

  // Products belonging to the active register
  const registerProducts = useMemo(() => {
    if (!activeRegister) return tabProducts
    if (isKitchenTab) return tabProducts
    return tabProducts.filter((p) => productMatchesRegister(p.category, activeRegister.key))
  }, [tabProducts, activeRegister, isKitchenTab])

  // Every size covered by the configured register stacks
  const stackSizes = useMemo(() => {
    const set = new Set<number>()
    for (const r of registers) {
      for (const size of r.sizes_ml) set.add(size)
    }
    return set
  }, [registers])

  // Catch-all products whose size is outside every register stack
  const otherProducts = useMemo(
    () =>
      stockProducts.filter((p) => {
        const ml = unitMl(p.unit)
        return isNaN(ml) || !stackSizes.has(ml)
      }),
    [stockProducts, stackSizes]
  )

  // Live pcs badge per register tab (all registers, including Others).
  const registerPcsTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const r of registers) totals[r.key] = 0
    totals[OTHER_REG_KEY] = 0
    if (kitchenEnabled) {
      totals[KITCHEN_REG_KEY] = kitchenProducts.reduce((n, p) => n + p.godownPcs + p.counterPcs, 0)
    }
    for (const p of stockProducts) {
      const pcs = p.godownPcs + p.counterPcs
      let matched = false
      for (const r of registers) {
        if (productMatchesRegister(p.category, r.key)) {
          totals[r.key] += pcs
          matched = true
        }
      }
      const ml = unitMl(p.unit)
      if (!matched || isNaN(ml) || !stackSizes.has(ml)) {
        totals[OTHER_REG_KEY] += pcs
      }
    }
    return totals
  }, [stockProducts, registers, stackSizes])

  // Group register products by Brand
  const brandRows = useMemo<BrandRow[]>(
    () =>
      groupBrandRows(registerProducts, (p) => {
        const ml = unitMl(p.unit)
        return !isNaN(ml) && ml > 0 && configuredSizes.includes(ml) ? ml : null
      }),
    [registerProducts, configuredSizes]
  )

  const otherBrandRows = useMemo<BrandRow[]>(
    () =>
      groupBrandRows(otherProducts, (p) => {
        const ml = unitMl(p.unit)
        return isNaN(ml) || ml <= 0 ? PCS_SIZE_KEY : ml
      }),
    [otherProducts]
  )

  const otherSizeKeys = useMemo<number[]>(() => {
    const numeric = new Set<number>()
    let hasPcs = false
    for (const p of otherProducts) {
      const ml = unitMl(p.unit)
      if (isNaN(ml) || ml <= 0) hasPcs = true
      else numeric.add(ml)
    }
    const keys = [...numeric].sort((a, b) => a - b)
    if (hasPcs) keys.push(PCS_SIZE_KEY)
    return keys
  }, [otherProducts])

  // Category options for the active register
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>()
    const prods = isOtherTab ? otherProducts : registerProducts
    for (const p of prods) {
      if (p.category && p.category.trim()) cats.add(p.category.trim())
    }
    return ['All', ...[...cats].sort((a, b) => a.localeCompare(b))]
  }, [isOtherTab, otherProducts, registerProducts])

  // Filter by search, lowOnly & category
  const filteredRows = useMemo(
    () => filterBrandRows(brandRows, lowOnly, search, categoryFilter),
    [brandRows, lowOnly, search, categoryFilter]
  )
  const otherFilteredRows = useMemo(
    () => filterBrandRows(otherBrandRows, lowOnly, search, categoryFilter),
    [otherBrandRows, lowOnly, search, categoryFilter]
  )

  // Dynamically filter sizes to ONLY sizes that exist in at least one brand row in the active register
  const populatedSizes = useMemo(() => {
    if (isOtherTab) return otherSizeKeys
    const existing = configuredSizes.filter((s) =>
      brandRows.some((r) => r.sizes && r.sizes[s] !== undefined)
    )
    return existing.length > 0 ? existing : configuredSizes
  }, [isOtherTab, otherSizeKeys, configuredSizes, brandRows])

  const baseRows = isOtherTab ? otherFilteredRows : filteredRows
  const displaySizes = sizeFilter === 'all'
    ? populatedSizes
    : populatedSizes.includes(Number(sizeFilter))
      ? [Number(sizeFilter)]
      : populatedSizes
  const rawDisplayRows = sizeFilter === 'all' ? baseRows : baseRows.filter((r) => r.sizes[Number(sizeFilter)])

  // Pinned first, then the app-wide ordering standard: rolling 4-business-day
  // sold quantity including today, tie-broken by most recent sale.
  const displayRows = useMemo(() => {
    return sortWithPinned({
      items: rawDisplayRows,
      keyExtractor: (r) => r.brand,
      pinnedKeys,
      sortMode,
      salesValueExtractor: (r) => soldQtyByBrand.get(r.brand)?.sold || 0,
      recencyValueExtractor: (r) => soldQtyByBrand.get(r.brand)?.last || 0,
      alphaValueExtractor: (r) => r.brand,
    })
  }, [rawDisplayRows, pinnedKeys, sortMode, soldQtyByBrand])

  const displayRowsAll = isOtherTab ? otherBrandRows : brandRows

  // Automatically reset categoryFilter when tab changes if current value is not valid
  useEffect(() => {
    if (categoryFilter !== 'All' && !categoryOptions.includes(categoryFilter)) {
      setCategoryFilter('All')
    }
  }, [categoryOptions, categoryFilter])

  // Automatically reset sizeFilter when tab changes if current value is not in displaySizes
  useEffect(() => {
    if (sizeFilter !== 'all') {
      const num = Number(sizeFilter)
      if (!displaySizes.includes(num)) {
        setSizeFilter('all')
      }
    }
  }, [displaySizes, sizeFilter])

  // Summary tiles across the active register
  const summary = useMemo(() => {
    let godownPcs = 0
    let counterPcs = 0
    let totalPcs = 0
    let value = 0
    let low = 0

    for (const r of displayRowsAll) {
      godownPcs += r.totalGodown
      counterPcs += r.totalCounter
      totalPcs += r.totalPcs
      value += r.totalValuation
      if (r.hasLowStock) low++
    }

    return { godownPcs, counterPcs, totalPcs, value, low }
  }, [displayRowsAll])

  // Grid column setup
  const columns = useMemo<GridColumn<BrandRow>[]>(() => {
    const cols: GridColumn<BrandRow>[] = [
      {
        key: 'brand',
        title: (
          <CompactSortHeader
            label="Brand"
            sortMode={sortMode}
            onToggleSort={toggleSortMode}
            pinnedCount={pinnedKeys.length}
            onOpenPinModal={() => setPinModalOpen(true)}
          />
        ),
        width: 210,
        align: 'left',
        render: (_val, row) => {
          const isPinned = pinnedSet.has(row.brand)
          const hasFlavours = !!row.flavours && row.flavours.length > 1
          const open = hasFlavours && !!expandedFlavours[row.brand]
          return (
            <div className="rg-brandline">
              <button
                type="button"
                className={`rg-row-pin-btn ${isPinned ? 'pinned' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isPinned) unpinItem(row.brand)
                  else pinItem(row.brand)
                }}
                title={isPinned ? 'Unpin brand' : 'Pin brand to top'}
                aria-label={isPinned ? 'Unpin brand' : 'Pin brand to top'}
              >
                {isPinned ? <IconPinFilled size={13} /> : <IconPin size={13} />}
              </button>
              <span aria-hidden="true" className={`rg-dot ${stockTone(row)}`} />
              <div className="rg-brandinfo">
                <span className="rg-brandcode">{row.brand}</span>
                {row.products?.[0]?.name && row.products[0].name !== row.brand && (
                  <span className="rg-brandsub" title={row.products[0].name}>
                    {row.products[0].name}
                  </span>
                )}
              </div>
              {hasFlavours && (
                <button
                  type="button"
                  className="rg-chip rg-chip--variant"
                  aria-expanded={open}
                  title={open ? 'Hide variants' : 'Show variants'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFlavours(row.brand)
                  }}
                >
                  ✦ {row.flavours!.length} {open ? '▴' : '▾'}
                </button>
              )}
            </div>
          )
        },
      },
    ]

    for (const size of displaySizes) {
      cols.push(
        {
          key: `god_${size}`,
          title: 'GOD',
          width: 44,
          align: 'center',
          render: (_val, row) => {
            const c = row.sizes[size]
            return c ? String(c.godown) : '—'
          },
        },
        {
          key: `cnt_${size}`,
          title: 'CNT',
          width: 44,
          align: 'center',
          render: (_val, row) => {
            const c = row.sizes[size]
            return c ? String(c.counter) : '—'
          },
        },
        {
          key: `tot_${size}`,
          title: 'TOT',
          width: 46,
          align: 'center',
          divider: true,
          render: (_val, row) => {
            const c = row.sizes[size]
            return c ? String(c.total) : '—'
          },
        }
      )
    }

    cols.push(
      {
        key: 'totalGodown',
        title: 'GOD',
        width: 48,
        align: 'center',
        render: (_val, row) => String(row.totalGodown),
      },
      {
        key: 'totalCounter',
        title: 'CNT',
        width: 48,
        align: 'center',
        render: (_val, row) => String(row.totalCounter),
      },
      {
        key: 'totalPcs',
        title: 'TOT',
        width: 52,
        align: 'center',
        divider: !seesValuation,
        render: (_val, row) => String(row.totalPcs),
      }
    )

    if (seesValuation) {
      cols.push({
        key: 'totalValuation',
        title: 'Value',
        width: 96,
        align: 'center',
        divider: false,
        render: (_val, row) => money(row.totalValuation),
      })
    }

    return cols
  }, [
    displaySizes,
    seesValuation,
    expandedFlavours,
    toggleFlavours,
    sortMode,
    toggleSortMode,
    pinnedKeys,
    pinnedSet,
    pinItem,
    unpinItem,
  ])

  // Nested headers for grouped size display
  const nestedHeaders = useMemo<NestedHeader[][]>(() => {
    const topRow: NestedHeader[] = [
      {
        title: (
          <CompactSortHeader
            label="Brand"
            sortMode={sortMode}
            onToggleSort={toggleSortMode}
            pinnedCount={pinnedKeys.length}
            onOpenPinModal={() => setPinModalOpen(true)}
          />
        ),
        colspan: 1,
      },
    ]
    for (const size of displaySizes) {
      topRow.push({ title: sizeLabel(size), colspan: 3 })
    }
    topRow.push({ title: 'Total Stock', colspan: 3 })
    if (seesValuation) {
      topRow.push({ title: 'Valuation', colspan: 1 })
    }

    return [topRow]
  }, [displaySizes, seesValuation, sortMode, toggleSortMode, pinnedKeys])

  // Footer totals for visible rows
  const footers = useMemo<(string | number)[][]>(() => {
    const rowFooter: (string | number)[] = ['Total']

    for (const size of displaySizes) {
      let gSum = 0
      let cSum = 0
      let tSum = 0
      for (const r of displayRows) {
        const c = r.sizes[size]
        if (c) {
          gSum += c.godown
          cSum += c.counter
          tSum += c.total
        }
      }
      rowFooter.push(gSum, cSum, tSum)
    }

    let totG = 0
    let totC = 0
    let totPcs = 0
    let totVal = 0

    for (const r of displayRows) {
      totG += r.totalGodown
      totC += r.totalCounter
      totPcs += r.totalPcs
      totVal += r.totalValuation
    }

    rowFooter.push(totG, totC, totPcs)
    if (seesValuation) {
      rowFooter.push(money(totVal))
    }

    return [rowFooter]
  }, [displaySizes, displayRows, seesValuation])

  const openTransfer = useCallback((productId?: string) => {
    setSelectedProductId(productId)
    setTransferOpen(true)
  }, [])

  return (
    <div className="stock-page">
      {/* No page title or one-line description: the register is the first thing
          on screen. The godown / counter / low strip stays because those are
          live operational figures, not decoration. */}
      <div
        className="page-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <div className="sr-dock-stats" style={{ margin: 0 }}>
          <span>
            GODOWN <strong>{num0(summary.godownPcs)}</strong>
          </span>
          <span>
            COUNTER <strong>{num0(summary.counterPcs)}</strong>
          </span>
          <span>
            LOW{' '}
            <strong style={{ color: summary.low ? 'var(--warn-fg)' : 'var(--ok-fg)' }}>{num0(summary.low)}</strong>
          </span>
          {seesValuation && (
            <span>
              VALUE <strong>{money(summary.value)}</strong>
            </span>
          )}
        </div>
      </div>

      {mode === 'history' ? (
        <StockMovementHistory
          shopId={shopId}
          seesValuation={seesValuation}
          onBack={() => setMode('matrix')}
        />
      ) : (
        <>

          {/* Unbranded warning banner */}
          {unbrandedProducts.length > 0 && (
            <div className="sr-banner sr-banner--warn">
              <IconAlertTriangle size={16} style={{ color: 'var(--warn-fg)', flexShrink: 0 }} />
              <div className="sr-banner-body">
                <strong>{unbrandedProducts.length} products</strong> do not have a brand assigned.
                They are grouped under their product names. Set brand in Products to group sizes correctly.
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

          <Panel>
            {/* Panel Toolbar & Register Tabs */}
            <div className="panel-head" style={{ flexWrap: 'wrap', gap: 12 }}>
              {/* Register Tabs */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div className="seg" role="tablist" aria-label="Registers">
                  {visibleRegisters.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      role="tab"
                      aria-selected={activeRegKey === r.key}
                      className={`seg-btn ${activeRegKey === r.key ? 'active' : ''}`}
                      onClick={() => {
                        setActiveRegKey(r.key)
                        setCategoryFilter('All')
                        setSizeFilter('all')
                      }}
                    >
                      <span>{r.label}</span>
                      <span className="sr-seg-amt">{num0(registerPcsTotals[r.key] ?? 0)} pcs</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isOtherTab}
                    className={`seg-btn ${isOtherTab ? 'active' : ''}`}
                    onClick={() => {
                      setActiveRegKey(OTHER_REG_KEY)
                      setCategoryFilter('All')
                      setSizeFilter('all')
                    }}
                  >
                    <span>Others</span>
                    <span className="sr-seg-amt">{num0(registerPcsTotals[OTHER_REG_KEY] ?? 0)} pcs</span>
                  </button>
                </div>
                <span className="sr-count">
                  <strong>{displayRows.length}</strong> rows shown
                </span>
              </div>

              <div className="panel-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', justifyContent: 'flex-end' }}>
                {categoryOptions.length > 2 && (
                  <select
                    className="field-control"
                    style={{ width: 130, height: 32, fontSize: 12, flexShrink: 0 }}
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    aria-label="Filter by category"
                  >
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>
                        {c === 'All' ? 'All categories' : c}
                      </option>
                    ))}
                  </select>
                )}

                {displaySizes.length > 0 && (
                  <select
                    className="field-control"
                    style={{ width: 130, height: 32, fontSize: 12, flexShrink: 0 }}
                    value={sizeFilter}
                    onChange={(e) => setSizeFilter(e.target.value)}
                    aria-label="Filter by bottle size"
                  >
                    <option value="all">All sizes</option>
                    {displaySizes.map((s) => (
                      <option key={s} value={String(s)}>
                        {sizeDisplayLabel(s)}
                      </option>
                    ))}
                  </select>
                )}
                <div className="toolbar-grow search-box" style={{ flex: '1 1 200px', minWidth: 160 }}>
                  <input
                    className="field-control"
                    placeholder="Search brand or code…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ height: 32, fontSize: 12, width: '100%' }}
                  />
                  {search !== '' && (
                    <button
                      type="button"
                      className="search-clear"
                      aria-label="Clear search"
                      title="Clear search"
                      onClick={() => setSearch('')}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <Btn
                  variant="ghost"
                  className="btn-icon"
                  style={{
                    width: 32,
                    height: 32,
                    padding: 0,
                    ...(lowOnly
                      ? {
                          background: 'var(--layer-accent, #edf5ff)',
                          borderColor: 'var(--blue, #0f62fe)',
                          color: 'var(--blue, #0f62fe)',
                        }
                      : {}),
                  }}
                  aria-label="Filter low stock only"
                  aria-pressed={lowOnly}
                  title="Filter low stock only"
                  data-tooltip={lowOnly ? 'Showing low stock only' : 'Filter low stock only'}
                  onClick={() => setLowOnly((v) => !v)}
                >
                  <IconLowStock size={15} />
                </Btn>
                <Btn
                  variant="ghost"
                  className="btn-icon"
                  style={{ width: 32, height: 32, padding: 0 }}
                  aria-label="Stock movement history"
                  title="Stock movement history"
                  data-tooltip="Stock movement history"
                  onClick={() => setMode('history')}
                >
                  <IconHistory size={15} />
                </Btn>
                <Btn
                  variant="ghost"
                  className="btn-icon"
                  style={{ width: 32, height: 32, padding: 0 }}
                  aria-label="Export to spreadsheet"
                  data-tooltip="Export to spreadsheet"
                  onClick={() => {
                    const csvRows = displayRows.map((r) => {
                      const rowData: Record<string, any> = {
                        Brand: r.brand,
                        'Total Godown': r.totalGodown,
                        'Total Counter': r.totalCounter,
                        'Total Pcs': r.totalPcs,
                      }
                      for (const size of displaySizes) {
                        const c = r.sizes[size]
                        rowData[`${sizeLabel(size)} Godown`] = c ? c.godown : 0
                        rowData[`${sizeLabel(size)} Counter`] = c ? c.counter : 0
                        rowData[`${sizeLabel(size)} Total`] = c ? c.total : 0
                      }
                      if (seesValuation) {
                        rowData['Total Value'] = r.totalValuation
                      }
                      return rowData
                    })
                    const regKey = isOtherTab ? 'other-sizes' : activeRegKey
                    downloadCsv(`wine-stock-${regKey}-${new Date().toISOString().slice(0, 10)}.csv`, csvRows)
                  }}
                >
                  <IconSheet size={15} />
                </Btn>
                <Btn variant="primary" onClick={() => openTransfer()} style={{ height: 32, fontSize: 12 }}>
                  <IconTransfer size={14} /> Transfer stock
                </Btn>
              </div>
            </div>

            {/* Matrix View or Mobile Card View */}
            {displayRows.length === 0 ? (
              isOtherTab ? (
                <EmptyState
                  title="No other bottle sizes"
                  hint={search || lowOnly ? 'Nothing matches the current filters.' : 'Every product uses a size from the register stacks.'}
                />
              ) : (
                <EmptyState
                  title="No stock rows in this register"
                  hint={search ? 'Nothing matches your search.' : 'Add or import products in this register.'}
                />
              )
            ) : isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
                {displayRows.map((r) => (
                  <div
                    key={r.brand}
                    style={{
                      border: '1px solid var(--line)',
                      background: 'var(--canvas)',
                      padding: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{r.brand}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className="num" style={{ fontWeight: 600 }}>{r.totalPcs} pcs</span>
                        {r.hasLowStock && <Tag tone="warn">Low</Tag>}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6 }}>
                      {displaySizes.map((size) => {
                        const c = r.sizes[size]
                        if (!c) return null
                        return (
                          <div
                            key={size}
                            style={{
                              background: 'var(--layer)',
                              padding: '6px 8px',
                              border: '1px solid var(--line)',
                              fontSize: 12,
                            }}
                          >
                            <div style={{ fontWeight: 600, color: 'var(--muted)', marginBottom: 2 }}>{sizeLabel(size)}</div>
                            <div className="num" style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>G: {c.godown}</span>
                              <span>C: {c.counter}</span>
                              <strong>T: {c.total}</strong>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sr-viewport sr-viewport--stock">
                <RegisterGrid
                  columns={columns}
                  data={displayRows}
                  nestedHeaders={nestedHeaders}
                  footers={footers}
                  freezeColumns={1}
                  fitWidth={true}
                  isDrawerOpen={(row) => Boolean(expandedFlavours[row.brand])}
                  renderDrawer={(row) => renderStockVariantDrawer(row, displaySizes, seesValuation)}
                  ariaLabel="Wine stock matrix"
                />
              </div>
            )}
          </Panel>
        </>
      )}

      {/* Shared Stock Transfer Drawer */}
      <StockTransferDrawer
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        shopId={shopId}
        products={stockProducts}
        initialProductId={selectedProductId}
        onSuccess={() => d.refresh()}
      />

      <PinManagementModal
        open={pinModalOpen}
        onClose={() => setPinModalOpen(false)}
        title="Pinned Brands Priority"
        pinnedKeys={pinnedKeys}
        allItems={displayRowsAll.map((r) => ({
          key: r.brand,
          label: r.brand,
          sublabel: r.products?.[0]?.name && r.products[0].name !== r.brand ? r.products[0].name : undefined,
          soldText: `${soldQtyByBrand.get(r.brand)?.sold || 0} sold / 4 days`,
        }))}
        onMovePinned={movePinnedItem}
        onPin={pinItem}
        onUnpin={unpinItem}
      />
    </div>
  )
}

export default function WineStockPageGuarded() {
  const { can } = useAuth()
  if (!can('stock')) return <NoAccess what="Stock" />
  return <WineStockPage />
}
