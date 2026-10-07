import { useEffect, useMemo, useState } from 'react'
import type { PProduct } from '@/lib/repo'
import * as repo from '@/lib/repo'
import { num0 } from '@/lib/utils'
import { searchProducts } from '@/lib/search'
import { Btn, Drawer, Field, useToast } from '@/components/ui'

export type TransferDirection = 'toCounter' | 'toGodown'

const DIRECTIONS: { v: TransferDirection; label: string }[] = [
  { v: 'toCounter', label: 'Godown → Counter' },
  { v: 'toGodown', label: 'Counter → Godown' },
]

export interface StockTransferDrawerProps {
  open: boolean
  onClose: () => void
  shopId: string
  products: PProduct[]
  initialProductId?: string
  initialDirection?: TransferDirection
  onSuccess?: () => void
}

export function StockTransferDrawer({
  open,
  onClose,
  shopId,
  products,
  initialProductId,
  initialDirection = 'toCounter',
  onSuccess,
}: StockTransferDrawerProps) {
  const toast = useToast()
  const [direction, setDirection] = useState<TransferDirection>(initialDirection)
  const [productText, setProductText] = useState('')
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)

  // Stable identity across renders: a fresh array here would change the
  // reset-effect dependency below on every keystroke, silently clearing the
  // typed product and quantity after each character.
  const stockProducts = useMemo(() => products.filter((p) => !p.isKitchen), [products])

  useEffect(() => {
    if (open) {
      setDirection(initialDirection)
      setQty(0)
      if (initialProductId) {
        const found = stockProducts.find((p) => p.id === initialProductId)
        setProductText(found?.name ?? '')
      } else {
        setProductText('')
      }
    }
  }, [open, initialProductId, initialDirection, stockProducts])

  const t = productText.trim()
  const matchInfo = open && t
    ? (() => {
        const exact = stockProducts.find(
          (p) =>
            p.name.toLowerCase() === t.toLowerCase() ||
            (p.barcode ?? '').toLowerCase() === t.toLowerCase() ||
            p.code.toLowerCase() === t.toLowerCase()
        )
        if (exact) return { product: exact, ambiguous: 0 }
        const ranked = searchProducts(stockProducts, t)
        if (ranked.length === 1) return { product: ranked[0], ambiguous: 0 }
        if (ranked.length > 1) {
          return { product: null, ambiguous: ranked.length }
        }
        return { product: null, ambiguous: 0 }
      })()
    : null

  const product = matchInfo?.product ?? null
  const q = Math.floor(qty) || 0
  const available = product ? (direction === 'toCounter' ? product.godownPcs : product.counterPcs) : 0
  const over = !!product && q > available
  const from = direction === 'toCounter' ? 'Godown' : 'Counter'
  const to = direction === 'toCounter' ? 'Counter' : 'Godown'
  const fromPcs = product ? (direction === 'toCounter' ? product.godownPcs : product.counterPcs) : 0
  const toPcs = product ? (direction === 'toCounter' ? product.counterPcs : product.godownPcs) : 0
  const applied = Math.min(q, available)
  const afterFrom = fromPcs - applied
  const afterTo = toPcs + applied

  async function doTransfer() {
    if (!product || product.isKitchen) return toast('Select a valid retail product to move.', 'err')
    const validQty = Math.floor(qty)
    if (!(validQty > 0)) return toast('Enter a quantity above zero.', 'err')
    if (validQty > available) return toast(`Only ${available} pcs in the ${from.toLowerCase()}.`, 'err')
    setBusy(true)
    try {
      const toCounter = direction === 'toCounter'
      await repo.transferStock(shopId, {
        product_id: product.id,
        from_loc: toCounter ? 'godown' : 'counter',
        to_loc: toCounter ? 'counter' : 'godown',
        qty: validQty,
      })
      toast(toCounter ? `Moved ${validQty} pcs to counter.` : `Returned ${validQty} pcs to godown.`)
      onClose()
      onSuccess?.()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Transfer failed.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open}
      title="Transfer stock"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <Btn variant="primary" block disabled={busy || !product || !(q > 0) || over} onClick={doTransfer}>
            {busy ? 'Moving…' : q > 0 ? `Confirm transfer · ${num0(q)} pcs → ${to}` : `Choose a quantity → ${to}`}
          </Btn>
          <Btn variant="ghost" block onClick={onClose}>Cancel</Btn>
        </div>
      }
    >
      <Field label="Direction">
        <div className="seg" style={{ width: '100%' }}>
          {DIRECTIONS.map((x) => (
            <button
              key={x.v}
              type="button"
              className={`seg-btn ${direction === x.v ? 'active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => {
                setDirection(x.v)
                setQty(0)
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Product"
        help="Type to search by name, code or barcode."
        error={matchInfo?.ambiguous ? `${matchInfo.ambiguous} products match, keep typing to pick one.` : undefined}
      >
        <input
          className="field-control"
          list="stock-transfer-product-list"
          value={productText}
          onChange={(e) => setProductText(e.target.value)}
          placeholder="Search product…"
        />
        <datalist id="stock-transfer-product-list">
          {stockProducts.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
      </Field>

      <div className="transfer-wrap">
        <div className="transfer-node">
          <span className="transfer-node-role">From · {from}</span>
          <span className="transfer-node-stock num">{product ? num0(fromPcs) : '—'}</span>
          <span className="transfer-node-sub">{product ? 'available to move' : 'pick a product'}</span>
        </div>
        <span className={`transfer-arrow ${over ? 'err' : ''}`}>{direction === 'toCounter' ? '→' : '←'}</span>
        <div className="transfer-node">
          <span className="transfer-node-role">To · {to}</span>
          <span className="transfer-node-stock num">{product ? num0(toPcs) : '—'}</span>
          <span className="transfer-node-sub">{product ? 'on hand' : 'destination'}</span>
        </div>
      </div>

      <Field
        label={`Quantity to move (pcs)`}
        help={!product ? 'Pick a product first.' : undefined}
        error={product && over ? `Only ${available} pcs in the ${from.toLowerCase()}.` : undefined}
      >
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="qty-stepper">
            <button onClick={() => setQty((curr) => Math.max(0, curr - 1))}>−</button>
            <input
              value={qty === 0 ? '' : qty}
              onChange={(e) => setQty(e.target.value === '' ? 0 : Math.max(0, Number(e.target.value) || 0))}
              inputMode="numeric"
              placeholder="0"
            />
            <button disabled={!product || q >= available} onClick={() => setQty((curr) => curr + 1)}>+</button>
          </div>
          <Btn sm variant="ghost" disabled={!product} onClick={() => setQty(available)}>
            Max · {product ? num0(available) : '—'}
          </Btn>
        </div>
      </Field>

      {product && q > 0 && (
        <div className="transfer-after">
          <div className="after-box">
            <span className="after-name">{from}</span>
            <span className="after-val">
              <b className="num">{num0(afterFrom)}</b>
              <span className={`after-delta ${over ? 'err' : ''}`}>{over ? '' : `− ${num0(Math.min(q, available))}`}</span>
            </span>
          </div>
          <div className="after-box">
            <span className="after-name">{to}</span>
            <span className="after-val">
              <b className="num">{num0(afterTo)}</b>
              <span className="after-delta pos">+ {num0(Math.min(q, available))}</span>
            </span>
          </div>
        </div>
      )}
    </Drawer>
  )
}
