import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import { createCategory, createParent, createProduct, createUnit, listParents, updateProduct, type PCategory, type PParent, type PProduct, type PUnit } from '@/lib/repo'
import { Btn, Drawer, Field, NumInput, Tag, useToast } from '@/components/ui'
import { IconPlus } from '@/components/icons'

/** Inline searchable combobox for fast keyboard-friendly filtering */
function InlineSearchSelect({
  value,
  onChange,
  options,
  placeholder,
  emptyLabel = 'None',
  style,
  ariaLabel,
}: {
  value: string | null
  onChange: (val: string | null) => void
  options: { value: string; label: string }[]
  placeholder?: string
  emptyLabel?: string
  ariaLabel?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOpt = useMemo(() => options.find((o) => o.value === value), [options, value])

  const filtered = useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase().trim()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (val: string | null) => {
    onChange(val)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    const totalItems = 1 + filtered.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx((prev) => (prev + 1) % totalItems)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((prev) => (prev - 1 + totalItems) % totalItems)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightIdx === 0) {
        handleSelect(null)
      } else if (filtered[highlightIdx - 1]) {
        handleSelect(filtered[highlightIdx - 1].value)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 0, ...style }}>
      <input
        ref={inputRef}
        type="text"
        className="field-control"
        aria-label={ariaLabel}
        value={open ? query : selectedOpt?.label || ''}
        placeholder={open ? (selectedOpt?.label || placeholder || 'Type to search…') : (selectedOpt?.label || placeholder || emptyLabel)}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setHighlightIdx(0)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setHighlightIdx(0)
        }}
        onKeyDown={onKeyDown}
        style={{
          width: '100%',
          borderRadius: 0,
          paddingRight: 24,
        }}
        autoComplete="off"
      />
      <span
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          fontSize: 10,
          color: 'var(--muted, #525252)',
        }}
      >
        ▼
      </span>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 2px)',
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--canvas, #ffffff)',
            border: '1px solid var(--ink, #161616)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 100,
            borderRadius: 0,
          }}
        >
          <div
            onMouseDown={(e) => {
              e.preventDefault()
              handleSelect(null)
            }}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              cursor: 'pointer',
              color: 'var(--muted, #525252)',
              fontStyle: 'italic',
              background: highlightIdx === 0 ? 'var(--layer-selected, #edf5ff)' : 'transparent',
              borderBottom: '1px solid var(--line, #e0e0e0)',
            }}
          >
            {emptyLabel}
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted, #525252)' }}>
              No matches for "{query}"
            </div>
          ) : (
            filtered.map((opt, idx) => {
              const isHighlighted = highlightIdx === idx + 1
              const isCurrent = opt.value === value
              return (
                <div
                  key={opt.value}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelect(opt.value)
                  }}
                  onMouseEnter={() => setHighlightIdx(idx + 1)}
                  style={{
                    padding: '8px 12px',
                    fontSize: 13,
                    cursor: 'pointer',
                    color: isCurrent ? 'var(--blue, #0f62fe)' : 'var(--ink, #161616)',
                    fontWeight: isCurrent ? 600 : 400,
                    background: isHighlighted ? 'var(--layer-selected, #edf5ff)' : 'transparent',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{opt.label}</span>
                  {isCurrent && <span style={{ fontSize: 11, color: 'var(--blue, #0f62fe)' }}>✓</span>}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

/** Unit quick-add semantics (retail): ML and LTR are numeric measures whose
 *  canonical persisted name is derived (`500` → `500 ML`, `1` → `1 LTR`);
 *  OTHERS accepts any domain-valid free text (PCS, PACK, BOX, HALF…).
 *  One normalization rule everywhere — always uppercase, no case variants. */
type UnitKind = 'ml' | 'ltr' | 'others'

const UNIT_KINDS: { value: UnitKind; label: string; placeholder: string; numeric: boolean }[] = [
  { value: 'ml', label: 'ML', placeholder: 'e.g. 90, 180, 375, 500', numeric: true },
  { value: 'ltr', label: 'LTR', placeholder: 'e.g. 1, 2', numeric: true },
  { value: 'others', label: 'OTHERS', placeholder: 'e.g. PCS, PACK, BOX, HALF', numeric: false },
]

function normalizeUnitInput(kind: UnitKind, raw: string): { name: string; mlVolume: number | null; error?: string } {
  const v = raw.trim()
  if (!v) return { name: '', mlVolume: null, error: 'Enter a value.' }
  if (kind === 'ml') {
    if (!/^\d+$/.test(v)) return { name: '', mlVolume: null, error: 'ML needs a whole number, e.g. 500.' }
    const n = parseInt(v, 10)
    if (n <= 0) return { name: '', mlVolume: null, error: 'ML must be greater than zero.' }
    return { name: `${n} ML`, mlVolume: n }
  }
  if (kind === 'ltr') {
    if (!/^\d+(\.\d+)?$/.test(v)) return { name: '', mlVolume: null, error: 'LTR needs a number, e.g. 1 or 2.' }
    const n = parseFloat(v)
    if (n <= 0) return { name: '', mlVolume: null, error: 'LTR must be greater than zero.' }
    return { name: `${v} LTR`, mlVolume: Math.round(n * 1000) }
  }
  return { name: v.toUpperCase(), mlVolume: null }
}

/** Dropdown label: the ml annotation is only appended when the name does not
 *  already carry the size (avoids the redundant "500 ML (500 ML)"). */
function unitOptionLabel(u: PUnit): string {
  if (u.ml_volume && !/\d/.test(u.name) && !/^(ML|LTR)$/i.test(u.name)) return `${u.name} (${u.ml_volume} ML)`
  return u.name
}

/** Merge freshly created master rows into the authoritative server list until
 *  the DataProvider meta catches up (dedupe by id — server wins). */
function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  if (!extra.length) return base
  const seen = new Set(base.map((r) => r.id))
  return [...base, ...extra.filter((r) => !seen.has(r.id))]
}

export interface ProductDraft {
  code: string
  barcode: string
  name: string
  brand: string
  parentId: string | null
  flavour: string
  categoryId: string | null
  unitId: string | null
  mrp: number
  rate: number
  piecesPerBox: number
  godownPcs: number
  counterPcs: number
  lowLevel: number
  isActive: boolean
  isKitchen: boolean
}

export const blankProduct = (isKitchen = false): ProductDraft => ({
  code: '',
  barcode: '',
  name: '',
  brand: '',
  parentId: null,
  flavour: '',
  categoryId: null,
  unitId: null,
  mrp: 0,
  rate: 0,
  piecesPerBox: 1,
  godownPcs: 0,
  counterPcs: 0,
  lowLevel: 0,
  isActive: true,
  isKitchen,
})

export function ProductFormDrawer({
  open,
  initial,
  defaultProductType = 'retail',
  onClose,
  onSaved,
  onDelete,
}: {
  open: boolean
  initial: PProduct | null
  defaultProductType?: 'retail' | 'kitchen'
  onClose: () => void
  onSaved: (p: PProduct) => void
  onDelete?: (p: PProduct) => void
}) {
  const { wsUid, featureOn } = useAuth()
  const kitchenOn = featureOn('kitchen')
  const d = useData()
  const toast = useToast()
  const shopId = wsUid

  const [editing, setEditing] = useState<ProductDraft | null>(null)
  const [busy, setBusy] = useState(false)

  // Portion pricing for kitchen dishes
  const [enablePortions, setEnablePortions] = useState(false)
  const [halfRate, setHalfRate] = useState(0)
  const [fullRate, setFullRate] = useState(0)

  // One-time opening stock, offered only while CREATING a product. It is
  // deliberately not part of `editing`: once the product exists, the server
  // refuses a second opening (inventory.services.record_opening_stock), and
  // showing an editable field that cannot be saved would be a lie. The section
  // is collapsed by default so the common case - a new item with no stock yet -
  // is not interrupted.
  const [showOpeningStock, setShowOpeningStock] = useState(false)
  const [openingGodown, setOpeningGodown] = useState(0)
  const [openingCounter, setOpeningCounter] = useState(0)

  // Inline Quick Add state for Category and Unit
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingCat, setCreatingCat] = useState(false)

  const [addingUnit, setAddingUnit] = useState(false)
  const [newUnitName, setNewUnitName] = useState('')
  const [unitKind, setUnitKind] = useState<UnitKind>('ml')
  const [creatingUnit, setCreatingUnit] = useState(false)

  // Transient bridge for masters created inline: rendered alongside the
  // authoritative DataProvider lists (dedupe by id) so the just-created row
  // is selectable the instant it is created — never a blank/phantom option.
  const [localUnits, setLocalUnits] = useState<PUnit[]>([])
  const [localCats, setLocalCats] = useState<PCategory[]>([])

  const [parents, setParents] = useState<PParent[]>([])
  const [addingParent, setAddingParent] = useState(false)
  const [newParentName, setNewParentName] = useState('')
  const [creatingParent, setCreatingParent] = useState(false)

  const initialId = initial?.id ?? null

  const categories: PCategory[] = mergeById(d.meta?.categoriesRaw ?? [], localCats)
  const units: PUnit[] = mergeById(d.meta?.unitsRaw ?? [], localUnits)

  const brandOptions = useMemo(() => {
    const list = parents.map((p) => ({ value: p.id, label: p.name }))
    if (editing?.parentId && !parents.some((p) => p.id === editing.parentId)) {
      list.unshift({ value: editing.parentId, label: initial?.parentName || 'Current brand' })
    }
    return list
  }, [parents, editing?.parentId, initial?.parentName])

  const categoryOptions = useMemo(() => {
    const list = categories.map((c) => ({ value: c.id, label: c.name }))
    if (editing?.categoryId && !categories.some((c) => c.id === editing.categoryId)) {
      list.unshift({ value: editing.categoryId, label: initial?.category || 'Current category' })
    }
    return list
  }, [categories, editing?.categoryId, initial?.category])

  const unitOptions = useMemo(() => {
    const list = units.map((u) => ({ value: u.id, label: unitOptionLabel(u) }))
    if (editing?.unitId && !units.some((u) => u.id === editing.unitId)) {
      list.unshift({ value: editing.unitId, label: initial?.unit || 'Current unit' })
    }
    return list
  }, [units, editing?.unitId, initial?.unit])

  useEffect(() => {
    if (!open || !shopId) return
    let alive = true
    listParents(shopId)
      .then((rows) => {
        if (alive) setParents(rows)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open, shopId])

  async function handleCreateParent() {
    if (creatingParent) return
    const name = newParentName.trim()
    if (!name) return
    setCreatingParent(true)
    try {
      const created = await createParent(shopId, name)
      setParents((prev) => (prev.some((p) => p.id === created.id) ? prev : [...prev, created].sort((a, b) => a.name.localeCompare(b.name))))
      setEditing((cur) => (cur ? { ...cur, parentId: created.id } : cur))
      setAddingParent(false)
      setNewParentName('')
      toast(`Brand "${created.name}" created.`, 'ok')
    } catch (e: any) {
      toast(e?.message || 'Could not create the brand.', 'err')
    } finally {
      setCreatingParent(false)
    }
  }

  function resetAddForms() {
    setAddingCategory(false)
    setNewCategoryName('')
    setAddingUnit(false)
    setNewUnitName('')
    setUnitKind('ml')
    setLocalUnits([])
    setLocalCats([])
  }

  useEffect(() => {
    if (!open) {
      setEditing(null)
      resetAddForms()
      setEnablePortions(false)
      setHalfRate(0)
      setFullRate(0)
      return
    }
    const isK = initial
      ? (kitchenOn ? Boolean(initial.isKitchen) : false)
      : (kitchenOn && defaultProductType === 'kitchen')
    setEditing(
      initial
        ? {
            code: initial.code,
            barcode: initial.barcode,
            name: initial.name,
            brand: initial.brand || '',
            parentId: initial.parentId ?? null,
            flavour: initial.flavour || '',
            categoryId: initial.categoryId ?? null,
            unitId: initial.unitId ?? null,
            mrp: initial.mrp,
            rate: initial.rate || initial.mrp,
            piecesPerBox: Math.max(1, initial.piecesPerBox || 1),
            godownPcs: initial.godownPcs,
            counterPcs: initial.counterPcs,
            lowLevel: initial.lowLevel,
            isActive: initial.active,
            isKitchen: isK,
          }
        : blankProduct(isK)
    )
    if (initial) {
      setFullRate(initial.rate || initial.mrp || 0)
    }
  }, [open, initialId, defaultProductType])

  function applyCategoryChoice(catId: string | null) {
    setEditing((cur) => (cur ? { ...cur, categoryId: catId } : cur))
  }

  function applyUnitChoice(unitId: string | null) {
    setEditing((cur) => (cur ? { ...cur, unitId } : cur))
  }

  async function handleCreateCategory() {
    if (creatingCat) return
    const name = newCategoryName.trim().toUpperCase()
    if (!name) return toast('Category name is required.', 'err')
    if (categories.some((c) => c.name.toUpperCase() === name)) {
      return toast(`Category "${name}" already exists.`, 'err')
    }
    setCreatingCat(true)
    try {
      const created = await createCategory(shopId, name)
      setLocalCats((prev) => [...prev, created])
      toast(`Category "${created.name}" created.`, 'ok')
      void d.refresh()
      setEditing((cur) => (cur ? { ...cur, categoryId: created.id } : cur))
      setAddingCategory(false)
      setNewCategoryName('')
    } catch (e) {
      // Nothing is inserted and no success toast fires on failure — the form
      // keeps every already-entered value and the inline box stays open to retry.
      toast(e instanceof Error ? e.message : 'Failed to create category.', 'err')
    } finally {
      setCreatingCat(false)
    }
  }

  async function handleCreateKitchenUnit() {
    if (creatingUnit) return
    const name = newUnitName.trim().toUpperCase()
    if (!name) return toast('Unit name is required.', 'err')
    if (units.some((u) => u.name.toUpperCase() === name)) {
      return toast(`Unit "${name}" already exists.`, 'err')
    }
    setCreatingUnit(true)
    try {
      const created = await createUnit(shopId, name)
      setLocalUnits((prev) => [...prev, created])
      toast(`Unit "${created.name}" created.`, 'ok')
      void d.refresh()
      setEditing((cur) => (cur ? { ...cur, unitId: created.id } : cur))
      setAddingUnit(false)
      setNewUnitName('')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to create unit.', 'err')
    } finally {
      setCreatingUnit(false)
    }
  }

  async function handleCreateRetailUnit() {
    if (creatingUnit) return
    const parsed = normalizeUnitInput(unitKind, newUnitName)
    if (parsed.error || !parsed.name) return toast(parsed.error || 'Enter a value.', 'err')
    if (units.some((u) => u.name.toUpperCase() === parsed.name)) {
      return toast(`Unit "${parsed.name}" already exists.`, 'err')
    }
    setCreatingUnit(true)
    try {
      const created = await createUnit(shopId, parsed.name, { mlVolume: parsed.mlVolume })
      setLocalUnits((prev) => [...prev, created])
      toast(`Unit "${created.name}" created.`, 'ok')
      void d.refresh()
      setEditing((cur) => (cur ? { ...cur, unitId: created.id } : cur))
      setAddingUnit(false)
      setNewUnitName('')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to create unit.', 'err')
    } finally {
      setCreatingUnit(false)
    }
  }

  async function save() {
    if (!editing) return
    if (!editing.name.trim()) return toast('Product name is required.', 'err')

    if (editing.isKitchen) {
      if (!kitchenOn) return toast('Kitchen dishes are disabled in settings.', 'err')
      if (editing.rate <= 0) return toast('Price must be greater than zero.', 'err')
    } else {
      if (editing.mrp <= 0) return toast('MRP must be greater than zero.', 'err')
    }

    const bc = editing.isKitchen ? '' : editing.barcode.trim()
    if (bc && d.products.some((p) => p.barcode === bc && p.id !== initialId)) {
      return toast(`Barcode ${bc} already belongs to another product.`, 'err')
    }

    setBusy(true)
    try {
      const payload = {
        name: editing.name.trim(),
        brand: editing.brand?.trim() || '',
        parent: editing.parentId,
        flavour: editing.isKitchen ? '' : (editing.flavour?.trim() || ''),
        barcode: bc,
        category: editing.categoryId,
        unit: editing.unitId,
        mrp: editing.isKitchen ? editing.rate : editing.mrp,
        rate: editing.rate || editing.mrp,
        pieces_per_box: editing.isKitchen ? 1 : Math.max(1, editing.piecesPerBox || 1),
        low_level: editing.isKitchen ? 0 : editing.lowLevel,
        is_kitchen: editing.isKitchen,
        portions: editing.isKitchen && enablePortions && halfRate > 0 ? { full: editing.rate, half: halfRate } : undefined,
        // Creation only. Never sent on edit - the server has no route to change
        // an opening, and asking for one is how stock gets manufactured.
        ...(initialId
          ? {}
          : {
              opening_godown_pcs: Math.max(0, Math.round(openingGodown || 0)),
              opening_counter_pcs: Math.max(0, Math.round(openingCounter || 0)),
            }),
      }
      const saved = initialId
        ? await updateProduct(shopId, initialId, payload)
        : await createProduct(shopId, payload)

      toast(
        initialId
          ? (editing.isKitchen ? 'Kitchen dish updated.' : 'Product updated.')
          : (editing.isKitchen ? 'Kitchen dish created.' : 'Product created.'),
        'ok'
      )
      onSaved(saved)
      setEditing(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'err')
    } finally {
      setBusy(false)
    }
  }



  return (
    <Drawer
      open={open}
      title={
        initialId
          ? (editing?.isKitchen ? 'Edit Kitchen Dish' : 'Edit Product')
          : (editing?.isKitchen ? 'New Kitchen Dish' : 'New Product')
      }
      onClose={onClose}
      footer={
        <>
          {onDelete && initialId && initial && (
            <Btn variant="ghost" style={{ color: 'var(--err)' }} disabled title="Product deletion is not available yet." onClick={() => onDelete(initial)}>
              Delete Product
            </Btn>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn variant="secondary" onClick={onClose}>
              Cancel
            </Btn>
            <Btn variant="primary" disabled={busy} onClick={save}>
              {busy
                ? 'Saving…'
                : initialId
                  ? 'Save changes'
                  : editing?.isKitchen
                    ? 'Create dish'
                    : 'Create product'}
            </Btn>
          </div>
        </>
      }
    >
      {editing && (
        <>
          {/* Product Type Switcher */}
          {!initialId && kitchenOn && (
            <div style={{ marginBottom: 16 }}>
              <div className="micro-label" style={{ marginBottom: 6 }}>Product Classification</div>
              <div className="seg" role="tablist" aria-label="Product Classification" style={{ width: '100%', display: 'flex' }}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!editing.isKitchen}
                  className={`seg-btn ${!editing.isKitchen ? 'active' : ''}`}
                  style={{ flex: 1, height: 38, fontSize: 13 }}
                  onClick={() => setEditing({ ...editing, isKitchen: false })}
                >
                  Retail Product
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editing.isKitchen}
                  className={`seg-btn ${editing.isKitchen ? 'active' : ''}`}
                  style={{ flex: 1, height: 38, fontSize: 13 }}
                  onClick={() => {
                    setEditing({
                      ...editing,
                      isKitchen: true,
                      barcode: '',
                      piecesPerBox: 1,
                      lowLevel: 0,
                      mrp: editing.rate > 0 ? editing.rate : editing.mrp,
                      rate: editing.rate > 0 ? editing.rate : editing.mrp,
                    })
                  }}
                >
                  Kitchen Dish
                </button>
              </div>
            </div>
          )}

          {editing.isKitchen ? (
            /* ---- Kitchen Dish Form ---- */
            <>
              <div style={{ background: 'var(--layer)', border: '1px solid var(--line)', padding: '10px 12px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Tag kind="blue">KITCHEN DISH</Tag>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>Made-to-Order & Infinite Stock</span>
                </div>
                <div className="t-caption" style={{ marginTop: 4 }}>
                  No godown stock, no supplier purchases, and no barcode needed. Available instantly on the POS counter.
                </div>
              </div>

              <Field label="Dish Name" required>
                <input
                  className="field-control"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. Paneer Chilli, Chicken Biryani, Dal Tadka"
                  autoFocus
                  autoComplete="off"
                />
              </Field>

              <div className="form-grid">
                <Field label="Category" help="Food & beverage kitchen section.">
                  {addingCategory ? (
                    <div className="quick-add-box">
                      <input
                        className="field-control"
                        placeholder="New category name…"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleCreateCategory()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            e.stopPropagation()
                            setAddingCategory(false)
                            setNewCategoryName('')
                          }
                        }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Btn
                          type="button"
                          variant="primary"
                          sm
                          disabled={creatingCat || !newCategoryName.trim()}
                          onClick={() => void handleCreateCategory()}
                        >
                          {creatingCat ? 'Saving…' : 'Save'}
                        </Btn>
                        <Btn
                          type="button"
                          variant="ghost"
                          sm
                          onClick={() => {
                            setAddingCategory(false)
                            setNewCategoryName('')
                          }}
                        >
                          Cancel
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                      <InlineSearchSelect
                        options={categoryOptions}
                        value={editing.categoryId}
                        onChange={(val) => applyCategoryChoice(val)}
                        emptyLabel="No category"
                        placeholder="Search or select category…"
                        ariaLabel="Kitchen category"
                      />
                      <Btn
                        type="button"
                        variant="tertiary"
                        className="btn-icon"
                        style={{ width: 40, height: 40, flexShrink: 0 }}
                        onClick={() => {
                          setAddingCategory(true)
                          setNewCategoryName('')
                        }}
                        title="Add new category"
                        data-tooltip="Add new category"
                        data-tooltip-align="right"
                        aria-label="Add new category"
                      >
                        <IconPlus size={16} />
                      </Btn>
                    </div>
                  )}
                </Field>

                <Field label="Serving Portion / Unit" help="e.g. Plate, Bowl, Glass, Half, Full">
                  {addingUnit ? (
                    <div className="quick-add-box">
                      <input
                        className="field-control"
                        placeholder="Serving unit (e.g. Plate, Bowl)…"
                        value={newUnitName}
                        onChange={(e) => setNewUnitName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleCreateKitchenUnit()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            e.stopPropagation()
                            setAddingUnit(false)
                            setNewUnitName('')
                          }
                        }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Btn
                          type="button"
                          variant="primary"
                          sm
                          disabled={creatingUnit || !newUnitName.trim()}
                          onClick={() => void handleCreateKitchenUnit()}
                        >
                          {creatingUnit ? 'Saving…' : 'Save'}
                        </Btn>
                        <Btn
                          type="button"
                          variant="ghost"
                          sm
                          onClick={() => {
                            setAddingUnit(false)
                            setNewUnitName('')
                          }}
                        >
                          Cancel
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                      <InlineSearchSelect
                        options={unitOptions}
                        value={editing.unitId}
                        onChange={(val) => applyUnitChoice(val)}
                        emptyLabel="No unit"
                        placeholder="Search or select unit…"
                        ariaLabel="Serving portion unit"
                      />
                      <Btn
                        type="button"
                        variant="tertiary"
                        className="btn-icon"
                        style={{ width: 40, height: 40, flexShrink: 0 }}
                        onClick={() => {
                          setAddingUnit(true)
                          setNewUnitName('')
                        }}
                        title="Add new serving unit"
                        data-tooltip="Add new serving unit"
                        data-tooltip-align="right"
                        aria-label="Add new serving unit"
                      >
                        <IconPlus size={16} />
                      </Btn>
                    </div>
                  )}
                </Field>

                <Field label="Dish Price (₹)" required help="POS billing rate for this dish.">
                  <NumInput
                    className="field-control num"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={editing.rate}
                    onChange={(n) => {
                      setEditing({ ...editing, rate: n, mrp: n })
                      setFullRate(n)
                    }}
                  />
                </Field>
              </div>

              {!initialId && (
                <div style={{ marginTop: 12, padding: 12, background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={enablePortions}
                      onChange={(e) => setEnablePortions(e.target.checked)}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                      Offer in Half & Full portions
                    </span>
                  </label>
                  {enablePortions && (
                    <div className="form-grid" style={{ marginTop: 10 }}>
                      <Field label="Full Portion Rate (₹)">
                        <NumInput
                          className="field-control num"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={fullRate || editing.rate}
                          onChange={(n) => {
                            setFullRate(n)
                            setEditing({ ...editing, rate: n, mrp: n })
                          }}
                        />
                      </Field>
                      <Field label="Half Portion Rate (₹)">
                        <NumInput
                          className="field-control num"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={halfRate}
                          onChange={(n) => setHalfRate(n)}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* ---- Standard Retail Product Form ---- */
            <>
              <Field label="Product Name" required>
                <input
                  className="field-control"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. Classic Cola 500 ML"
                  autoFocus
                  autoComplete="off"
                />
              </Field>

              {!editing.isKitchen && (
                <div className="form-grid">
                  <Field
                    label="Brand"
                    help="Short brand name used by the counter sheet. The register rolls every flavour up under it. Manage brands from Products → gear → Brands."
                  >
                    {addingParent ? (
                      <div className="quick-add-box">
                        <input
                          className="field-control"
                          placeholder="New brand name…"
                          value={newParentName}
                          onChange={(e) => setNewParentName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void handleCreateParent()
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              e.stopPropagation()
                              setAddingParent(false)
                              setNewParentName('')
                            }
                          }}
                          autoFocus
                        />
                        <Btn sm variant="primary" type="button" disabled={creatingParent} onClick={() => void handleCreateParent()}>
                          Add
                        </Btn>
                        <Btn
                          sm
                          variant="ghost"
                          type="button"
                          onClick={() => {
                            setAddingParent(false)
                            setNewParentName('')
                          }}
                        >
                          Cancel
                        </Btn>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                        <InlineSearchSelect
                          options={brandOptions}
                          value={editing.parentId}
                          onChange={(val) => setEditing({ ...editing, parentId: val })}
                          emptyLabel="— No brand master —"
                          placeholder="Search or select brand…"
                          ariaLabel="Brand"
                        />
                        <Btn sm variant="ghost" type="button" title="New brand" onClick={() => setAddingParent(true)}>
                          <IconPlus size={13} />
                        </Btn>
                      </div>
                    )}
                  </Field>

                  <Field label="Flavour / variant" help="Leave blank for single-variant brands.">
                    <input
                      className="field-control"
                      disabled title="Product variants are not available yet." value={editing.flavour}
                      onChange={(e) => setEditing({ ...editing, flavour: e.target.value })}
                      placeholder="e.g. Green Apple"
                      autoComplete="off"
                    />
                  </Field>
                </div>
              )}

              <div className="form-grid">
                <Field label="Barcode" help="Scan or type — used for POS instant scanning.">
                  <input
                    className="field-control num"
                    value={editing.barcode}
                    onChange={(e) => setEditing({ ...editing, barcode: e.target.value })}
                    inputMode="numeric"
                    placeholder="Scan or enter barcode"
                    autoComplete="off"
                  />
                </Field>

                <Field label="Category">
                  {addingCategory ? (
                    <div className="quick-add-box">
                      <input
                        className="field-control"
                        placeholder="New category name…"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleCreateCategory()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            e.stopPropagation()
                            setAddingCategory(false)
                            setNewCategoryName('')
                          }
                        }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Btn
                          type="button"
                          variant="primary"
                          sm
                          disabled={creatingCat || !newCategoryName.trim()}
                          onClick={() => void handleCreateCategory()}
                        >
                          {creatingCat ? 'Saving…' : 'Save'}
                        </Btn>
                        <Btn
                          type="button"
                          variant="ghost"
                          sm
                          onClick={() => {
                            setAddingCategory(false)
                            setNewCategoryName('')
                          }}
                        >
                          Cancel
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                      <InlineSearchSelect
                        options={categoryOptions}
                        value={editing.categoryId}
                        onChange={(val) => applyCategoryChoice(val)}
                        emptyLabel="No category"
                        placeholder="Search or select category…"
                        ariaLabel="Category"
                      />
                      <Btn
                        type="button"
                        variant="tertiary"
                        className="btn-icon"
                        style={{ width: 40, height: 40, flexShrink: 0 }}
                        onClick={() => {
                          setAddingCategory(true)
                          setNewCategoryName('')
                        }}
                        title="Add new category"
                        data-tooltip="Add new category"
                        data-tooltip-align="right"
                        aria-label="Add new category"
                      >
                        <IconPlus size={16} />
                      </Btn>
                    </div>
                  )}
                </Field>

                <Field label="Unit" help="Bottle measure (ML/LTR) or pack unit. + adds a new one.">
                  {addingUnit ? (
                    <div className="quick-add-box">
                      <div style={{ display: 'flex', gap: 4 }}>
                        <select
                          className="field-control"
                          style={{ width: 116, flexShrink: 0 }}
                          value={unitKind}
                          onChange={(e) => setUnitKind(e.target.value as UnitKind)}
                          aria-label="Unit type"
                        >
                          {UNIT_KINDS.map((k) => (
                            <option key={k.value} value={k.value}>{k.label}</option>
                          ))}
                        </select>
                        <input
                          className="field-control"
                          style={{ flex: 1, minWidth: 0 }}
                          placeholder={UNIT_KINDS.find((k) => k.value === unitKind)?.placeholder}
                          value={newUnitName}
                          onChange={(e) => setNewUnitName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void handleCreateRetailUnit()
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              e.stopPropagation()
                              setAddingUnit(false)
                              setNewUnitName('')
                            }
                          }}
                          inputMode={UNIT_KINDS.find((k) => k.value === unitKind)?.numeric ? 'numeric' : undefined}
                          autoFocus
                        />
                      </div>
                      {(() => {
                        const draft = normalizeUnitInput(unitKind, newUnitName)
                        if (draft.error) {
                          return newUnitName.trim() ? (
                            <div style={{ fontSize: 12, color: 'var(--err)' }}>{draft.error}</div>
                          ) : null
                        }
                        return (
                          <div className="t-caption">
                            Creates unit “{draft.name}”
                            {draft.mlVolume ? ` — bottle size ${draft.mlVolume} ML` : ''}
                          </div>
                        )
                      })()}
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Btn
                          type="button"
                          variant="primary"
                          sm
                          disabled={creatingUnit || !newUnitName.trim()}
                          onClick={() => void handleCreateRetailUnit()}
                        >
                          {creatingUnit ? 'Saving…' : 'Save'}
                        </Btn>
                        <Btn
                          type="button"
                          variant="ghost"
                          sm
                          onClick={() => {
                            setAddingUnit(false)
                            setNewUnitName('')
                          }}
                        >
                          Cancel
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                      <InlineSearchSelect
                        options={unitOptions}
                        value={editing.unitId}
                        onChange={(val) => applyUnitChoice(val)}
                        emptyLabel="No unit"
                        placeholder="Search or select unit…"
                        ariaLabel="Unit"
                      />
                      <Btn
                        type="button"
                        variant="tertiary"
                        className="btn-icon"
                        style={{ width: 40, height: 40, flexShrink: 0 }}
                        onClick={() => {
                          setAddingUnit(true)
                          setNewUnitName('')
                        }}
                        title="Add new unit"
                        data-tooltip="Add new unit"
                        data-tooltip-align="right"
                        aria-label="Add new unit"
                      >
                        <IconPlus size={16} />
                      </Btn>
                    </div>
                  )}
                </Field>

                <Field
                  label="Pieces per Box"
                  help="How many pieces in 1 wholesale box / case."
                >
                  <NumInput
                    className="field-control num"
                    min="1"
                    step="1"
                    placeholder="1"
                    disabled title="Box packing is not available yet." value={editing.piecesPerBox}
                    onChange={(n) => setEditing({ ...editing, piecesPerBox: Math.max(1, n) })}
                  />
                </Field>

                <Field label="MRP per piece (₹)" required>
                  <NumInput
                    className="field-control num"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={editing.mrp}
                    onChange={(n) => setEditing({ ...editing, mrp: n })}
                  />
                </Field>

                <Field label="Sales Rate (₹)" required>
                  <NumInput
                    className="field-control num"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={editing.rate}
                    onChange={(n) => setEditing({ ...editing, rate: n })}
                  />
                </Field>

                <Field label="Low Stock Level (pcs)" help="Low stock alerts fire when total drops here.">
                  <NumInput
                    className="field-control num"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={editing.lowLevel}
                    onChange={(n) => setEditing({ ...editing, lowLevel: n })}
                  />
                </Field>
              </div>

              {/* One-time opening stock. Creation only, collapsed by default.
                  Rendered beside the Low Stock Level because that is where a
                  person setting up a new item already looks for "how many do
                  we have" - but kept out of the main grid so it cannot be
                  entered by accident. */}
              {!initialId && (
                <div style={{ marginTop: 4 }}>
                  <button
                    type="button"
                    disabled title="Opening stock is not available in this form yet." onClick={() => setShowOpeningStock((v) => !v)}
                    aria-expanded={showOpeningStock}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      background: 'var(--layer)', border: '1px solid var(--line)',
                      borderRadius: 0, padding: '10px 12px', cursor: 'pointer',
                      fontSize: 12.5, fontWeight: 600, color: 'var(--ink)',
                      textAlign: 'left',
                    }}
                  >
                    <span aria-hidden="true" style={{ color: 'var(--muted)' }}>
                      {showOpeningStock ? '▾' : '▸'}
                    </span>
                    We already have stock for this item
                    <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--muted)' }}>
                      one time, at creation
                    </span>
                  </button>

                  {showOpeningStock && (
                    <div
                      className="t-2col"
                      style={{
                        marginTop: 10, padding: '12px 12px 4px',
                        border: '1px solid var(--line)', borderTop: 'none',
                        background: 'var(--bg-subtle, var(--layer))',
                      }}
                    >
                      <div style={{ gridColumn: '1 / -1', marginBottom: 8 }}>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>
                          Enter what is physically on the shelf right now. This is recorded
                          once as an opening entry and <strong>cannot be changed afterwards</strong>
                          &mdash; if the count is later wrong, record a stock correction with a
                          reason instead, so the history stays honest.
                        </p>
                      </div>
                      <Field label="Opening stock &mdash; Godown (pcs)" help="Stock in the back store.">
                        <NumInput
                          className="field-control num"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={openingGodown}
                          onChange={(n) => setOpeningGodown(Math.max(0, Math.round(n || 0)))}
                        />
                      </Field>
                      <Field label="Opening stock &mdash; Counter (pcs)" help="Stock on the sales counter.">
                        <NumInput
                          className="field-control num"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={openingCounter}
                          onChange={(n) => setOpeningCounter(Math.max(0, Math.round(n || 0)))}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Drawer>
  )
}
