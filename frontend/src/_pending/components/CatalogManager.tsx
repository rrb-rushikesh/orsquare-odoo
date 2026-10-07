import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import {
  createCategory,
  createParent,
  createUnit,
  deleteCategory,
  deleteParent,
  deleteUnit,
  listParents,
  updateCategory,
  updateParent,
  updateUnit,
  type PCategory,
  type PParent,
  type PUnit,
} from '@/lib/repo'
import { Btn, Drawer, Tag, useToast } from '@/components/ui'
import { IconCheck, IconEdit, IconTrash, IconX } from '@/components/icons'

type UnitRow = { id: string; name: string; isDefault: boolean; originPreset: string }
type CatRow = { id: string; name: string; isDefault: boolean; originPreset: string }

const toUnitRows = (raw: PUnit[]): UnitRow[] =>
  raw.map((r) => ({ id: r.id, name: r.name, isDefault: r.isDefault, originPreset: r.originPreset }))

const toCatRows = (raw: PCategory[]): CatRow[] =>
  raw.map((r) => ({ id: r.id, name: r.name, isDefault: r.isDefault, originPreset: r.originPreset }))

const PROTECTED_TOOLTIP = 'Protected default provided by the preset — disable the preset (Developer Console) to make it editable.'

export function CatalogManager({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { wsUid } = useAuth()
  const d = useData()
  const toast = useToast()
  const shopId = wsUid

  const [activeTab, setActiveTab] = useState<'categories' | 'units' | 'brands'>('categories')
  const [units, setUnits] = useState<UnitRow[]>([])
  const [categories, setCategories] = useState<CatRow[]>([])
  const [brands, setBrands] = useState<PParent[]>([])
  const [addUnitName, setAddUnitName] = useState('')
  const [addCatName, setAddCatName] = useState('')
  const [addBrandName, setAddBrandName] = useState('')
  const [editingUnit, setEditingUnit] = useState<UnitRow | null>(null)
  const [editingCat, setEditingCat] = useState<CatRow | null>(null)
  const [editingBrand, setEditingBrand] = useState<PParent | null>(null)
  const [busy, setBusy] = useState(false)

  // Seed once per open.
  useEffect(() => {
    if (!open) return
    setUnits(toUnitRows(d.meta?.unitsRaw ?? []))
    setCategories(toCatRows(d.meta?.categoriesRaw ?? []))
    setAddUnitName('')
    setAddCatName('')
    setAddBrandName('')
    setEditingUnit(null)
    setEditingCat(null)
    setEditingBrand(null)
  }, [open, d.meta])

  useEffect(() => {
    if (!open || !shopId) return
    let alive = true
    listParents(shopId)
      .then((rows) => {
        if (alive) setBrands(rows)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open, shopId])

  // Meta refreshed after a mutation (d.refresh), adopt the server rows.
  useEffect(() => {
    if (!open || !d.meta) return
    setUnits(toUnitRows(d.meta.unitsRaw ?? []))
    setCategories(toCatRows(d.meta.categoriesRaw ?? []))
  }, [open, d.meta])

  const run = async (fn: () => Promise<unknown>, okMsg: string, errMsg: string): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      toast(okMsg, 'ok')
      d.refresh()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : errMsg, 'err')
      return false
    } finally {
      setBusy(false)
    }
  }

  function addUnitRow() {
    const v = addUnitName.trim().toUpperCase()
    if (!v) return
    if (units.some((r) => r.name.toUpperCase() === v)) {
      return toast(`${v} is already in units.`, 'err')
    }
    run(
      () => createUnit(shopId, v),
      `${v} added to catalogue.`,
      'Failed to add item.'
    ).then((ok) => {
      if (!ok) return
      setAddUnitName('')
    })
  }

  function saveUnitEdit() {
    if (!editingUnit) return
    const next = editingUnit.name.trim().toUpperCase()
    if (!next) return
    if (units.some((r) => r.id !== editingUnit.id && r.name.toUpperCase() === next)) {
      return toast(`${next} already exists.`, 'err')
    }
    const row = editingUnit
    run(
      () => updateUnit(shopId, row.id, next),
      'Unit updated.',
      'Update failed.'
    ).then((ok) => {
      if (!ok) return
      setUnits(units.map((r) => (r.id === row.id ? { ...row, name: next } : r)))
      setEditingUnit(null)
    })
  }

  function addCatRow() {
    const v = addCatName.trim().toUpperCase()
    if (!v) return
    if (categories.some((r) => r.name.toUpperCase() === v)) {
      return toast(`${v} is already in categories.`, 'err')
    }
    run(
      () => createCategory(shopId, v),
      `${v} added to catalogue.`,
      'Failed to add item.'
    ).then((ok) => {
      if (!ok) return
      setAddCatName('')
    })
  }

  function saveCatEdit() {
    if (!editingCat) return
    const next = editingCat.name.trim().toUpperCase()
    if (!next) return
    if (categories.some((r) => r.id !== editingCat.id && r.name.toUpperCase() === next)) {
      return toast(`${next} already exists.`, 'err')
    }
    const row = editingCat
    run(
      () => updateCategory(shopId, row.id, next),
      'Category updated.',
      'Update failed.'
    ).then((ok) => {
      if (!ok) return
      setCategories(categories.map((r) => (r.id === row.id ? { ...row, name: next } : r)))
      setEditingCat(null)
    })
  }

  function removeUnit(row: UnitRow) {
    run(
      () => deleteUnit(shopId, row.id),
      `${row.name} removed from catalogue.`,
      'Delete failed.'
    ).then((ok) => ok && setUnits(units.filter((r) => r.id !== row.id)))
  }

  function removeCat(row: CatRow) {
    run(
      () => deleteCategory(shopId, row.id),
      `${row.name} removed from catalogue.`,
      'Delete failed.'
    ).then((ok) => ok && setCategories(categories.filter((r) => r.id !== row.id)))
  }

  function addBrandRow() {
    const v = addBrandName.trim()
    if (!v) return
    if (brands.some((r) => r.name.toUpperCase() === v.toUpperCase())) {
      return toast(`${v} already exists.`, 'err')
    }
    run(
      () => createParent(shopId, v),
      `${v} added to brands.`,
      'Failed to add brand.'
    ).then(async (ok) => {
      if (!ok) return
      setAddBrandName('')
      setBrands(await listParents(shopId))
    })
  }

  function saveBrandEdit() {
    if (!editingBrand) return
    const next = editingBrand.name.trim()
    if (!next) return
    if (brands.some((r) => r.id !== editingBrand.id && r.name.toUpperCase() === next.toUpperCase())) {
      return toast(`${next} already exists.`, 'err')
    }
    const row = editingBrand
    run(
      () => updateParent(shopId, row.id, next, row.fullName),
      'Brand updated.',
      'Update failed.'
    ).then((ok) => {
      if (!ok) return
      setBrands(brands.map((r) => (r.id === row.id ? { ...row, name: next } : r)))
      setEditingBrand(null)
    })
  }

  function removeBrand(row: PParent) {
    run(
      () => deleteParent(shopId, row.id),
      `${row.name} removed from brands.`,
      'Delete failed.'
    ).then((ok) => ok && setBrands(brands.filter((r) => r.id !== row.id)))
  }

  function renderBrands() {
    const addArea = (
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="field-control"
          value={addBrandName}
          autoComplete="off"
          onChange={(e) => setAddBrandName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && addBrandName.trim() && !busy) addBrandRow()
          }}
          placeholder="Short brand name — e.g. MCD, RS, RC, KF"
        />
        <Btn variant="primary" disabled={!addBrandName.trim() || busy} onClick={addBrandRow}>
          + Add
        </Btn>
      </div>
    )

    return renderShell(
      'Brands',
      brands.length,
      addArea,
      'brand',
      brands.map((r) => {
        const isEditing = editingBrand?.id === r.id
        return (
          <div
            key={r.id}
            className="check-row"
            style={{
              padding: '8px 12px',
              background: 'var(--canvas)',
              borderBottom: '1px solid var(--line)',
              width: '100%',
              justifyContent: 'space-between',
            }}
          >
            {isEditing && editingBrand ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                <input
                  className="field-control"
                  value={editingBrand.name}
                  autoFocus
                  style={{ height: 32 }}
                  onChange={(e) => setEditingBrand({ ...editingBrand, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveBrandEdit()
                    else if (e.key === 'Escape') setEditingBrand(null)
                  }}
                />
                <button className="icon-btn" aria-label="Apply brand change" title="Save" onClick={saveBrandEdit}>
                  <IconCheck size={16} />
                </button>
                <button className="icon-btn" aria-label="Cancel brand change" title="Cancel" onClick={() => setEditingBrand(null)}>
                  <IconX size={16} />
                </button>
              </div>
            ) : (
              <>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: 'var(--ink)' }}>{r.name}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="icon-btn"
                    aria-label={`Edit ${r.name}`}
                    title="Edit"
                    onClick={() => setEditingBrand({ ...r })}
                  >
                    <IconEdit size={14} />
                  </button>
                  <button
                    className="icon-btn del"
                    aria-label={`Delete ${r.name}`}
                    title="Delete"
                    onClick={() => removeBrand(r)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })
    )
  }

  function renderShell(label: string, count: number, addArea: ReactNode, emptyKind: string, rowsNode: ReactNode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
          <Tag tone="gray">{count} {count === 1 ? 'item' : 'items'}</Tag>
        </div>
        {addArea}
        {count === 0 ? (
          <div className="t-caption" style={{ padding: '16px 0', textAlign: 'center' }}>
            No {emptyKind}s registered yet. Add the first one above.
          </div>
        ) : (
          <div
            className="supplier-list"
            style={{
              flex: 1,
              minHeight: 420,
              maxHeight: 'calc(100vh - 240px)',
              overflowY: 'auto',
              border: '1px solid var(--line)',
              background: 'var(--canvas)',
            }}
          >
            {rowsNode}
          </div>
        )}
      </div>
    )
  }

  function renderUnits() {
    const addArea = (
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="field-control"
          value={addUnitName}
          autoComplete="off"
          onChange={(e) => setAddUnitName(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && addUnitName.trim() && !busy) addUnitRow()
          }}
          placeholder="e.g. PCS, PLATE, BOWL, KG, BOX"
        />
        <Btn variant="primary" disabled={!addUnitName.trim() || busy} onClick={addUnitRow}>
          + Add
        </Btn>
      </div>
    )

    return renderShell(
      'Measurement Units',
      units.length,
      addArea,
      'unit',
      units.map((r) => {
        const isEditing = editingUnit?.id === r.id
        return (
          <div
            key={r.id}
            className="check-row"
            style={{
              padding: '8px 12px',
              background: 'var(--canvas)',
              borderBottom: '1px solid var(--line)',
              width: '100%',
              justifyContent: 'space-between',
            }}
          >
            {isEditing && editingUnit ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                <input
                  className="field-control"
                  value={editingUnit.name}
                  autoFocus
                  style={{ height: 32 }}
                  onChange={(e) => setEditingUnit({ ...editingUnit, name: e.target.value.toUpperCase() })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveUnitEdit()
                    else if (e.key === 'Escape') setEditingUnit(null)
                  }}
                />
                <button className="icon-btn" aria-label="Apply unit change" title="Save" onClick={saveUnitEdit}>
                  <IconCheck size={16} />
                </button>
                <button className="icon-btn" aria-label="Cancel unit change" title="Cancel" onClick={() => setEditingUnit(null)}>
                  <IconX size={16} />
                </button>
              </div>
            ) : (
              <>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: 'var(--ink)' }}>
                  {r.name}
                  {r.isDefault && (
                    <span style={{ marginLeft: 8 }}>
                      <Tag tone="gray" title={PROTECTED_TOOLTIP}>
                        DEFAULT
                      </Tag>
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="icon-btn"
                    aria-label={`Edit ${r.name}`}
                    title="Edit"
                    onClick={() => setEditingUnit({ ...r })}
                  >
                    <IconEdit size={14} />
                  </button>
                  <button
                    className="icon-btn del"
                    aria-label={`Delete ${r.name}`}
                    title="Delete"
                    onClick={() => removeUnit(r)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })
    )
  }

  function renderCategories() {
    const addArea = (
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="field-control"
          value={addCatName}
          autoComplete="off"
          onChange={(e) => setAddCatName(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && addCatName.trim() && !busy) addCatRow()
          }}
          placeholder="e.g. STARTERS, BEVERAGES, MAIN COURSE, SNACKS"
        />
        <Btn variant="primary" disabled={!addCatName.trim() || busy} onClick={addCatRow}>
          + Add
        </Btn>
      </div>
    )

    return renderShell(
      'Product Categories',
      categories.length,
      addArea,
      'category',
      categories.map((r) => {
        const isEditing = editingCat?.id === r.id
        return (
          <div
            key={r.id}
            className="check-row"
            style={{
              padding: '8px 12px',
              background: 'var(--canvas)',
              borderBottom: '1px solid var(--line)',
              width: '100%',
              justifyContent: 'space-between',
            }}
          >
            {isEditing && editingCat ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                <input
                  className="field-control"
                  value={editingCat.name}
                  autoFocus
                  style={{ height: 32 }}
                  onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value.toUpperCase() })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveCatEdit()
                    else if (e.key === 'Escape') setEditingCat(null)
                  }}
                />
                <button className="icon-btn" aria-label="Apply category change" title="Save" onClick={saveCatEdit}>
                  <IconCheck size={16} />
                </button>
                <button className="icon-btn" aria-label="Cancel category change" title="Cancel" onClick={() => setEditingCat(null)}>
                  <IconX size={16} />
                </button>
              </div>
            ) : (
              <>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: 'var(--ink)' }}>
                  {r.name}
                  {r.isDefault && (
                    <span style={{ marginLeft: 8 }}>
                      <Tag tone="gray" title={PROTECTED_TOOLTIP}>
                        DEFAULT
                      </Tag>
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="icon-btn"
                    aria-label={`Edit ${r.name}`}
                    title="Edit"
                    onClick={() => setEditingCat({ ...r })}
                  >
                    <IconEdit size={14} />
                  </button>
                  <button
                    className="icon-btn del"
                    aria-label={`Delete ${r.name}`}
                    title="Delete"
                    onClick={() => removeCat(r)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })
    )
  }

  return (
    <Drawer
      open={open}
      title="Catalogue Options"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
          <Btn variant="secondary" onClick={onClose}>
            Close
          </Btn>
        </div>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 12px 0' }}>
        Configure the categories and units offered across all product entry forms and POS terminals.
      </p>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
        <button
          className={`nav-item ${activeTab === 'categories' ? 'active' : ''}`}
          style={{ height: 38, fontSize: 13, padding: '0 16px' }}
          onClick={() => setActiveTab('categories')}
        >
          Categories ({categories.length})
        </button>
        <button
          className={`nav-item ${activeTab === 'units' ? 'active' : ''}`}
          style={{ height: 38, fontSize: 13, padding: '0 16px' }}
          onClick={() => setActiveTab('units')}
        >
          Units ({units.length})
        </button>
        <button
          className={`nav-item ${activeTab === 'brands' ? 'active' : ''}`}
          style={{ height: 38, fontSize: 13, padding: '0 16px' }}
          onClick={() => setActiveTab('brands')}
        >
          Brands ({brands.length})
        </button>
      </div>

      {activeTab === 'categories' && renderCategories()}

      {activeTab === 'units' && renderUnits()}

      {activeTab === 'brands' && renderBrands()}
    </Drawer>
  )
}
