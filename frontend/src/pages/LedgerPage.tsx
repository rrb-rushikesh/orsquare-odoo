import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useData } from '@/data/DataProvider';
import {
  getTrialBalance,
  getProfitLoss,
  getBalanceSheet,
  listAccounts,
  type PAccount,
  type TrialBalanceResponse,
  type ProfitLossResponse,
  type BalanceSheetResponse,
} from '@/lib/repo';
import { money } from '@/lib/utils';
import { todayKey } from '@/lib/clock';
import {
  NoAccess,
  Btn,
  EmptyState,
  Panel,
  Tag,
  Tile,
  Drawer,
  useToast,
} from '@/components/ui';
import { IconRefresh } from '@/components/icons';
import { AccountLedgerView } from '@/components/accounts/AccountLedgerView';
import { DateRangeFilter, useDateRange } from '@/components/DateRangeFilter';

type LedgerTab =
  | 'account'
  | 'trial_balance'
  | 'profit_loss'
  | 'balance_sheet'
  | 'receivables'
  | 'payables'
  | 'cash_flow';

export default function LedgerPage() {
  const { wsUid, can } = useAuth();
  const d = useData();
  const toast = useToast();
  const shopId = wsUid;

  const [activeTab, setActiveTab] = useState<LedgerTab>('account');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [drawerAccountId, setDrawerAccountId] = useState<string | null>(null);

  // Account Ledger Tab: default to first customer or account
  useEffect(() => {
    if (!selectedAccountId && d.accounts.length > 0) {
      setSelectedAccountId(d.accounts[0].id);
    }
  }, [d.accounts, selectedAccountId]);

  // Trial Balance state
  const [tbDateState, setTbDateState, tbEffDate] = useDateRange('today');
  const [tbData, setTbData] = useState<TrialBalanceResponse | null>(null);
  const [tbLoading, setTbLoading] = useState(false);

  // Profit & Loss state
  const [plDateState, setPlDateState, plEffDate] = useDateRange('all');
  const [plData, setPlData] = useState<ProfitLossResponse | null>(null);
  const [plLoading, setPlLoading] = useState(false);

  // Balance Sheet state
  const [bsDateState, setBsDateState, bsEffDate] = useDateRange('today');
  const [bsData, setBsData] = useState<BalanceSheetResponse | null>(null);
  const [bsLoading, setBsLoading] = useState(false);

  // Load Trial Balance
  const loadTrialBalance = async () => {
    if (!shopId) return;
    setTbLoading(true);
    try {
      const asOf = tbEffDate.to || tbEffDate.from || todayKey();
      const res = await getTrialBalance(shopId, { as_of: asOf });
      setTbData(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load Trial Balance', 'err');
    } finally {
      setTbLoading(false);
    }
  };

  // Load Profit & Loss
  const loadProfitLoss = async () => {
    if (!shopId) return;
    setPlLoading(true);
    try {
      const res = await getProfitLoss(shopId, {
        from: plEffDate.from || undefined,
        to: plEffDate.to || undefined,
      });
      setPlData(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load Profit & Loss', 'err');
    } finally {
      setPlLoading(false);
    }
  };

  // Load Balance Sheet
  const loadBalanceSheet = async () => {
    if (!shopId) return;
    setBsLoading(true);
    try {
      const asOf = bsEffDate.to || bsEffDate.from || todayKey();
      const res = await getBalanceSheet(shopId, { as_of: asOf });
      setBsData(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load Balance Sheet', 'err');
    } finally {
      setBsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'trial_balance') {
      loadTrialBalance();
    } else if (activeTab === 'profit_loss') {
      loadProfitLoss();
    } else if (activeTab === 'balance_sheet') {
      loadBalanceSheet();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tbEffDate.from, tbEffDate.to, plEffDate.from, plEffDate.to, bsEffDate.from, bsEffDate.to]);

  // Control accounts (Cash, UPI/Bank, and the other system accounts) live
  // OUTSIDE the party register - the accounts endpoint filters is_system=False
  // by default and no caller ever asked for them. So `d.accounts` could never
  // contain a Cash account, `cashAccount` was always undefined, and the "Cash
  // in hand" / "UPI / Bank balance" tiles read a permanent 0.00 for every
  // shop while the trial balance on the same screen showed real money. They are
  // now fetched explicitly, with the server's ledger-derived balance.
  const [controlAccounts, setControlAccounts] = useState<PAccount[]>([]);
  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    listAccounts(shopId, { includeSystem: true })
      .then((rows) => { if (alive) setControlAccounts(rows) })
      .catch(() => { if (alive) setControlAccounts([]) });
    return () => { alive = false };
  }, [shopId, d.accounts]);

  const cashAccount = useMemo(() => {
    return controlAccounts.find((x) => x.type === 'Cash' || x.code === 'SYS-CASH');
  }, [controlAccounts]);

  const bankAccount = useMemo(() => {
    return controlAccounts.find((x) => x.type === 'Bank' || x.code === 'SYS-UPI');
  }, [controlAccounts]);

  const cashBalance = cashAccount?.balance ?? NaN;
  const bankBalance = bankAccount?.balance ?? NaN;

  const [nativeCash, setNativeCash] = useState<any>(null);
  useEffect(() => { let alive=true; import('@/lib/repo').then(r=>r.cashRegister()).then(r=>{if(alive)setNativeCash(r)}).catch(()=>{if(alive)setNativeCash(null)}); return ()=>{alive=false}; }, [shopId, d.accounts]);
  const cashFlowMetrics = { directSalesInflow: nativeCash?.sales_in ?? NaN,
    khataReceiptsInflow: nativeCash?.receipts_in ?? NaN, purchasePaidOutflow: nativeCash?.payments_out ?? NaN,
    debtDisbursementsOutflow: NaN, operatingExpensesOutflow: nativeCash?.expenses_out ?? NaN,
    totalInflow: nativeCash?.cash_in ?? NaN, totalOutflow: nativeCash?.cash_out ?? NaN };

  // Derived Receivables & Payables lists, from the server's authoritative
  // role. These used to filter on `type` and sort/colour by the SIGN, which
  // admitted negative balances: a customer who had paid in advance appeared in
  // the Sundry Debtors register as money "You'll Get", and a pre-paid supplier
  // appeared in Sundry Creditors as money "You'll Give" - the exact opposite of
  // what each is. The totals then applied a `> 0` test the rows did not, so the
  // footer did not add up to the list above it.
  const receivables = useMemo(() => {
    return d.accounts
      .filter((a) => a.isReceivable)
      .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
  }, [d.accounts]);

  const payables = useMemo(() => {
    return d.accounts
      .filter((a) => a.isPayable)
      .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
  }, [d.accounts]);

  // Totals count exactly the rows listed - same source, same filter.
  const totalReceivables = useMemo(
    () => receivables.reduce((sum, a) => sum + (a.balance ?? 0), 0),
    [receivables]
  );

  const totalPayables = useMemo(
    () => payables.reduce((sum, a) => sum + (a.balance ?? 0), 0),
    [payables]
  );

  if (!can('accounts')) return <NoAccess what="Ledger" />;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        {/* Tab switch bar */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', width: '100%' }}>
          {[
            { id: 'account', label: 'General Ledger' },
            { id: 'trial_balance', label: 'Trial Balance' },
            { id: 'profit_loss', label: 'Profit & Loss' },
            { id: 'balance_sheet', label: 'Balance Sheet' },
            { id: 'receivables', label: `Receivables (${receivables.length})` },
            { id: 'payables', label: `Payables (${payables.length})` },
            { id: 'cash_flow', label: 'Cash Flow' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--blue)' : '2px solid transparent',
                color: activeTab === tab.id ? 'var(--blue)' : 'var(--muted)',
                fontWeight: 600,
                padding: '8px 14px',
                cursor: 'pointer',
                fontSize: 13,
                borderRadius: 0,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              onClick={() => setActiveTab(tab.id as LedgerTab)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: General Ledger / Account Statement */}
      {activeTab === 'account' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="tiles tiles-4">
            <Tile
              label="Cash in hand"
              value={money(cashBalance)}
              note="Operating cash account"
            />
            <Tile
              label="UPI / Bank balance"
              value={money(bankBalance)}
              note="Digital & bank accounts"
            />
            <Tile
              label="Receivables (You'll Get)"
              value={<span style={{ color: 'var(--ok, #198038)' }}>{money(totalReceivables)}</span>}
              note={`${receivables.length} accounts`}
            />
            <Tile
              label="Payables (You'll Give)"
              value={<span style={{ color: 'var(--err, #da1e28)' }}>{money(totalPayables)}</span>}
              note={`${payables.length} accounts`}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
              background: 'var(--canvas)',
              border: '1px solid var(--line)',
              flexWrap: 'wrap',
            }}
          >
            <label style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Select Account:</label>
            <select
              className="field-control"
              style={{ maxWidth: 380, width: '100%', flex: '1 1 200px', height: 34, fontSize: 13 }}
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            >
              {d.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type}) {a.code ? `[${a.code}]` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedAccountId ? (
            <div style={{ border: '1px solid var(--line)', background: 'var(--canvas)' }}>
              <AccountLedgerView shopId={shopId} accountId={selectedAccountId} />
            </div>
          ) : (
            <EmptyState title="No account selected" hint="Select an account from the dropdown above to view its statement." />
          )}
        </div>
      )}

      {/* TAB 2: Trial Balance */}
      {activeTab === 'trial_balance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              padding: '10px 16px',
              background: 'var(--canvas)',
              border: '1px solid var(--line)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DateRangeFilter state={tbDateState} onChange={setTbDateState} align="left" />
              <Btn variant="ghost" className="btn-icon" title="Refresh" onClick={loadTrialBalance} style={{ width: 32, height: 32 }}>
                <IconRefresh size={16} />
              </Btn>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {tbData && (
                <Tag kind={tbData.is_balanced ? 'green' : 'warn'}>
                  {tbData.is_balanced ? 'Debit = Credit (Balanced)' : 'Out of Balance'}
                </Tag>
              )}
            </div>
          </div>

          {tbLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', background: 'var(--canvas)', border: '1px solid var(--line)' }}>Loading Trial Balance...</div>
          ) : !tbData || tbData.rows.length === 0 ? (
            <EmptyState title="No transactions recorded" hint="Trial balance will reflect entries as soon as sales, purchases, or opening entries are posted." />
          ) : (
            <div className="tbl-scroll" style={{ border: '1px solid var(--line)', background: 'var(--canvas)', overflowX: 'auto', width: '100%' }}>
              <table className="tbl data-table" style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--layer)' }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left' }}>Account</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 140 }}>Code</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 130 }}>Type</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', width: 160 }}>Debit (₹)</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', width: 160 }}>Credit (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {tbData.rows.map((row) => (
                    <tr
                      key={row.account_id}
                      onClick={() => setDrawerAccountId(row.account_id)}
                      title="Click to view full account statement"
                      style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                      className="ledger-row"
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--blue)' }}>{row.name}</td>
                      <td style={{ padding: '12px 14px' }} className="num">{row.code || '—'}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <Tag kind="gray">{row.type}</Tag>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                        {parseFloat(row.debit) > 0 ? (
                          <span style={{ color: 'var(--dr-fg)', fontWeight: 600 }}>{money(parseFloat(row.debit))}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                        {parseFloat(row.credit) > 0 ? (
                          // Same --cr token as the statement drawer's credit
                          // column. This used to be --fin-pay (red) while Dr was
                          // --fin-rec (green), and the account statement drew
                          // the identical Dr figure in --err (red) - so the same
                          // number was green here and red one tab over.
                          <span style={{ color: 'var(--cr-fg)', fontWeight: 600 }}>{money(parseFloat(row.credit))}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--layer)', borderTop: '2px solid var(--line)', fontWeight: 600 }}>
                    <td style={{ padding: '12px 16px' }} colSpan={3}>
                      Total (Trial Balance)
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-rec)', fontWeight: 600 }}>{money(parseFloat(tbData.total_debit))}</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-pay)', fontWeight: 600 }}>{money(parseFloat(tbData.total_credit))}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Profit & Loss */}
      {activeTab === 'profit_loss' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              padding: '10px 16px',
              background: 'var(--canvas)',
              border: '1px solid var(--line)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DateRangeFilter state={plDateState} onChange={setPlDateState} align="left" />
              <Btn variant="ghost" className="btn-icon" title="Refresh" onClick={loadProfitLoss} style={{ width: 32, height: 32 }}>
                <IconRefresh size={16} />
              </Btn>
            </div>
          </div>

          {plLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', background: 'var(--canvas)', border: '1px solid var(--line)' }}>Loading Profit & Loss...</div>
          ) : !plData ? (
            <EmptyState title="No financial data" hint="Post sales and expenses to view profit & loss analysis." />
          ) : (
            <>
              {/* Net Profit Banner */}
              <div
                style={{
                  border: '1px solid var(--line)',
                  background: 'var(--layer)',
                  padding: '16px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>
                    Net {parseFloat(plData.net_profit) >= 0 ? 'Profit' : 'Loss'}
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      marginTop: 4,
                      color: parseFloat(plData.net_profit) >= 0 ? 'var(--fin-rec)' : 'var(--fin-pay)',
                    }}
                    className="num"
                  >
                    {money(Math.abs(parseFloat(plData.net_profit)))}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--muted)' }}>
                  <div>Total Revenue: <b className="num" style={{ color: 'var(--fin-rec)' }}>{money(parseFloat(plData.total_income))}</b></div>
                  <div style={{ marginTop: 2 }}>Total Expenses: <b className="num" style={{ color: 'var(--fin-pay)' }}>{money(parseFloat(plData.total_expenses))}</b></div>
                </div>
              </div>

              {/* Income & Expense Breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                {/* Income */}
                <Panel title="Income / Revenue">
                  <div className="tbl-scroll" style={{ overflowX: 'auto', width: '100%' }}>
                    <table className="tbl data-table" style={{ width: '100%', minWidth: 300, borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--layer)' }}>
                          <th style={{ padding: '9px 12px', textAlign: 'left' }}>Income Head</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right', width: 140 }}>Amount (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plData.income.length === 0 ? (
                          <tr>
                            <td colSpan={2} style={{ padding: 16, textAlign: 'center', color: 'var(--subtle)' }}>No revenue entries</td>
                          </tr>
                        ) : (
                          plData.income.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td style={{ padding: '9px 12px', fontWeight: 500 }}>{item.name}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right' }} className="num">
                                <span style={{ color: 'var(--fin-rec)', fontWeight: 600 }}>{money(parseFloat(item.amount))}</span>
                              </td>
                            </tr>
                          ))
                        )}
                        <tr style={{ background: 'var(--layer)', fontWeight: 600, borderTop: '2px solid var(--line)' }}>
                          <td style={{ padding: '9px 12px' }}>Total Revenue</td>
                          <td style={{ padding: '9px 12px', textAlign: 'right' }} className="num">
                            <span style={{ color: 'var(--fin-rec)', fontWeight: 600 }}>{money(parseFloat(plData.total_income))}</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Panel>

                {/* Expenses */}
                <Panel title="Operating Expenses & Cost">
                  <div className="tbl-scroll" style={{ overflowX: 'auto', width: '100%' }}>
                    <table className="tbl data-table" style={{ width: '100%', minWidth: 300, borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--layer)' }}>
                          <th style={{ padding: '9px 12px', textAlign: 'left' }}>Expense Head</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right', width: 140 }}>Amount (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plData.expenses.length === 0 ? (
                          <tr>
                            <td colSpan={2} style={{ padding: 16, textAlign: 'center', color: 'var(--subtle)' }}>No expense entries</td>
                          </tr>
                        ) : (
                          plData.expenses.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td style={{ padding: '9px 12px', fontWeight: 500 }}>{item.name}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right' }} className="num">
                                <span style={{ color: 'var(--fin-pay)', fontWeight: 600 }}>{money(parseFloat(item.amount))}</span>
                              </td>
                            </tr>
                          ))
                        )}
                        <tr style={{ background: 'var(--layer)', fontWeight: 600, borderTop: '2px solid var(--line)' }}>
                          <td style={{ padding: '9px 12px' }}>Total Expenses</td>
                          <td style={{ padding: '9px 12px', textAlign: 'right' }} className="num">
                            <span style={{ color: 'var(--fin-pay)', fontWeight: 600 }}>{money(parseFloat(plData.total_expenses))}</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 4: Balance Sheet */}
      {activeTab === 'balance_sheet' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              padding: '10px 16px',
              background: 'var(--canvas)',
              border: '1px solid var(--line)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DateRangeFilter state={bsDateState} onChange={setBsDateState} align="left" />
              <Btn variant="ghost" className="btn-icon" title="Refresh" onClick={loadBalanceSheet} style={{ width: 32, height: 32 }}>
                <IconRefresh size={16} />
              </Btn>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {bsData && (
                <Tag kind={bsData.is_balanced ? 'green' : 'warn'}>
                  {bsData.is_balanced ? 'Assets = Liab + Equity (Balanced)' : 'Discrepancy'}
                </Tag>
              )}
            </div>
          </div>

          {bsLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', background: 'var(--canvas)', border: '1px solid var(--line)' }}>Loading Balance Sheet...</div>
          ) : !bsData ? (
            <EmptyState title="No financial data" hint="Post opening entries or transactions to generate Balance Sheet." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
              {/* Assets Panel */}
              <Panel title="Assets">
                <div className="tbl-scroll" style={{ overflowX: 'auto', width: '100%' }}>
                  <table className="tbl data-table" style={{ width: '100%', minWidth: 320, borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--layer)' }}>
                        <th style={{ padding: '10px 14px', textAlign: 'left' }}>Asset Account</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', width: 120 }}>Type</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right', width: 140 }}>Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bsData.assets.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ padding: 16, textAlign: 'center', color: 'var(--subtle)' }}>No assets</td>
                        </tr>
                      ) : (
                        bsData.assets.map((a, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                            <td style={{ padding: '10px 14px', fontWeight: 500 }}>{a.name}</td>
                            <td style={{ padding: '10px 14px' }}><Tag kind="teal">{a.type}</Tag></td>
                            <td style={{ padding: '10px 14px', textAlign: 'right' }} className="num">
                              <span style={{ color: 'var(--fin-rec)', fontWeight: 600 }}>{money(parseFloat(a.amount))}</span>
                            </td>
                          </tr>
                        ))
                      )}
                      <tr style={{ background: 'var(--layer)', fontWeight: 600, borderTop: '2px solid var(--line)' }}>
                        <td style={{ padding: '12px 14px' }} colSpan={2}>Total Assets</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }} className="num">
                          <span style={{ color: 'var(--fin-rec)', fontWeight: 600 }}>{money(parseFloat(bsData.total_assets))}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Panel>

              {/* Liabilities & Equity Panel */}
              <Panel title="Liabilities & Equity">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Liabilities Table */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      Liabilities
                    </div>
                    <div className="tbl-scroll" style={{ overflowX: 'auto', width: '100%' }}>
                      <table className="tbl data-table" style={{ width: '100%', minWidth: 300, borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--layer)' }}>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Liability</th>
                            <th style={{ padding: '8px 12px', textAlign: 'right', width: 140 }}>Amount (₹)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bsData.liabilities.length === 0 ? (
                            <tr>
                              <td colSpan={2} style={{ padding: 12, textAlign: 'center', color: 'var(--subtle)' }}>No liabilities</td>
                            </tr>
                          ) : (
                            bsData.liabilities.map((l, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '8px 12px' }}>{l.name}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }} className="num">
                                  <span style={{ color: 'var(--fin-pay)', fontWeight: 600 }}>{money(parseFloat(l.amount))}</span>
                                </td>
                              </tr>
                            ))
                          )}
                          <tr style={{ background: 'var(--layer)', fontWeight: 600 }}>
                            <td style={{ padding: '8px 12px' }}>Total Liabilities</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }} className="num">
                              <span style={{ color: 'var(--fin-pay)', fontWeight: 600 }}>{money(parseFloat(bsData.total_liabilities))}</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Equity Table */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      Equity & Capital
                    </div>
                    <div className="tbl-scroll" style={{ overflowX: 'auto', width: '100%' }}>
                      <table className="tbl data-table" style={{ width: '100%', minWidth: 300, borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--layer)' }}>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Equity Head</th>
                            <th style={{ padding: '8px 12px', textAlign: 'right', width: 140 }}>Amount (₹)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bsData.equity.length === 0 ? (
                            <tr>
                              <td colSpan={2} style={{ padding: 12, textAlign: 'center', color: 'var(--subtle)' }}>No equity heads</td>
                            </tr>
                          ) : (
                            bsData.equity.map((eq, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '8px 12px' }}>{eq.name}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }} className="num">{money(parseFloat(eq.amount))}</td>
                              </tr>
                            ))
                          )}
                          <tr style={{ background: 'var(--layer)', fontWeight: 600 }}>
                            <td style={{ padding: '8px 12px' }}>Total Equity</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }} className="num">
                              {money(parseFloat(bsData.total_equity))}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Total Liabilities & Equity Row */}
                  <div
                    style={{
                      borderTop: '2px solid var(--line)',
                      background: 'var(--layer)',
                      padding: '12px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <span>Total Liabilities & Equity</span>
                    <span className="num" style={{ color: 'var(--blue)' }}>
                      {money(parseFloat(bsData.total_liabilities_and_equity))}
                    </span>
                  </div>
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: Receivables (Debtors) */}
      {activeTab === 'receivables' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Customer Receivables Register (Sundry Debtors)">
            <div className="tbl-scroll" style={{ overflowX: 'auto', width: '100%' }}>
              <table className="tbl data-table" style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--layer)' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 50 }}>#</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left' }}>Customer Name</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 140 }}>Code</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 140 }}>Mobile</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', width: 180 }}>Receivable (You'll Get)</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', width: 110 }}>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                        No outstanding customer receivables.
                      </td>
                    </tr>
                  ) : (
                    receivables.map((c, idx) => (
                      <tr
                        key={c.id}
                        onClick={() => setDrawerAccountId(c.id)}
                        title="Click to view detailed customer ledger"
                        style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                        className="ledger-row"
                      >
                        <td style={{ padding: '12px 14px', color: 'var(--muted)' }} className="num">{idx + 1}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--blue)' }}>{c.name}</td>
                        <td style={{ padding: '12px 14px' }} className="num">{c.code || '—'}</td>
                        <td style={{ padding: '12px 14px' }} className="num">{c.phone || '—'}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                          <span style={{ color: 'var(--rec-fg)', fontWeight: 600 }}>{money(c.balance ?? 0)}</span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          {/* From the server's role, and only a genuine receivable
                              reaches this register now - an advance used to be
                              listed here as a green "You'll Get". */}
                          <Tag kind="green">● You'll Get</Tag>
                        </td>
                      </tr>
                    ))
                  )}
                  <tr style={{ background: 'var(--layer)', fontWeight: 600, borderTop: '2px solid var(--line)' }}>
                    <td style={{ padding: '12px 14px' }} colSpan={4}>
                      Total Customer Receivables (You'll Get)
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-rec)', fontWeight: 600, fontSize: 14 }}>{money(totalReceivables)}</span>
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* TAB 6: Payables (Creditors) */}
      {activeTab === 'payables' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Supplier Payables Register (Sundry Creditors)">
            <div className="tbl-scroll" style={{ overflowX: 'auto', width: '100%' }}>
              <table className="tbl data-table" style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--layer)' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 50 }}>#</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left' }}>Supplier Name</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 140 }}>Code</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 140 }}>Mobile</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', width: 180 }}>Payable (You'll Give)</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', width: 110 }}>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {payables.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                        No outstanding supplier payables.
                      </td>
                    </tr>
                  ) : (
                    payables.map((s, idx) => (
                      <tr
                        key={s.id}
                        onClick={() => setDrawerAccountId(s.id)}
                        title="Click to view detailed supplier ledger"
                        style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                        className="ledger-row"
                      >
                        <td style={{ padding: '12px 14px', color: 'var(--muted)' }} className="num">{idx + 1}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--blue)' }}>{s.name}</td>
                        <td style={{ padding: '12px 14px' }} className="num">{s.code || '—'}</td>
                        <td style={{ padding: '12px 14px' }} className="num">{s.phone || '—'}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                          <span style={{ color: 'var(--pay-fg)', fontWeight: 600 }}>{money(s.balance ?? 0)}</span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <Tag kind="red">● You'll Give</Tag>
                        </td>
                      </tr>
                    ))
                  )}
                  <tr style={{ background: 'var(--layer)', fontWeight: 600, borderTop: '2px solid var(--line)' }}>
                    <td style={{ padding: '12px 14px' }} colSpan={4}>
                      Total Supplier Payables (You'll Give)
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-pay)', fontWeight: 600, fontSize: 14 }}>{money(totalPayables)}</span>
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* TAB 7: Cash Flow Statement */}
      {activeTab === 'cash_flow' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Cash Flow Statement (Operations & Settlements)">
            <div style={{ padding: '12px 16px', background: 'var(--layer)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                Cash and Bank settlements recorded from sales, receipts, and supplier disbursements.
              </span>
              <Btn variant="ghost" className="btn-icon" title="Refresh" onClick={() => d.refresh()} style={{ width: 32, height: 32 }}>
                <IconRefresh size={16} />
              </Btn>
            </div>

            <div className="tbl-scroll" style={{ overflowX: 'auto', width: '100%' }}>
              <table className="tbl data-table" style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--canvas)' }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left' }}>Cash Flow Head / Category</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', width: 140 }}>Type</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', width: 180 }}>Inflow (+)</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', width: 180 }}>Outflow (-)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    onClick={() => { if (cashAccount) setDrawerAccountId(cashAccount.id); }}
                    title="Click to view Cash ledger entries"
                    style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                    className="ledger-row"
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--blue)' }}>Customer Cash & UPI Sales</td>
                    <td style={{ padding: '12px 14px' }}><Tag kind="green">Operating Inflow</Tag></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-rec)', fontWeight: 600 }}>{money(cashFlowMetrics.directSalesInflow)}</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">—</td>
                  </tr>
                  <tr
                    onClick={() => { if (cashAccount) setDrawerAccountId(cashAccount.id); }}
                    title="Click to view Cash ledger entries"
                    style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                    className="ledger-row"
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--blue)' }}>Customer Khata Repayments (Receipts)</td>
                    <td style={{ padding: '12px 14px' }}><Tag kind="green">Settlement Inflow</Tag></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-rec)', fontWeight: 600 }}>{money(cashFlowMetrics.khataReceiptsInflow)}</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">—</td>
                  </tr>
                  <tr
                    onClick={() => { if (cashAccount) setDrawerAccountId(cashAccount.id); }}
                    title="Click to view Cash ledger entries"
                    style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                    className="ledger-row"
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--blue)' }}>Supplier Purchases (Cash & UPI Paid)</td>
                    <td style={{ padding: '12px 14px' }}><Tag kind="red">Operating Outflow</Tag></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">—</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-pay)', fontWeight: 600 }}>{money(cashFlowMetrics.purchasePaidOutflow)}</span>
                    </td>
                  </tr>
                  <tr
                    onClick={() => { if (bankAccount || cashAccount) setDrawerAccountId((bankAccount || cashAccount)!.id); }}
                    title="Click to view Bank/Cash ledger entries"
                    style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                    className="ledger-row"
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--blue)' }}>Supplier Debt Disbursements (Payment Vouchers)</td>
                    <td style={{ padding: '12px 14px' }}><Tag kind="red">Settlement Outflow</Tag></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">—</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-pay)', fontWeight: 600 }}>{money(cashFlowMetrics.debtDisbursementsOutflow)}</span>
                    </td>
                  </tr>
                  <tr
                    onClick={() => { if (cashAccount) setDrawerAccountId(cashAccount.id); }}
                    title="Click to view Cash ledger entries"
                    style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                    className="ledger-row"
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--blue)' }}>Store Rent & Operating Utilities</td>
                    <td style={{ padding: '12px 14px' }}><Tag kind="red">Expense Outflow</Tag></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">—</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-pay)', fontWeight: 600 }}>{money(cashFlowMetrics.operatingExpensesOutflow)}</span>
                    </td>
                  </tr>
                  <tr style={{ background: 'var(--layer)', fontWeight: 600, borderTop: '2px solid var(--line)' }}>
                    <td style={{ padding: '12px 16px' }} colSpan={2}>
                      Net Operating Cash Movement
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-rec)', fontWeight: 600 }}>{money(cashFlowMetrics.totalInflow)}</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }} className="num">
                      <span style={{ color: 'var(--fin-pay)', fontWeight: 600 }}>{money(cashFlowMetrics.totalOutflow)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* Account Detail & Ledger Statement Drawer */}
      <Drawer
        open={!!drawerAccountId}
        title="Account Statement & Ledger"
        onClose={() => setDrawerAccountId(null)}
        xwide
      >
        {drawerAccountId && (
          <AccountLedgerView shopId={shopId} accountId={drawerAccountId} />
        )}
      </Drawer>
    </>
  );
}
