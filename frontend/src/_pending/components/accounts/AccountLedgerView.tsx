import { useEffect, useState, useMemo, useRef } from 'react';
import { getAccountLedger, getSale, getPurchase, type AccountLedgerResponse, type AccountLedgerEntry, type PSale, type PPurchase } from '@/lib/repo';
import { money } from '@/lib/utils';
import { Btn, Tag, EmptyState, Drawer, useToast } from '@/components/ui';
import { IconRefresh, IconRupee, IconPrinter } from '@/components/icons';
import { DateRangeFilter, useDateRange } from '@/components/DateRangeFilter';
import { AccountPaymentModal } from './AccountPaymentModal';
import { useData } from '@/data/DataProvider';
import { receiptToDoc, saleToReceipt } from '@/lib/receipt';
import { printPurchaseBill } from '@/lib/purchasePrint';
import { beginPrint, outcomeMessage } from '@/lib/printing/service';
import { loadPrefs } from '@/lib/prefs';

interface Props {
  shopId: string;
  accountId: string;
  onEdit?: () => void;
  compact?: boolean;
}

const TYPE_TAG: Record<string, string> = {
  Customer: 'gray',
  Supplier: 'blue',
  Employee: 'gray',
  Retailer: 'purple',
};

export function format12HourTime(timeStr?: string): string {
  if (!timeStr) return '';
  const clean = timeStr.trim();
  if (/am|pm/i.test(clean)) return clean;
  const parts = clean.split(':');
  if (parts.length < 2) return clean;
  let h = parseInt(parts[0], 10);
  const m = parts[1].slice(0, 2);
  if (isNaN(h)) return clean;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export function AccountLedgerView({ shopId, accountId, onEdit, compact = false }: Props) {
  const toast = useToast();
  const d = useData();
  const [data, setData] = useState<AccountLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateState, setDateState, effDate] = useDateRange('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<AccountLedgerEntry | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentDirection, setPaymentDirection] = useState<'in' | 'out'>('in');
  const [activeSaleDoc, setActiveSaleDoc] = useState<PSale | null>(null);
  const [activePurchaseDoc, setActivePurchaseDoc] = useState<PPurchase | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const prefetchedSales = useRef<Map<string, PSale>>(new Map());
  const prefetchedPurchases = useRef<Map<string, PPurchase>>(new Map());

  // Background prefetch for invoice entries so clicking opens instantly with zero latency
  useEffect(() => {
    if (!data?.entries || !shopId) return;
    const invoiceEntries = data.entries
      .filter((e) => e.voucher_type === 'Sales Invoice' || e.voucher_type === 'Purchase Invoice')
      .slice(0, 20);

    for (const e of invoiceEntries) {
      if (e.voucher_type === 'Sales Invoice') {
        const saleId = e.voucher_id || d.sales.find((s) => String(s.billNo) === String(e.voucher_no))?.id;
        if (saleId && !prefetchedSales.current.has(saleId)) {
          const direct = d.sales.find((s) => s.id === saleId && s.items && s.items.length > 0);
          if (direct) {
            prefetchedSales.current.set(saleId, direct);
          } else {
            getSale(shopId, saleId).then((full) => {
              prefetchedSales.current.set(saleId, full);
            }).catch(() => {});
          }
        }
      } else if (e.voucher_type === 'Purchase Invoice') {
        const purchId = e.voucher_id || d.purchases.find((p) => String(p.billNo) === String(e.voucher_no))?.id;
        if (purchId && !prefetchedPurchases.current.has(purchId)) {
          const direct = d.purchases.find((p) => p.id === purchId && p.items && p.items.length > 0);
          if (direct) {
            prefetchedPurchases.current.set(purchId, direct);
          } else {
            getPurchase(shopId, purchId).then((full) => {
              prefetchedPurchases.current.set(purchId, full);
            }).catch(() => {});
          }
        }
      }
    }
  }, [data?.entries, shopId, d.sales, d.purchases]);

  // When entry is selected in drawer: resolve linked sale or purchase immediately
  useEffect(() => {
    if (!selectedEntry || !shopId) {
      setActiveSaleDoc(null);
      setActivePurchaseDoc(null);
      setDocLoading(false);
      return;
    }
    if (selectedEntry.voucher_type === 'Sales Invoice') {
      const saleId = selectedEntry.voucher_id || d.sales.find((s) => String(s.billNo) === String(selectedEntry.voucher_no))?.id;
      if (saleId) {
        const cached = prefetchedSales.current.get(saleId) || d.sales.find((s) => s.id === saleId && s.items && s.items.length > 0);
        if (cached) {
          setActiveSaleDoc(cached);
          setDocLoading(false);
        } else {
          setDocLoading(true);
          getSale(shopId, saleId)
            .then((doc) => {
              prefetchedSales.current.set(saleId, doc);
              setActiveSaleDoc(doc);
            })
            .catch(() => setActiveSaleDoc(null))
            .finally(() => setDocLoading(false));
        }
      } else {
        setActiveSaleDoc(null);
      }
    } else if (selectedEntry.voucher_type === 'Purchase Invoice') {
      const purchId = selectedEntry.voucher_id || d.purchases.find((p) => String(p.billNo) === String(selectedEntry.voucher_no))?.id;
      if (purchId) {
        const cached = prefetchedPurchases.current.get(purchId) || d.purchases.find((p) => p.id === purchId && p.items && p.items.length > 0);
        if (cached) {
          setActivePurchaseDoc(cached);
          setDocLoading(false);
        } else {
          setDocLoading(true);
          getPurchase(shopId, purchId)
            .then((doc) => {
              prefetchedPurchases.current.set(purchId, doc);
              setActivePurchaseDoc(doc);
            })
            .catch(() => setActivePurchaseDoc(null))
            .finally(() => setDocLoading(false));
        }
      } else {
        setActivePurchaseDoc(null);
      }
    } else {
      setActiveSaleDoc(null);
      setActivePurchaseDoc(null);
      setDocLoading(false);
    }
  }, [selectedEntry, shopId, d.sales, d.purchases]);

  const handlePrintSaleReceipt = async (s: PSale) => {
    const h = beginPrint();
    try {
      const prefs = loadPrefs();
      const m = outcomeMessage(await h.submit(receiptToDoc(prefs.invoice, saleToReceipt(s), prefs.print), {
        key: `reprint:${s.billNo}`, label: `Reprint ${s.billNo}`, kind: 'reprint', repeatable: true,
      }));
      if (m) toast(m.text, m.kind);
    } catch (e) {
      h.abort();
      toast(e instanceof Error ? e.message : 'Could not print receipt', 'err');
    }
  };

  const handlePrintPurchaseBill = async (p: PPurchase) => {
    const h = beginPrint();
    try {
      const m = outcomeMessage(await printPurchaseBill(h, p));
      if (m) toast(m.text, m.kind);
    } catch (e) {
      h.abort();
      toast(e instanceof Error ? e.message : 'Could not print purchase bill', 'err');
    }
  };

  const fetchLedger = async () => {
    if (!shopId || !accountId) return;
    setLoading(true);
    try {
      const res = await getAccountLedger(shopId, accountId, {
        from: effDate.from || undefined,
        to: effDate.to || undefined,
      });
      setData(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load ledger', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, accountId, effDate.from, effDate.to]);

  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    if (!searchFilter.trim()) return data.entries;
    const q = searchFilter.toLowerCase().trim();
    return data.entries.filter(
      (e) =>
        e.voucher_no.toLowerCase().includes(q) ||
        e.voucher_type.toLowerCase().includes(q) ||
        e.against_account.toLowerCase().includes(q) ||
        e.remarks.toLowerCase().includes(q) ||
        e.date.includes(q)
    );
  }, [data?.entries, searchFilter]);

  if (loading && !data) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', background: 'var(--canvas)' }}>
        Loading ledger statement...
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        title="Could not load account"
        hint="The account could not be found or ledger could not be retrieved."
      />
    );
  }

  const { account, initial_balance, total_debit, total_credit, closing_balance } = data;
  // The statement shows THREE different balances for one account: the
  // denormalised `account.balance` column, the GL-derived `closing_balance`,
  // and now the server's `ledger_balance`. They used to be mixed - the header
  // tile read the hand-maintained column, the sticky footer read the GL, and
  // the row colours read a third value - so one screen could show two
  // different numbers and the operator had no way to tell which was which.
  //
  // The server decides. `closing_balance` is the statement's own closing
  // figure (it honours the date filter) and is the one the statement is about,
  // so that is what the header tile and the status tag both use, and `side`
  // / `role` come from accounts/selectors.py rather than from a sign test
  // re-derived here.
  const closingBalNum = parseFloat(closing_balance);
  const currentBalNum = Number.isFinite(closingBalNum) ? closingBalNum : parseFloat(account.balance);
  const isSupplier = account.type === 'Supplier';

  const serverSide = data.side;
  const serverRole = data.role;
  const isReceivable = data.is_receivable ?? false;
  const isPayable = data.is_payable ?? false;
  const isDr = serverSide === 'Dr';
  const isCr = serverSide === 'Cr';

  const currentStatusText = serverRole
    ?? (currentBalNum === 0
      ? 'Settled'
      : isReceivable
      ? "You'll Get"
      : isPayable
      ? "You'll Give"
      : 'Advance');

  const currentStatusColor = currentBalNum === 0
    ? 'var(--fin-zero, var(--muted))'
    : isReceivable
    ? 'var(--rec-fg, #235c35)'
    : isPayable
    ? 'var(--pay-fg, #8a2e2e)'
    : 'var(--adv-fg, #0f62fe)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 460, overflow: 'visible' }}>
      {/* 1. Account Header Strip */}
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--canvas)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{account.name}</h2>
          <Tag kind={TYPE_TAG[account.type] || 'gray'}>{account.type}</Tag>
          {!account.is_active && <Tag kind="gray">Inactive</Tag>}
          {account.code && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Code: <b className="num">{account.code}</b>
            </span>
          )}
          {account.phone && (
            <a
              href={`tel:${account.country_code ? `${account.country_code}` : '+91'}${account.phone}`}
              style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              title="Call contact"
            >
              Mobile: <b className="num">{account.country_code ? `${account.country_code} ` : ''}{account.phone}</b>
            </a>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Btn
            variant="primary"
            style={{ height: 34, fontSize: 12, padding: '0 14px' }}
            onClick={() => {
              setPaymentDirection(isSupplier ? 'out' : 'in');
              setPaymentModalOpen(true);
            }}
          >
            <IconRupee size={14} style={{ marginRight: 4, verticalAlign: '-1px' }} />
            {isSupplier ? 'Pay Supplier' : 'Receive Payment'}
          </Btn>
          <Btn variant="ghost" className="btn-icon" title="Refresh ledger" onClick={fetchLedger} style={{ width: 34, height: 34 }}>
            <IconRefresh size={16} />
          </Btn>
          {onEdit && (
            <Btn variant="secondary" style={{ height: 34, fontSize: 12, padding: '0 14px' }} onClick={onEdit}>
              Edit Account
            </Btn>
          )}
        </div>
      </div>

      {/* 2. Financial Metrics Bar - Sleek compact strip with hairline dividers */}
      <div
        className="ledger-metric-bar"
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          borderBottom: '1px solid var(--line)',
          background: 'var(--layer)',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '8px 14px', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.4px' }}>
            Current Balance
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }} className="num">
            <span style={{ color: currentStatusColor, whiteSpace: 'nowrap' }}>{money(Math.abs(currentBalNum))}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: isDr ? 'var(--blue)' : isCr ? 'var(--ink)' : 'inherit', whiteSpace: 'nowrap' }}>
              {isDr ? 'Dr' : isCr ? 'Cr' : ''}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: currentStatusColor, whiteSpace: 'nowrap' }}>
              · {currentStatusText}
            </span>
          </div>
        </div>

        <div style={{ padding: '8px 14px', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.4px' }}>
            Opening Balance
          </div>
          <div style={{ fontSize: 14, fontWeight: 700 }} className="num">
            <span style={{ color: parseFloat(account.opening) === 0 ? 'var(--fin-zero)' : (isSupplier ? 'var(--fin-pay)' : 'var(--fin-rec)'), whiteSpace: 'nowrap' }}>
              {money(Math.abs(parseFloat(account.opening)))}
            </span>
            <span style={{ fontSize: 11, marginLeft: 4, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {parseFloat(account.opening) > 0 ? (isSupplier ? 'Cr' : 'Dr') : '—'}
            </span>
          </div>
        </div>

        <div style={{ padding: '8px 14px', borderRight: compact ? 'none' : '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.4px' }}>
            Period Debit (+)
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fin-rec)', whiteSpace: 'nowrap' }} className="num">
            {money(parseFloat(total_debit))}
          </div>
        </div>

        <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.4px' }}>
            Period Credit (-)
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: isSupplier ? 'var(--fin-pay)' : 'var(--ink)', whiteSpace: 'nowrap' }} className="num">
            {money(parseFloat(total_credit))}
          </div>
        </div>
      </div>

      {/* 3. Date Filter & Search Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          background: 'var(--canvas)',
          borderBottom: '1px solid var(--line)',
          padding: '10px 20px',
          flexShrink: 0,
          position: 'relative',
          zIndex: 25,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DateRangeFilter state={dateState} onChange={setDateState} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 260, marginLeft: 'auto' }}>
          <input
            type="text"
            className="field-control"
            placeholder="Search entries…"
            style={{ height: 32, fontSize: 12, padding: '2px 10px' }}
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>
      </div>

      {/* 4. Ledger Table (Spacious, standardized DataTable with smooth horizontal touch scroll) */}
      <div className="tbl-scroll" style={{ flex: 1, minHeight: 220, overflow: 'auto', background: 'var(--canvas)', width: '100%' }}>
        <table className="tbl data-table" style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--layer)', boxShadow: '0 1px 0 var(--line)' }}>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              <th style={{ padding: '9px 12px', fontWeight: 600, width: 125, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>Date & Time</th>
              <th style={{ padding: '9px 12px', fontWeight: 600, width: 115, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>Voucher</th>
              <th style={{ padding: '9px 12px', fontWeight: 600, width: 105, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>Type</th>
              <th style={{ padding: '9px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>Remarks / Against</th>
              <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right', width: 135, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>
                Debit (You Gave)
              </th>
              <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right', width: 135, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>
                Credit (You Got)
              </th>
              <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right', width: 135, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {/* Opening Balance Row if date filter is active or initial balance is non-zero */}
            {parseFloat(initial_balance) !== 0 && (
              <tr style={{ background: 'var(--layer)', fontStyle: 'italic', borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 12px' }} className="num">{effDate.from || '—'}</td>
                <td style={{ padding: '10px 12px' }} colSpan={2}>
                  <b>Opening Balance b/f</b>
                </td>
                <td style={{ padding: '10px 12px' }}>Initial balance for selected period</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>—</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>—</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }} className="num font-semibold">
                  <span style={{ color: isSupplier ? 'var(--err, #da1e28)' : 'var(--ok, #198038)' }}>
                    {money(Math.abs(parseFloat(initial_balance)))}
                  </span>{' '}
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                    {parseFloat(initial_balance) >= 0 ? (isSupplier ? 'Cr' : 'Dr') : (isSupplier ? 'Dr' : 'Cr')}
                  </span>
                </td>
              </tr>
            )}

            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  No accounting ledger entries found.
                </td>
              </tr>
            ) : (
              filteredEntries.map((e) => {
                const drNum = parseFloat(e.debit);
                const crNum = parseFloat(e.credit);
                const balNum = parseFloat(e.running_balance);

                // Side and meaning come from the server, per row, because a row
                // is a point in time: an account that starts owing 5,000 and is
                // settled by row 4 is a receivable on rows 1-3 and flat after.
                // The client used to re-derive this per row from an inline
                // `type === 'Supplier' ? ... : ...` tuple that omitted Employee,
                // so an employee advance rendered as a green "You'll Get" on
                // rows where the header said something else entirely.
                const rowStatusText = balNum === 0 ? 'Settled' : (e.role ?? '—');
                const rowStatusColor = balNum === 0
                  ? 'var(--fin-zero, var(--muted))'
                  : e.role === 'Receivable'
                  ? 'var(--rec-fg, #235c35)'
                  : e.role === 'Payable'
                  ? 'var(--pay-fg, #8a2e2e)'
                  : 'var(--adv-fg, #0f62fe)';

                return (
                  <tr
                    key={e.id}
                    onClick={() => setSelectedEntry(e)}
                    title="Click to view full entry details"
                    style={{
                      borderBottom: '1px solid var(--line)',
                      background: e.is_opening ? 'var(--layer-accent)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background-color 0.1s ease',
                    }}
                    className="ledger-row"
                  >
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span className="num" style={{ fontWeight: 600 }}>{e.date}</span>
                        {e.time && (
                          <span className="num" style={{ color: 'var(--muted)', fontSize: 11, marginTop: 1 }}>
                            {format12HourTime(e.time)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '9px 12px', fontWeight: 600 }}>
                      <span className="num" style={{ color: 'var(--blue)' }}>{e.voucher_no}</span>
                    </td>
                    <td style={{ padding: '9px 12px' }}>
                      <Tag kind={e.is_opening ? 'blue' : 'gray'}>{e.voucher_type}</Tag>
                    </td>
                    <td style={{ padding: '9px 12px', maxWidth: 240, wordBreak: 'break-word', lineHeight: 1.35 }}>
                      <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{e.remarks || e.against_account}</div>
                      {e.against_account && e.against_account !== e.remarks && (
                        <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 2 }}>vs {e.against_account}</div>
                      )}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', background: drNum > 0 ? 'var(--dr-bg)' : 'transparent' }} className="num">
                      {drNum > 0 ? (
                        <span style={{ color: 'var(--dr-fg)', fontWeight: 600 }}>{money(drNum)}</span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', background: crNum > 0 ? 'var(--cr-bg)' : 'transparent' }} className="num">
                      {crNum > 0 ? (
                        <span style={{ color: 'var(--cr-fg)', fontWeight: 600 }}>{money(crNum)}</span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }} className="num">
                      <div style={{ fontWeight: 600, color: rowStatusColor }}>
                        {money(Math.abs(balNum))} {balNum === 0 ? '' : (e.side ?? '')}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: rowStatusColor, marginTop: 1 }}>
                        · {rowStatusText}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}

            {/* Closing Balance summary row (sticky bottom) */}
            <tr style={{ position: 'sticky', bottom: 0, zIndex: 2, background: 'var(--layer)', borderTop: '2px solid var(--line)', fontWeight: 600 }}>
              <td style={{ padding: '10px 12px' }} colSpan={4}>
                Closing Balance c/d
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', background: parseFloat(total_debit) > 0 ? 'rgba(218, 30, 40, 0.04)' : 'transparent' }} className="num">
                <span style={{ color: 'var(--err, #da1e28)', fontWeight: 600 }}>{money(parseFloat(total_debit))}</span>
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', background: parseFloat(total_credit) > 0 ? 'rgba(25, 128, 56, 0.04)' : 'transparent' }} className="num">
                <span style={{ color: 'var(--ok, #198038)', fontWeight: 600 }}>{money(parseFloat(total_credit))}</span>
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right' }} className="num">
                <div style={{ fontWeight: 600, color: currentStatusColor }}>
                  {money(Math.abs(closingBalNum))} {closingBalNum === 0 ? '' : (isSupplier ? (closingBalNum > 0 ? 'Cr' : 'Dr') : (closingBalNum > 0 ? 'Dr' : 'Cr'))}
                </div>
                <div style={{ fontSize: 11, color: currentStatusColor, marginTop: 2, fontWeight: 600 }}>
                  · {currentStatusText}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile Khata Quick Action Bar */}
      <div
        className="accounts-mobile-action-bar"
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--line)',
          background: 'var(--canvas)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.3px' }}>Net Balance</span>
          <span className="num" style={{ fontSize: 13.5, fontWeight: 700, color: currentStatusColor }}>
            {money(Math.abs(currentBalNum))} · {currentStatusText}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            type="button"
            style={{
              background: 'var(--err, #da1e28)',
              color: '#ffffff',
              border: 'none',
              padding: '10px 12px',
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              letterSpacing: '0.4px',
            }}
            onClick={() => {
              setPaymentDirection('out');
              setPaymentModalOpen(true);
            }}
          >
            YOU GAVE ₹
          </button>
          <button
            type="button"
            style={{
              background: 'var(--ok, #198038)',
              color: '#ffffff',
              border: 'none',
              padding: '10px 12px',
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              letterSpacing: '0.4px',
            }}
            onClick={() => {
              setPaymentDirection('in');
              setPaymentModalOpen(true);
            }}
          >
            YOU GOT ₹
          </button>
        </div>
      </div>

      {/* 5. Entry Detail Drawer */}
      <Drawer
        open={!!selectedEntry}
        onClose={() => setSelectedEntry(null)}
        title="Accounting Entry Details"
        wide
      >
        {selectedEntry && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* What Happened narrative summary */}
            <div
              style={{
                border: '1px solid var(--line)',
                background: 'var(--layer)',
                padding: '12px 16px',
                borderLeft: '4px solid var(--blue)',
              }}
            >
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--subtle)', fontWeight: 600, letterSpacing: '0.32px' }}>
                Summary
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginTop: 4 }}>
                {selectedEntry.what_happened || selectedEntry.remarks || selectedEntry.voucher_type}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                Source: <b>{selectedEntry.source_label || selectedEntry.voucher_type}</b>
              </div>
            </div>

            {/* Core Transaction Metadata */}
            <div style={{ border: '1px solid var(--line)', background: 'var(--canvas)' }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--layer)', fontWeight: 600, fontSize: 12 }}>
                Voucher Information
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: 12, fontSize: 13 }}>
                <div>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>Voucher Number:</span>
                  <div className="num" style={{ fontWeight: 600, marginTop: 2 }}>{selectedEntry.voucher_no}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>Voucher Type:</span>
                  <div style={{ marginTop: 2 }}>
                    <Tag kind={selectedEntry.is_opening ? 'blue' : 'gray'}>{selectedEntry.voucher_type}</Tag>
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>Posting Date & Time:</span>
                  <div className="num" style={{ fontWeight: 600, marginTop: 2 }}>
                    {selectedEntry.date} {selectedEntry.time ? `· ${format12HourTime(selectedEntry.time)}` : ''}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>Account / Party:</span>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>
                    {account.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({account.type})</span>
                  </div>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>Against Account (Offset):</span>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>
                    {selectedEntry.against_account || '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Financial Amounts & Impact */}
            <div style={{ border: '1px solid var(--line)', background: 'var(--canvas)' }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--layer)', fontWeight: 600, fontSize: 12 }}>
                Financial Amounts
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Debit (Dr)</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--blue)', marginTop: 4 }}>
                    {money(parseFloat(selectedEntry.debit))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Credit (Cr)</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginTop: 4 }}>
                    {money(parseFloat(selectedEntry.credit))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Resulting Balance</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
                    {money(Math.abs(parseFloat(selectedEntry.running_balance)))}
                    <span
                      style={{
                        fontSize: 12,
                        marginLeft: 6,
                        fontWeight: 600,
                        color: parseFloat(selectedEntry.running_balance) === 0
                          ? 'var(--muted)'
                          : isSupplier
                          ? (parseFloat(selectedEntry.running_balance) > 0 ? 'var(--mild-red, #a03b3b)' : 'var(--blue)')
                          : (parseFloat(selectedEntry.running_balance) > 0 ? 'var(--mild-green, #2d6b3f)' : 'var(--blue)'),
                      }}
                    >
                      {parseFloat(selectedEntry.running_balance) === 0
                        ? '· Settled'
                        : isSupplier
                        ? (parseFloat(selectedEntry.running_balance) > 0 ? 'Cr · Payable' : 'Dr · Advance')
                        : (parseFloat(selectedEntry.running_balance) > 0 ? 'Dr · Receivable' : 'Cr · Advance')}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Narration & Description */}
            <div style={{ border: '1px solid var(--line)', background: 'var(--canvas)' }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--layer)', fontWeight: 600, fontSize: 12 }}>
                Description & Remarks
              </div>
              <div style={{ padding: 12, fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
                {selectedEntry.remarks || 'No specific remarks entered for this voucher.'}
              </div>
            </div>

            {/* Receipt Preview & Breakdown */}
            {(selectedEntry.voucher_type === 'Sales Invoice' || selectedEntry.voucher_type === 'Purchase Invoice') && (
              <div style={{ border: '1px solid var(--line)', background: 'var(--canvas)' }}>
                <div
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--line)',
                    background: 'var(--layer)',
                    fontWeight: 600,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Itemized Receipt Preview</span>
                  {activeSaleDoc && (
                    <Btn
                      variant="ghost"
                      style={{ height: 26, fontSize: 11, padding: '0 8px' }}
                      onClick={() => handlePrintSaleReceipt(activeSaleDoc)}
                    >
                      <IconPrinter size={13} style={{ marginRight: 4 }} />
                      Print Receipt
                    </Btn>
                  )}
                  {activePurchaseDoc && (
                    <Btn
                      variant="ghost"
                      style={{ height: 26, fontSize: 11, padding: '0 8px' }}
                      onClick={() => handlePrintPurchaseBill(activePurchaseDoc)}
                    >
                      <IconPrinter size={13} style={{ marginRight: 4 }} />
                      Print Bill
                    </Btn>
                  )}
                </div>

                {docLoading ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                    Loading receipt details...
                  </div>
                ) : activeSaleDoc ? (
                  <div style={{ padding: 12 }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)', textAlign: 'left' }}>
                          <th style={{ padding: '4px 0', fontWeight: 600 }}>Item</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>Qty</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>Rate</th>
                          <th style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activeSaleDoc.items || []).map((it, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                            <td style={{ padding: '6px 0', fontWeight: 500 }}>{it.productName}</td>
                            <td className="num" style={{ padding: '6px 8px', textAlign: 'right' }}>{it.qty}</td>
                            <td className="num" style={{ padding: '6px 8px', textAlign: 'right' }}>{money(it.rate)}</td>
                            <td className="num" style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600 }}>{money(it.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--muted)' }}>Subtotal</span>
                        <span className="num">{money(activeSaleDoc.subtotal || activeSaleDoc.total)}</span>
                      </div>
                      {!!activeSaleDoc.discount && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ok, #198038)' }}>
                          <span>Discount</span>
                          <span className="num">- {money(activeSaleDoc.discount)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, marginTop: 2 }}>
                        <span>Net Total</span>
                        <span className="num">{money(activeSaleDoc.total)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
                        <span>Settlement</span>
                        <span>
                          {activeSaleDoc.payments && activeSaleDoc.payments.length > 0
                            ? activeSaleDoc.payments.map((p) => `${p.method}: ${money(p.amount)}`).join(' · ')
                            : `${activeSaleDoc.method} · ${money(activeSaleDoc.total)}`}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : activePurchaseDoc ? (
                  <div style={{ padding: 12 }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)', textAlign: 'left' }}>
                          <th style={{ padding: '4px 0', fontWeight: 600 }}>Item</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>Qty</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>Rate</th>
                          <th style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activePurchaseDoc.items || []).map((it, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                            <td style={{ padding: '6px 0', fontWeight: 500 }}>{it.productName}</td>
                            <td className="num" style={{ padding: '6px 8px', textAlign: 'right' }}>{it.qty}</td>
                            <td className="num" style={{ padding: '6px 8px', textAlign: 'right' }}>{money(it.rate)}</td>
                            <td className="num" style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600 }}>{money(it.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}>
                        <span>Bill Total</span>
                        <span className="num">{money(activePurchaseDoc.amount)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: 11 }}>
                        <span>Paid / Balance</span>
                        <span className="num">Paid: {money(activePurchaseDoc.paidAmount)} | Bal: {money(Math.max(0, activePurchaseDoc.amount - activePurchaseDoc.paidAmount))}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: 12, color: 'var(--muted)', fontSize: 12 }}>
                    Receipt details could not be retrieved.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Btn variant="secondary" onClick={() => setSelectedEntry(null)}>
                Close Details
              </Btn>
            </div>
          </div>
        )}
      </Drawer>

      <AccountPaymentModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        shopId={shopId}
        accounts={d.accounts || []}
        preselectedAccountId={accountId}
        defaultDirection={paymentDirection}
        onSuccess={() => {
          fetchLedger();
          d.refresh();
        }}
      />
    </div>
  );
}
