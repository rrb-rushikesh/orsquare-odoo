import { useEffect, useDeferredValue, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import { deleteProduct, type PProduct } from '@/lib/repo'
import { compact, downloadCsv, money, num0, unitMl } from '@/lib/utils'
import { searchProducts } from '@/lib/search'
import { todayKey } from '@/lib/clock'
import {
  NoAccess,
  Btn,
  IconButton,
  SearchField,
  ToolbarSelect,
  ConfirmDialog,
  EmptyState,
  Panel,
  Tag,
  Tile,
  useToast,
} from '@/components/ui'
import { DataTable, type DTCol } from '@/components/DataTable'
import { ProductFormDrawer } from '@/components/ProductForm'
import { ProductImportDrawer } from '@/components/ProductImport'
import { CatalogManager } from '@/components/CatalogManager'
import { IconGear, IconLowStock, IconSheet, IconUpload } from '@/components/icons'

function productSub(p: PProduct): string {
  const size = p.unit && p.unit !== '-' ? p.unit : ''
  return [size, p.barcode].filter(Boolean).join(' · ')
}

function ProductsPage() {
  const { wsUid, seesMoney, seesValuation, featureOn } = useAuth()
  const kitchenEnabled = featureOn('kitchen')
  const d = useData()
  const toast = useToast()
  const shopId = wsUid

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [lowOnly, setLowOnly] = useState(false)
  const [sort, setSort] = useState('newest')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PProduct | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const [productTypeFilter, setProductTypeFilter] = useState<'all' | 'retail' | 'kitchen'>('all')
  const [formDefaultType, setFormDefaultType] = useState<'retail' | 'kitchen'>('retail')
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    if (!kitchenEnabled && productTypeFilter === 'kitchen') {
      setProductTypeFilter('all')
    }
  }, [kitchenEnabled, productTypeFilter])

  const categories = useMemo(
    () => [...new Set([...(d.meta?.categories ?? []), ...d.products.map((p) => p.category).filter(Boolean)])].sort(),
    [d.meta?.categories, d.products]
  )

  const filtered = useMemo(() => {
    const q = deferredSearch.trim()
    const base = d.products.filter((p) => {
      if (!kitchenEnabled && p.isKitchen) return false
      if (productTypeFilter === 'retail' && p.isKitchen) return false
      if (productTypeFilter === 'kitchen' && !p.isKitchen) return false
      if (categoryFilter !== 'All' && p.category !== categoryFilter) return false
      if (lowOnly && (p.isKitchen || p.godownPcs + p.counterPcs > p.lowLevel)) return false
      return true
    })
    if (q) {
      const scored = searchProducts(base, q)
      if (sort === 'name-asc') return [...scored].sort((a, b) => a.name.localeCompare(b.name))
      if (sort === 'name-desc') return [...scored].sort((a, b) => b.name.localeCompare(a.name))
      if (sort === 'ml-asc' || sort === 'ml-desc') {
        const dir = sort === 'ml-asc' ? 1 : -1
        const mlOf = (p: PProduct): number => {
          const v = unitMl(p.unit)
          return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY
        }
        return [...scored].sort((a, b) => {
          const ma = mlOf(a)
          const mb = mlOf(b)
          if (ma === mb) return a.name.localeCompare(b.name)
          return (ma - mb) * dir
        })
      }
      return scored
    }
    switch (sort) {
      case 'name-asc':
        return [...base].sort((a, b) => a.name.localeCompare(b.name))
      case 'name-desc':
        return [...base].sort((a, b) => b.name.localeCompare(a.name))
      case 'ml-asc':
      case 'ml-desc': {
        const dir = sort === 'ml-asc' ? 1 : -1
        const mlOf = (p: PProduct): number => {
          const v = unitMl(p.unit)
          return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY
        }
        return [...base].sort((a, b) => {
          const ma = mlOf(a)
          const mb = mlOf(b)
          if (ma === mb) return a.name.localeCompare(b.name)
          return (ma - mb) * dir
        })
      }
      default:
        return base
    }
  }, [d.products, deferredSearch, productTypeFilter, categoryFilter, lowOnly, sort, kitchenEnabled])

  const cols = useMemo<DTCol<PProduct>[]>(() => {
    const c: DTCol<PProduct>[] = [
      {
        key: 'name',
        label: 'Product',
        sortValue: (p) => p.name.toLowerCase(),
        render: (p) => {
          const sub = productSub(p)
          return (
            <>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="cell-main">{p.name}</span>
                {p.isKitchen && <Tag kind="blue">KITCHEN</Tag>}
              </div>
              {sub && <span className="cell-sub num">{sub}</span>}
            </>
          )
        },
      },
      {
        key: 'category',
        label: 'Category',
        sortValue: (p) => p.category.toLowerCase(),
        render: (p) =>
          p.category && p.category !== '-' ? (
            <Tag kind="gray">{p.category.toUpperCase()}</Tag>
          ) : (
            <span className="td-muted">—</span>
          ),
      },
    ]
    if (seesMoney) {
      c.push(
        {
          key: 'mrp',
          label: 'MRP',
          align: 'right',
          sortValue: (p) => p.mrp,
          hideMobile: true,
          render: (p) => (p.isKitchen ? <span className="td-muted">—</span> : <span className="num">{money(p.mrp)}</span>),
        },
        {
          key: 'rate',
          label: 'Sales Rate',
          align: 'right',
          sortValue: (p) => p.rate || p.mrp,
          render: (p) => <span className="num">{money(p.rate || p.mrp)}</span>,
        }
      )
    }
    c.push({
      key: 'stock',
      label: 'Stock (pcs)',
      align: 'right',
      sortValue: (p) => (p.isKitchen ? 999999 : p.godownPcs + p.counterPcs),
      render: (p) => {
        if (p.isKitchen) {
          return (
            <>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                <Tag kind="blue">Infinite Stock</Tag>
              </div>
              <div className="cell-sub">Made-to-order · No godown count</div>
            </>
          )
        }
        const total = p.godownPcs + p.counterPcs
        const low = total <= p.lowLevel
        return (
          <>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
              <span className="num" style={{ fontWeight: 500 }}>{num0(total)}</span>
              <Tag kind={low ? 'red' : 'green'}>{low ? 'Low' : 'OK'}</Tag>
            </div>
            <div className="cell-sub num">{num0(p.godownPcs)} godown · {num0(p.counterPcs)} counter · {p.piecesPerBox || 1}/box</div>
          </>
        )
      },
    })
    if (seesValuation) {
      c.push({
        key: 'value',
        label: 'Value',
        align: 'right',
        sortValue: (p) => (p.isKitchen ? 0 : (p.godownPcs + p.counterPcs) * p.mrp),
        hideMobile: true,
        render: (p) =>
          p.isKitchen ? (
            <span className="td-muted">—</span>
          ) : (
            <span className="num" style={{ fontWeight: 600 }}>{money((p.godownPcs + p.counterPcs) * p.mrp)}</span>
          ),
      })
    }
    return c
  }, [seesMoney, seesValuation])

  const summary = useMemo(() => {
    let value = 0
    let low = 0
    let out = 0
    d.products.forEach((p) => {
      if (p.isKitchen) return
      const total = p.godownPcs + p.counterPcs
      value += total * p.mrp
      if (total === 0) out++
      else if (total <= p.lowLevel) low++
    })
    return { value, low, out }
  }, [d.products])

  function exportCsv() {
    downloadCsv(
      `products-${todayKey()}.csv`,
      filtered.map((p) => ({
        Type: p.isKitchen ? 'Kitchen' : 'Retail',
        Barcode: p.barcode, Name: p.name, Category: p.category, Unit: p.unit,
        ...(seesMoney ? { MRP: p.isKitchen ? '' : p.mrp, OurRate: p.rate || p.mrp } : {}),
        PcsPerBox: p.piecesPerBox,
        Godown: p.isKitchen ? 'Infinite' : p.godownPcs,
        Counter: p.isKitchen ? 'Infinite' : p.counterPcs,
        Total: p.isKitchen ? 'Infinite' : p.godownPcs + p.counterPcs,
        LowLevel: p.isKitchen ? 'N/A' : p.lowLevel,
      }))
    )
  }

  return (
    <>
      <div className="tiles">
        <Tile
          label="Products"
          value={kitchenEnabled ? d.products.length : d.products.filter((p) => !p.isKitchen).length}
          note={`${categories.length} categories`}
        />
        {seesValuation && <Tile label="Stock value" value={compact(summary.value)} note="Total pcs × MRP" />}
        <Tile label="Low stock" value={summary.low} note="At or below minimum level" />
        <Tile label="Out of stock" value={summary.out} />
      </div>

      <Panel>
        <div className="panel-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h3 className="panel-title" style={{ margin: 0 }}>
              {kitchenEnabled && productTypeFilter === 'kitchen'
                ? 'Kitchen Dishes'
                : kitchenEnabled && productTypeFilter === 'retail'
                  ? 'Retail Inventory'
                  : 'Catalogue'}
            </h3>
            <span className="t-caption">{filtered.length} shown</span>
          </div>
          <div className="panel-actions">
            <SearchField
              placeholder="Search by name or barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
            />
            <ToolbarSelect width="lg" value={sort} onChange={(e) => setSort(e.target.value)} title="Sort products">
              <option value="newest">Newest added</option>
              <option value="name-asc">Name · A–Z</option>
              <option value="name-desc">Name · Z–A</option>
              <option value="ml-asc">Unit · Low → High</option>
              <option value="ml-desc">Unit · High → Low</option>
            </ToolbarSelect>
            {kitchenEnabled && (
              <ToolbarSelect
                width="sm"
                value={productTypeFilter}
                onChange={(e) => setProductTypeFilter(e.target.value as 'all' | 'retail' | 'kitchen')}
                title="Filter by product type"
              >
                <option value="all">All items</option>
                <option value="retail">Retail only</option>
                <option value="kitchen">Kitchen dishes</option>
              </ToolbarSelect>
            )}
            <ToolbarSelect width="md" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} title="Filter by category">
              <option value="All">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </ToolbarSelect>
            <IconButton
              label="Filter low stock only"
              tooltip={lowOnly ? 'Showing low stock only' : 'Filter low stock only'}
              aria-pressed={lowOnly}
              onClick={() => setLowOnly((v) => !v)}
              icon={<IconLowStock size={16} />}
            />
            <IconButton
              label="Export to spreadsheet"
              tooltip="Export to spreadsheet"
              onClick={exportCsv}
              icon={<IconSheet size={16} />}
            />
            <IconButton
              label="Import products from Excel"
              tooltip="Import products from Excel (Retail only)"
              disabled
              title="Product import is not available yet."
              onClick={() => setImportOpen(true)}
              icon={<IconUpload size={16} />}
            />
            <IconButton
              label="Manage categories and units"
              tooltip="Manage categories and units"
              onClick={() => setManageOpen(true)}
              icon={<IconGear size={16} />}
            />
            <Btn
              variant="primary"
              onClick={() => {
                setEditing(null)
                setFormDefaultType(kitchenEnabled && productTypeFilter === 'kitchen' ? 'kitchen' : 'retail')
                setFormOpen(true)
              }}
            >
              + Add Product
            </Btn>
          </div>
        </div>

        {d.products.length === 0 ? (
          <EmptyState title="No products found" hint="Add products so you can bill them at the counter." />
        ) : (
          <DataTable
            key={sort}
            cols={cols}
            rows={filtered}
            ariaLabel="Product catalogue"
            onRowClick={(p) => { setEditing(p); setFormOpen(true) }}
            empty={<EmptyState title="No products found" hint="Adjust the filters to see more." />}
          />
        )}
      </Panel>

      <CatalogManager open={manageOpen} onClose={() => setManageOpen(false)} />

      <ProductImportDrawer open={importOpen} onClose={() => setImportOpen(false)} />

      <ProductFormDrawer
        open={formOpen}
        initial={editing}
        defaultProductType={formDefaultType}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSaved={() => { setFormOpen(false); setEditing(null); d.refresh() }}
        onDelete={(p) => { setConfirmId(p.id); setFormOpen(false) }}
      />

      <ConfirmDialog
        open={!!confirmId}
        title="Delete this product?"
        message="Past bills keep their line items, but the product disappears from the catalogue and POS."
        busy={busy}
        onClose={() => setConfirmId(null)}
        onConfirm={async () => {
          if (!confirmId) return
          setBusy(true)
          try {
            await deleteProduct(shopId, confirmId)
            toast('Product deleted.')
            setConfirmId(null)
            d.refresh()
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Delete failed.', 'err')
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

export default function ProductsPageGuarded() {
  const { can } = useAuth()
  if (!can('products')) return <NoAccess what="Products" />
  return <ProductsPage />
}