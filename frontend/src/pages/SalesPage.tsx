import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import * as repo from '@/lib/repo'
import type { PAccount, PProduct, PServerTab, PSale, PSaleReturn } from '@/lib/repo'
import type { OfflineSalePayment } from '@/lib/db'
import {
  loadPrefs,
  savePrefs,
  type SeatingArrangement,
  type SeatingPos,
  type SeatingSize,
} from '@/lib/prefs'
import { normalizeTablesConfig, tableId, tableLabels } from '@/lib/tables'
import { money, round2, dt } from '@/lib/utils'
import { divRoundHalfUp, fromPaise, toPaise } from '@/lib/money'
import { useCounterQuote } from '@/lib/quote'

/**
 * GST-inclusive refund for `q` of a sale line's `qty` units, matching
 * create_sale_return() exactly: the full line's gross `total` when the whole
 * line is returned, otherwise the proportional share rounded half-up in paise.
 */
function lineRefundPaise(it: { total: number; qty: number }, q: number): number {
  const totalPaise = toPaise(it.total)
  const qty = it.qty || 1
  return q >= qty ? totalPaise : divRoundHalfUp(totalPaise * q, qty)
}
import { now } from '@/lib/clock'
import { useCurrentBusinessDate } from '@/lib/businessDay'
import type { ReceiptData } from '@/lib/receipt'
import { outcomeMessage, printReceipt, type PrintOutcome } from '@/lib/printing/service'
import { searchProductsCached, detectSearchIntent, searchAccounts } from '@/lib/search'
import { attachScannerCapture, beep, normalizeScan, DEDUP_MS } from '@/lib/scanner'
import { GST_SLABS, type DiscountScheme, type SaleItem, type TableTab, type TablesConfig } from '@/types'
import { NoAccess, Btn, ConfirmDialog, Drawer, EmptyState, Field, Modal, NumInput, Panel, Tag, useToast } from '@/components/ui'
import { IconBoxReturn, IconCheck, IconGear, IconHistory, IconLock, IconSearch, IconTrash, IconUnlock, IconUser, IconX, IconZap, IconTable } from '@/components/icons'
import { SalesHistoryRegister } from '@/components/SalesHistoryRegister'
import { SaleReturnHistory } from '@/components/ReturnHistory'
import { BillFinder } from '@/components/BillFinder'
import { DiscountSchemeManager } from '@/components/DiscountSchemeManager'
import { PhoneInput } from '@/components/PhoneInput'
import { DEFAULT_DIAL, isValidNational, nationalDigits } from '@/lib/phone'

interface BillLine {
  productId: string
  name: string
  unit: string
  qty: number
  rate: number
}

const TABS_KEY = 'xpo.floorTabs.v1'
// Unbound-bill draft. When Tables are off there is no floor tab to hold an open
// order, so the cart lives only in React state and ANY page reload (manual F5,
// crash, or a future capability refresh) would silently lose the bill. This
// drafts it locally so it is restored on the next mount. Cleared on sale,
// on clear, and whenever the bill is bound to a floor table (the tab store
// owns persistence from then on).
const DRAFT_KEY = 'xpo.billDraft.v1'
const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000

function loadBillDraft(): BillLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
    if (!raw || !Array.isArray(raw.items)) return []
    if (typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(DRAFT_KEY)
      return []
    }
    return (raw.items as any[]).filter(
      (l) => l && typeof l.productId === 'string' && typeof l.qty === 'number' && l.qty > 0
    )
  } catch {
    return []
  }
}

type PayOption = 'Cash' | 'UPI' | 'Khata'

interface ArmedPayment {
  method: 'Cash' | 'UPI'
  expiresAt: number
  source: 'keyboard' | 'touch'
}

/** The payment method pre-selected for a fresh bill on this device.
 *  'last' replays the previous bill's method; Khata needs a linked customer
 *  account, which a fresh bill never has, it falls back to Cash. */
function nextDefaultMethod(): PayOption {
  const p = loadPrefs()
  if (p.salesDefaultPaymentMode === 'Cash' || p.salesDefaultPaymentMode === 'UPI') {
    return p.salesDefaultPaymentMode
  }
  const m = p.defaultPayMethod === 'last' ? (p.lastPayMethod ?? 'Cash') : p.defaultPayMethod
  if (m === 'Khata') {
    return 'Cash'
  }
  return m
}

/** Snapshot of the register worth parking on a table. */
function draftItems(lines: BillLine[]): SaleItem[] {
  return lines
    .filter((l) => l.qty > 0)
    .map(({ productId, name, unit, qty, rate }) => ({ productId, name, unit, qty, rate }))
}

// Bug B fix: schemes come from the server (GET /api/sales/discount-schemes/)
// instead of the old hardcoded COUPONS list, "No coupon" is a synthetic,
// always-present first entry, never sent to the backend.
const NO_COUPON: DiscountScheme = { id: '', code: '', label: 'No coupon', kind: 'percentage', value: 0 }

// ---- F2: product search combobox (WAI-ARIA) -------------------------------

const comboboxListStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  right: 0,
  zIndex: 60,
  margin: 0,
  padding: 0,
  listStyle: 'none',
  background: 'var(--canvas)',
  border: '1px solid var(--line)',
  maxHeight: 320,
  overflowY: 'auto',
}

/** Shared by the billing search and the F6 replacement picker. Local ranked
 *  matching always works offline; when online, debounced server results are
 *  merged ahead of local-only extras (deduped by id, errors swallowed). */
function ProductCombobox({
  products,
  shopId,
  inputRef,
  clearRef,
  onPick,
  onScan,
  onMiss,
  rateOf,
  placeholder,
  ariaLabel,
  enableKitchen = false,
}: {
  products: PProduct[]
  shopId: string
  inputRef?: { current: HTMLInputElement | null }
  clearRef?: { current: () => void }
  onPick: (p: PProduct) => void
  /** Barcode/code resolution with the scanner dedup guard; 'unknown' falls
   *  back to the top-ranked result. */
  onScan?: (q: string) => 'added' | 'blocked' | 'unknown'
  onMiss?: () => void
  rateOf?: (p: PProduct) => number
  placeholder: string
  ariaLabel: string
  enableKitchen?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hl, setHl] = useState(-1)
  const [serverHits, setServerHits] = useState<PProduct[]>([])
  const listId = useId()

  const clear = () => {
    setQuery('')
    setHl(-1)
    setOpen(false)
    setServerHits([])
  }
  if (clearRef) clearRef.current = clear

  const intent = useMemo(() => detectSearchIntent(query), [query])

  // ONLINE boost: 150ms-debounced server search; stale responses are skipped
  // so a slow/failed fetch never disturbs the offline path.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || !navigator.onLine || !shopId) {
      setServerHits([])
      return
    }
    let alive = true
    const t = setTimeout(() => {
      repo
        .listProducts(shopId, { search: q, ...(enableKitchen ? {} : { is_kitchen: false }) })
        .then((rows) => {
          if (alive) {
            const filtered = enableKitchen ? rows : rows.filter((r) => !r.isKitchen)
            setServerHits(filtered)
          }
        })
        .catch(() => {
          if (alive) setServerHits([])
        })
    }, 150)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, shopId, enableKitchen])

  const exactHit = useMemo(() => {
    const q = query.trim()
    if (!q) return null
    return products.find((p) => p.barcode === q || p.code === q || p.code.toLowerCase() === q.toLowerCase()) ?? null
  }, [products, query])

  // Suffix-less scanner support in search input: if an exact numeric barcode is entered
  // and followed by silence (300ms), auto-commit the scan.
  useEffect(() => {
    const q = query.trim()
    if (q.length >= 8 && /^\d+$/.test(q) && exactHit && onScan) {
      const timer = setTimeout(() => {
        const r = onScan(q)
        if (r !== 'unknown') {
          clear()
          inputRef?.current?.focus()
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [query, exactHit, onScan])

  const results = useMemo(() => {
    const q = query.trim()
    if (!q || (q.length < 2 && !exactHit)) return []
    const local = searchProductsCached(products, q, { limit: 12 })
    const out: PProduct[] = []
    const seen = new Set<string>()
    if (exactHit) {
      out.push(exactHit)
      seen.add(exactHit.id)
    }
    for (const h of local) {
      if (!seen.has(h.id)) {
        seen.add(h.id)
        out.push(h)
      }
    }
    for (const r of serverHits) {
      if (!seen.has(r.id)) {
        seen.add(r.id)
        out.push(r)
      }
    }
    return out.slice(0, 8)
  }, [query, products, serverHits, exactHit])

  const showList = focused && open && results.length > 0

  function pick(p: PProduct) {
    onPick(p)
    clear()
    inputRef?.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!showList) return
      e.preventDefault()
      setHl((h) => (e.key === 'ArrowDown' ? Math.min(h + 1, results.length - 1) : Math.max(h - 1, -1)))
      return
    }
    if (e.key === 'Enter' || (e.key === 'Tab' && query.trim().length >= 4)) {
      const q = query.trim()
      if (!q) return
      e.preventDefault()
      if (showList && hl >= 0 && results[hl]) {
        pick(results[hl])
        return
      }
      if (onScan) {
        const r = onScan(q)
        if (r !== 'unknown') {
          clear()
          inputRef?.current?.focus()
          return
        }
      }
      if (results[0]) {
        beep('ok')
        pick(results[0])
      } else {
        onMiss?.()
        clear()
      }
      return
    }
    if (e.key === 'Escape') {
      if (query || open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setHl(-1)
        setQuery('')
      }
    }
  }

  return (
    <div className="search-box sug-anchor" style={{ flex: 1, minWidth: 0 }}>
      <IconSearch />
      <input
        ref={inputRef}
        className="field-control"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={showList && hl >= 0 ? `${listId}-opt-${hl}` : undefined}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        placeholder={intent.isBarcodeLikely ? 'Barcode scan detected… (Enter to add)' : placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setHl(-1)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label={ariaLabel} style={comboboxListStyle}>
          {results.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={hl === i}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(p)
              }}
              onMouseEnter={() => setHl(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 12px',
                minHeight: 44,
                cursor: 'pointer',
                borderBottom: '1px solid var(--line)',
                background: hl === i ? 'var(--layer)' : 'transparent',
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 13.5,
                  color: 'var(--ink)',
                }}
              >
                {p.name}
                {query.trim() && p.barcode && p.barcode.includes(query.trim()) ? (
                  <span className="num" style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>
                    [{p.barcode}]
                  </span>
                ) : query.trim() && p.code && p.code.toLowerCase().includes(query.trim().toLowerCase()) ? (
                  <span className="num" style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>
                    [{p.code}]
                  </span>
                ) : null}
              </span>
              <span
                className="num"
                style={{
                  border: '1px solid var(--line)',
                  color: 'var(--muted)',
                  fontSize: 11,
                  padding: '1px 6px',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.unit}
              </span>
              <span className="num" style={{ fontSize: 12.5, color: 'var(--muted)', minWidth: 64, textAlign: 'right' }}>
                {money(rateOf ? rateOf(p) : p.rate)}
              </span>
              {p.isKitchen ? (
                <Tag kind="blue">
                  <span>KITCHEN</span>
                </Tag>
              ) : p.counterPcs > 0 ? (
                <Tag kind="green">
                  <span>{p.counterPcs} pcs</span>
                </Tag>
              ) : p.godownPcs > 0 ? (
                <Tag kind="red">
                  <span>IN GODOWN</span>
                </Tag>
              ) : (
                <Tag kind="red">
                  <span style={{ opacity: 0.75 }}>out</span>
                </Tag>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- F3: keyboard-first keymap (rendered by the "?" cheat-sheet) ----------

const SHORTCUT_ROWS: [string, string][] = [
  ['F8', 'Fast Cash Sale (press twice to confirm)'],
  ['F9', 'Fast UPI Sale (press twice to confirm)'],
  ['F2 or /', 'Focus product search / barcode scanner'],
  ['↑ ↓', 'Move through search suggestions'],
  ['Enter', 'Add highlighted suggestion or manual code'],
  ['+ / −', 'Quantity +1 / −1 on focused bill line'],
  ['Tab / Shift+Tab', 'Next / previous bill line'],
  ['0–9', 'Type a quantity on the focused line — Enter applies'],
  ['Del', 'Remove the focused bill line'],
  ['Ctrl+Enter', 'Confirm & settle the bill'],
  ['Esc', 'Cancel armed payment · clear search · return to scanner'],
  ['?', 'This shortcut sheet'],
]

/**
 * One bill line. Extracted + memoized so that editing/sc scanning/adding a line
 * only re-renders the rows whose `line` object actually changed — previously the
 * whole (growing) cart table reconciled on every scan.
 *
 * Only primitive/stable props are passed; state setters are stable and the one
 * closure-dependent handler (row keydown) arrives through a latest-value ref so
 * memoization is never defeated by a fresh function identity.
 */
const BillRow = memo(function BillRow({
  line: l,
  lineAmount,
  online = true,
  index: i,
  product: p,
  customRateOn,
  autoGodownOn = false,
  active,
  tabbable,
  locked = false,
  setLines,
  setFocusedLineIdx,
  rowRefs,
  keyDownRef,
  scanRef,
}: {
  line: BillLine
  lineAmount: number
  online?: boolean
  index: number
  product: PProduct | undefined
  customRateOn: boolean
  autoGodownOn?: boolean
  active: boolean
  tabbable: boolean
  locked?: boolean
  setLines: React.Dispatch<React.SetStateAction<BillLine[]>>
  setFocusedLineIdx: React.Dispatch<React.SetStateAction<number | null>>
  rowRefs: { current: (HTMLTableRowElement | null)[] }
  keyDownRef: { current: (e: React.KeyboardEvent<HTMLTableRowElement>, i: number) => void }
  scanRef?: { current: (code: string) => void }
}) {
  const isKitchen = Boolean(p?.isKitchen)
  const counterStock = p?.counterPcs ?? 0
  const godownStock = p?.godownPcs ?? 0
  const totalStock = !online || isKitchen ? Infinity : (autoGodownOn ? counterStock + godownStock : counterStock)
  const needsGodown = autoGodownOn && !isKitchen && l.qty > counterStock && l.qty <= (counterStock + godownStock)
  const overStock = !isKitchen && l.qty > totalStock
  const ident = p?.barcode ? `Barcode: ${p.barcode}` : p ? `Code: ${p.code}` : ''
  const stdRate = p ? (p.rate > 0 ? p.rate : p.mrp) : l.rate
  const isDiscounted = stdRate > 0 && l.rate < stdRate
  const isMarkup = stdRate > 0 && l.rate > stdRate
  const lastKeyAt = useRef(0)
  const scanBurst = useRef(false)
  const scanCode = useRef('')
  const origQtyRef = useRef(l.qty)

  return (
    <tr
      ref={(el) => {
        rowRefs.current[i] = el
      }}
      tabIndex={tabbable ? 0 : -1}
      onFocus={() => setFocusedLineIdx(i)}
      onClick={() => {
        setFocusedLineIdx(i)
        rowRefs.current[i]?.focus()
      }}
      onKeyDown={(e) => keyDownRef.current(e, i)}
      style={{ outline: active ? '1px solid var(--blue)' : undefined, outlineOffset: -1 }}
    >
      <td className="td-center td-muted num">{i + 1}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="cell-main">{l.name}</span>
          {isKitchen && (
            <Tag kind="blue">KITCHEN</Tag>
          )}
          {needsGodown && (
            <Tag kind="red">IN GODOWN</Tag>
          )}
          {overStock && (
            <Tag kind="red">OUT OF STOCK</Tag>
          )}
        </div>
        <span className={`cell-sub num ${overStock ? 'neg' : ''}`}>
          {ident}{ident ? ' · ' : ''}{l.unit}
          {isKitchen
            ? ' · Made-to-order'
            : needsGodown
            ? ` · ${l.qty - Math.max(0, counterStock)} pcs in godown`
            : overStock
              ? ` · exceeds ${autoGodownOn ? 'total' : 'counter'} stock (only ${totalStock} available${!autoGodownOn && godownStock > 0 ? `, ${godownStock} in godown` : ''})`
              : ''}
        </span>
      </td>
      <td className="td-right">
        <div className="rate-cell-wrap">
          <input
            type="number"
            className="rate-edit-input"
            value={l.rate === 0 ? '' : l.rate}
            step="any"
            min="0"
            disabled={locked || !customRateOn}
            title={locked ? 'List is locked' : customRateOn ? undefined : 'Custom rate editing is disabled for this shop.'}
            onChange={(e) => {
              if (locked) return
              const v = e.target.value
              const n = parseFloat(v)
              setLines((ls) =>
                ls.map((x, j) => {
                  if (j !== i) return x
                  return { ...x, rate: v === '' || !Number.isFinite(n) ? 0 : Math.max(0, round2(n)) }
                })
              )
            }}
            aria-label={`Rate of ${l.name}`}
          />
          {isDiscounted && (
            <span className="rate-tag discounted" title={`Catalog rate: ${money(stdRate)}`}>
              −{money(stdRate - l.rate)}
            </span>
          )}
          {isMarkup && (
            <span className="rate-tag markup" title={`Catalog rate: ${money(stdRate)}`}>
              +{money(l.rate - stdRate)}
            </span>
          )}
        </div>
      </td>
      <td className="td-center">
        <div className="qty-stepper">
          <button
            aria-label="Decrease quantity"
            disabled={locked}
            style={locked ? { opacity: 0.3, pointerEvents: 'none' } : undefined}
            onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}
          >−</button>
          <input
            value={l.qty === 0 ? '' : l.qty}
            readOnly={locked}
            style={locked ? { cursor: 'default', background: 'transparent' } : undefined}
            onFocus={(e) => {
              if (locked) return
              origQtyRef.current = l.qty
              scanBurst.current = false
              scanCode.current = ''
              e.target.select()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                if (scanBurst.current && scanCode.current.length >= 4) {
                  e.preventDefault()
                  e.stopPropagation()
                  const code = scanCode.current
                  scanBurst.current = false
                  scanCode.current = ''
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: origQtyRef.current } : x)))
                  scanRef?.current(code)
                  return
                }
                scanBurst.current = false
                scanCode.current = ''
                return
              }
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const now = performance.now()
                const gap = now - lastKeyAt.current
                lastKeyAt.current = now

                if (gap < 65) {
                  // Machine scanner burst detected while in quantity input
                  if (!scanBurst.current) {
                    setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: origQtyRef.current } : x)))
                  }
                  scanBurst.current = true
                  scanCode.current += e.key
                  e.preventDefault()
                  e.stopPropagation()
                  return
                } else {
                  scanBurst.current = false
                  scanCode.current = e.key
                }
              }
            }}
            onChange={(e) => {
              if (scanBurst.current) return
              const v = e.target.value.trim()
              if (v.length >= 8 && /^\d+$/.test(v)) {
                scanRef?.current(v)
                setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: origQtyRef.current } : x)))
                return
              }
              const n = Math.floor(Number(v))
              const safeQty = v === '' || !Number.isFinite(n) ? 0 : Math.max(0, Math.min(totalStock, n))
              setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: safeQty } : x)))
            }}
            inputMode="numeric"
            aria-label={`Quantity of ${l.name}`}
          />
          <button
            aria-label="Increase quantity"
            disabled={locked || (!isKitchen && l.qty >= totalStock)}
            style={locked ? { opacity: 0.3, pointerEvents: 'none' } : undefined}
            onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}
          >+</button>
        </div>
      </td>
      <td className="td-right" style={{ fontWeight: 600 }}>{money(lineAmount)}</td>
      <td>
        <button
          className="icon-btn del"
          aria-label={`Remove ${l.name}`}
          disabled={locked}
          style={locked ? { opacity: 0.2, pointerEvents: 'none' } : undefined}
          onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
        >
          <IconTrash size={15} />
        </button>
      </td>
    </tr>
  )
})

/**
 * Checkout maths + settlement. Extracted and memoized: it re-renders only when
 * an amount, the payment method or the armed state actually changes — so typing
 * a customer name, the qty buffer, a drawer field or toggling a sheet no longer
 * re-renders the totals/settlement subtree.
 *
 * Unstable closures (triggerFastPay / confirmSale) are passed as latest-value
 * refs, keeping every prop referentially stable.
 */
const PayPanel = memo(function PayPanel({
  hasLines,
  overStockLine,
  busy,
  totalPcs,
  subtotal,
  couponCode,
  discount,
  quickDiscountOn,
  quickDiscountMode,
  suggestedQuickPaise,
  quickPaise,
  quickDiscount,
  setQuickDiscount,
  gstSlab,
  gstAmount,
  tip,
  useCustomTip,
  tipPct,
  grand,
  method,
  setMethod,
  customerMode,
  hasMatchedAccount,
  khataOn,
  enforcedPaymentMethod = 'all',
  armedMethod,
  isTouch,
  payMethodRef,
  fastPayRef,
  confirmRef,
}: {
  hasLines: boolean
  overStockLine: boolean
  busy: boolean
  totalPcs: number
  subtotal: number
  couponCode: string
  discount: number
  quickDiscountOn: boolean
  quickDiscountMode: 'manual' | 'auto'
  suggestedQuickPaise: number
  quickPaise: number
  quickDiscount: number
  setQuickDiscount: (n: number) => void
  gstSlab: number
  gstAmount: number
  tip: number
  useCustomTip: boolean
  tipPct: number
  grand: number
  method: PayOption
  setMethod: (m: PayOption) => void
  customerMode: boolean
  hasMatchedAccount: boolean
  khataOn: boolean
  enforcedPaymentMethod?: 'all' | 'Cash' | 'UPI'
  armedMethod: 'Cash' | 'UPI' | null
  isTouch: boolean
  payMethodRef: { current: HTMLDivElement | null }
  fastPayRef: { current: (m: 'Cash' | 'UPI', src: 'keyboard' | 'touch') => void }
  confirmRef: { current: (m?: PayOption) => void }
}) {
  const blocked = busy || !hasLines || overStockLine
  const isEnforced = enforcedPaymentMethod !== 'all'
  return (
    <>
      <div className="pay-box">
        <div className="pay-row num">
          <span>Items subtotal ({totalPcs} pcs)</span>
          <span>{money(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="pay-row num">
            <span>Coupon {couponCode}</span>
            <span className="pos">− {money(discount)}</span>
          </div>
        )}
        {quickDiscountOn && (
          <div className="pay-row num quick-discount-row">
            <span>
              Quick discount (₹)
              <span className={`qd-mode-tag ${quickDiscountMode}`}>
                {quickDiscountMode === 'auto' ? 'Auto' : 'Manual'}
              </span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {quickDiscountMode === 'auto' && suggestedQuickPaise > 0 && quickPaise === 0 && (
                <button
                  type="button"
                  className="qd-suggest-btn"
                  title={`Suggested: rounds the payable down to the nearest ₹100 (remainder ${money(fromPaise(suggestedQuickPaise))})`}
                  onClick={() => setQuickDiscount(fromPaise(suggestedQuickPaise))}
                >
                  Suggest −{money(fromPaise(suggestedQuickPaise))}
                </button>
              )}
              <NumInput
                className="quick-discount-input"
                value={quickDiscount}
                onChange={setQuickDiscount}
                placeholder="0"
                aria-label="Quick discount in rupees"
              />
            </span>
          </div>
        )}
        {quickPaise > 0 && (
          <div className="pay-row num qd-applied-row">
            <span>
              Quick discount <span className="qd-applied-tag">Applied</span>
            </span>
            <span className="pos">− {money(fromPaise(quickPaise))}</span>
          </div>
        )}
        {gstAmount > 0 && (
          <div className="pay-row num">
            <span>{gstSlab > 0 ? `GST ${gstSlab}%` : "Tax"}</span>
            <span>{money(gstAmount)}</span>
          </div>
        )}
        {tip > 0 && (
          <div className="pay-row num">
            <span>Service tip{!useCustomTip && tipPct > 0 ? ` (${tipPct}%)` : ''}</span>
            <span>{money(tip)}</span>
          </div>
        )}
        <div className="pay-net num">
          <span>Net payable</span>
          <span>{money(grand)}</span>
        </div>
      </div>

      <div ref={payMethodRef} className="fast-pay-container">
        {!isEnforced && (
          <>
            <div className="micro-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>Fast Settlement</span>
              {!isTouch && <span style={{ color: 'var(--muted)', fontSize: 11 }}>F8 = Cash · F9 = UPI</span>}
            </div>

            <div className={`fast-pay-seg ${customerMode && khataOn ? 'three-col' : ''}`}>
              {/* Cash Sale Button */}
              <button
                type="button"
                data-pay="Cash"
                className={`fast-pay-btn ${armedMethod === 'Cash' ? 'armed' : ''} ${method === 'Cash' && !armedMethod ? 'selected' : ''}`}
                disabled={blocked}
                onClick={() => fastPayRef.current('Cash', 'touch')}
                aria-pressed={method === 'Cash'}
                title={!hasLines ? 'Add at least one item' : undefined}
              >
                <span>{armedMethod === 'Cash' ? (isTouch ? 'Confirm Cash' : 'Press F8 to confirm') : 'Cash'}</span>
                {!isTouch && <span className="fast-pay-kbd">F8</span>}
              </button>

              {/* UPI Sale Button */}
              <button
                type="button"
                data-pay="UPI"
                className={`fast-pay-btn ${armedMethod === 'UPI' ? 'armed' : ''} ${method === 'UPI' && !armedMethod ? 'selected' : ''}`}
                disabled={blocked}
                onClick={() => fastPayRef.current('UPI', 'touch')}
                aria-pressed={method === 'UPI'}
                title={!hasLines ? 'Add at least one item' : undefined}
              >
                <span>{armedMethod === 'UPI' ? (isTouch ? 'Confirm UPI' : 'Press F9 to confirm') : 'UPI'}</span>
                {!isTouch && <span className="fast-pay-kbd">F9</span>}
              </button>

              {/* Khata Sale Button (when customer linked) */}
              {customerMode && khataOn && (
                <button
                  type="button"
                  data-pay="Khata"
                  className={`fast-pay-btn ${method === 'Khata' && !armedMethod ? 'selected' : ''}`}
                  disabled={blocked || !hasMatchedAccount}
                  onClick={() => {
                    setMethod('Khata')
                    confirmRef.current('Khata')
                  }}
                  aria-pressed={method === 'Khata'}
                  title={!hasMatchedAccount ? 'Link a matching customer account first' : undefined}
                >
                  <span>Khata</span>
                </button>
              )}
            </div>
          </>
        )}

        {/* Primary Settle Bill button */}
        <Btn
          variant="primary"
          block
          disabled={blocked}
          onClick={() => {
            if (isEnforced) {
              confirmRef.current(enforcedPaymentMethod)
            } else if (armedMethod) {
              confirmRef.current(armedMethod)
            } else {
              confirmRef.current(method)
            }
          }}
          style={{ height: 48, fontSize: 15, fontWeight: 600, marginTop: isEnforced ? 0 : 8 }}
        >
          {busy
            ? 'Saving bill…'
            : isEnforced
              ? `Settle ${enforcedPaymentMethod} Sale · ${money(grand)} (Ctrl+Enter)`
              : armedMethod
                ? `Confirm ${armedMethod} Sale · ${money(grand)}`
                : `Settle Bill · ${money(grand)} (Ctrl+Enter)`}
        </Btn>
      </div>
    </>
  )
})

/**
 * "Quick add" popular-item chips. Memoized: the chip list only changes when the
 * catalog/rates change, so cart, payment and unrelated UI state updates no longer
 * re-render this strip. The click handler is a latest-value ref (addProduct reads
 * live cart state), keeping props referentially stable.
 */
const QuickAdd = memo(function QuickAdd({
  items,
  onAddRef,
}: {
  items: { p: PProduct; rate: number }[]
  onAddRef: { current: (p: PProduct) => void }
}) {
  return (
    <div className="quick-wrap">
      <div className="micro-label">Quick add popular items</div>
      <div className="quick-row">
        {items.map(({ p, rate }) => (
          <button key={p.id} type="button" className="quick-chip" onClick={() => onAddRef.current(p)}>
            + {p.name} · {money(rate)}
          </button>
        ))}
        {items.length === 0 && <span className="t-caption">Add stock to the counter to see quick items.</span>}
      </div>
    </div>
  )
})

export type CustomerCardHandle = { setName: (name: string) => void; clear: () => void }

/**
 * Customer / Khata card. Owns its input text and dropdown state so that typing a
 * customer name re-renders only this card, never the 3,000-line SalesPage body.
 *
 * The parent still gets what it needs, without per-keystroke renders:
 *  - `onNameChange` writes the current text into a parent ref (no setState);
 *  - `onMatch` fires only when the RESOLVED account changes.
 * Tab restore / resets use the imperative handle.
 */
const CustomerCard = memo(
  forwardRef<
    CustomerCardHandle,
    {
      active: boolean
      onToggle: () => void
      accounts: PAccount[]
      isOwner: boolean
      onNameChange: (name: string) => void
      onMatch: (account: PAccount | undefined) => void
      onCreateNew: () => void
    }
  >(function CustomerCard({ active, onToggle, accounts, isOwner, onNameChange, onMatch, onCreateNew }, ref) {
    const [name, setName] = useState('')
    const [open, setOpen] = useState(false)

    const matches = useMemo(() => {
      const q = name.trim()
      if (!q) return accounts.slice(0, 6)
      return searchAccounts(accounts, q, { limit: 6 })
    }, [name, accounts])

    const match = useMemo(() => {
      if (!active) return undefined
      const n = name.trim().toUpperCase()
      if (!n) return undefined
      const nDigits = n.replace(/\D/g, '')
      return accounts.find((a) => {
        if (a.name.trim().toUpperCase() === n) return true
        if (a.code && a.code.toUpperCase() === n) return true
        if (nDigits && nDigits.length >= 6 && a.phone && a.phone.replace(/\D/g, '') === nDigits) return true
        return false
      })
    }, [active, name, accounts])

    useEffect(() => {
      onNameChange(name)
    }, [name, onNameChange])

    useEffect(() => {
      onMatch(match)
    }, [match, onMatch])

    useImperativeHandle(
      ref,
      () => ({
        setName: (n: string) => {
          setName(n)
          setOpen(false)
        },
        clear: () => {
          setName('')
          setOpen(false)
        },
      }),
      [],
    )

    return (
      <div className={`co-cust ${active ? 'is-active' : ''}`}>
        <div className="co-cust-head">
          <span className="co-cust-title">
            <IconUser size={14} />
            <span>Customer / Khata</span>
            {active ? (
              match ? (
                <span className="co-cust-badge matched">Linked</span>
              ) : name.trim() ? (
                <span className="co-cust-badge unlinked">Unlinked</span>
              ) : (
                <span className="co-cust-badge">Active</span>
              )
            ) : (
              <span className="co-cust-badge">Walk-in</span>
            )}
          </span>
          <button
            type="button"
            className={`switch sm ${active ? 'on' : ''}`}
            role="switch"
            aria-checked={active}
            aria-label="Link customer account"
            title={active ? 'Turn off for direct walk-in' : 'Turn on to link customer or Khata ledger'}
            onClick={onToggle}
          >
            <span className="knob" />
          </button>
        </div>
        {active && (
          <div className="co-cust-body">
            <div className="co-cust-input-wrap">
              <div className="co-cust-search-box sug-anchor" style={{ position: 'relative' }}>
                <input
                  className="field-control"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setOpen(true)
                  }}
                  onFocus={() => setOpen(true)}
                  onBlur={() => setTimeout(() => setOpen(false), 200)}
                  placeholder={isOwner ? 'Search customer, retailer or phone…' : 'Search name, mobile or code…'}
                  autoFocus
                />
                {name && (
                  <button
                    type="button"
                    className="co-cust-clear"
                    onClick={() => {
                      setName('')
                      setOpen(false)
                    }}
                    title="Clear customer name"
                    aria-label="Clear customer name"
                  >
                    <IconX size={12} />
                  </button>
                )}
                {open && matches.length > 0 && (
                  <ul style={comboboxListStyle}>
                    {matches.map((a) => (
                      <li
                        key={a.id}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setName(a.name)
                          setOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          cursor: 'pointer',
                          borderBottom: '1px solid var(--line)',
                          background: 'var(--canvas)',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.type === 'Retailer' ? `[Retailer] ${a.name}` : a.name}
                          </span>
                          <span className="t-caption num" style={{ color: 'var(--muted)' }}>
                            {a.phone ? a.phone : a.code ? a.code : ''}
                          </span>
                        </div>
                            {(a.balance ?? 0) > 0 ? (
                              <span className="num due" style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 8 }}>
                                Due {money(a.balance ?? 0)}
                              </span>
                            ) : (a.balance ?? 0) < 0 ? (
                              <span className="num adv" style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 8 }}>
                                Adv {money(Math.abs(a.balance ?? 0))}
                              </span>
                            ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                className="co-cust-new-btn"
                onClick={onCreateNew}
                title={isOwner ? 'Create a customer or link retailer' : 'Create a new customer'}
              >
                + New
              </button>
            </div>
            {match ? (
              <div className="co-cust-info">
                <span className="co-cust-info-name">
                  <IconCheck size={12} style={{ color: 'var(--semantic-success)', flexShrink: 0 }} />
                  <strong>{match.name}</strong>
                  {match.phone && <span className="co-cust-info-phone">· {match.phone}</span>}
                </span>
                {(match.balance ?? 0) > 0 ? (
                  <span className="co-cust-bal due" title="Pending dues to collect">
                    Due {money(match.balance ?? 0)}
                  </span>
                ) : (match.balance ?? 0) < 0 ? (
                  <span className="co-cust-bal adv" title="Customer has advance credit balance">
                    Adv {money(Math.abs(match.balance ?? 0))}
                  </span>
                ) : (
                  <span className="co-cust-bal clear" title="Zero pending ledger balance">
                    Clear (₹0)
                  </span>
                )}
              </div>
            ) : name.trim() ? (
              <div className="co-cust-info unlinked-hint">
                <span>No matching Khata account for this name.</span>
                <button type="button" className="co-cust-create-ledger" onClick={onCreateNew}>
                  Create ledger
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    )
  }),
)

function SalesPage() {
  const { user, activeShop, seesMoney, feature, featureOn } = useAuth()
  const d = useData()
  const toast = useToast()
  const shopId = activeShop?.id ?? ''
  const todayBusinessDate = useCurrentBusinessDate(activeShop?.lockInTime)
  const isOwner = activeShop?.role === 'owner'
  const [prefs, setPrefs] = useState(() => loadPrefs())

  // Server-authoritative shop capabilities (Settings → Features). The UI mirrors
  // them for hiding/affordances only; every rule is re-checked server-side.
  const kitchenOn = featureOn('kitchen')
  const customRateOn = featureOn('custom_rate')
  const discountOn = featureOn('quick_discount') || featureOn('discount')
  // 'manual' (cashier types an amount) or 'auto' (system only SUGGESTS a
  // rounding discount; it is never applied until the cashier taps the chip).
  const discountMode: 'manual' | 'auto' =
    (feature('quick_discount').mode === 'auto' || feature('discount').mode === 'auto') ? 'auto' : 'manual'
  // Auto-import godown stock to counter when counter stock is insufficient during billing
  const autoGodownOn = featureOn('auto_godown_transfer')
  // Khata credit is a real shop capability; the server rejects credit sales
  // when it is off, and the counter hides the Khata method to match.
  const khataOn = featureOn('khata_credit')
  const continuousScanning = Boolean(prefs.continuousScanning)
  const todaySalesOn = featureOn('today_sales_checkout') && seesMoney
  const [todaySales, setTodaySales] = useState<{ gross: number; net: number } | null>(null)
  const todaySalesMode = feature('today_sales_checkout').mode === 'gross' ? 'gross' : 'net'
  const enforcedPaymentMethod = prefs.salesDefaultPaymentMode ?? 'all'
  const isEnforced = enforcedPaymentMethod !== 'all'

  const [cartUnlocked, setCartUnlocked] = useState(false)
  const continuousSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRestoredRef = useRef(false)

  useEffect(() => {
    const handleFocus = () => setPrefs(loadPrefs())
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  const connectedRetailerShops = useMemo(() => {
    if (!isOwner || !user?.shops) return []
    return user.shops.filter((s) => s.id !== activeShop?.id)
  }, [isOwner, user?.shops, activeShop?.id])

  const [lines, setLines] = useState<BillLine[]>(() => loadBillDraft())
  const [schemes, setSchemes] = useState<DiscountScheme[]>([NO_COUPON])
  const [discountManagerOpen, setDiscountManagerOpen] = useState(false)
  const [couponIdx, setCouponIdx] = useState(0)
  const [gstSlab, setGstSlab] = useState(0)
  const [quickDiscount, setQuickDiscount] = useState(0)
  const [method, setMethod] = useState<PayOption>(nextDefaultMethod)
  const [busy, setBusy] = useState(false)
  const [newCustType, setNewCustType] = useState<'Customer' | 'Retailer'>('Customer')
  const [selectedRetailShopId, setSelectedRetailShopId] = useState('')

  // Bug B fix: fetch the shop's active discount schemes once per shop,
  // replaces the hardcoded COUPONS constant. Falls back to just "No coupon"
  // if the fetch fails, so checkout keeps working without discounts.
  const reloadSchemes = () => {
    if (!shopId) return
    repo
      .listDiscountSchemes(shopId)
      .then((rows) => {
        setSchemes([
          NO_COUPON,
          ...rows.map((r) => ({ id: r.id, code: r.code, label: r.label, kind: r.kind, value: Number(r.value) })),
        ])
      })
      .catch(() => {
        setSchemes([NO_COUPON])
      })
  }

  useEffect(() => {
    reloadSchemes()
  }, [shopId])

  // ---- Restaurant floor (Settings → Tables) --------------------------------
  // Tabs are client-side only (no backend tab store): the register binds to a
  // floor table, items ring onto its tab, and the tab persists in localStorage
  // so a reload (or a second browser tab) sees the same open tables. Settling
  // or clearing frees the table.
  const tablesCfg: TablesConfig = useMemo(() => {
    const metaBase = normalizeTablesConfig(d.meta?.tables)
    const prefsBase = normalizeTablesConfig(loadPrefs().tables)
    return normalizeTablesConfig({
      ...metaBase,
      enabled: prefsBase.enabled,
      tips: prefsBase.tips,
      rows: prefsBase.rows,
      cols: prefsBase.cols,
      pattern: prefsBase.pattern,
      prefix: prefsBase.prefix,
    })
  }, [d.meta])
  const labels = useMemo(() => (tablesCfg.enabled ? tableLabels(tablesCfg) : []), [tablesCfg])
  // Seating view settings (arrangement + tile size), device-local prefs,
  // applied to the seating grid only; table binding/parking is untouched.
  const [seatArrangement] = useState<SeatingArrangement>(() => loadPrefs().seatingArrangement)
  const [seatSize] = useState<SeatingSize>(() => loadPrefs().seatingSize)
  // Floor plan placement: 'top' is the classic full-width strip; 'left'/'right'
  // dock it as a rail beside the register at ≥1056px only (CSS falls back to
  // 'top' below that); 'hidden' keeps only the slim head strip with an
  // expand chevron (session-only, the saved pref stays).
  const [seatPos] = useState<SeatingPos>(() => loadPrefs().seatingPos)
  const [seatCustomTile] = useState<number>(() => loadPrefs().seatingCustomTile)
  const [seatCustomHeight] = useState<number>(() => loadPrefs().seatingCustomHeight)
  const [fastSaleMode, setFastSaleMode] = useState<boolean>(false)
  const [activeTableId, setActiveTableId] = useState<string | null>(null)

  const activeLabel = useMemo(
    () => labels.find((l) => tableId(l) === activeTableId) ?? null,
    [labels, activeTableId]
  )
  const [tabsById, setTabsById] = useState<Map<string, TableTab>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null')
      return raw && typeof raw === 'object' ? new Map(Object.entries(raw)) : new Map()
    } catch {
      return new Map()
    }
  })
  // CROSS-DEVICE TAB CONFLICT (2026-08-31): a locally-free seating table may
  // hold a live tab parked from another device. The probe in bindTable asks
  // before taking over; granted takeovers let subsequent saves force-park.
  const [takeoverAsk, setTakeoverAsk] = useState<{ id: string; conflict: PServerTab } | null>(null)
const takeoverGranted = useRef<Set<string>>(new Set())

  function commitTab(t: TableTab | null, id: string) {
    const next = new Map(tabsById)
    if (t) next.set(id, t)
    else next.delete(id)
    setTabsById(next)
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(Object.fromEntries(next)))
    } catch {
      /* storage full / unavailable: tabs survive for this session */
    }
    // Server persistence (multi-device conflict guard). Failures are
    // non-fatal: offline billing still works from localStorage.
    const label = labels.find((l) => tableId(l) === id)
    if (!label || !shopId) return
    if (t) {
      repo.saveServerTab(shopId, label, {
        customerName: t.customerName || '',
        gstSlab: t.gstSlab || 0,
        couponCode: t.couponCode || '',
        tipPct: t.tipPct || 0,
        draftItems: t.items,
      }, takeoverGranted.current.has(id)).catch(() => {})
    } else {
      takeoverGranted.current.delete(id)
      repo.releaseServerTab(shopId, label).catch(() => {})
    }
  }

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Pending table switch when an unbound bill would be overwritten. */
  const [switchAsk, setSwitchAsk] = useState<string | null>(null)

  // Service tip: restaurant bills only. Chips are % of the discounted
  // subtotal; Custom takes an absolute ₹ amount. Added AFTER tax on the bill.
  const [tipPct, setTipPct] = useState(0)
  const [useCustomTip, setUseCustomTip] = useState(false)
  const [customTip, setCustomTip] = useState(0)

  // Customer / Khata toggle: off by default; direct walk-in, no name asked.
  const [customerMode, setCustomerMode] = useState(false)
  // Customer text + dropdown live inside the memoized CustomerCard so typing a
  // name never re-renders this component. The parent keeps the current text in a
  // ref (for the sale/tab payloads) and the RESOLVED account as state (for the
  // Khata gate), updated only when the match actually changes.
  const customerCardRef = useRef<CustomerCardHandle | null>(null)
  const customerNameRef = useRef('')
  const [matchedAccount, setMatchedAccount] = useState<PAccount | undefined>(undefined)

  useEffect(() => {
    if (!khataOn && customerMode) {
      setCustomerMode(false)
      if (method === 'Khata') setMethod(isEnforced ? (enforcedPaymentMethod as PayOption) : 'Cash')
    }
  }, [khataOn, customerMode, method, isEnforced, enforcedPaymentMethod])

  useEffect(() => {
    if (isEnforced && method !== enforcedPaymentMethod) {
      setMethod(enforcedPaymentMethod as PayOption)
    }
  }, [isEnforced, enforcedPaymentMethod, method])

  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newCustCountry, setNewCustCountry] = useState(DEFAULT_DIAL)
  const [addingCust, setAddingCust] = useState(false)

  const [clearOpen, setClearOpen] = useState(false)
  const [lastBill, setLastBill] = useState<ReceiptData | null>(null)
  // Post-confirm print prompt: asks once per bill unless autoPrintBill is on.
  const [printAsk, setPrintAsk] = useState<ReceiptData | null>(null)
  const [printAskAlways, setPrintAskAlways] = useState(false)

  // ---- F3: keyboard-first cart navigation ----------------------------------
  const [focusedLineIdx, setFocusedLineIdx] = useState<number | null>(null)
  const [qtyBuf, setQtyBuf] = useState<{ line: number; text: string } | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const lineRowRefs = useRef<(HTMLTableRowElement | null)[]>([])
  const lastLineKeyAt = useRef(0)
  // Latest-value ref for the row keydown handler: it closes over live cart state,
  // so it cannot be memoized itself — the memoized BillRow reads it through this
  // ref, keeping its props stable.
  const onLineKeyDownRef = useRef<(e: React.KeyboardEvent<HTMLTableRowElement>, i: number) => void>(() => {})
  const payMethodRef = useRef<HTMLDivElement | null>(null)
  const coPanelRef = useRef<HTMLElement | null>(null)

const [armedPay, setArmedPay] = useState<ArmedPayment | null>(null)
  const armedPayTimerRef = useRef<number | null>(null)
  const armedPayRef = useRef<ArmedPayment | null>(null)

  // Unmount cleanup: a pending fast-pay arm must not fire after the page is gone.
  useEffect(() => {
    return () => {
      if (armedPayTimerRef.current) {
        clearTimeout(armedPayTimerRef.current)
        armedPayTimerRef.current = null
      }
    }
  }, [])

  const [isTouch, setIsTouch] = useState(() => {
    if (typeof window === 'undefined') return false
    return (
      window.matchMedia('(hover: none) and (pointer: coarse)').matches ||
      ('ontouchstart' in window && window.innerWidth <= 1024)
    )
  })

  useEffect(() => {
    const checkTouch = () => {
      setIsTouch(
        window.matchMedia('(hover: none) and (pointer: coarse)').matches ||
        ('ontouchstart' in window && window.innerWidth <= 1024)
      )
    }
    window.addEventListener('resize', checkTouch)
    return () => window.removeEventListener('resize', checkTouch)
  }, [])

  function cancelArmedPay() {
    if (armedPayTimerRef.current) {
      clearTimeout(armedPayTimerRef.current)
      armedPayTimerRef.current = null
    }
    armedPayRef.current = null
    setArmedPay(null)
  }
  const cancelArmedPayRef = useRef(cancelArmedPay)

  const triggerFastPayRef = useRef<(m: 'Cash' | 'UPI', src: 'keyboard' | 'touch') => void>(() => {})
  const tryConfirmRef = useRef<() => void>(() => {})
  // Latest-value bridge for confirmSale so the memoized PayPanel can stay
  // referentially stable (confirmSale closes over live cart/payment state).
  const confirmSaleRef = useRef<(m?: PayOption) => void>(() => {})
  // Latest-value bridge for addProduct so the memoized QuickAdd strip stays stable.
  const addProductRef = useRef<(p: PProduct) => void>(() => {})
  const uiBlockedRef = useRef(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const clearSearchRef = useRef<() => void>(() => {})
  const lastScanRef = useRef({ code: '', at: 0 })

  const salesProducts = useMemo(
    () => (kitchenOn ? d.products : d.products.filter((p) => !p.isKitchen)),
    [d.products, kitchenOn]
  )

  const barcodeMap = useMemo(() => new Map(salesProducts.map((p) => [p.barcode, p])), [salesProducts])
  const codeMap = useMemo(() => new Map(salesProducts.map((p) => [p.code.toLowerCase(), p])), [salesProducts])
  const productById = useMemo(() => new Map(d.products.map((p) => [p.id, p])), [d.products])

  useEffect(() => {
    searchRef.current?.focus()
    const overlayOpen = () => {
      // Esc/F2 must not fight the Drawer/ConfirmDialog handlers or yank focus
      // to the scanner behind an open modal.
      const el = document.activeElement
      return !!el && typeof el.closest === 'function' && el.closest('[role="dialog"],[role="alertdialog"]') !== null
    }
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpen() || uiBlockedRef.current) return
      const el = document.activeElement as HTMLElement | null
      const tag = (el?.tagName ?? '').toLowerCase()
      const inField = tag === 'input' || tag === 'select' || tag === 'textarea' || !!el?.isContentEditable

      // F8: Fast Cash Sale (first press arms, second press confirms; routes to enforced payment method when enforced)
      if (e.key === 'F8') {
        e.preventDefault()
        e.stopPropagation()
        triggerFastPayRef.current(isEnforced ? (enforcedPaymentMethod as 'Cash' | 'UPI') : 'Cash', 'keyboard')
        return
      }

      // F9: Fast UPI Sale (first press arms, second press confirms; routes to enforced payment method when enforced)
      if (e.key === 'F9') {
        e.preventDefault()
        e.stopPropagation()
        triggerFastPayRef.current(isEnforced ? (enforcedPaymentMethod as 'Cash' | 'UPI') : 'UPI', 'keyboard')
        return
      }

      // Ctrl+Enter: confirm & settle
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        tryConfirmRef.current()
        return
      }

      // Escape: cancel armed payment or clear search / return to scanner
      if (e.key === 'Escape') {
        if (armedPayRef.current) {
          e.preventDefault()
          e.stopPropagation()
          cancelArmedPayRef.current()
          searchRef.current?.focus()
          return
        }
        if (retModeRef.current) return
        if (histModeRef.current) {
          e.preventDefault()
          e.stopPropagation()
          setHistMode(false)
          searchRef.current?.focus()
          return
        }
        // If an input is focused and has text, let the input or field handle its own Esc
        if (inField && (el as HTMLInputElement)?.value) {
          return
        }
        // Hard rule: Esc always returns the cursor to the scanner box.
        e.preventDefault()
        clearSearchRef.current()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }

      if (!retModeRef.current && !histModeRef.current && (e.key === 'F2' || (e.key === '/' && !inField))) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }

      if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') {
        if (histModeRef.current) return
        e.preventDefault()
        setShortcutsOpen(true)
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Hard rule: while on Sales, a scan anywhere on the page resolves instantly.
  // Unknown codes and out-of-stock items notify instead of failing silently.
  // Both capture paths (global wedge + Enter inside the search box) funnel
  // through here so the machine-gun dedup guard always applies.
  function tryAddScanned(rawCode: string): 'added' | 'blocked' | 'unknown' {
    setQtyBuf(null)
    setFocusedLineIdx(null)
    const norm = normalizeScan(rawCode)
    if (!norm) return 'unknown'
    // Scanner dedup uses the DEVICE clock on purpose, it measures keystroke
    // timing, not business dates.
    const scanNow = Date.now()
    const prev = lastScanRef.current
    if (norm === prev.code && scanNow - prev.at < DEDUP_MS) return 'added' // machine-gun guard: swallow
    lastScanRef.current = { code: norm, at: scanNow }

    const p = barcodeMap.get(norm) ?? codeMap.get(norm.toLowerCase())
    if (!p) return 'unknown'
    if (!kitchenOn && p.isKitchen) return 'unknown'
    const totalStock = !d.online || p.isKitchen ? Infinity : (autoGodownOn ? p.counterPcs + p.godownPcs : p.counterPcs)
    if (d.online && totalStock <= 0) {
      blockProduct(p)
      return 'blocked'
    }
addProduct(p)
    beep('ok')
    return 'added'
  }

  const handleScan = useRef<(raw: string) => void>(() => {})
  function handleScanImpl(raw: string) {
    // Stray scans while a return/exchange or history bill is on screen must
    // not add hidden cart lines to the current bill.
    if (retModeRef.current || histModeRef.current) return
    const res = tryAddScanned(raw)
    if (res === 'unknown') {
      beep('err')
      toast(`Barcode ${normalizeScan(raw)} not found — check the product list.`, 'err')
    } else if (res === 'added') {
      clearSearchRef.current()
      searchRef.current?.focus()
    }
  }
  useEffect(() => {
    const cap = attachScannerCapture((code) => handleScan.current(code))
    return () => cap.detach()
  }, [])

  // Top sellers ranking: calculate real sold quantities from sales history (d.sales),
  // ranking verified top sellers first, falling back to counter stock.
  const popular = useMemo(() => {
    const soldQtyMap = new Map<string, number>()
    for (const s of d.sales || []) {
      for (const it of s.items || []) {
        if (it.productId) {
          soldQtyMap.set(it.productId, (soldQtyMap.get(it.productId) || 0) + (it.qty || 1))
        }
      }
    }
    const candidates = salesProducts.filter(
      (p) => (kitchenOn ? p.isKitchen : false) || (autoGodownOn ? p.counterPcs + p.godownPcs > 0 : p.counterPcs > 0)
    )
    return [...candidates]
      .sort((a, b) => {
        const soldA = soldQtyMap.get(a.id) || 0
        const soldB = soldQtyMap.get(b.id) || 0
        if (soldB !== soldA) return soldB - soldA
        return b.counterPcs - a.counterPcs
      })
      .slice(0, 8)
  }, [salesProducts, kitchenOn, d.sales])

  // Starting price = "Sales Rate" when the device holds it, falling back to MRP.
  // When the shop disables custom rate editing the catalog selling rate is the
  // only legal price, so the cart starts (and stays) there — the server rejects
  // any other value, and the UI must never show a total it cannot post.
  function saleRate(p: PProduct): number {
    if (!customRateOn) return p.rate && p.rate > 0 ? p.rate : p.mrp
    const r = d.rates[p.id]
    return r && r > 0 ? r : p.mrp
  }

  // Chip data for the memoized QuickAdd strip. saleRate only depends on the
  // custom-rate capability and the device rate map, so those are the deps.
  const popularChips = useMemo(
    () => popular.map((p) => ({ p, rate: saleRate(p) })),
    [popular, customRateOn, d.rates],
  )

  // Drift guard: parked tables, restored drafts, or a flip of the capability
  // can leave a custom rate in the cart. Re-normalize every line to the catalog
  // rate whenever custom editing is off so the displayed total is postable.
  useEffect(() => {
    if (customRateOn) return
    setLines((ls) => {
      let changed = false
      const next = ls.map((l) => {
        const p = d.products.find((x) => x.id === l.productId)
        if (!p) return l
        const cat = p.rate && p.rate > 0 ? p.rate : p.mrp
        if (cat !== l.rate) {
          changed = true
          return { ...l, rate: cat }
        }
        return l
      })
      return changed ? next : ls
    })
  }, [customRateOn, d.products])

  // A product that couldn't be added because available stock is exhausted.
  // Drives an inline warning when total stock is exceeded.
  const [blocked, setBlocked] = useState<
    { name: string; counter: number; godown: number; used: number } | null
  >(null)
  const nav = useNavigate()

  function blockProduct(prod: PProduct, used = 0) {
    const totalStock = autoGodownOn ? prod.counterPcs + prod.godownPcs : prod.counterPcs
    beep('err')
    setBlocked({ name: prod.name, counter: prod.counterPcs, godown: prod.godownPcs, used })
    if (totalStock <= 0) {
      if (!autoGodownOn && prod.godownPcs > 0) {
        toast(`${prod.name} has 0 counter stock (${prod.godownPcs} in godown). Auto-transfer is disabled.`, 'err')
      } else {
        toast(`${prod.name} is out of stock.`, 'err')
      }
    } else if (used >= totalStock) {
      const stockDesc = autoGodownOn
        ? `all ${totalStock} available pcs (${prod.counterPcs} counter, ${prod.godownPcs} godown)`
        : `all ${totalStock} counter pcs`
      toast(`${prod.name}: ${stockDesc} already added to the bill.`, 'err')
    } else {
      toast(`${prod.name} is out of stock.`, 'err')
    }
  }

  function addProduct(p: PProduct) {
    setQtyBuf(null)
    setFocusedLineIdx(null)
    if (!kitchenOn && p.isKitchen) {
      beep('err')
      toast('Kitchen dishes are disabled in settings.', 'err')
      return
    }
    cancelArmedPay()
    const totalStock = p.isKitchen ? Infinity : (autoGodownOn ? p.counterPcs + p.godownPcs : p.counterPcs)
    if (totalStock <= 0) {
      blockProduct(p)
      return
    }
    const existing = lines.find((l) => l.productId === p.id)
    if (d.online && !p.isKitchen && existing && existing.qty >= totalStock) {
      blockProduct(p, existing.qty)
      return
    }
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id)
      if (i >= 0) {
        const next = [...ls]
        next[i] = { ...next[i], qty: next[i].qty + 1 }
        return next
      }
      return [...ls, { productId: p.id, name: p.name, unit: p.unit, qty: 1, rate: saleRate(p) }]
    })
    setBlocked(null)
    searchRef.current?.focus()
  }

  const activeLines = useMemo(() => lines.filter((l) => l.qty > 0), [lines])
  const coupon = schemes[couponIdx] ?? NO_COUPON
  const priced = useCounterQuote(activeLines, discountOn ? coupon.code : '', discountOn ? quickDiscount : 0, matchedAccount?.id)
  const subtotal = priced.quote?.subtotal ?? 0
  const subtotalPaise = toPaise(subtotal)
  const discount = coupon.code ? priced.quote?.discount ?? 0 : 0
  const quickPaise = toPaise(discountOn && !coupon.code ? priced.quote?.discount ?? 0 : 0)
  const maxQuickPaise = subtotalPaise
  const gstAmount = priced.quote?.tax ?? 0
  const tip = 0
  const grand = priced.quote?.payable ?? 0
  const grandPaise = toPaise(grand)
  // Auto quick-discount suggestion.
  //
  // Rule (Settings → Features → Discounts & schemes → Auto mode):
  //   round the payable DOWN to the nearest ₹100 when the leftover remainder is
  //   ₹50 or less. ₹50 qualifies; ₹51 does not. Exact multiples need nothing,
  //   and ₹0 / empty carts never suggest.
  //
  // This is SUGGESTIVE ONLY. It is surfaced as a chip the cashier must tap;
  // the bill is never modified without an explicit action, and Manual mode
  // never suggests at all.
  const ROUND_TARGET_PAISE = 10000 // ₹100
  const ROUND_THRESHOLD_PAISE = 5000 // ₹50
  const suggestedQuickPaise = useMemo(() => {
    if (!discountOn || discountMode !== 'auto' || subtotalPaise <= 0) return 0
    const remainder = grandPaise % ROUND_TARGET_PAISE
    if (remainder <= 0 || remainder > ROUND_THRESHOLD_PAISE) return 0
    // Cap by what is still discountable after any coupon; if the coupon already
    // covers the remainder there is nothing useful to suggest.
    const next = Math.min(remainder, maxQuickPaise)
    return next > 0 ? next : 0
  }, [discountOn, discountMode, grandPaise, maxQuickPaise, subtotalPaise])
  useEffect(() => { if (priced.offline) toast('Offline estimate · final amounts are confirmed on sync.', 'warn') }, [priced.offline, toast])
  const totalPcs = lines.reduce((a, l) => a + l.qty, 0)

  // Khata credit needs a REAL Customer or Retailer account selected, the due posts to
  // their ledger on settle.
  const eligibleAccounts = useMemo(
    () => d.accounts.filter((a) => a.type === 'Customer' || (isOwner && a.type === 'Retailer')),
    [d.accounts, isOwner]
  )

  // ---- Table tab persistence (client-side) --------------------------------
  function buildTab(): TableTab | null {
    if (!activeTableId || !activeLabel) return null
    const items = draftItems(lines)
    if (!items.length) return null
    const prev = tabsById.get(activeTableId)
    return {
      id: activeTableId,
      label: activeLabel,
      items,
      customerName: customerMode ? customerNameRef.current.trim().toUpperCase() : '',
      gstSlab,
      couponCode: couponIdx > 0 ? coupon.code : '',
      tipPct,
      // Park the custom-₹ tip with the tab so it survives a table switch.
      useCustomTip,
      customTip: round2(customTip),
      openedAt: prev?.openedAt ?? now(),
      openedBy: prev?.openedBy ?? user?.name ?? 'Staff',
      updatedAt: now(),
    }
  }

  function flushSave() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!activeTableId) return
    const t = buildTab()
    commitTab(t, activeTableId)
  }
  // Latest flushSave for the page-hide path (below), never a stale closure.
  const flushSaveRef = useRef(flushSave)

  // ---- Customer card bridges (stable, so the memoized card never re-renders
  // because a parent render produced a fresh callback) ----------------------
  const methodRef = useRef(method)
  const activeTableIdRef = useRef(activeTableId)

  const handleCustomerName = useCallback((v: string) => {
    customerNameRef.current = v
    // Keep the tab-draft autosave behaviour on a customer change without a
    // render: re-arm the same 900ms debounce the state-driven effect used.
    if (!activeTableIdRef.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flushSaveRef.current(), 900)
  }, [])

  const handleCustomerMatch = useCallback((a: PAccount | undefined) => {
    setMatchedAccount(a)
  }, [])

  const handleCustomerToggle = useCallback(() => {
    setCustomerMode((prev) => {
      const next = !prev
      if (!next && methodRef.current === 'Khata') setMethod('Cash')
      return next
    })
  }, [])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSaveRef.current()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  // Debounced auto-save of the bound table's running order.
  useEffect(() => {
    if (!activeTableId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSave, 900)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, couponIdx, gstSlab, customerMode, activeTableId])

  // Persist / clear the unbound-bill draft (see DRAFT_KEY).
  useEffect(() => {
    try {
      if (activeTableId || lines.length === 0) {
        localStorage.removeItem(DRAFT_KEY)
        return
      }
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          items: lines,
          customerName: customerNameRef.current.trim(),
          gstSlab,
          quickDiscount,
          couponIdx,
          tipPct,
          customTip,
          useCustomTip,
        }),
      )
    } catch {
      /* storage full / unavailable */
    }
  }, [lines, activeTableId, gstSlab, quickDiscount, couponIdx, tipPct, customTip, useCustomTip])

  // Continuous scanning server-tab synchronization (background, non-blocking)
  useEffect(() => {
    if (!continuousScanning || !shopId || activeTableId) return

    if (continuousSyncTimer.current) clearTimeout(continuousSyncTimer.current)

    if (lines.length === 0) {
      repo.releaseServerTab(shopId, '__continuous_draft__').catch(() => {})
      return
    }

    continuousSyncTimer.current = setTimeout(() => {
      const items = draftItems(lines)
      if (items.length > 0 && shopId) {
        repo.saveServerTab(
          shopId,
          '__continuous_draft__',
          {
            customerName: customerNameRef.current.trim(),
            gstSlab,
            couponCode: discount > 0 ? coupon.code : '',
            tipPct: tablesCfg.tips ? tipPct : 0,
            draftItems: items,
          },
          true,
        ).catch(() => {})
      }
    }, 1000)

    return () => {
      if (continuousSyncTimer.current) clearTimeout(continuousSyncTimer.current)
    }
  }, [continuousScanning, shopId, lines, activeTableId, gstSlab, discount, coupon.code, tablesCfg.tips, tipPct])

  // Continuous scanning draft restore: local-first, server-fallback
  useEffect(() => {
    if (!continuousScanning || !shopId || draftRestoredRef.current) return
    draftRestoredRef.current = true

    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
      if (raw && Array.isArray(raw.items) && raw.items.length > 0) {
        if (raw.customerName) {
          setCustomerMode(true)
          customerCardRef.current?.setName(raw.customerName)
        }
        if (typeof raw.gstSlab === 'number') setGstSlab(raw.gstSlab)
        if (typeof raw.quickDiscount === 'number') setQuickDiscount(raw.quickDiscount)
        if (typeof raw.couponIdx === 'number') setCouponIdx(raw.couponIdx)
        if (typeof raw.tipPct === 'number') setTipPct(raw.tipPct)
        if (typeof raw.customTip === 'number') setCustomTip(raw.customTip)
        if (typeof raw.useCustomTip === 'boolean') setUseCustomTip(raw.useCustomTip)
        return
      }
    } catch {}

    // Fallback: check server draft tab if local storage was empty
    repo.listServerTabs(shopId).then((serverTabs) => {
      const draftTab = serverTabs.find((st) => st.tableLabel === '__continuous_draft__')
      if (draftTab && Array.isArray(draftTab.draftItems) && draftTab.draftItems.length > 0) {
        const restored: BillLine[] = draftTab.draftItems.map((item: any) => ({
          productId: item.productId || item.product_id,
          barcode: item.barcode || '',
          code: item.code || '',
          name: item.name,
          unit: item.unit || 'pcs',
          rate: Number(item.rate) || 0,
          qty: Number(item.qty) || 1,
          isKitchen: Boolean(item.isKitchen),
        }))
        setLines(restored)
        if (draftTab.customerName) {
          setCustomerMode(true)
          customerCardRef.current?.setName(draftTab.customerName)
        }
        if (draftTab.gstSlab) setGstSlab(draftTab.gstSlab)
        if (draftTab.tipPct) setTipPct(draftTab.tipPct)
      }
    }).catch(() => {})
  }, [continuousScanning, shopId])

  async function bindTable(id: string) {
    const wasBound = activeTableId != null
    const hadCart = lines.some((l) => l.qty > 0)
    flushSave()
    setActiveTableId(id)
    const t = tabsById.get(id)
    if (t && t.items.length > 0) {
      // Occupied table: its EXISTING tab opens (standard floor-service
      // behaviour: never a second order on one table).
      const tabItems = kitchenOn
        ? t.items
        : t.items.filter((x) => {
            const prod = x.productId ? productById.get(x.productId) : undefined
            return !prod?.isKitchen
          })
      setLines(tabItems.map((x) => ({ ...x, productId: x.productId as string })))
      const ci = schemes.findIndex((c) => c.code === t.couponCode)
      setCouponIdx(ci >= 0 ? ci : 0)
      setGstSlab(t.gstSlab || 0)
      if (t.customerName) {
        setCustomerMode(true)
        customerCardRef.current?.setName(t.customerName)
      } else {
        setCustomerMode(false)
        customerCardRef.current?.clear()
      }
      setUseCustomTip(t.useCustomTip ?? false)
      setCustomTip(t.customTip ?? 0)
      setTipPct(t.tipPct || 0)
    } else if (!wasBound && hadCart) {
      // An unbound bill adopts this free table as its new tab.
    } else {
      // Free table fresh start: another table's order is NEVER dragged along;
      // it stays parked where it was.
      setLines([])
      setCouponIdx(0)
      setGstSlab(0)
      setUseCustomTip(false)
      setTipPct(0)
      setCustomTip(0)
      setCustomerMode(false)
      customerCardRef.current?.clear()
      // Cross-device conflict probe: the table may be locally free but hold a
      // live tab parked from ANOTHER device. Ask before taking over.
      const label = labels.find((l) => tableId(l) === id)
      if (label && shopId) {
        repo.listServerTabs(shopId).then((serverTabs) => {
          const foreign = serverTabs.find(
            (st) =>
              st.tableLabel === label &&
              st.openedByName &&
              st.openedByName !== (user?.name || '') &&
              (st.draftItems?.length ?? 0) > 0
          )
          if (foreign) setTakeoverAsk({ id, conflict: foreign })
        }).catch(() => {})
      }
    }
  }

  async function selectTable(id: string) {
    if (fastSaleMode) {
      setFastSaleMode(false)
    }
    if (id === activeTableId) return
    const hasCart = lines.some((l) => l.qty > 0)
    if (hasCart && !activeTableId && tabsById.get(id)) {
      // An unbound bill is on the register and the target table already holds
      // an open tab: loading it would discard the current bill.
      setSwitchAsk(id)
      return
    }
    await bindTable(id)
  }

  // Fast Sale (F9): mode for urgent parcel/counter purchases when dine-in floor is active.
  // Parks any bound table, frees the register for a direct counter bill, and minimizes floor UI.
  function toggleFastSale() {
    if (!fastSaleMode) {
      flushSave()
      setActiveTableId(null)
      setLines([])
      setCouponIdx(0)
      setGstSlab(0)
      setUseCustomTip(false)
      setTipPct(0)
      setCustomTip(0)
      setCustomerMode(false)
      customerCardRef.current?.clear()
      clearSearchRef.current()
      setFastSaleMode(true)
      toast('Fast Sale (Parcel): Direct counter bill. Press F9 to return to tables.', 'ok')
      searchRef.current?.focus()
    } else {
      flushSave()
      setFastSaleMode(false)
      toast('Returned to Dine-in table floor.')
    }
  }

  const toggleFastSaleRef = useRef(toggleFastSale)

  const overStockLine = d.online && activeLines.some((l) => {
    const prod = productById.get(l.productId)
    if (prod?.isKitchen) return false
    const total = autoGodownOn ? (prod?.counterPcs ?? 0) + (prod?.godownPcs ?? 0) : (prod?.counterPcs ?? 0)
    return l.qty > total
  })

  async function confirmSale(overrideMethod?: PayOption) {
    const activeMethod = isEnforced ? (enforcedPaymentMethod as PayOption) : (overrideMethod ?? method)
    if (!activeLines.length) return toast('Add at least one item', 'err')
    for (const l of d.online ? activeLines : []) {
      const prod = productById.get(l.productId)
      if (prod?.isKitchen) continue
      const counterStock = prod?.counterPcs ?? 0
      const godownStock = prod?.godownPcs ?? 0
      const totalStock = autoGodownOn ? counterStock + godownStock : counterStock
      if (l.qty > totalStock) {
        if (!autoGodownOn && l.qty > counterStock) {
          return toast(
            `${l.name}: insufficient counter stock (${counterStock} available). Auto-transfer from godown (${godownStock} available) is OFF. Transfer stock first.`,
            'err'
          )
        }
        return toast(
          `${l.name}: only ${totalStock} pcs available in total (${counterStock} counter, ${godownStock} godown).`,
          'err'
        )
      }
    }
    if (activeMethod === 'Khata' && !khataOn) {
      return toast('Khata credit billing is disabled for this shop.', 'err')
    }
    if (activeMethod === 'Khata' && !matchedAccount) {
      return toast('Select a matching customer account for Khata billing.', 'err')
    }
    if (!priced.ready) return toast(priced.error || 'Pricing this bill…', 'err')
    setBusy(true)
    // Snapshot the bound table up front, the txn below frees it, and the
    // register becomes unbound only after the bill is posted.
    const settleTable = activeTableId
    const settleLabel = activeLabel
    try {
      const cust = customerMode ? customerNameRef.current.trim().toUpperCase() || 'WALK IN CUSTOMER' : 'WALK IN CUSTOMER'
      const sold = activeLines
      const payments: OfflineSalePayment[] =
        activeMethod === 'UPI'
          ? [{ method: 'UPI', amount: grand.toFixed(2) }]
          : activeMethod === 'Khata'
            ? [{ method: 'Khata', amount: grand.toFixed(2) }]
            : [{ method: 'Cash', amount: grand.toFixed(2) }]
      const { billNo, offline, result: settled } = await repo.createSale(shopId, {
        idempotency_key: crypto.randomUUID(),
        customer_id: matchedAccount?.id ?? null,
        customer_name: cust === 'WALK IN CUSTOMER' ? undefined : cust,
        table_label: settleLabel ?? undefined,
        coupon_code: discount > 0 ? coupon.code : undefined,
        // Fixed-rupee order discount (Settings → Features → Quick discount
        // amount). The server re-validates the capability and caps the value.
        quick_discount: quickDiscount > 0 ? quickDiscount.toFixed(2) : undefined,
        // Send the EFFECTIVE slab. When GST is disabled the register charges
        // no tax, so it must not tell the server to — otherwise the server
        // adds tax the client never collected and the payment total mismatches.
        gst_slab: prefs.enableGst ? gstSlab : 0,
        tip: (tablesCfg.tips && tip > 0) ? tip.toFixed(2) : undefined,
        // Bug A fix: this register always computes GST tax-EXCLUSIVE (see the
        // taxable/gstAmount calc above: GST is added on top of subtotal, not
        // backed out of it), so it must tell the backend that, or GST silently
        // disappears from the bill total and the payment total then mismatches
        // the backend's: every bill with a GST slab selected used to 400.
        is_tax_inclusive: false,
        lines: sold.map(({ productId, qty, rate }) => ({ product_id: productId, qty, rate: rate.toFixed(2) })),
        payments,
        estimated_total: grand,
      })
      if (!offline) window.dispatchEvent(new Event('xpo:sales-total-changed'))
      toast(`Bill ${billNo} confirmed · ${money(grand)} ${activeMethod}.${matchedAccount ? ' Due posted to ledger.' : ''}${settleLabel ? ` Table ${settleLabel} freed.` : ''}`, 'ok')
      const receipt: ReceiptData = {
        billNo: String(billNo),
        nativeOrderId: settled?.order_id,
        provisional: offline,
        date: now(),
        customerName: cust,
        method: activeMethod,
        staffName: user?.name ?? '',
        station: 'Counter 1',
        items: sold.map(({ name, unit, qty, rate }) => ({ name, unit, qty, rate })),
        subtotal,
        discount,
      couponCode: discount > 0 ? coupon.code : undefined,
      gstSlab: prefs.enableGst ? gstSlab : 0,
      gstAmount,
        tip: (tablesCfg.tips && tip > 0) ? tip : undefined,
        tableLabel: activeLabel ?? undefined,
        total: grand,
      }
      if (settled) { receipt.total = settled.total; receipt.gstAmount = settled.tax; }
      setLastBill(receipt)
      cancelArmedPay()
      setLines([])
      if (continuousScanning && shopId) {
        try {
          localStorage.removeItem(DRAFT_KEY)
        } catch {}
        repo.releaseServerTab(shopId, '__continuous_draft__').catch(() => {})
        setCartUnlocked(false)
      }
      setCouponIdx(0)
      setMethod(nextDefaultMethod())
      // Keep the chosen GST slab: a GST-registered shop bills on the same
      // slab all day; resetting to "exempt" per bill made GST look broken.
      setTipPct(0)
      setUseCustomTip(false)
      setCustomTip(0)
      // Quick discount is per-bill, never sticky: the next customer must not
      // inherit the previous bill's discount (manual or auto-suggested).
      setQuickDiscount(0)
      if (settleTable) commitTab(null, settleTable)
      setActiveTableId(null)
      // Reset the customer too: the next walk-in bill must never silently
      // inherit the previous customer's linked account.
      setCustomerMode(false)
      customerCardRef.current?.clear()
      clearSearchRef.current()
      // "Remember last": record the method used so the next bill preselects it.
      const prefsNow = loadPrefs()
      if (prefsNow.defaultPayMethod === 'last') {
        savePrefs({ ...prefsNow, lastPayMethod: activeMethod })
      }
      // Print behavior is device-local (printMode): 'auto' prints without
      // asking, 'ask' prompts once per bill, 'off' stays completely silent,
      // no print window, no prompt; manual toolbar printing still works.
      // Auto-print runs before the refresh await to stay inside the click's
      // transient popup allowance.
      const printMode = prefsNow.printMode ?? 'ask'
      if (printMode === 'auto') {
        // One receipt per bill, ever: the key is the bill itself, so a retry, a re-render or the ask-dialog
        // can never produce a second automatic copy.
        void printAndReport(receipt, { key: `sale:${billNo}`, label: `Bill ${billNo}`, kind: 'sale' })
      } else if (printMode === 'ask') {
        setPrintAskAlways(false)
        setPrintAsk(receipt)
      }
      // Bug fix (2026-08-31): the stock guard validates against
      // d.products.counterPcs, which nothing refreshed after a sale, the
      // NEXT bill was rejected by the server ("Insufficient counter stock")
      // until a manual page reload. Reload the snapshot immediately so
      // consecutive billing just works.
      await d.refresh()
      // Don't yank focus out of the print-ask dialog (its Print button holds
      // it, which also keeps the global F2/F9/Escape handlers at bay). When
      // no dialog is shown (auto or off), return the cursor to the scanner.
      if ((prefsNow.printMode ?? 'ask') !== 'ask') searchRef.current?.focus()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the sale.', 'err')
      d.refresh()
    } finally {
      setBusy(false)
    }
  }

  function triggerFastPay(targetMethod: 'Cash' | 'UPI', source: 'keyboard' | 'touch') {
    const effectiveMethod = isEnforced ? (enforcedPaymentMethod as 'Cash' | 'UPI') : targetMethod
    if (busy) return
    if (retModeRef.current || histModeRef.current) return
    if (uiBlockedRef.current) return

    // Absolute Checkout Safety: No item = no sale.
    if (!activeLines.length || subtotal <= 0) {
      cancelArmedPay()
      beep('err')
      toast('Add at least one item', 'err')
      return
    }

    if (overStockLine) {
      cancelArmedPay()
      beep('err')
      toast('A line exceeds available stock — reduce quantity before settling.', 'err')
      return
    }

    const nowTime = Date.now()

    // Safety rule: If already armed for this EXACT method within 2s, confirm and settle immediately!
    if (armedPayRef.current && armedPayRef.current.method === effectiveMethod && nowTime <= armedPayRef.current.expiresAt) {
      cancelArmedPay()
      void confirmSale(effectiveMethod)
      return
    }

    // Otherwise, arm for target method (cancels previous or switches cleanly)
    if (armedPayTimerRef.current) {
      clearTimeout(armedPayTimerRef.current)
    }

    const nextArmed: ArmedPayment = {
      method: effectiveMethod,
      expiresAt: nowTime + 2500,
      source,
    }
    armedPayRef.current = nextArmed
    setArmedPay(nextArmed)
    setMethod(effectiveMethod)

    armedPayTimerRef.current = window.setTimeout(() => {
      armedPayRef.current = null
      setArmedPay(null)
      armedPayTimerRef.current = null
    }, 2500)
  }

  // ---- F3: keyboard-first helpers ------------------------------------------
  // Document-level map lives in the effect below; the user-facing keymap is
  // rendered by the "?" cheat-sheet. Guards: any open dialog/drawer blocks
  // everything, and focus inside an input/select/textarea is never hijacked.

  /** Any modal/drawer/dialog state that must stand down the global shortcuts. */

  function focusLine(i: number) {
    if (!lines.length) {
      setFocusedLineIdx(null)
      return
    }
    const j = Math.max(0, Math.min(i, lines.length - 1))
    setFocusedLineIdx(j)
    setQtyBuf(null)
    lineRowRefs.current[j]?.focus()
  }

  function bumpQty(i: number, delta: number) {
    setLines((ls) =>
      ls.map((x, j) => {
        if (j !== i) return x
        const prod = productById.get(x.productId)
        if (prod?.isKitchen) {
          return { ...x, qty: Math.max(1, x.qty + delta) }
        }
        const totalStock = autoGodownOn ? (prod?.counterPcs ?? 0) + (prod?.godownPcs ?? 0) : (prod?.counterPcs ?? 0)
        const q = delta > 0 ? Math.min(totalStock, x.qty + 1) : Math.max(1, x.qty - 1)
        return { ...x, qty: q }
      })
    )
  }

  function removeLine(i: number) {
    const nextLen = lines.length - 1
    setLines((ls) => ls.filter((_, j) => j !== i))
    setQtyBuf(null)
    if (nextLen <= 0) setFocusedLineIdx(null)
    else {
      const j = Math.max(0, Math.min(i, nextLen - 1))
      setFocusedLineIdx(j)
      lineRowRefs.current[j]?.focus()
    }
  }

  function onLineKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, i: number) {
    const t = e.target as HTMLElement
    const tag = t.tagName.toLowerCase()
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || t.isContentEditable) return

    const now = performance.now()
    const gap = now - lastLineKeyAt.current
    lastLineKeyAt.current = now

    // Inter-keystroke speed guard: humans cannot type digits faster than 65ms per stroke.
    // If keys arrive at machine scanner bursts (< 65ms), immediately stand down qtyBuf
    // and ignore the keys so barcode digits never corrupt the line quantity.
    if (gap < 65) {
      if (qtyBuf) setQtyBuf(null)
      e.preventDefault()
      e.stopPropagation()
      return
    }

    if (continuousScanning && !cartUnlocked) {
      if (e.key === 'Tab' || e.key === 'Escape') {
        // allow Tab navigation and Escape
      } else {
        return
      }
    }

    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      bumpQty(i, 1)
      return
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      bumpQty(i, -1)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeLine(i)
      return
    }
    if (e.key === 'Tab') {
      const next = i + (e.shiftKey ? -1 : 1)
      if (next < 0 || next >= lines.length) return // native Tab exits the table
      e.preventDefault()
      focusLine(next)
      return
    }
    if (e.key === 'Escape') {
      if (qtyBuf) {
        e.preventDefault()
        setQtyBuf(null)
      }
      return
    }
    if (e.key === 'Enter') {
      if (qtyBuf && qtyBuf.line === i && qtyBuf.text) {
        e.preventDefault()
        // Never allow barcode-length bursts or corrupted buffers to apply as quantity
        if (qtyBuf.text.length > 3) {
          setQtyBuf(null)
          return
        }
        const prod = productById.get(lines[i]?.productId ?? '')
        const totalStock = prod?.isKitchen ? Infinity : (autoGodownOn ? (prod?.counterPcs ?? 0) + (prod?.godownPcs ?? 0) : (prod?.counterPcs ?? 0))
        const parsed = parseInt(qtyBuf.text, 10) || 0
        const n = Math.max(0, Math.min(totalStock, parsed))
        setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: n } : x)))
        setQtyBuf(null)
      }
      return
    }
    if (/^\d$/.test(e.key)) {
      // Typed-digits qty entry: digits append to a small buffer (max 3 digits: 1-999), Enter commits.
      e.preventDefault()
      setQtyBuf((b) => (b && b.line === i ? { line: i, text: (b.text + e.key).slice(0, 3) } : { line: i, text: e.key }))
    }
  }

  // Roving-tabindex bookkeeping: clamp the focused row when lines shrink and
  // drop the qty buffer whenever the cart empties.
  useEffect(() => {
    setFocusedLineIdx((i) => (i == null ? null : lines.length === 0 ? null : Math.min(i, lines.length - 1)))
    if (lines.length === 0) setQtyBuf(null)
  }, [lines])

  function tryConfirm() {
    if (retModeRef.current || histModeRef.current || busy || !lines.length || overStockLine) return
    void confirmSale()
  }

  // Cheat-sheet: Esc dismisses. Capture + stopPropagation keeps the global
  // Esc handler from also firing while the sheet is open.
  useEffect(() => {
    if (!shortcutsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setShortcutsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shortcutsOpen])

  // ---- F6: Return / Exchange mode (owner & manager only) -------------------
  // Counter staff (cashiers included) take returns at the desk, the sales
  // tab grant, not the role, gates the return mode now (server enforces the
  // same rule on POST /api/sales/returns/).
  const canReturn = true
  const [retMode, setRetMode] = useState(false)
  const retModeRef = useRef(false)

  // ---- Bill history mode (all roles), register relocated from Reports -----
  const [histMode, setHistMode] = useState(false)
  const histModeRef = useRef(false)
  useEffect(() => {
    if (!todaySalesOn || !shopId || retMode || histMode) return
    let stopped = false
    let inFlight = false
    const refreshTodaySales = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const summary = await repo.liveSalesTotal(shopId, todayBusinessDate)
        if (!stopped) {
          const next = { gross: summary.gross_sales, net: summary.net_sales }
          setTodaySales((current) => current?.gross === next.gross && current?.net === next.net ? current : next)
        }
      } catch {
        if (!stopped) setTodaySales(null)
      } finally {
        inFlight = false
      }
    }
    void refreshTodaySales()
    const timer = window.setInterval(() => void refreshTodaySales(), 15000)
    const onFocus = () => void refreshTodaySales()
    const onOnline = () => void refreshTodaySales()
    const onSalesTotalChanged = () => void refreshTodaySales()
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('xpo:sales-total-changed', onSalesTotalChanged)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('xpo:sales-total-changed', onSalesTotalChanged)
    }
  }, [todaySalesOn, shopId, todayBusinessDate, retMode, histMode])
  // Return/Exchange flow sub-tab: the form or the posted-returns history.
  const [retTab, setRetTab] = useState<'new' | 'history'>('new')
  const [retLoading, setRetLoading] = useState(false)
  const returnSeqRef = useRef(0)
  const [retSale, setRetSale] = useState<PSale | null>(null)
  const [retLines, setRetLines] = useState<Record<string, number>>({})
  const [retReturned, setRetReturned] = useState<Record<string, number>>({})
  const [restockLoc, setRestockLoc] = useState<'counter' | 'godown'>('counter')
  const [refundMethod, setRefundMethod] = useState<PayOption>('Cash')
  const [refundRef, setRefundRef] = useState('')
  const [exchange, setExchange] = useState(false)
  const [replLines, setReplLines] = useState<{ productId: string; name: string; unit: string; qty: number; rate: number }[]>([])
  const [settleMethod, setSettleMethod] = useState<PayOption>('Cash')
  const [retBusy, setRetBusy] = useState(false)
  const [retDone, setRetDone] = useState<{ billNo: string; kind: string; amount: number } | null>(null)
  const [retBills, setRetBills] = useState<PSale[]>([])
  const retBillRef = useRef<HTMLInputElement>(null)
  const replClearRef = useRef<() => void>(() => {})

  const returnValue = useMemo(() => {
    if (!retSale) return 0
    return fromPaise(
      (retSale.items ?? []).reduce((a, it) => a + lineRefundPaise(it, retLines[it.id] ?? 0), 0),
    )
  }, [retSale, retLines])
  const replTotal = useMemo(
    () => fromPaise(replLines.reduce((a, l) => a + toPaise(l.qty * l.rate), 0)),
    [replLines],
  )
  const chosenCount = useMemo(
    () => (retSale ? (retSale.items ?? []).filter((it) => (retLines[it.id] ?? 0) > 0).length : 0),
    [retSale, retLines]
  )
  const netExchange = fromPaise(toPaise(replTotal) - toPaise(returnValue))

  function enterHistoryMode() {
    flushSave()
    setRetMode(false)
    setHistMode(true)
  }

  /** From the history register: switch to return mode with the bill preloaded. */
  function returnBillFromHistory(sale: PSale) {
    setHistMode(false)
    enterReturnMode()
    void loadReturnSale(sale.id)
  }

  function enterReturnMode() {
    toast('Returns and exchanges are not available yet.', 'info'); return;
    flushSave()
    setRetMode(true)
    setRetDone(null)
    setRetBills([])
    if (!shopId) return
    repo
      .listSales(shopId)
      .then((rows) =>
        setRetBills(rows.filter((s) => !s.isVoid).sort((a, b) => (a.date < b.date ? 1 : -1)))
      )
      .catch(() => setRetBills([]))
  }

  function resetReturnFlow() {
    setRetSale(null)
    setRetLines({})
    setRetReturned({})
    setReplLines([])
    setExchange(false)
    setRefundRef('')
    setRestockLoc('counter')
    setRefundMethod('Cash')
    setSettleMethod('Cash')
  }

  async function loadReturnSale(saleId: string) {
    if (!shopId) return
    const seq = ++returnSeqRef.current
    setRetLoading(true)
    try {
      const [sale, rets] = await Promise.all([
        repo.getSale(shopId, saleId),
        repo.listSaleReturns(shopId, { saleId }).catch(() => [] as PSaleReturn[]),
      ])
      if (seq !== returnSeqRef.current) return
      if (sale.isVoid) {
        toast(`Bill ${sale.billNo} is voided — returns are blocked.`, 'err')
        return
      }
      const byProduct: Record<string, number> = {}
      for (const r of rets) {
        for (const it of r.items) byProduct[it.productId] = (byProduct[it.productId] ?? 0) + it.qty
      }
      setRetSale(sale)
      setRetReturned(byProduct)
      setRetLines({})
      setReplLines([])
      setExchange(false)
      setRefundRef('')
      setRetDone(null)
    } catch (e) {
      if (seq !== returnSeqRef.current) return
      toast(e instanceof Error ? e.message : 'Could not load that bill.', 'err')
    } finally {
      if (seq === returnSeqRef.current) {
        setRetLoading(false)
      }
    }
  }

  function addReplacement(p: PProduct) {
    if (!kitchenOn && p.isKitchen) {
      toast('Kitchen dishes are disabled in settings.', 'err')
      return
    }
    setReplLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id)
      if (i >= 0) {
        const next = [...ls]
        next[i] = { ...next[i], qty: next[i].qty + 1 }
        return next
      }
      return [...ls, { productId: p.id, name: p.name, unit: p.unit, qty: 1, rate: saleRate(p) }]
    })
  }

  async function confirmReturn() {
    if (!retSale || !shopId) return
    const items = retSale.items ?? []
    const chosen = items.filter((it) => (retLines[it.id] ?? 0) > 0)
    if (!chosen.length) {
      toast('Enter a return quantity on at least one line.', 'err')
      return
    }
    if (exchange && replTotal <= 0) {
      toast('Add replacement items or switch Exchange off.', 'err')
      return
    }
    if (refundMethod === 'Khata' && !retSale.customerId) {
      toast('Khata refunds need a customer on the original bill.', 'err')
      return
    }
    setRetBusy(true)
    try {
      const Y = replTotal
      const r = await repo.createSaleReturn(shopId, {
        saleId: retSale.id,
        lines: chosen.map((it) => ({ sale_item_id: it.id, product_id: it.productId, qty: retLines[it.id] })),
        restock_location: restockLoc,
        refund_method: refundMethod,
        refund_ref: refundMethod === 'UPI' && refundRef.trim() ? refundRef.trim() : undefined,
        notes: exchange ? 'Exchange' : '',
        replacement: exchange
          ? {
              lines: replLines
                .filter((l) => l.qty > 0)
                .map((l) => ({ product_id: l.productId, qty: l.qty, rate: l.rate })),
              payments: [{ method: settleMethod, amount: Y }],
              customer_id: retSale.customerId,
              customer_name: retSale.customerName,
            }
          : undefined,
        idempotency_key: crypto.randomUUID(),
      })
      window.dispatchEvent(new Event('xpo:sales-total-changed'))
      // Exchange notes carry the replacement bill reference on paper.
      let replBillNo: string | undefined
      if (r.replacementSaleId) {
        replBillNo = await repo.getSale(shopId, r.replacementSaleId).then((s) => s.billNo).catch(() => undefined)
      }
      toast(`${r.billNo} created · ${exchange ? `exchange vs ${retSale.billNo}` : `refund ${money(r.amount)}`}.`)
      const note: ReceiptData = {
        billNo: r.billNo,
        date: now(),
        customerName: retSale.customerName || 'WALK IN CUSTOMER',
        method: exchange ? `Exchange · new bill ${replBillNo ?? '—'}` : `Refund · ${r.refundMethod}`,
        staffName: user?.name ?? '',
        station: 'Counter 1',
        items: r.items.map((i) => ({ name: i.productName, unit: i.unit, qty: i.qty, rate: i.rate })),
        subtotal: r.amount,
        discount: 0,
        gstSlab: 0,
        gstAmount: 0,
        total: r.amount,
        creditNote: {
          kind: exchange ? 'exchange' : 'return',
          originalBillNo: retSale.billNo,
          replacementBillNo: exchange ? replBillNo : undefined,
          replacementTotal: exchange ? Y : undefined,
        },
      }
      const wasExchange = exchange
      const amount = r.amount
      resetReturnFlow()
      setRetDone({ billNo: r.billNo, kind: wasExchange ? 'Exchange' : 'Return', amount })
      // printMode 'off' on this device suppresses the automatic credit-note
      // print window too: notes stay printable from Return History.
      if ((loadPrefs().printMode ?? 'ask') !== 'off') {
        void printAndReport(note, { key: `note:${r.billNo}`, label: `Credit note ${r.billNo}`, kind: 'note' })
      }
      // Restocked pieces must be visible to the very next bill.
      void d.refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the return.', 'err')
    } finally {
      setRetBusy(false)
    }
  }

  function openAddCustomer() {
    setNewCustType('Customer')
    setSelectedRetailShopId('')
    setNewName('')
    setNewPhone('')
    setAddOpen(true)
  }

  async function createCustomer() {
    const name = newName.trim()
    if (!name) return toast(newCustType === 'Retailer' ? 'Select or enter the retailer shop name.' : 'Enter the customer name.', 'err')
    if (!isValidNational(newPhone)) return toast('Enter a valid phone number (4–15 digits).', 'err')
    setAddingCust(true)
    try {
      const matched = connectedRetailerShops.find((s) => s.id === selectedRetailShopId)
      const code = newCustType === 'Retailer' && matched ? `RET-${matched.code}` : undefined
      const acc = await repo.createAccount(shopId, { name, type: newCustType, phone: nationalDigits(newPhone), country_code: newCustCountry || DEFAULT_DIAL, code })
      toast(`${newCustType} ${name} added (${acc.code}).`)
      customerCardRef.current?.setName(name)
      setAddOpen(false)
      // Reload accounts so the new customer/retailer is selectable, the Khata option
      // unlocks immediately instead of after the next unrelated refresh.
      await d.refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the account.', 'err')
    } finally {
      setAddingCust(false)
    }
  }

  /** Receipt shape for the CURRENT open cart, printed as a provisional
   *  (unpaid) bill. Zero-qty lines are excluded: they are not part of any
   *  posted sale and must not appear on paper either. */
  function cartReceipt(): ReceiptData {
    return {
      billNo: 'PROVISIONAL',
      date: now(),
      customerName: customerMode ? customerNameRef.current.trim().toUpperCase() || 'WALK IN CUSTOMER' : 'WALK IN CUSTOMER',
      method,
      staffName: user?.name ?? '',
      station: 'Counter 1',
      items: lines
        .filter((l) => l.qty > 0)
        .map(({ name, unit, qty, rate }) => ({ name, unit, qty, rate })),
      subtotal,
      discount,
      couponCode: discount > 0 ? coupon.code : undefined,
      gstSlab,
      gstAmount,
      tip: (tablesCfg.tips && tip > 0) ? tip : undefined,
      tableLabel: activeLabel ?? undefined,
      total: grand,
      provisional: true,
    }
  }

  function printBill() {
    // Reprint the last confirmed bill; with none, an open cart prints as a
    // provisional receipt instead of erroring out.
    const src: ReceiptData | null = lastBill ?? (lines.some((l) => l.qty > 0) ? cartReceipt() : null)
    if (!src) return toast('Confirm a bill first — nothing to print.', 'err')
    void printAndReport(src, { key: `reprint:${src.billNo}`, label: `Reprint ${src.billNo}`, kind: 'reprint', repeatable: true })
  }

  /** Every receipt in the register goes through the one print service; this only adds the cashier-facing wording. */
  async function printAndReport(r: ReceiptData, o: Parameters<typeof printReceipt>[1]): Promise<PrintOutcome> {
    const outcome = await printReceipt(r, o)
    const m = outcomeMessage(outcome)
    if (m) toast(m.text, m.kind)
    return outcome
  }

  function printOpenBill() {
    if (!lines.some((l) => l.qty > 0)) return
    void printAndReport(cartReceipt(), { key: 'open-bill', label: 'Open bill', kind: 'reprint', repeatable: true })
  }

  function settlePrintAsk(print: boolean) {
    const data = printAsk
    setPrintAsk(null)
    if (!data) return
    if (printAskAlways) savePrefs({ ...loadPrefs(), printMode: 'auto', autoPrintBill: true })
    if (print) void printAndReport(data, { key: `sale:${data.billNo}`, label: `Bill ${data.billNo}`, kind: 'sale' })
    searchRef.current?.focus()
  }

  /** One-tap opt-out from the per-bill prompt: switches this device to
   *  printMode 'off' without printing. Reversible in Settings → Sales. */
  function turnOffPrintAsk() {
    savePrefs({ ...loadPrefs(), printMode: 'off', autoPrintBill: false })
    setPrintAskAlways(false)
    setPrintAsk(null)
    toast('Bill printing turned off on this device — reprint anytime from the toolbar.', 'info')
    searchRef.current?.focus()
  }
  const settlePrintAskRef = useRef(settlePrintAsk)

  // Print-ask dialog keys: Enter/P = print, Esc = skip. Capture phase +
  // stopPropagation keeps them away from the global F2/F9/Escape handlers.
  useEffect(() => {
    if (!printAsk) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        e.stopPropagation()
        settlePrintAskRef.current(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        settlePrintAskRef.current(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [printAsk !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  // Floor plan placement: 'left'/'right' dock the seating panel as a rail
  // beside the register (≥1056px only: below that CSS falls back to 'top');
  // 'hidden' keeps only the slim head strip, with a session-only expand
  // chevron that never rewrites the saved pref.
  const seatMin =
    seatSize === 'compact' ? 80 : seatSize === 'large' ? 145 : seatSize === 'custom' ? seatCustomTile : 110
  const seatHeight =
    seatSize === 'compact' ? 54 : seatSize === 'large' ? 84 : seatSize === 'custom' ? seatCustomHeight : 68

  // Idle-badge freshness: re-renders the floor plan every 30s so a table
  // sitting open doesn't keep a stale "idle" state while cashiers work.
  const [clockTick, setClockTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setClockTick((n) => n + 1), 30000)
    return () => window.clearInterval(t)
  }, [])

  const { tableRows } = useMemo(() => {
    const tableRows = labels.map((label) => {
      const id = tableId(label)
      const t = tabsById.get(id)
      const occ = !!t && t.items.length > 0
      const act = activeTableId === id
      const idle = occ && now() - t.updatedAt > 90 * 60000
      const amt = act ? subtotal : occ ? round2(t.items.reduce((a, x) => a + x.qty * x.rate, 0)) : 0
      return { id, label, t, occ, act, idle, amt }
    })
    return { tableRows }
  }, [labels, tabsById, activeTableId, subtotal, clockTick])

  const renderFloorTiles = (rows: typeof tableRows) => {
    if (seatArrangement === 'list') {
      return (
        <div className="seat-list">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`seat-row ${r.occ ? 'occ' : ''} ${r.idle ? 'idle' : ''} ${r.act ? 'act' : ''}`}
              style={{ minHeight: Math.max(40, seatHeight * 0.7) }}
              onClick={() => selectTable(r.id)}
              title={
                r.occ
                  ? `${r.t!.items.length} lines · ${money(r.amt)} · opened by ${r.t!.openedBy}${r.idle ? ' · sitting a while' : ''}`
                  : `${r.label} — available`
              }
            >
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="fc-label">{r.label}</span>
                {r.act && <Tag kind="blue">Active</Tag>}
                {r.idle && <Tag kind="orange">Sitting</Tag>}
              </div>
              {r.occ || r.act ? (
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="fc-meta num">{r.t?.items.length ?? lines.length} items</span>
                  <span className="fc-amt num">{money(r.amt)}</span>
                </div>
              ) : (
                <span className="seat-row-free">Available</span>
              )}
            </button>
          ))}
        </div>
      )
    }

    return (
      <div
        className="floor-grid"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${seatMin}px, 1fr))`,
        }}
      >
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`floor-cell ${r.occ ? 'occ' : ''} ${r.idle ? 'idle' : ''} ${r.act ? 'act' : ''}`}
            style={{ minHeight: seatHeight }}
            onClick={() => selectTable(r.id)}
            title={
              r.occ
                ? `${r.t!.items.length} lines · ${money(r.amt)} · opened by ${r.t!.openedBy}${r.idle ? ' · sitting a while' : ''}`
                : `${r.label} — available`
            }
          >
            <div className="fc-top">
              <span className="fc-label">{r.label}</span>
              <span className="fc-status-pill">
                {r.act ? 'Billing' : r.idle ? 'Idle' : r.occ ? 'In service' : 'Free'}
              </span>
            </div>
            {(r.occ || r.act) && (
              <div className="fc-bottom">
                <span className="fc-amt num">{money(r.amt)}</span>
                <span className="fc-meta num">{r.t?.items.length ?? lines.length} items</span>
              </div>
            )}
          </button>
        ))}
      </div>
    )
  }

  const floorSection = tablesCfg.enabled && labels.length > 0 && !fastSaleMode ? (
    <div className={`floor-panel ${seatPos === 'bottom' ? 'floor-bottom' : ''}`}>
      {renderFloorTiles(tableRows)}
    </div>
  ) : null

  const posGrid = (
    <div className="pos-grid">
      <Panel>
        <div className="panel-body pos-left">
          <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
            <ProductCombobox
              products={salesProducts}
              shopId={shopId}
              inputRef={searchRef}
              clearRef={clearSearchRef}
              onPick={addProduct}
              onScan={tryAddScanned}
              onMiss={() => {
                beep('err')
                toast('No product matches that scan.', 'err')
              }}
              rateOf={saleRate}
              placeholder="Scan barcode or type product name to add to bill…"
              ariaLabel="Scan barcode or search products"
              enableKitchen={kitchenOn}
            />
            <Btn
              variant="ghost"
              className="btn-icon"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              style={{ fontSize: 15 }}
              onClick={() => setShortcutsOpen(true)}
            >
              ?
            </Btn>
          </div>

          {blocked && (() => {
            const availStock = autoGodownOn ? blocked.counter + blocked.godown : blocked.counter
            const fullyOut = availStock <= 0
            const totalStock = availStock
            return (
              <div className="stockwarn" role="alert">
                <div className="stockwarn-head">
                  <span className="stockwarn-title">
                    {fullyOut ? 'Out of stock' : 'Stock limit reached'}
                  </span>
                  <button className="icon-btn" aria-label="Dismiss warning" onClick={() => setBlocked(null)}>×</button>
                </div>
                <p className="stockwarn-msg">
                  {fullyOut ? (
                    blocked.counter <= 0 && blocked.godown > 0 && !autoGodownOn ? (
                      <>
                        <strong>{blocked.name}</strong> has 0 pcs at counter ({blocked.godown} in godown). Auto-import godown stock is OFF.
                      </>
                    ) : (
                      <>
                        <strong>{blocked.name}</strong> is out of stock — 0 pcs at counter and 0 pcs in godown.
                      </>
                    )
                  ) : (
                    <>
                      <strong>{blocked.name}</strong> — all available <strong>{totalStock} pcs</strong>{' '}
                      {autoGodownOn ? `(${blocked.counter} at counter, ${blocked.godown} in godown)` : `at counter`} have already been added to the bill.
                    </>
                  )}
                </p>
                {fullyOut ? (
                  <button className="link-btn" onClick={() => setBlocked(null)}>Dismiss</button>
                ) : (
                  <div className="row" style={{ gap: 8 }}>
                    <Btn sm variant="primary" onClick={() => nav('/stock')}>View stock</Btn>
                    <Btn sm variant="ghost" onClick={() => setBlocked(null)}>Dismiss</Btn>
                  </div>
                )}
              </div>
            )
          })()}

          {continuousScanning && lines.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 12px',
                marginBottom: 8,
                border: '1px solid var(--line)',
                background: cartUnlocked ? 'var(--layer-accent, rgba(15,98,254,0.06))' : 'var(--layer)',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {cartUnlocked ? (
                  <IconUnlock size={14} style={{ color: 'var(--brand)' }} />
                ) : (
                  <IconLock size={14} style={{ color: 'var(--muted)' }} />
                )}
                <span style={{ fontWeight: 600, color: cartUnlocked ? 'var(--brand)' : 'var(--ink)' }}>
                  {cartUnlocked
                    ? 'Edit Mode Active — quantities & items can be modified'
                    : 'Continuous Scanning — list locked against accidental edits'}
                </span>
              </div>
              <Btn
                sm
                variant={cartUnlocked ? 'primary' : 'ghost'}
                onClick={() => setCartUnlocked((prev) => !prev)}
                style={{ height: 26, fontSize: 11, padding: '0 10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {cartUnlocked ? 'Lock List' : 'Unlock to Edit'}
              </Btn>
            </div>
          )}

          {lines.length === 0 ? (
            <EmptyState icon={<IconX size={16} />} title="Bill is empty" hint="Scan a barcode or press Enter on a search result to start the bill." />
          ) : (
            <>
              {qtyBuf && lines[qtyBuf.line] && (
                <div className="alert" role="status" style={{ padding: '8px 12px' }}>
                  Qty for <strong>{lines[qtyBuf.line].name}</strong>: <span className="num" style={{ fontWeight: 600 }}>{qtyBuf.text}</span> — press{' '}
                  <span className="kbd">Enter</span> to apply · <span className="kbd">Esc</span> cancels
                </div>
              )}
              <div className="tbl-scroll">
                <table className="tbl bill-tbl">
                  <thead>
                    <tr>
                      <th className="td-center" style={{ width: 44 }}>Sr.</th>
                      <th>Item description</th>
                      <th className="td-right" style={{ width: 112 }}>Rate (₹)</th>
                      <th className="td-center" style={{ width: 150 }}>Qty</th>
                      <th className="td-right" style={{ width: 104 }}>Total (₹)</th>
                      <th style={{ width: 44 }}></th>
                    </tr>
                  </thead>
<tbody>
                    {lines.map((l, i) => (
                      <BillRow
                        key={l.productId}
                        line={l}
                        online={d.online}
                        lineAmount={priced.ready ? priced.offline ? l.qty * l.rate : priced.quote?.lines[i]?.total ?? NaN : NaN}
                        index={i}
                        product={productById.get(l.productId)}
                        customRateOn={customRateOn}
                        autoGodownOn={autoGodownOn}
                        active={focusedLineIdx === i}
                        tabbable={focusedLineIdx === i || (focusedLineIdx == null && i === 0)}
                        locked={continuousScanning && !cartUnlocked}
                        setLines={setLines}
                        setFocusedLineIdx={setFocusedLineIdx}
                        rowRefs={lineRowRefs}
                        keyDownRef={onLineKeyDownRef}
                        scanRef={handleScan}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!continuousScanning && <QuickAdd items={popularChips} onAddRef={addProductRef} />}
        </div>
      </Panel>

      <div className="pos-checkout-column">
      <section className="panel co-panel" aria-label="Checkout" ref={coPanelRef}>
        <header className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3 className="panel-title" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Checkout</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {(lastBill || lines.length > 0) && (
              <div className="row" style={{ gap: 6 }}>
                <Btn variant="ghost" sm disabled={!lines.some((l) => l.qty > 0)} onClick={printOpenBill}>
                  Print open bill
                </Btn>
                <Btn variant="ghost" sm onClick={printBill}>
                  Reprint last bill
                </Btn>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {discountOn && (
                <Btn
                  variant="ghost"
                  className="btn-icon"
                  aria-label="Manage discount schemes"
                  aria-pressed={discountManagerOpen}
                  title="Manage discount schemes"
                  data-tooltip="Manage discount schemes"
                  style={
                    discountManagerOpen
                      ? { background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)', width: 28, height: 28, minWidth: 28, padding: 0 }
                      : { background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', width: 28, height: 28, minWidth: 28, padding: 0 }
                  }
                  onClick={() => setDiscountManagerOpen(true)}
                >
                  <IconGear size={14} />
                </Btn>
              )}
              {canReturn && (
                <Btn
                  variant="ghost"
                  className="btn-icon"
                  aria-label="Return or Exchange a bill"
                  aria-pressed={retMode}
                  disabled title="Returns and exchanges are not available yet"
                  data-tooltip="Return or Exchange a bill"
                  style={
                    retMode
                      ? { background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)', width: 28, height: 28, minWidth: 28, padding: 0 }
                      : { background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', width: 28, height: 28, minWidth: 28, padding: 0 }
                  }
                  onClick={() => {
                    if (retMode) {
                      setRetMode(false)
                      return
                    }
                    setHistMode(false)
                    enterReturnMode()
                  }}
                >
                  <IconBoxReturn size={14} />
                </Btn>
              )}
              <Btn
                variant="ghost"
                className="btn-icon"
                aria-label="Bill history"
                aria-pressed={histMode}
                title="Bill history"
                data-tooltip="Bill history"
                style={
                  histMode
                    ? { background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)', width: 28, height: 28, minWidth: 28, padding: 0 }
                    : { background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', width: 28, height: 28, minWidth: 28, padding: 0 }
                }
                onClick={() => (histMode ? setHistMode(false) : enterHistoryMode())}
              >
                <IconHistory size={14} />
              </Btn>
            </div>
          </div>
        </header>

        <div className="co-body">
          {activeLabel && (
            <div className="co-table" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Tag kind="blue">
                <IconTable size={12} style={{ marginRight: 5, verticalAlign: '-1px' }} />
                Table {activeLabel} · {money(grand)}
              </Tag>
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 11.5, color: 'var(--muted)' }}
                onClick={() => {
                  flushSave()
                  setActiveTableId(null)
                }}
                title="Unbind table and switch to direct counter bill"
              >
                Detach
              </button>
            </div>
          )}

          {khataOn && (
            <CustomerCard
              ref={customerCardRef}
              active={customerMode}
              onToggle={handleCustomerToggle}
              accounts={eligibleAccounts}
              isOwner={isOwner}
              onNameChange={handleCustomerName}
              onMatch={handleCustomerMatch}
              onCreateNew={openAddCustomer}
            />
          )}

          {(discountOn || prefs.enableGst) && (
            <div>
              <div className="micro-label">
                {discountOn && prefs.enableGst
                  ? 'Discount scheme & Tax slab'
                  : discountOn
                    ? 'Discount scheme'
                    : 'GST tax slab'}
              </div>
              <div className={discountOn && prefs.enableGst ? 'form-grid' : ''} style={{ marginTop: 8 }}>
                {discountOn && (
                  <select className="field-control" value={couponIdx} onChange={(e) => setCouponIdx(Number(e.target.value))} aria-label="Discount scheme">
                    {schemes.map((c, i) => (
                      <option key={c.id || c.label} value={i}>{!c.code ? c.label : c.label.replace(' · ', ' ')}</option>
                    ))}
                  </select>
                )}
                {prefs.enableGst && (
                  <select className="field-control" disabled title="Tax comes from the product configured in Odoo" value={gstSlab} onChange={(e) => setGstSlab(Number(e.target.value))} aria-label="GST slab">
                    {GST_SLABS.map((s) => (
                      <option key={s} value={s}>{s === 0 ? 'GST exempt' : `GST ${s}%`}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {tablesCfg.tips && (
            <div>
              <div className="micro-label">Service tip</div>
              <div className="pay-seg" role="group" aria-label="Service tip" style={{ marginTop: 8 }}>
                {[0, 5, 10].map((p) => (
                  <button
                    key={p}
                    disabled={p > 0}
                    title={p > 0 ? "Not available yet" : undefined}
                    type="button"
                    className={`pay-seg-btn ${!useCustomTip && tipPct === p ? 'on' : ''}`}
                    aria-pressed={!useCustomTip && tipPct === p}
                    onClick={() => {
                      setUseCustomTip(false)
                      setCustomTip(0)
                      setTipPct(p)
                    }}
                  >
                    {p === 0 ? 'No tip' : `${p}%`}
                  </button>
                ))}
                <button
                  type="button"
                  className={`pay-seg-btn ${useCustomTip ? 'on' : ''}`}
                  disabled title="Not available yet" aria-pressed={useCustomTip}
                  onClick={() => setUseCustomTip(true)}
                >
                  Custom
                </button>
              </div>
              {useCustomTip && (
                <Field label="Tip amount (₹)" help="Added after tax on the bill.">
                  <NumInput value={customTip} onChange={setCustomTip} placeholder="0" />
                </Field>
              )}
            </div>
          )}

          <PayPanel
            hasLines={activeLines.length > 0 && priced.ready}
            overStockLine={overStockLine}
            busy={busy}
            totalPcs={totalPcs}
            subtotal={subtotal}
            couponCode={coupon.code}
            discount={discount}
            quickDiscountOn={discountOn}
            quickDiscountMode={discountMode}
            suggestedQuickPaise={suggestedQuickPaise}
            quickPaise={quickPaise}
            quickDiscount={quickDiscount}
            setQuickDiscount={setQuickDiscount}
            gstSlab={gstSlab}
            gstAmount={gstAmount}
            tip={tip}
            useCustomTip={useCustomTip}
            tipPct={tipPct}
            grand={grand}
            method={method}
            setMethod={setMethod}
            customerMode={customerMode}
            hasMatchedAccount={Boolean(matchedAccount)}
            khataOn={khataOn}
            enforcedPaymentMethod={enforcedPaymentMethod}
            armedMethod={armedPay?.method ?? null}
            isTouch={isTouch}
            payMethodRef={payMethodRef}
            fastPayRef={triggerFastPayRef}
            confirmRef={confirmSaleRef}
          />

          {overStockLine && (
            <div className="alert">
              A line exceeds available {autoGodownOn ? 'stock across counter and godown' : 'counter stock'} — reduce the quantity before settling.
            </div>
          )}

          <div className="row" style={{ alignItems: 'stretch', marginTop: 4 }}>
            <Btn variant="tertiary" block disabled={!lines.length || busy} onClick={() => setClearOpen(true)}>
              Clear bill
            </Btn>
          </div>

          <div className="t-caption">
            {isEnforced ? `F8/F9 = ${enforcedPaymentMethod}` : 'F8 = Cash · F9 = UPI'} · F2 = Focus scanner · Esc = Cancel / Clear
          </div>
        </div>
      </section>
      {todaySalesOn && (
        <div className="pos-today-sales" aria-live="polite" aria-atomic="true">
          <span>Today's {todaySalesMode} sales</span>
          <strong className="num">
            {todaySales === null ? 'Updating…' : money(todaySales[todaySalesMode])}
          </strong>
        </div>
      )}
      </div>
    </div>
  )

  // F6 return/exchange: focused single-column Carbon flow (720px).
  const retMono: CSSProperties = { fontFamily: "ui-monospace, 'Cascadia Mono', Menlo, monospace" }
  const retRow: CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }
  const retNameCell: CSSProperties = { flex: '1 1 150px', minWidth: 0 }
  const retColSold: CSSProperties = { width: 44, textAlign: 'right' }
  const retColRet: CSSProperties = { width: 64, textAlign: 'right' }
  const retColValue: CSSProperties = { width: 84, textAlign: 'right' }
  const retColRate: CSSProperties = { width: 72, textAlign: 'right' }
  const retColQty: CSSProperties = { width: 132 }

  const retSectionHead = (label: string) => (
    <div className="micro-label" style={{ marginBottom: 8 }}>{label}</div>
  )

  const returnPanel = (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '8px 24px 0' }}>
      <div className="stack" style={{ gap: 4, marginBottom: 24 }}>
        <div>
          <Btn sm variant="ghost" style={{ paddingLeft: 0 }} onClick={() => setRetMode(false)}>
            ← Back to billing
          </Btn>
        </div>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 300, color: 'var(--ink)' }}>
          Return or Exchange
        </h2>
        <span className="t-caption">Credit an earlier bill, or swap items — stock and ledger adjust automatically.</span>
        <div className="seg" role="tablist" aria-label="Return flow sections" style={{ marginTop: 12, width: 'fit-content' }}>
          <button
            type="button"
            role="tab"
            aria-selected={retTab === 'new'}
            className={`seg-btn ${retTab === 'new' ? 'active' : ''}`}
            style={{ height: 38, minWidth: 120 }}
            onClick={() => setRetTab('new')}
          >
            New return
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={retTab === 'history'}
            className={`seg-btn ${retTab === 'history' ? 'active' : ''}`}
            style={{ height: 38, minWidth: 120 }}
            onClick={() => setRetTab('history')}
          >
            History
          </button>
        </div>
      </div>

      {retTab === 'history' ? (
        <div style={{ marginTop: 16 }}>
              <SaleReturnHistory
                onReturnAgain={(saleId) => {
                  setRetTab('new')
                  void loadReturnSale(saleId)
                }}
              />
            </div>
          ) : (
            <>
          {retDone && (
            <div
              role="status"
              style={{ background: 'var(--layer)', border: '1px solid var(--line)', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
            >
              <span style={{ fontSize: 13 }}>
                <strong>{retDone.kind} {retDone.billNo}</strong> recorded
                {retDone.amount > 0 ? <> · <span className="num">{money(retDone.amount)}</span></> : null}.
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setRetDone(null)
                  retBillRef.current?.focus()
                }}
              >
                Return another bill
              </button>
            </div>
          )}

          <section style={{ marginTop: 16 }}>
            {retSectionHead('Original bill')}
            {retSale ? (
              <div style={{ background: 'var(--layer)', border: '1px solid var(--line)', padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...retMono, fontWeight: 600, fontSize: 13 }}>{retSale.billNo}</span>
                <span className="t-caption num">{dt(new Date(retSale.date).getTime())}</span>
                <span className="t-caption">{retSale.customerName || 'Walk-in'}</span>
                <span className="num" style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13.5 }}>{money(retSale.total)}</span>
                <button type="button" className="link-btn" onClick={resetReturnFlow}>Change</button>
              </div>
            ) : (
              !retDone && (
                <>
                  <div className="t-caption" style={{ marginBottom: 8 }}>
                    Pick the customer&apos;s bill from the list — newest first. Typing a bill number or name narrows it.
                  </div>
                  <BillFinder
                    rows={retBills.map((s) => ({
                      id: s.id,
                      billNo: s.billNo,
                      title: s.customerName || 'Walk-in',
                      when: dt(new Date(s.date).getTime()),
                      amount: money(s.total),
                    }))}
                    loading={retLoading}
                    onPick={(id) => void loadReturnSale(id)}
                    searchPlaceholder="Search bill no. or customer — e.g. INV-0123"
                    emptyHint="No bills found on this device yet — new bills appear here after they are saved."
                    inputRef={retBillRef}
                  />
                </>
              )
            )}
          </section>

          {retSale && (
            <>
              <section style={{ marginTop: 16 }}>
                {retSectionHead('Items to return')}
                <div style={{ ...retRow, alignItems: 'flex-end', paddingBottom: 6, borderBottom: '1px solid var(--line-strong)' }}>
                  <div style={retNameCell}><span className="micro-label">Item</span></div>
                  <div style={retColSold}><span className="micro-label">Sold</span></div>
                  <div style={retColRet}><span className="micro-label">Returned</span></div>
                  <div style={{ width: 88 }}><span className="micro-label">Qty back</span></div>
                  <div style={retColValue}><span className="micro-label">Value</span></div>
                </div>
                {(retSale.items ?? []).length === 0 ? (
                  <div className="alert" style={{ marginTop: 8 }}>This bill has no line items.</div>
                ) : (
                  (retSale.items ?? []).map((it) => {
                    const already = retReturned[it.productId] ?? 0
                    const max = it.qty - already
                    const q = retLines[it.id] ?? 0
                    return (
                      <div key={it.id} style={{ ...retRow, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                        <div style={retNameCell}>
                          <div style={{ fontWeight: 500, fontSize: 13.5, overflowWrap: 'anywhere' }}>{it.productName}</div>
                          <div className="t-caption" style={{ marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span>{it.unit}</span>
                            {max <= 0 && <Tag tone="neutral">Fully returned</Tag>}
                          </div>
                        </div>
                        <div style={retColSold}><span className="num" style={{ fontSize: 13 }}>{it.qty}</span></div>
                        <div style={retColRet}><span className="num" style={{ fontSize: 13 }}>{already}</span></div>
                        <div style={{ width: 88 }}>
                          <NumInput
                            value={max <= 0 ? 0 : q}
                            disabled={max <= 0}
                            style={{ width: 88, height: 40 }}
                            aria-label={`Return quantity of ${it.productName}`}
                            onChange={(n) =>
                              setRetLines((prev) => ({ ...prev, [it.id]: Math.max(0, Math.min(max, Math.floor(n || 0))) }))
                            }
                          />
                        </div>
                        <div style={retColValue}>
                          <span className="num" style={{ fontSize: 13, fontWeight: q > 0 ? 600 : 400 }}>
                            {q > 0 ? money(fromPaise(lineRefundPaise(it, q))) : '—'}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, paddingTop: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                    Return value ({chosenCount} item{chosenCount === 1 ? '' : 's'})
                  </span>
                  <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{money(returnValue)}</span>
                </div>
              </section>

              <section style={{ marginTop: 16 }}>
                {retSectionHead('Settlement')}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div className="micro-label" style={{ marginBottom: 6 }}>Restock to</div>
                    <div className="seg" role="group" aria-label="Restock location">
                      {(['counter', 'godown'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={`seg-btn ${restockLoc === v ? 'active' : ''}`}
                          style={{ flex: 1, height: 40 }}
                          aria-pressed={restockLoc === v}
                          onClick={() => setRestockLoc(v)}
                        >
                          {v === 'counter' ? 'Counter' : 'Godown'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div className="micro-label" style={{ marginBottom: 6 }}>Refund via</div>
                    <div className="seg" role="group" aria-label="Refund method">
                      {(['Cash', 'UPI', 'Khata'] as PayOption[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`seg-btn ${refundMethod === m ? 'active' : ''}`}
                          style={{ flex: 1, height: 40 }}
                          aria-pressed={refundMethod === m}
                          disabled={m === 'Khata' && !retSale.customerId}
                          title={m === 'Khata' && !retSale.customerId ? 'The original bill has no customer — Khata refunds need one' : undefined}
                          onClick={() => setRefundMethod(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    {refundMethod === 'Khata' && retSale.customerId && (
                      <div className="t-caption" style={{ marginTop: 6 }}>Refund posts to {retSale.customerName}&apos;s ledger.</div>
                    )}
                    {refundMethod === 'UPI' && (
                      <div style={{ marginTop: 8 }}>
                        <div className="micro-label" style={{ marginBottom: 6 }}>UPI reference</div>
                        <input
                          className="field-control num"
                          style={{ height: 40 }}
                          value={refundRef}
                          onChange={(e) => setRefundRef(e.target.value)}
                          placeholder="UTR / transaction id"
                          aria-label="UPI reference"
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                  <label htmlFor="ret-exchange" style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Exchange items instead of refunding
                  </label>
                  <button
                    id="ret-exchange"
                    type="button"
                    className={`switch ${exchange ? 'on' : ''}`}
                    role="switch"
                    aria-checked={exchange}
                    aria-label="Exchange items instead of refunding"
                    onClick={() => setExchange((v) => !v)}
                  >
                    <span className="knob" />
                  </button>
                </div>
              </section>

              {exchange && (
                <section style={{ marginTop: 16 }}>
                  {retSectionHead('Replacement items')}
                  <ProductCombobox
                    products={salesProducts}
                    shopId={shopId}
                    clearRef={replClearRef}
                    onPick={addReplacement}
                    rateOf={saleRate}
                    placeholder="Search a replacement product…"
                    ariaLabel="Search replacement products"
                    enableKitchen={kitchenOn}
                  />
                  {replLines.length === 0 ? (
                    <div className="t-caption" style={{ marginTop: 8 }}>No replacement items yet — search above to add them.</div>
                  ) : (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ ...retRow, alignItems: 'flex-end', paddingBottom: 6, borderBottom: '1px solid var(--line-strong)' }}>
                        <div style={retNameCell}><span className="micro-label">Item</span></div>
                        <div style={retColRate}><span className="micro-label">Rate</span></div>
                        <div style={retColQty}><span className="micro-label">Qty</span></div>
                        <div style={retColValue}><span className="micro-label">Value</span></div>
                        <div style={{ width: 36 }} />
                      </div>
                      {replLines.map((l, i) => (
                        <div key={l.productId} style={{ ...retRow, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                          <div style={retNameCell}>
                            <div style={{ fontWeight: 500, fontSize: 13.5, overflowWrap: 'anywhere' }}>{l.name}</div>
                            <div className="t-caption" style={{ marginTop: 2 }}>{l.unit}</div>
                          </div>
                          <div style={retColRate}><span className="num" style={{ fontSize: 13 }}>{money(l.rate)}</span></div>
                          <div style={retColQty}>
                            <div className="qty-stepper">
                              <button aria-label={`Decrease ${l.name}`} onClick={() => setReplLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>−</button>
                              <NumInput
                                value={l.qty}
                                style={{ width: 52 }}
                                aria-label={`Quantity of ${l.name}`}
                                onChange={(n) => setReplLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.floor(n || 1)) } : x)))}
                              />
                              <button aria-label={`Increase ${l.name}`} onClick={() => setReplLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                            </div>
                          </div>
                          <div style={retColValue}>
                            <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{money(l.qty * l.rate)}</span>
                          </div>
                          <div style={{ width: 36 }}>
                            <button className="icon-btn del" aria-label={`Remove ${l.name}`} onClick={() => setReplLines((ls) => ls.filter((_, j) => j !== i))}>
                              <IconTrash size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                      <div className="micro-label" style={{ marginBottom: 6 }}>Settle new items</div>
                      <div className="seg" role="group" aria-label="Settlement method for new items">
                        {(['Cash', 'UPI', 'Khata'] as PayOption[]).map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`seg-btn ${settleMethod === m ? 'active' : ''}`}
                            style={{ flex: 1, height: 40 }}
                            aria-pressed={settleMethod === m}
                            disabled={m === 'Khata' && !retSale.customerId}
                            title={m === 'Khata' && !retSale.customerId ? 'The original bill has no customer' : undefined}
                            onClick={() => setSettleMethod(m)}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ flex: '1 1 260px', minWidth: 0, background: 'var(--layer)', border: '1px solid var(--line)', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--muted)', padding: '3px 0' }}>
                        <span>Returned</span>
                        <span className="num">− {money(returnValue)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--muted)', padding: '3px 0' }}>
                        <span>New items</span>
                        <span className="num">{money(replTotal)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>
                          {netExchange > 0 ? 'Customer pays' : netExchange < 0 ? 'Shop refunds' : 'Even swap'}
                        </span>
                        <span
                          className="num"
                          style={{ fontSize: 16, fontWeight: 600, ...(netExchange !== 0 ? { color: 'var(--blue)' } : {}) }}
                        >
                          {money(Math.abs(netExchange))}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              <div className="t-caption">
                Returns post a credit note against the original bill · over-returns are rejected by the server.
              </div>

              <div style={{ position: 'sticky', bottom: 0, zIndex: 10, background: 'var(--canvas)', borderTop: '1px solid var(--line)', marginTop: 16, padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Btn variant="ghost" onClick={() => setRetMode(false)}>Back to billing</Btn>
                <Btn
                  variant="primary"
                  disabled={retBusy || returnValue <= 0 || (exchange && replTotal <= 0)}
                  onClick={() => void confirmReturn()}
                >
                  {retBusy
                    ? 'Posting return…'
                    : exchange
                      ? `Confirm exchange (${netExchange > 0 ? `customer pays ${money(netExchange)}` : netExchange < 0 ? `shop refunds ${money(-netExchange)}` : 'even swap'})`
                      : `Confirm return · refund ${money(returnValue)}`}
                </Btn>
              </div>
            </>
          )}
            </>
          )}
    </div>
  )

  // Latest-value refs for the stable listeners/handlers above. Writing refs
  // during render violates the Rules of React (and blocks the React Compiler);
  // a layout effect publishes the same values synchronously after commit and
  // before paint, so every event handler still observes the freshest state.
  useLayoutEffect(() => {
    armedPayRef.current = armedPay
    cancelArmedPayRef.current = cancelArmedPay
    addProductRef.current = addProduct
    flushSaveRef.current = flushSave
    methodRef.current = method
    activeTableIdRef.current = activeTableId
    toggleFastSaleRef.current = toggleFastSale
    confirmSaleRef.current = confirmSale
    triggerFastPayRef.current = triggerFastPay
    uiBlockedRef.current = addOpen || clearOpen || switchAsk != null || takeoverAsk != null || printAsk != null || shortcutsOpen || discountManagerOpen
    onLineKeyDownRef.current = onLineKeyDown
    tryConfirmRef.current = tryConfirm
    retModeRef.current = retMode
    histModeRef.current = histMode
    settlePrintAskRef.current = settlePrintAsk
    handleScan.current = handleScanImpl
  })
  return (
    <>
      {tablesCfg.enabled && fastSaleMode && (
        <div style={{ marginBottom: 8 }}>
          <Tag kind="blue">
            <IconZap size={12} style={{ marginRight: 5, verticalAlign: '-1px' }} />
            Fast Sale Active
          </Tag>
        </div>
      )}

      {histMode ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 10 }}>
            <Btn sm variant="ghost" style={{ paddingLeft: 0 }} onClick={() => setHistMode(false)}>
              ← Back to billing
            </Btn>
          </div>
          <SalesHistoryRegister
            showCsv={seesMoney}
            defaultRange="today"
            onReturnBill={returnBillFromHistory}
          />
        </div>
      ) : tablesCfg.enabled && !retMode && seatPos === 'left' && !fastSaleMode ? (
        <div className="pos-layout-docked pos-layout-left">
          <aside className="seat-rail seat-rail-left">
            {floorSection}
          </aside>
          {posGrid}
        </div>
      ) : tablesCfg.enabled && !retMode && seatPos === 'right' && !fastSaleMode ? (
        <div className="pos-layout-docked pos-layout-right">
          {posGrid}
          <aside className="seat-rail seat-rail-right">
            {floorSection}
          </aside>
        </div>
      ) : (
        <>
          {tablesCfg.enabled && !retMode && seatPos === 'top' && !fastSaleMode && floorSection}
          {retMode ? returnPanel : posGrid}
          {tablesCfg.enabled && !retMode && seatPos === 'bottom' && !fastSaleMode && floorSection}
        </>
      )}

      <Drawer open={addOpen} title={isOwner ? 'New customer or retailer shop' : 'New customer'} onClose={() => setAddOpen(false)}>
        {isOwner && (
          <Field label="Account type">
            <div className="seg" role="group" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`seg-btn ${newCustType === 'Customer' ? 'active' : ''}`}
                onClick={() => {
                  setNewCustType('Customer')
                  setSelectedRetailShopId('')
                  setNewName('')
                  setNewPhone('')
                }}
              >
                Customer
              </button>
              <button
                type="button"
                className={`seg-btn ${newCustType === 'Retailer' ? 'active' : ''}`}
                onClick={() => {
                  setNewCustType('Retailer')
                }}
              >
                Retailer Shop
              </button>
            </div>
          </Field>
        )}

        {isOwner && newCustType === 'Retailer' && connectedRetailerShops.length > 0 && (
          <Field label="Connected retailer shop" help="Select a connected retailer outlet in this enterprise.">
            <select
              className="field-control"
              value={selectedRetailShopId}
              onChange={(e) => {
                const sId = e.target.value
                setSelectedRetailShopId(sId)
                const matched = connectedRetailerShops.find((s) => s.id === sId)
                if (matched) {
                  setNewName(`Retailer — ${matched.name}`)
                  setNewPhone(matched.phone || '')
                }
              }}
            >
              <option value="">-- Choose connected shop --</option>
              {connectedRetailerShops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label={newCustType === 'Retailer' ? 'Retailer account name' : 'Customer name'} help={newCustType === 'Retailer' ? 'Account for this connected retailer outlet.' : 'Saved to Accounts as a Customer (khata) instantly.'}>
          <input
            className="field-control"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={newCustType === 'Retailer' ? 'e.g. Retailer — Downtown Outlet' : 'e.g. Ramesh Kumar'}
            autoFocus
          />
        </Field>
        <Field label="Phone" required help="Required — used for collections, delivery and Khata reminders.">
          <PhoneInput
            countryCode={newCustCountry}
            phone={newPhone}
            onCountryCode={setNewCustCountry}
            onPhone={setNewPhone}
            required
          />
        </Field>
        <Btn variant="primary" block disabled={addingCust} onClick={createCustomer}>
          {addingCust ? 'Saving…' : `Save ${newCustType.toLowerCase()} & use on bill`}
        </Btn>
      </Drawer>

      <ConfirmDialog
        open={clearOpen}
        title="Clear this bill?"
        message={
          activeLabel
            ? `All items will be removed and table ${activeLabel}'s open tab will be deleted — the table becomes free. This cannot be undone.`
            : 'All scanned items will be removed from the current bill. This cannot be undone.'
        }
        confirmLabel="Clear bill"
        onClose={() => setClearOpen(false)}
        onConfirm={() => {
          if (activeTableId) commitTab(null, activeTableId)
          setActiveTableId(null)
          if (continuousScanning && shopId) {
            try {
              localStorage.removeItem(DRAFT_KEY)
            } catch {}
            repo.releaseServerTab(shopId, '__continuous_draft__').catch(() => {})
            setCartUnlocked(false)
          }
          setLines([])
          setCouponIdx(0)
          setQuickDiscount(0)
          setGstSlab(0)
          setTipPct(0)
          setUseCustomTip(false)
          setCustomTip(0)
          setClearOpen(false)
          searchRef.current?.focus()
        }}
      />

      <ConfirmDialog
        open={switchAsk != null}
        title="Load this table's tab?"
        message={
          switchAsk
            ? `Table ${labels.find((l) => tableId(l) === switchAsk) ?? ''} already holds an open tab with ${
                tabsById.get(switchAsk)?.items.length ?? 0
              } item(s). Loading it replaces the current unbound bill.`
            : ''
        }
        confirmLabel="Load table tab"
        onClose={() => setSwitchAsk(null)}
        onConfirm={() => {
          const id = switchAsk
          setSwitchAsk(null)
          if (id) void bindTable(id)
        }}
      />

      <ConfirmDialog
        open={takeoverAsk != null}
        title="Table held on another device"
        message={
          takeoverAsk
            ? `Table ${labels.find((l) => tableId(l) === takeoverAsk.id) ?? ''} has a live tab parked by ${
                takeoverAsk.conflict.openedByName || 'another device'
              } (${takeoverAsk.conflict.draftItems.length} item(s)). Taking over replaces their parked tab with this bill.`
            : ''
        }
        confirmLabel="Take over table"
        onClose={() => {
          const id = takeoverAsk?.id ?? null
          setTakeoverAsk(null)
          if (id) {
            setActiveTableId(null)
            setLines([])
          }
        }}
        onConfirm={() => {
          const id = takeoverAsk?.id ?? null
          setTakeoverAsk(null)
          if (id) {
            takeoverGranted.current.add(id)
            // Re-park immediately with force so the server reflects the takeover.
            const t = tabsById.get(id)
            if (t) commitTab(t, id)
          }
        }}
      />

      <Modal
        open={!!printAsk}
        onClose={() => settlePrintAsk(false)}
        title={printAsk ? `Bill ${printAsk.billNo} confirmed` : ''}
        ariaLabel={printAsk ? `Bill ${printAsk.billNo} confirmed` : 'Bill confirmed'}
        footer={
          <>
            <Btn variant="secondary" onClick={() => settlePrintAsk(false)}>
              Skip
            </Btn>
            <Btn variant="primary" autoFocus onClick={() => settlePrintAsk(true)}>
              Print
            </Btn>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--ink)' }}>Print this bill?</p>
        <label
          className="row"
          style={{ gap: 8, alignItems: 'center', marginTop: 12, minHeight: 40, cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            style={{ accentColor: 'var(--blue)', width: 16, height: 16 }}
            checked={printAskAlways}
            onChange={(e) => setPrintAskAlways(e.target.checked)}
            aria-label="Always print after confirming — don't ask"
          />
          <span style={{ fontSize: 13 }}>Always print after confirming — don&apos;t ask</span>
        </label>
        <button
          type="button"
          onClick={turnOffPrintAsk}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            marginTop: 8,
            minHeight: 40,
            color: 'var(--blue)',
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: '0.16px',
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Don&apos;t print or ask again — turn off bill printing on this device
        </button>
      </Modal>

      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
        width={520}
        footer={
          <Btn variant="secondary" onClick={() => setShortcutsOpen(false)}>
            Close
          </Btn>
        }
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {SHORTCUT_ROWS.map(([k, desc]) => (
              <tr key={k}>
                <td style={{ padding: '7px 12px 7px 0', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>
                  <span className="kbd">{k}</span>
                </td>
                <td style={{ padding: '7px 0', borderBottom: '1px solid var(--line)', color: 'var(--ink)' }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>

      <DiscountSchemeManager
        open={discountManagerOpen}
        shopId={shopId}
        schemes={schemes}
        onClose={() => setDiscountManagerOpen(false)}
        onSchemesChange={reloadSchemes}
      />
    </>
  )
}

export default function SalesPageGuarded() {
  const { can, isOwnerAccount } = useAuth()
  if (!can('sales')) return <NoAccess what="Sales counter" />
  if (isOwnerAccount) {
    return (
      <div className="panel stack" style={{ maxWidth: 640, margin: '40px auto', padding: 24, textAlign: 'center', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Dedicated Owner Account</h2>
        <p style={{ color: 'var(--ink-muted)', fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
          You are signed in as the Business Owner. In multi-shop mode, retail counter sales are conducted through each shop&apos;s dedicated Retailer Account to maintain accurate per-store cash drawers and registers.
        </p>
        <div style={{ marginTop: 8 }}>
          <a href="/" className="btn btn-primary" style={{ display: 'inline-flex', padding: '8px 16px', background: 'var(--blue)', color: '#fff', textDecoration: 'none' }}>
            Go to Owner Dashboard
          </a>
        </div>
      </div>
    )
  }
  return <SalesPage />
}
