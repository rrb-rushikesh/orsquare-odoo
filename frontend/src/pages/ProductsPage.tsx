import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useWorkspace, bootstrapNow, refreshNow, type CounterProduct } from '@/data/workspace'
import { call } from '@/lib/api'
import { searchProducts } from '@/lib/search'
import { money, num } from '@/lib/utils'
import { Btn, Drawer, EmptyState, Field, NumInput, Panel, Tag, useToast } from '@/components/ui'

/**
 * Products: the shop's catalogue.  Online-only by design (the offline spec blocks adding products offline), so
 * every change goes straight to Odoo and the new row comes back with the next sync.  The suggested selling price is
 * Odoo's own answer (cost + the category/size margin rule): this screen never computes it.
 */

type Kind = 'retail' | 'kitchen' | 'consumable'
interface Form {
  name: string; barcode: string; shortCode: string; kind: Kind; categId: number | ''; brandId: number | ''
  uomId: number | ''; regimeId: number | ''; mrp: number; price: number; cost: number; lowStock: number
  pegs: { ml: number; price: number }[]; openingQty: number; openingWhere: 'godown' | 'counter'
}

const EMPTY: Form = {
  name: '', barcode: '', shortCode: '', kind: 'retail', categId: '', brandId: '', uomId: '', regimeId: '',
  mrp: 0, price: 0, cost: 0, lowStock: 0, pegs: [], openingQty: 0, openingWhere: 'godown',
}

export default function ProductsPage() {
  const { seesValuation, isOwner, featureOn } = useAuth()
  const ws = useWorkspace()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search)
  const [kind, setKind] = useState<'all' | Kind>('all')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<{ product: CounterProduct | null } | null>(null)
  const [mastersOpen, setMastersOpen] = useState(false)
  const kitchenOn = featureOn('kitchen')

  const categories = useMemo(() => [...new Set(ws.counterProducts.map((p) => p.category).filter(Boolean))].sort(), [ws.counterProducts])
  const rows = useMemo(() => {
    const base = ws.counterProducts.filter((p) => (kind === 'all' || p.kind === kind) && (!category || p.category === category))
    return q.trim() ? searchProducts(base, q) : base
  }, [ws.counterProducts, kind, category, q])

  return (
    <div className="stack" style={{ gap: 16 }}>
      {!ws.online && <div className="alert" role="status">Offline: products can be browsed but not added or changed until the connection returns.</div>}
      <Panel
        title="Products"
        subtitle={`${ws.counterProducts.length} in your catalogue`}
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Btn sm variant="tertiary" onClick={() => setMastersOpen(true)} aria-label="Categories, units and brands">Categories · Units · Brands</Btn>
            <Btn sm variant="primary" disabled={!ws.online} onClick={() => setEditing({ product: null })}>+ New product</Btn>
          </div>
        }
      >
        <div className="row" style={{ gap: 8, padding: 12, flexWrap: 'wrap' }}>
          <input className="field-control" style={{ flex: '1 1 240px' }} placeholder="Search by name, code or barcode…"
            value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          <select className="field-control" style={{ width: 160 }} value={kind} onChange={(e) => setKind(e.target.value as 'all' | Kind)} aria-label="Type">
            <option value="all">All types</option><option value="retail">Retail</option>
            {kitchenOn && <option value="kitchen">Kitchen</option>}<option value="consumable">Consumable</option>
          </select>
          <select className="field-control" style={{ width: 180 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {ws.status === 'loading' ? <div className="skeleton" style={{ minHeight: 160, margin: 12 }} /> : rows.length === 0 ? (
          <EmptyState title={ws.counterProducts.length ? 'No products match' : 'No products yet'}
            hint={ws.counterProducts.length ? 'Try a different search or filter.' : 'Add your first product to start billing.'}
            action={ws.counterProducts.length || !ws.online ? undefined : <Btn variant="primary" onClick={() => setEditing({ product: null })}>+ New product</Btn>} />
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr>
                <th>Product</th><th>Unit</th><th>Tax regime</th><th className="td-right">MRP</th>
                <th className="td-right">Selling rate</th>{seesValuation && <th className="td-right">Cost</th>}
                <th className="td-right">In stock</th><th style={{ width: 80 }}></th>
              </tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.productId}>
                  <td><span className="cell-main">{p.name}</span>{' '}{!p.active && <Tag kind="gray">ARCHIVED</Tag>}{' '}{p.isKitchen && <Tag kind="blue">KITCHEN</Tag>}
                    <div className="t-caption">{[p.brand, p.category, p.barcode || p.code].filter(Boolean).join(' · ')}</div></td>
                  <td className="td-muted">{p.unit}</td><td className="td-muted">{p.regime || '—'}</td>
                  <td className="td-right num">{money(p.mrp)}</td><td className="td-right num">{money(p.rate)}</td>
                  {seesValuation && <td className="td-right num">{p.cost !== undefined ? money(p.cost) : '—'}</td>}
                  <td className="td-right num">{p.isKitchen ? '∞' : num(p.totalPcs)}</td>
                  <td className="td-right"><Btn sm disabled={!ws.online} onClick={() => setEditing({ product: p })}>Edit</Btn></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editing && <ProductDrawer product={editing.product} onClose={() => setEditing(null)}
        onSaved={(msg) => { setEditing(null); toast(msg, 'ok'); void refreshNow() }} />}
      <MastersDrawer open={mastersOpen} onClose={() => setMastersOpen(false)} owner={isOwner} />
    </div>
  )
}

function ProductDrawer({ product, onClose, onSaved }: { product: CounterProduct | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const ws = useWorkspace()
  const { seesValuation, featureOn } = useAuth()
  const [f, setF] = useState<Form>(() => product ? {
    ...EMPTY, name: product.name, barcode: product.barcode, shortCode: product.code, kind: product.kind,
    categId: product.categoryId || '', brandId: product.brandId || '', uomId: product.uomId || '', regimeId: product.regimeId || '',
    mrp: product.mrp, price: product.rate, cost: product.cost ?? 0, lowStock: product.lowStockQty, pegs: product.pegs.map((x) => ({ ...x })),
  } : EMPTY)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const units = ws.units
  const unitOptions = useMemo(() => units ? [
    ...units.shop_units.map((u: any) => ({ id: u.id, name: u.name })),
    ...units.base_units.filter((u: any) => u.visible).map((u: any) => ({ id: u.id, name: u.name })),
  ] : [], [units])
  const isNew = !product

  const save = async () => {
    setErr('')
    if (!f.name.trim()) return setErr('Give the product a name.')
    if (f.price < 0 || f.mrp < 0 || f.cost < 0) return setErr('Amounts cannot be negative.')
    setBusy(true)
    try {
      const values: Record<string, unknown> = {
        name: f.name.trim(), barcode: f.barcode.trim() || false, short_code: f.shortCode.trim() || false, kind: f.kind,
        list_price: f.price, mrp: f.mrp, low_stock_qty: f.lowStock,
        categ_id: f.categId || undefined, brand_id: f.brandId || false, uom_id: f.uomId || undefined, regime_id: f.regimeId || false,
        pegs: f.pegs.filter((p) => p.ml > 0 && p.price > 0),
      }
      if (seesValuation) values.cost = f.cost
      const tmplId = await call<number>('catalog', 'save_product', { values, product_tmpl_id: product?.templateId })
      if (isNew && f.kind === 'retail' && f.openingQty > 0) {
        const rows = await call<{ id: number; product_id: number }[]>('catalog', 'list_products', { search: f.barcode.trim() || f.name.trim(), limit: 20 })
        const created = rows.find((r) => r.id === tmplId)
        if (created) await call('stock', 'set_opening_stock', { lines: [{ product_id: created.product_id, qty: f.openingQty, ...(seesValuation ? { cost: f.cost } : {}) }], location: f.openingWhere })
      }
      onSaved(isNew ? `Added ${f.name.trim()}` : 'Product saved')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the product.')
    } finally { setBusy(false) }
  }

  const suggest = product?.suggestedPrice
  return (
    <Drawer open onClose={onClose} title={isNew ? 'New product' : 'Edit product'} wide
      footer={<div className="row" style={{ gap: 8 }}><Btn variant="tertiary" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save product'}</Btn></div>}>
      <div className="stack" style={{ gap: 14 }}>
        {err && <div className="alert" role="alert">{err}</div>}
        <Field label="Name"><input className="field-control" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="form-grid">
          <Field label="Type">
            <select className="field-control" value={f.kind} disabled={!isNew} onChange={(e) => set('kind', e.target.value as Kind)}>
              <option value="retail">Retail (stock-tracked)</option>{featureOn('kitchen') && <option value="kitchen">Kitchen dish</option>}
              <option value="consumable">Consumable (not tracked)</option>
            </select>
          </Field>
          <Field label="Barcode"><input className="field-control" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
          <Field label="Short code"><input className="field-control" value={f.shortCode} onChange={(e) => set('shortCode', e.target.value)} /></Field>
          <Field label="Unit / bottle size">
            <select className="field-control" value={f.uomId} onChange={(e) => set('uomId', e.target.value ? Number(e.target.value) : '')}>
              <option value="">Default (Piece)</option>{unitOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select className="field-control" value={f.categId} onChange={(e) => set('categId', e.target.value ? Number(e.target.value) : '')}>
              <option value="">Default</option>{ws.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Brand">
            <select className="field-control" value={f.brandId} onChange={(e) => set('brandId', e.target.value ? Number(e.target.value) : '')}>
              <option value="">No brand</option>{ws.brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Tax regime" help="Decides the taxes Odoo applies when this item is sold or bought.">
            <select className="field-control" value={f.regimeId} onChange={(e) => set('regimeId', e.target.value ? Number(e.target.value) : '')}>
              <option value="">Category default</option>{ws.regimes.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Low-stock level"><NumInput className="field-control" value={f.lowStock} onChange={(n) => set('lowStock', n)} /></Field>
        </div>

        <div className="form-grid">
          <Field label="MRP (₹)"><NumInput className="field-control" value={f.mrp} onChange={(n) => set('mrp', n)} /></Field>
          <Field label="Selling rate (₹)"><NumInput className="field-control" value={f.price} onChange={(n) => set('price', n)} /></Field>
          {seesValuation && <Field label="Cost (₹)"><NumInput className="field-control" value={f.cost} onChange={(n) => set('cost', n)} /></Field>}
        </div>
        {seesValuation && suggest !== undefined && suggest > 0 && suggest !== f.price && (
          <div className="alert" role="note">
            Odoo suggests a selling price of <strong>{money(suggest)}</strong> (cost plus your category margin).{' '}
            <button type="button" className="link-btn" onClick={() => set('price', suggest)}>Apply suggestion</button>
          </div>
        )}

        {f.kind === 'retail' && (product?.canOpen || isNew) && (
          <div>
            <div className="micro-label">Peg rates (for open bottles)</div>
            {f.pegs.map((p, i) => (
              <div key={i} className="row" style={{ gap: 8, marginTop: 8 }}>
                <NumInput className="field-control" value={p.ml} placeholder="ml" aria-label="Peg size in ml" onChange={(n) => set('pegs', f.pegs.map((x, k) => (k === i ? { ...x, ml: n } : x)))} />
                <NumInput className="field-control" value={p.price} placeholder="₹" aria-label="Peg price" onChange={(n) => set('pegs', f.pegs.map((x, k) => (k === i ? { ...x, price: n } : x)))} />
                <Btn sm onClick={() => set('pegs', f.pegs.filter((_, k) => k !== i))} aria-label="Remove peg size">×</Btn>
              </div>
            ))}
            <Btn sm style={{ marginTop: 8 }} onClick={() => set('pegs', [...f.pegs, { ml: 30, price: 0 }])}>+ Add peg size</Btn>
          </div>
        )}

        {isNew && f.kind === 'retail' && (
          <div>
            <div className="micro-label">Opening stock (accepted once)</div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <NumInput className="field-control" value={f.openingQty} placeholder="Quantity" aria-label="Opening quantity" onChange={(n) => set('openingQty', n)} />
              <select className="field-control" value={f.openingWhere} onChange={(e) => set('openingWhere', e.target.value as 'godown' | 'counter')}>
                <option value="godown">Godown</option><option value="counter">Counter</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}

function MastersDrawer({ open, onClose, owner }: { open: boolean; onClose: () => void; owner: boolean }) {
  const ws = useWorkspace()
  const toast = useToast()
  const [tab, setTab] = useState<'categories' | 'units' | 'brands'>('categories')
  const [name, setName] = useState('')
  const [parent, setParent] = useState<number | ''>('')
  const [regime, setRegime] = useState<number | ''>('')
  const [baseUnit, setBaseUnit] = useState<number | ''>('')
  const [ratio, setRatio] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setName(''); setRatio(0) } }, [open, tab])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast(ok, 'ok'); setName(''); await bootstrapNow() } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err') } finally { setBusy(false) }
  }
  const visibleBase = (ws.units?.base_units ?? []).filter((u: any) => u.visible)

  return (
    <Drawer open={open} onClose={onClose} title="Catalogue masters" wide>
      <div className="pay-seg flow" role="tablist" style={{ marginBottom: 16 }}>
        {(['categories', 'units', 'brands'] as const).map((t) => (
          <button key={t} type="button" className={`pay-seg-btn ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>))}
      </div>
      {tab === 'categories' && (<>
        <table className="tbl"><thead><tr><th>Category</th><th>Tax regime</th></tr></thead>
          <tbody>{ws.categories.map((c) => <tr key={c.id}><td>{c.name}</td><td className="td-muted">{c.regime || '—'}</td></tr>)}</tbody></table>
        <div className="stack" style={{ gap: 8, marginTop: 16 }}>
          <input className="field-control" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New category name" />
          <select className="field-control" value={parent} onChange={(e) => setParent(e.target.value ? Number(e.target.value) : '')} aria-label="Parent category">
            <option value="">No parent</option>{ws.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="field-control" value={regime} onChange={(e) => setRegime(e.target.value ? Number(e.target.value) : '')} aria-label="Tax regime">
            <option value="">No tax regime</option>{ws.regimes.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <Btn variant="primary" disabled={busy || !name.trim()} onClick={() => void run(() => call('catalog', 'create_category', { name, parent_id: parent || undefined, regime_id: regime || undefined }), 'Category added')}>Add category</Btn>
        </div></>)}
      {tab === 'brands' && (<>
        <table className="tbl"><thead><tr><th>Brand</th></tr></thead><tbody>{ws.brands.map((b: any) => <tr key={b.id}><td>{b.name}</td></tr>)}</tbody></table>
        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <input className="field-control" placeholder="New brand" value={name} onChange={(e) => setName(e.target.value)} aria-label="New brand name" />
          <Btn variant="primary" disabled={busy || !name.trim()} onClick={() => void run(() => call('catalog', 'create_brand', { name }), 'Brand added')}>Add</Btn>
        </div></>)}
      {tab === 'units' && ws.units && (<>
        <div className="micro-label">Standard units {owner ? '(tap to show or hide)' : ''}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '8px 0 16px' }}>
          {ws.units.base_units.map((u: any) => (
            <Btn key={u.id} sm variant={u.visible ? 'primary' : 'tertiary'} disabled={!owner || busy} aria-pressed={u.visible}
              onClick={() => void run(() => call('catalog', 'set_base_unit_visibility', { uom_id: u.id, visible: !u.visible }), `${u.name} ${u.visible ? 'hidden' : 'shown'}`)}>{u.name}</Btn>))}
        </div>
        <div className="micro-label">Your units</div>
        <table className="tbl"><thead><tr><th>Unit</th><th>Base</th><th className="td-right">Ratio</th></tr></thead>
          <tbody>{ws.units.shop_units.map((u: any) => <tr key={u.id}><td>{u.name}</td><td className="td-muted">{u.base_unit}</td><td className="td-right num">{num(u.ratio)}</td></tr>)}</tbody></table>
        <div className="stack" style={{ gap: 8, marginTop: 16 }}>
          <input className="field-control" placeholder="Unit name, e.g. 330 ml" value={name} onChange={(e) => setName(e.target.value)} aria-label="New unit name" />
          <select className="field-control" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value ? Number(e.target.value) : '')} aria-label="Base unit">
            <option value="">Base unit…</option>{visibleBase.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <NumInput className="field-control" value={ratio} placeholder="Ratio (e.g. 330)" aria-label="Ratio to base unit" onChange={setRatio} />
          <Btn variant="primary" disabled={busy || !name.trim() || !baseUnit || ratio <= 0} onClick={() => void run(() => call('catalog', 'create_shop_unit', { name, base_unit_id: baseUnit, ratio }), 'Unit added')}>Add unit</Btn>
        </div></>)}
    </Drawer>
  )
}
