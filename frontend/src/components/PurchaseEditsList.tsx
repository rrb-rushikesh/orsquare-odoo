import { useMemo, useState } from 'react'
import { useData } from '@/data/DataProvider'
import { formatDate, money, num0, timeOf } from '@/lib/utils'
import { Btn, EmptyState } from '@/components/ui'

interface EditRow {
  id: string
  billNo: string
  editedAt: string
  editedBy: string
  purchaseId: string | null
  before: { amount: number; totalQty: number; supplierName: string }
  after: { amount: number; totalQty: number; supplierName: string }
  changes: { label: string; before: string; after: string }[]
}

const numv = (v: any): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const whenOf = (iso: string): string => (iso ? `${formatDate(iso)} · ${timeOf(iso)}` : '—')

// Snapshots carry a `lines` array; older/idealized payloads carry scalar totals.
const snapQty = (s: any): number =>
  Array.isArray(s?.lines) ? s.lines.reduce((a: number, l: any) => a + numv(l?.qty), 0) : numv(s?.totalQty ?? s?.total_qty ?? 0)

// Accepts both the live wire shape (bill_no / before_snapshot / changes_diff)
// and the idealized camelCase shape the Reports page was originally mapped for.
const mapEdit = (e: any): EditRow => {
  const before = e.before ?? e.before_snapshot ?? {}
  const after = e.after ?? e.after_snapshot ?? {}
  const rawChanges = e.changes ?? e.changesDiff ?? e.changes_diff
  return {
    id: e.id,
    billNo: e.bill_no ?? e.billNo ?? '—',
    editedAt: e.edited_at ?? e.editedAt ?? '',
    editedBy: e.edited_by_name || e.editedBy || '—',
    purchaseId: e.purchase_id ?? e.purchaseId ?? e.purchase ?? null,
    before: {
      amount: numv(before.amount ?? before.total),
      totalQty: snapQty(before),
      supplierName: before.supplierName ?? before.supplier_name ?? '—',
    },
    after: {
      amount: numv(after.amount ?? after.total),
      totalQty: snapQty(after),
      supplierName: after.supplierName ?? after.supplier_name ?? '—',
    },
    changes: Array.isArray(rawChanges)
      ? rawChanges.map((c: any) => ({ label: c.label ?? c.field ?? '—', before: c.before ?? '—', after: c.after ?? '—' }))
      : [],
  }
}

/**
 * Purchase edit audit log (relocated from Reports). Reads the log straight
 * from DataProvider, newest first, one flat row per correction. With
 * `purchaseId` it scopes to that bill's edits; otherwise it shows the full
 * log with a bill-no filter. `onOpenBill` adds a per-row "Open bill" action.
 */
export default function PurchaseEditsList({
  purchaseId,
  onOpenBill,
  compact,
}: {
  purchaseId?: string
  onOpenBill?: (purchaseId: string) => void
  compact?: boolean
}) {
  const d = useData()
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const all = [...d.purchaseEdits].map(mapEdit).sort((a, b) => b.editedAt.localeCompare(a.editedAt))
    if (!purchaseId) return all
    // Edit rows are keyed by bill_no on the wire; resolve the bill's number
    // from the loaded register (direct purchase-id match wins when present).
    const billNo = d.purchases.find((p) => p.id === purchaseId)?.billNo
    return all.filter((e) => e.purchaseId === purchaseId || (billNo != null && e.billNo === billNo))
  }, [d.purchaseEdits, d.purchases, purchaseId])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (purchaseId || !needle) return rows
    return rows.filter((e) => e.billNo.toLowerCase().includes(needle))
  }, [rows, q, purchaseId])

  return (
    <div className="stack" style={{ gap: 8 }}>
      {!purchaseId && (
        <input
          className="field-control mono-tag"
          style={{ height: 40 }}
          placeholder="Filter by bill no…"
          aria-label="Filter edits by bill no"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {visible.length === 0 ? (
        purchaseId ? (
          <EmptyState title="No edits recorded for this bill." />
        ) : (
          <EmptyState
            title="No purchase edits yet"
            hint="Correct a bill from Purchases → open it → Edit purchase, and every change is recorded here."
          />
        )
      ) : (
        <div>
          {visible.map((e) => (
            <div
              key={e.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: compact ? '8px 0' : '10px 0',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span className="mono-tag" style={{ fontWeight: 600 }}>{e.billNo}</span>
                  <span className="t-caption num">{whenOf(e.editedAt)}</span>
                  {e.editedBy !== '—' && <span className="t-caption">by {e.editedBy}</span>}
                </div>
                <div className="t-caption num" style={{ whiteSpace: 'normal' }}>
                  Amount {money(e.before.amount)} → <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{money(e.after.amount)}</span> · {num0(e.before.totalQty)} → {num0(e.after.totalQty)} pcs
                </div>
                {e.before.supplierName !== '—' && e.after.supplierName !== e.before.supplierName && (
                  <div className="t-caption" style={{ whiteSpace: 'normal' }}>
                    Supplier {e.before.supplierName} → {e.after.supplierName}
                  </div>
                )}
                {e.changes.map((c, i) => (
                  <div key={`${e.id}-${i}`} className="t-caption num" style={{ whiteSpace: 'normal' }}>
                    {c.label}: {c.before} → {c.after}
                  </div>
                ))}
              </div>
              {onOpenBill && (
                <Btn
                  sm
                  variant="ghost"
                  aria-label={`Open bill ${e.billNo}`}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onOpenBill(e.purchaseId ?? purchaseId ?? e.billNo)
                  }}
                >
                  Open bill
                </Btn>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
