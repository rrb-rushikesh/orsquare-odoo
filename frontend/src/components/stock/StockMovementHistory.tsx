import { useEffect, useMemo, useState } from 'react'
import type { PStockMovement } from '@/lib/repo'
import * as repo from '@/lib/repo'
import { downloadCsv, formatDate, money, num0, timeOf } from '@/lib/utils'
import { DateRangeFilter, useDateRange } from '@/components/DateRangeFilter'
import { Btn, EmptyState, Panel, Tag, useToast } from '@/components/ui'
import { DataTable, type DTCol } from '@/components/DataTable'
import { IconHistory, IconSheet } from '@/components/icons'

const REASONS: { v: string; label: string }[] = [
  { v: 'all', label: 'All reasons' },
  { v: 'opening_stock', label: 'Opening stock' },
  { v: 'purchase_intake', label: 'Purchase intake' },
  { v: 'sale_pos', label: 'Sale' },
  { v: 'transfer', label: 'Transfer (manual)' },
  { v: 'auto_sale_transfer', label: 'Auto sale transfer' },
  { v: 'void_restock', label: 'Void restock' },
  { v: 'sale_return', label: 'Sale return' },
  { v: 'purchase_return', label: 'Purchase return' },
  { v: 'audit_correction', label: 'Audit correction' },
]

const reasonLabel = (r: string): string => REASONS.find((x) => x.v === r)?.label ?? r

const dayOfIso = (iso: string): { day: string; time: string } => ({
  day: formatDate(iso),
  time: timeOf(iso),
})

export interface StockMovementHistoryProps {
  shopId: string
  seesValuation: boolean
  onBack?: () => void
}

export function StockMovementHistory({
  shopId,
  seesValuation,
  onBack,
}: StockMovementHistoryProps) {
  const toast = useToast()
  const [histDate, setHistDate, histRange] = useDateRange()
  const [reason, setReason] = useState('all')
  const [moves, setMoves] = useState<PStockMovement[]>([])
  const [movesLoading, setMovesLoading] = useState(false)

  useEffect(() => {
    if (!shopId) return
    let alive = true
    setMovesLoading(true)
    repo.listStockMovements(shopId, {
      from: histRange.from ?? undefined,
      to: histRange.to ?? undefined,
      reason: reason === 'all' ? undefined : reason,
      limit: 1000,
    })
      .then((rows) => {
        if (alive) setMoves(rows)
      })
      .catch(() => {
        if (!alive) return
        setMoves([])
        toast('Could not load stock movements.', 'err')
      })
      .finally(() => {
        if (alive) setMovesLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, histRange.from, histRange.to, reason])

  const moveSummary = useMemo(() => {
    let totalQty = 0
    let totalValuation = 0
    let transferQty = 0
    let transferValuation = 0
    let saleQty = 0
    let saleValuation = 0
    let purchaseQty = 0
    let purchaseValuation = 0

    for (const m of moves) {
      const q = Math.abs(m.qtyDelta)
      const cost = m.runningCost ?? 0
      const val = q * cost

      totalQty += q
      totalValuation += val

      if (m.reason === 'purchase_intake') {
        purchaseQty += q
        purchaseValuation += val
      } else if (m.reason === 'sale_pos') {
        saleQty += q
        saleValuation += val
      } else if (m.reason === 'transfer' || m.reason === 'auto_sale_transfer') {
        transferQty += q
        transferValuation += val
      }
    }

    return {
      totalQty,
      totalValuation,
      transferQty,
      transferValuation,
      saleQty,
      saleValuation,
      purchaseQty,
      purchaseValuation,
      count: moves.length,
    }
  }, [moves])

  const moveCols = useMemo<DTCol<PStockMovement>[]>(() => {
    const c: DTCol<PStockMovement>[] = [
      {
        key: 'date',
        label: 'Date',
        sortValue: (m) => m.createdAt,
        render: (m) => {
          const dt = dayOfIso(m.createdAt)
          return (
            <span className="num td-muted">
              {dt.day}{dt.time ? <span className="t-caption"> · {dt.time}</span> : null}
            </span>
          )
        },
      },
      {
        key: 'product',
        label: 'Product',
        sortValue: (m) => m.productName.toLowerCase(),
        render: (m) => <span className="cell-main">{m.productName}</span>,
      },
      {
        key: 'qty',
        label: 'Movement',
        align: 'right',
        sortValue: (m) => m.qtyDelta,
        render: (m) => (
          <span className={`num ${m.qtyDelta > 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 600 }}>
            {m.qtyDelta > 0 ? `+${num0(m.qtyDelta)}` : `−${num0(Math.abs(m.qtyDelta))}`}
          </span>
        ),
      },
      {
        key: 'locs',
        label: 'From → To',
        hideMobile: true,
        sortValue: (m) => `${m.fromLoc} ${m.toLoc}`,
        render: (m) => <span className="t-caption num">{m.fromLoc} <span style={{ color: 'var(--muted)' }}>→</span> {m.toLoc}</span>,
      },
      {
        key: 'reason',
        label: 'Reason',
        hideMobile: true,
        sortValue: (m) => m.reason,
        render: (m) => {
          if (m.reason === 'opening_stock') {
            return <Tag kind="blue">OPENING STOCK</Tag>
          }
          if (m.reason === 'auto_sale_transfer') {
            return <Tag kind="purple">AUTO SALE TRANSFER</Tag>
          }
          return <Tag kind="gray">{reasonLabel(m.reason).toUpperCase()}</Tag>
        },
      },
    ]
    if (seesValuation) {
      c.push({
        key: 'cost',
        label: 'Cost',
        align: 'right',
        hideMobile: true,
        sortValue: (m) => m.runningCost ?? -1,
        render: (m) => <span className="num">{m.runningCost == null ? '—' : money(m.runningCost)}</span>,
      })
    }
    return c
  }, [seesValuation])

  function exportMovementsCsv() {
    downloadCsv(
      `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`,
      moves.map((m) => {
        const dt = dayOfIso(m.createdAt)
        return {
          Date: dt.day,
          Time: dt.time,
          Product: m.productName,
          'Qty delta': m.qtyDelta,
          From: m.fromLoc,
          To: m.toLoc,
          Reason: reasonLabel(m.reason),
          Cost: m.runningCost ?? '',
        }
      })
    )
  }

  return (
    <Panel>
      <div className="panel-head">
        <div className="panel-title-group">
          <h3 className="panel-title" style={{ margin: 0 }}>Stock movements</h3>
          <span className="t-caption">Showing {moves.length} of {moves.length}</span>
        </div>
        <div className="panel-actions">
          <DateRangeFilter state={histDate} onChange={setHistDate} />
          <select
            className="field-control"
            style={{ width: 180 }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Filter by reason"
          >
            {REASONS.map((r) => (
              <option key={r.v} value={r.v}>{r.label}</option>
            ))}
          </select>
          {seesValuation && (
            <Btn
              variant="ghost"
              className="btn-icon"
              style={{ width: 40, height: 40 }}
              aria-label="Export to spreadsheet"
              data-tooltip="Export to spreadsheet"
              onClick={exportMovementsCsv}
            >
              <IconSheet size={16} />
            </Btn>
          )}
          {onBack && (
            <Btn
              variant="ghost"
              className="btn-icon"
              style={{ width: 40, height: 40, background: 'var(--blue)', borderColor: 'var(--blue)', color: '#ffffff' }}
              aria-label="Back to on-hand stock"
              aria-pressed={true}
              title="Back to on-hand stock"
              data-tooltip="Back to on-hand stock"
              onClick={onBack}
            >
              <IconHistory size={16} />
            </Btn>
          )}
        </div>
      </div>
      {movesLoading ? (
        <div className="skeleton" style={{ height: 240 }} />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 1,
              background: 'var(--line)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>
                Total Moved
              </div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                {num0(moveSummary.totalQty)} <span className="t-caption" style={{ fontWeight: 400 }}>pcs</span>
              </div>
              {seesValuation && (
                <div className="t-caption num" style={{ color: 'var(--ok-fg)', fontWeight: 600 }}>
                  {money(moveSummary.totalValuation)}
                </div>
              )}
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>
                Godown → Counter
              </div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--purple-fg)' }}>
                {num0(moveSummary.transferQty)} <span className="t-caption" style={{ fontWeight: 400 }}>pcs</span>
              </div>
              {seesValuation && (
                <div className="t-caption num">
                  {money(moveSummary.transferValuation)}
                </div>
              )}
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>
                Counter → Customer
              </div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--blue)' }}>
                {num0(moveSummary.saleQty)} <span className="t-caption" style={{ fontWeight: 400 }}>pcs</span>
              </div>
              {seesValuation && (
                <div className="t-caption num">
                  {money(moveSummary.saleValuation)}
                </div>
              )}
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>
                Purchase Intake
              </div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ok-fg)' }}>
                {num0(moveSummary.purchaseQty)} <span className="t-caption" style={{ fontWeight: 400 }}>pcs</span>
              </div>
              {seesValuation && (
                <div className="t-caption num">
                  {money(moveSummary.purchaseValuation)}
                </div>
              )}
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--canvas)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.32px' }}>
                Movement Records
              </div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                {moveSummary.count} <span className="t-caption" style={{ fontWeight: 400 }}>entries</span>
              </div>
            </div>
          </div>
          <DataTable
            cols={moveCols}
            rows={moves}
            defaultSort={{ key: 'date', dir: 'desc' }}
            empty={
              <EmptyState
                title="No stock movements in this period."
                hint="Try a different date range or reason filter."
              />
            }
          />
        </>
      )}
    </Panel>
  )
}
