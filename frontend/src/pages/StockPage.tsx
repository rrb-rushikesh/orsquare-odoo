import { useDeferredValue, useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import * as repo from '@/lib/repo'
import type { PProduct, StockOverview } from '@/lib/repo'
import { downloadCsv, formatDate, money, num0 } from '@/lib/utils'
import { searchProducts, searchGeneric } from '@/lib/search'
import {
  NoAccess,
  Btn,
  Drawer,
  EmptyState,
  Panel,
  Tag,
  Tile,
} from '@/components/ui'
import { DataTable, type DTCol } from '@/components/DataTable'
import { IconHistory, IconLowStock, IconPin, IconPinFilled, IconSheet, IconTransfer } from '@/components/icons'
import { StockTransferDrawer, StockMovementHistory } from '@/components/stock'
import { usePinnedSorting, sortWithPinned } from '@/lib/pinnedSorting'
import { CompactSortHeader, PinManagementModal } from '@/components/CompactSortHeader'
import '@/styles/sheet-register.css'

function StockPage() {
  const { activeShop, seesValuation, user, isOwner, featureOn } = useAuth()
  const d = useData()
  const shopId = activeShop?.id ?? ''

  // Kitchen is a first-class stock view, gated on the shop's Kitchen feature.
  // It is a subtab, not a filter: kitchen stock never mixes into the retail
  // levels table, and the two share the same ordering and pinning standard.
  const kitchenEnabled = featureOn('kitchen')
  const [kitchenOnly, setKitchenOnly] = useState(false)
  // A shop that has the feature switched off mid-session must not stay on an
  // empty Kitchen tab.
  useEffect(() => { if (!kitchenEnabled) setKitchenOnly(false) }, [kitchenEnabled])

  // Owner control layer: a multi-shop owner's Stock tab opens on the
  // network-wide by-retailer matrix instead of a single shop's locations.
  const isMultiShopOwner = isOwner && (user?.shops?.length ?? 0) > 1

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [lowOnly, setLowOnly] = useState(false)
  const [category, setCategory] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<PProduct | null>(null)
  const [transferProductId, setTransferProductId] = useState<string | undefined>(undefined)

  const productTransfers = useMemo(() => {
    if (!selectedProduct) return []
    return (d.transfers || []).filter(
      (t) => (t.productId && t.productId === selectedProduct.id) || t.productName === selectedProduct.name
    )
  }, [selectedProduct, d.transfers])

  const [mode, setMode] = useState<'network' | 'levels' | 'history'>(isMultiShopOwner ? 'network' : 'levels')
  const [pinModalOpen, setPinModalOpen] = useState(false)

  // Persistent sorting & pinning hook
  const {
    sortMode,
    toggleSortMode,
    pinnedKeys,
    pinnedSet,
    pinItem,
    unpinItem,
    movePinnedItem,
  } = usePinnedSorting('stock_products', 'most-sold')

  const [overview, setOverview] = useState<{ loading: boolean; error: string | null; data: StockOverview | null }>({
    loading: true,
    error: null,
    data: null,
  })
  const [showAllNetwork, setShowAllNetwork] = useState(false)
  const NETWORK_CAP = 300

  const loadOverview = useCallback(async () => {
    if (!shopId) return
    setOverview((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await repo.fetchStockOverview(shopId)
      setOverview({ loading: false, error: null, data })
    } catch (e) {
      setOverview({
        loading: false,
        error: e instanceof Error && e.message ? e.message : 'Could not load stock.',
        data: null,
      })
    }
  }, [shopId])

  useEffect(() => {
    if (isMultiShopOwner) void loadOverview()
  }, [mode, isMultiShopOwner, loadOverview])

  const filtered = useMemo(() => {
    const q = deferredSearch.trim()
    const base = d.products.filter((p) => {
      // Kitchen is a first-class stock view, not a hidden filter: it is its own
      // subtab, and only offered when the shop has the feature on.
      if (Boolean(p.isKitchen) !== kitchenOnly) return false
      if (lowOnly && p.godownPcs + p.counterPcs > p.lowLevel) return false
      if (category && p.category !== category) return false
      return true
    })
    let list = base
    if (q) {
      list = searchProducts(base, q)
    }

    // Pinned first, then the app-wide ordering standard: rolling 4-business-day
    // sold quantity including today, tie-broken by most recent sale, then by
    // the backend's stable name order.
    return sortWithPinned({
      items: list,
      keyExtractor: (p) => p.id,
      pinnedKeys,
      sortMode,
      salesValueExtractor: (p) => p.sold4d || 0,
      recencyValueExtractor: (p) => Date.parse(p.orderLastSoldAt || '') || 0,
      alphaValueExtractor: (p) => p.name,
    })
  }, [d.products, deferredSearch, lowOnly, category, sortMode, pinnedKeys, kitchenOnly])

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const p of d.products) {
      if (Boolean(p.isKitchen) !== kitchenOnly) continue
      const c = (p.category || '').trim()
      if (c && c !== '-' && !seen.has(c)) seen.add(c)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [d.products, kitchenOnly])

  const cols = useMemo<DTCol<PProduct>[]>(() => {
    const c: DTCol<PProduct>[] = [
      {
        key: 'name',
        label: 'Product',
        headerRender: () => (
          <CompactSortHeader
            label="Product"
            sortMode={sortMode}
            onToggleSort={toggleSortMode}
            pinnedCount={pinnedKeys.length}
            onOpenPinModal={() => setPinModalOpen(true)}
          />
        ),
        render: (p) => {
          const isPinned = pinnedSet.has(p.id)
          const size = p.unit && p.unit !== '-' ? p.unit : ''
          const sub = [size, p.barcode].filter(Boolean).join(' · ')
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className={`rg-row-pin-btn ${isPinned ? 'pinned' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isPinned) unpinItem(p.id)
                  else pinItem(p.id)
                }}
                title={isPinned ? 'Unpin product' : 'Pin product to top'}
                aria-label={isPinned ? 'Unpin product' : 'Pin product to top'}
              >
                {isPinned ? <IconPinFilled size={13} /> : <IconPin size={13} />}
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="cell-main">{p.name}</span>
                {sub && <span className="cell-sub num">{sub}</span>}
              </div>
            </div>
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
      {
        key: 'godown',
        label: 'Godown',
        align: 'center',
        sortValue: (p) => p.godownPcs,
        hideMobile: true,
        render: (p) => <span className="num">{num0(p.godownPcs)}</span>,
      },
      {
        key: 'counter',
        label: 'Counter',
        align: 'center',
        sortValue: (p) => p.counterPcs,
        hideMobile: true,
        render: (p) => <span className="num">{num0(p.counterPcs)}</span>,
      },
      {
        key: 'total',
        label: 'Total',
        align: 'center',
        sortValue: (p) => p.godownPcs + p.counterPcs,
        render: (p) => (
          <span className="num" style={{ fontWeight: 600 }}>{num0(p.godownPcs + p.counterPcs)}</span>
        ),
      },
    ]
    if (seesValuation) {
      c.push({
        key: 'value',
        label: 'Value',
        align: 'center',
        sortValue: (p) => p.stockValue ?? NaN,
        hideMobile: true,
        render: (p) => <span className="num">{money(p.stockValue ?? NaN)}</span>,
      })
    }
    c.push({
      key: 'status',
      label: 'Status',
      sortValue: (p) => {
        const t = p.godownPcs + p.counterPcs
        return t === 0 ? 'Out' : t <= p.lowLevel ? 'Low' : 'OK'
      },
      render: (p) => {
        const total = p.godownPcs + p.counterPcs
        return total === 0 ? (
          <Tag kind="red">Out</Tag>
        ) : total <= p.lowLevel ? (
          <Tag kind="warn">Low</Tag>
        ) : (
          <Tag kind="green">OK</Tag>
        )
      },
    })
    return c
  }, [seesValuation, sortMode, toggleSortMode, pinnedKeys, pinnedSet, pinItem, unpinItem])

  const stockProducts = useMemo(() => d.products.filter((p) => !p.isKitchen), [d.products])

  const summary = useMemo(() => {
    let value = 0
    let godownPcs = 0
    let counterPcs = 0
    let low = 0
    stockProducts.forEach((p) => {
      const total = p.godownPcs + p.counterPcs
      void value
      godownPcs += p.godownPcs
      counterPcs += p.counterPcs
      if (total <= p.lowLevel) low++
    })
    return { value: d.stockValue ?? NaN, godownPcs, counterPcs, low }
  }, [stockProducts, d.stockValue])

  // ----- Owner network matrix (control-layer view) -----
  const godownShopId = user?.shops?.[0]?.id ?? ''
  const networkShops = overview.data?.shops ?? []

  const networkRows = useMemo(() => {
    const rows = overview.data?.products ?? []
    const q = deferredSearch.trim()
    if (!q) return rows
    return searchGeneric(rows, q, [
      { get: (r) => r.name, weight: 2.0 },
      { get: (r) => r.code, weight: 2.5, isCode: true },
    ])
  }, [overview.data, deferredSearch])
  const shownNetwork = showAllNetwork ? networkRows : networkRows.slice(0, NETWORK_CAP)

  const networkTotals = useMemo(() => {
    let godown = 0
    let retailers = 0
    for (const r of overview.data?.products ?? []) {
      for (const s of overview.data?.shops ?? []) {
        const v = r.per_shop[s.id]?.total ?? 0
        if (s.id === godownShopId) godown += v
        else retailers += v
      }
    }
    return { godown, retailers, products: overview.data?.products.length ?? 0 }
  }, [overview.data, godownShopId])

  function exportNetworkCsv() {
    const rows = networkRows.map((r) => ({
      Product: r.name || r.code,
      MRP: Number(r.mrp) || 0,
      'Owner Godown': godownShopId ? r.per_shop[godownShopId]?.total ?? 0 : 0,
      ...Object.fromEntries(networkShops.filter((s) => s.id !== godownShopId).map((s) => [s.name, r.per_shop[s.id]?.total ?? 0])),
      Total: r.total,
    }))
    downloadCsv(`network-stock-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  function openTransfer() {
    setTransferOpen(true)
  }

  return (
    <>
      {/* Kitchen subtab. Retail stock and kitchen stock are different products
          with different movement rules (a kitchen line never touches counter
          stock), so they get their own tab rather than a mixed table. */}
      {kitchenEnabled && mode === 'levels' && !isMultiShopOwner && (
        <div className="seg" role="tablist" aria-label="Stock view" style={{ marginBottom: 12 }}>
          <button type="button" role="tab" aria-selected={!kitchenOnly}
            className={`seg-btn ${!kitchenOnly ? 'active' : ''}`} onClick={() => setKitchenOnly(false)}>
            Retail
          </button>
          <button type="button" role="tab" aria-selected={kitchenOnly}
            className={`seg-btn ${kitchenOnly ? 'active' : ''}`} onClick={() => setKitchenOnly(true)}>
            Kitchen
          </button>
        </div>
      )}
      {isMultiShopOwner && (
        <>
          <div className="tiles">
            <Tile label="Central Godown" value={num0(networkTotals.godown)} note="Pieces in your main godown" />
            <Tile label="Retailer shops" value={num0(networkTotals.retailers)} note="Godown + counter combined" />
            <Tile label="Total across business" value={num0(networkTotals.godown + networkTotals.retailers)} note="All locations" />
            <Tile label="Products" value={num0(networkTotals.products)} note={networkShops.length > 1 ? `${networkShops.length} shops` : undefined} />
          </div>

          <Panel>
            <div className="panel-head">
              <div className="panel-title-group">
                <h3 className="panel-title" style={{ margin: 0 }}>Stock by retailer</h3>
                <span className="t-caption">{shownNetwork.length} shown</span>
              </div>
              <div className="panel-actions">
                <div className="toolbar-grow search-box">
                  <input className="field-control" placeholder="Search product…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Btn
                  variant="ghost"
                  className="btn-icon"
                  style={{ width: 40, height: 40 }}
                  aria-label="Stock movement history"
                  disabled title="Stock movement history is not available yet."
                  data-tooltip="Stock movement history"
                  onClick={() => setMode('history')}
                >
                  <IconHistory size={16} />
                </Btn>
                <Btn
                  variant="ghost"
                  className="btn-icon"
                  style={{ width: 40, height: 40 }}
                  aria-label="Export to spreadsheet"
                  data-tooltip="Export to spreadsheet"
                  onClick={exportNetworkCsv}
                >
                  <IconSheet size={16} />
                </Btn>
                <Btn variant="primary" disabled={stockProducts.length === 0} onClick={openTransfer}>
                  <IconTransfer /> Transfer stock
                </Btn>
              </div>
            </div>

            {overview.loading ? (
              <div className="skeleton" style={{ height: 240 }} />
            ) : overview.error ? (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                <div className="alert" role="alert">{overview.error}</div>
                <Btn sm variant="secondary" onClick={() => void loadOverview()}>Retry</Btn>
              </div>
            ) : networkRows.length === 0 ? (
              <EmptyState title="No stock rows" hint="Purchase stock into your central godown first." />
            ) : (
              <>
                <div className="tbl-scroll">
                  <table className="tbl" aria-label="Stock by retailer">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="td-right">Total</th>
                        {networkShops.map((s) => (
                          <th key={s.id} className="td-right" style={{ fontWeight: s.id === godownShopId ? 600 : 400 }}>
                            {s.id === godownShopId ? `${s.name} (godown)` : s.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shownNetwork.map((r) => (
                        <tr key={r.code}>
                          <td>
                            <span className="cell-main">{r.name || r.code}</span>
                            <span className="cell-sub num">{r.code}</span>
                          </td>
                          <td className="td-right num" style={{ fontWeight: 600 }}>{num0(r.total)}</td>
                          {networkShops.map((s) => (
                            <td key={s.id} className={`td-right num ${s.id === godownShopId ? '' : 'td-muted'}`}>
                              {num0(r.per_shop[s.id]?.total ?? 0)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!showAllNetwork && networkRows.length > NETWORK_CAP && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 16px' }}>
                    <Btn sm variant="secondary" onClick={() => setShowAllNetwork(true)}>
                      Show all {networkRows.length}
                    </Btn>
                  </div>
                )}
              </>
            )}
          </Panel>
        </>
      )}

      {!isMultiShopOwner && mode === 'levels' && (
        <>
          <div className="tiles tiles-4" style={{ marginBottom: 16 }}>
            <Tile
              label="Total stock value"
              value={seesValuation ? money(summary.value) : '—'}
              note="Combined valuation"
            />
            <Tile
              label="Godown stock"
              value={`${num0(summary.godownPcs)} pcs`}
              note="In warehouse storage"
            />
            <Tile
              label="Counter stock"
              value={`${num0(summary.counterPcs)} pcs`}
              note="Front retail display"
            />
            <Tile
              label="Below minimum"
              value={`${num0(summary.low)} items`}
              note={summary.low > 0 ? 'Requires restock' : 'Levels adequate'}
            />
          </div>

          <Panel>
            <div className="panel-head">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <h3 className="panel-title" style={{ margin: 0 }}>On hand</h3>
                <span className="t-caption">{filtered.length} shown</span>
              </div>
              <div className="panel-actions">
                {categoryOptions.length > 0 && (
                  <select
                    className="field-control"
                    style={{ width: 170 }}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    aria-label="Filter by category"
                  >
                    <option value="">All categories</option>
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                <div className="toolbar-grow search-box">
                  <input className="field-control" placeholder="Search product or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                    width: 40,
                    height: 40,
                    ...(lowOnly ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#ffffff' } : {}),
                  }}
                  aria-label="Filter low stock only"
                  aria-pressed={lowOnly}
                  title="Filter low stock only"
                  data-tooltip={lowOnly ? 'Showing low stock only' : 'Filter low stock only'}
                  onClick={() => setLowOnly((v) => !v)}
                >
                  <IconLowStock size={16} />
                </Btn>
                <Btn
                  variant="ghost"
                  className="btn-icon"
                  style={{ width: 40, height: 40 }}
                  aria-label="Stock movement history"
                  disabled title="Stock movement history is not available yet."
                  data-tooltip="Stock movement history"
                  onClick={() => setMode('history')}
                >
                  <IconHistory size={16} />
                </Btn>
                <Btn variant="primary" disabled={stockProducts.length === 0} onClick={openTransfer}>
                  <IconTransfer /> Transfer stock
                </Btn>
              </div>
            </div>

            {stockProducts.length === 0 ? (
              <EmptyState title="No stock rows" hint="Add products first." />
            ) : (
              <DataTable
                cols={cols}
                rows={filtered}
                manualSort={true}
                onRowClick={(p) => setSelectedProduct(p)}
                ariaLabel="Stock on hand"
                empty={<EmptyState title="No stock rows" hint="Nothing matches this filter." />}
              />
            )}
          </Panel>
        </>
      )}

      {mode === 'history' && (
        <StockMovementHistory
          shopId={shopId}
          seesValuation={seesValuation}
          onBack={() => setMode(isMultiShopOwner ? 'network' : 'levels')}
        />
      )}

      <Drawer
        open={Boolean(selectedProduct)}
        title="Product stock details"
        onClose={() => setSelectedProduct(null)}
      >
        {selectedProduct && (
          <div className="stack" style={{ gap: 16 }}>
            <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{selectedProduct.name}</h3>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    {selectedProduct.category && <Tag kind="gray">{selectedProduct.category}</Tag>}
                    {selectedProduct.barcode && <span className="t-caption">Barcode: {selectedProduct.barcode}</span>}
                    {selectedProduct.code && <span className="t-caption">Code: {selectedProduct.code}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="num" style={{ fontSize: 18, fontWeight: 600 }}>{money(selectedProduct.rate || selectedProduct.mrp)}</div>
                  {selectedProduct.mrp > selectedProduct.rate && (
                    <div className="t-caption">MRP: {money(selectedProduct.mrp)}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="tiles tiles-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <Tile
                label="Godown storage"
                value={`${num0(selectedProduct.godownPcs)} pcs`}
                note={selectedProduct.unit ? `Unit: ${selectedProduct.unit}` : undefined}
              />
              <Tile
                label="Counter display"
                value={`${num0(selectedProduct.counterPcs)} pcs`}
                note={selectedProduct.counterPcs <= selectedProduct.lowLevel ? 'At or below minimum' : 'Normal level'}
              />
              <Tile
                label="Total stock"
                value={`${num0(selectedProduct.godownPcs + selectedProduct.counterPcs)} pcs`}
                note={seesValuation ? `Value: ${money(selectedProduct.stockValue ?? NaN)}` : undefined}
              />
              <Tile
                label="Minimum alert level"
                value={`${num0(selectedProduct.lowLevel)} pcs`}
                note={selectedProduct.counterPcs + selectedProduct.godownPcs <= selectedProduct.lowLevel ? 'Restock needed' : 'Sufficient'}
              />
            </div>

            <div>
              <Btn
                variant="primary"
                sm
                block
                onClick={() => {
                  setTransferProductId(selectedProduct.id)
                  setTransferOpen(true)
                }}
              >
                <IconTransfer /> Transfer stock
              </Btn>
            </div>

            <div style={{ marginTop: 8 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Transfer history</h4>
              {productTransfers.length === 0 ? (
                <EmptyState title="No transfers recorded" hint="No transfers between godown and counter for this product." />
              ) : (
                <div className="tbl-scroll" style={{ maxHeight: 280 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Direction</th>
                        <th className="td-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productTransfers.map((t) => (
                        <tr key={t.id}>
                          <td className="num">{t.date ? formatDate(t.date) : '—'}</td>
                          <td>
                            <Tag kind={t.from === 'godown' ? 'purple' : 'blue'}>
                              {t.from === 'godown' ? 'Godown → Counter' : 'Counter → Godown'}
                            </Tag>
                          </td>
                          <td className="td-right num" style={{ fontWeight: 600 }}>
                            {t.qty} pcs
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <StockTransferDrawer
        open={transferOpen}
        onClose={() => {
          setTransferOpen(false)
          setTransferProductId(undefined)
        }}
        initialProductId={transferProductId}
        shopId={shopId}
        products={d.products}
        onSuccess={() => d.refresh()}
      />

      <PinManagementModal
        open={pinModalOpen}
        onClose={() => setPinModalOpen(false)}
        title="Pinned Products Priority"
        pinnedKeys={pinnedKeys}
        allItems={stockProducts.map((p) => ({
          key: p.id,
          label: p.name,
          sublabel: [p.unit && p.unit !== '-' ? p.unit : '', p.category].filter(Boolean).join(' · '),
          soldText: `${p.soldCount || 0} sold`,
        }))}
        onMovePinned={movePinnedItem}
        onPin={pinItem}
        onUnpin={unpinItem}
      />
    </>
  )
}

export default function StockPageGuarded() {
  const { can } = useAuth()
  if (!can('stock')) return <NoAccess what="Stock" />
  return <StockPage />
}
