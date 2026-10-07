import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/components/ui'
import * as repo from '@/lib/repo'
import type { PPurchaseReturn, PSaleReturn } from '@/lib/repo'
import { formatDate, money, timeOf } from '@/lib/utils'
import { Btn, EmptyState, Tag } from '@/components/ui'
import { IconBoxReturn } from '@/components/icons'

const whenOf = (iso: string): string => {
  if (!iso) return '—'
  const day = formatDate(iso)
  const time = timeOf(iso)
  return time ? `${day} · ${time}` : day
}

const itemsLine = (items: { productName: string; qty: number }[]): string =>
  items
    .slice(0, 3)
    .map((it) => `${it.productName} × ${it.qty}`)
    .join(' · ') + (items.length > 3 ? ` · +${items.length - 3} more` : '')

/** Red for returns (money goes back), green for exchanges (items swap). */
function KindTag({ kind }: { kind: string }) {
  const isExchange = kind === 'exchange'
  return (
    <Tag kind={isExchange ? 'green' : 'red'}>
      {isExchange ? 'Exchange' : 'Return'}
    </Tag>
  )
}

/**
 * One shared row shape for both histories:
 *   RET-0001  [Return]                      ₹ 181.80
 *   Against INV-0503 · 06/09/2026 06:02     [Return items]
 *   Refunded ₹181.80 in Cash
 *   Master deligth BLUE 180ML × 1
 */
function ReturnRow({
  billNo,
  kind,
  againstBillNo,
  when,
  settlement,
  items,
  amount,
  actionLabel,
  onAction,
  reason,
}: {
  billNo: string
  kind: string
  againstBillNo: string
  when: string
  settlement: string
  items: { productName: string; qty: number }[]
  amount: number
  actionLabel: string
  onAction: () => void
  reason?: string
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono-tag" style={{ fontWeight: 600 }}>{billNo}</span>
          <KindTag kind={kind} />
        </div>
        <div className="t-caption num" style={{ marginTop: 4 }}>
          Against {againstBillNo} · {when}
        </div>
        <div style={{ marginTop: 4, fontSize: 13.5, color: 'var(--ink)' }}>{settlement}</div>
        {reason && <div className="t-caption" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>Reason: {reason}</div>}
        {items.length > 0 && (
          <div className="t-caption num" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>
            {itemsLine(items)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        <span className="num" style={{ fontWeight: 600, fontSize: 14 }}>{money(amount)}</span>
        <Btn sm variant="ghost" onClick={onAction}>
          {actionLabel}
        </Btn>
      </div>
    </div>
  )
}

function HistoryFrame({
  title,
  count,
  search,
  onSearch,
  children,
}: {
  title: string
  count: number
  search: string
  onSearch: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <div className="stack" style={{ gap: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          className="field-control mono-tag"
          style={{ flex: '1 1 200px', height: 40, minWidth: 0 }}
          placeholder="Filter by return or bill no…"
          aria-label={`Filter ${title}`}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <span className="t-caption num" style={{ whiteSpace: 'nowrap' }}>
          {count} return{count === 1 ? '' : 's'}
        </span>
      </div>
      {children}
    </div>
  )
}

/**
 * Return-history register for the Sales Return/Exchange flow (RET-xxxx credit
 * notes). Read-only listing with a per-row "Return items" action that re-opens
 * the ORIGINAL bill in the return form.
 */
export function SaleReturnHistory({ onReturnAgain }: { onReturnAgain: (saleId: string, billNo: string) => void }) {
  const { activeShop } = useAuth()
  const shopId = activeShop?.id ?? ''
  const toast = useToast()
  const [rows, setRows] = useState<PSaleReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!shopId) return
    let alive = true
    setLoading(true)
    repo
      .listSaleReturns(shopId, { limit: 100 })
      .then((rs) => {
        if (alive) setRows([...rs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)))
      })
      .catch(() => {
        if (alive) toast('Could not load return history.', 'err')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => (r.billNo ?? '').toLowerCase().includes(q) || (r.saleBillNo ?? '').toLowerCase().includes(q))
  }, [rows, search])

  return (
    <HistoryFrame title="return history" count={visible.length} search={search} onSearch={setSearch}>
      {loading ? (
        <div className="t-caption" style={{ padding: '12px 0' }}>Loading returns…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconBoxReturn size={16} />}
          title={rows.length === 0 ? 'No returns yet' : 'No returns match that filter'}
          hint="Every credit note posted from this flow is listed here."
        />
      ) : (
        <div>
          {visible.map((r) => (
            <ReturnRow
              key={r.id}
              billNo={r.billNo}
              kind={r.kind}
              againstBillNo={r.saleBillNo}
              when={whenOf(r.date)}
              settlement={
                r.kind === 'exchange'
                  ? 'Exchanged for new items'
                  : `Refunded ${money(r.amount)}${r.refundMethod ? ` via ${r.refundMethod}` : ''}`
              }
              items={r.items ?? []}
              amount={r.amount}
              actionLabel="Return items"
              onAction={() => onReturnAgain(r.saleId, r.saleBillNo)}
            />
          ))}
        </div>
      )}
    </HistoryFrame>
  )
}

/**
 * Return-history register for the Purchase Return/Exchange flow (PRET-xxxx
 * debit notes). "Return items" re-opens the ORIGINAL supplier bill in the
 * return form.
 */
export function PurchaseReturnHistory({ onReturnAgain }: { onReturnAgain: (purchaseId: string) => void }) {
  const { wsUid } = useAuth()
  const shopId = wsUid
  const toast = useToast()
  const [rows, setRows] = useState<PPurchaseReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!shopId) return
    let alive = true
    setLoading(true)
    repo
      .listPurchaseReturns(shopId, { limit: 100 })
      .then((rs) => {
        if (alive) setRows([...rs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)))
      })
      .catch(() => {
        if (alive) toast('Could not load return history.', 'err')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => (r.billNo ?? '').toLowerCase().includes(q) || (r.purchaseBillNo ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  return (
    <HistoryFrame title="return history" count={visible.length} search={search} onSearch={setSearch}>
      {loading ? (
        <div className="t-caption" style={{ padding: '12px 0' }}>Loading returns…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconBoxReturn size={16} />}
          title={rows.length === 0 ? 'No returns yet' : 'No returns match that filter'}
          hint="Every debit note posted from this flow is listed here."
        />
      ) : (
        <div>
          {visible.map((r) => (
            <ReturnRow
              key={r.id}
              billNo={r.billNo}
              kind={r.kind}
              againstBillNo={r.purchaseBillNo}
              when={whenOf(r.date)}
              settlement={
                r.kind === 'exchange'
                  ? 'Exchanged for new items'
                  : r.settlement === 'refund'
                    ? `Refunded ${money(r.amount)}${r.refundMethod ? ` via ${r.refundMethod}` : ''}`
                    : 'Payable reduced'
              }
              items={r.items ?? []}
              amount={r.amount}
              actionLabel="Return items"
              onAction={() => onReturnAgain(r.purchaseId)}
              reason={r.reason || undefined}
            />
          ))}
        </div>
      )}
    </HistoryFrame>
  )
}
