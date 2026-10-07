import { useState, useMemo } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useData } from '@/data/DataProvider';
import { createAccount, updateAccount, deleteAccount, type PAccount } from '@/lib/repo';
import { money, payablesOf, receivablesOf } from '@/lib/utils';
import { searchAccounts } from '@/lib/search';
import { todayKey } from '@/lib/clock';
import { ACCOUNT_TYPES, OWNER_ACCOUNT_TYPES, type AccountType } from '@/types';
import {
  NoAccess,
  Btn,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  NumInput,
  Tag,
  useToast,
} from '@/components/ui';
import { PhoneInput } from '@/components/PhoneInput';
import { DEFAULT_DIAL, isValidNational } from '@/lib/phone';
import { AccountLedgerView } from '@/components/accounts/AccountLedgerView';
import { IconPlus, IconRupee } from '@/components/icons';
import { AccountPaymentModal } from '@/components/accounts/AccountPaymentModal';

type SortOption = 'name' | 'balance' | 'receivable' | 'payable' | 'type';

type Draft = {
  id?: string;
  name: string;
  type: AccountType;
  phone: string;
  countryCode: string;
  opening: number;
  balance: number;
  active: boolean;
  openingType?: 'Debit' | 'Credit';
  openingDate?: string;
};

const blank = (defaultType: AccountType = 'Customer'): Draft => ({
  name: '',
  type: defaultType,
  phone: '',
  countryCode: DEFAULT_DIAL,
  opening: 0,
  balance: 0,
  active: true,
  openingType: defaultType === 'Supplier' ? 'Credit' : 'Debit',
  openingDate: todayKey(),
});

const TYPE_TAG: Record<string, string> = {
  Customer: 'gray',
  Supplier: 'blue',
  Employee: 'gray',
  Retailer: 'purple',
};

function AdvancedAccountsPage() {
  const { wsUid, user, activeShop } = useAuth();
  const d = useData();
  const toast = useToast();
  const shopId = wsUid;
  const isOwner = activeShop?.role === 'owner';
  const isMultiShopOwner = isOwner && (user?.shops?.length ?? 0) > 1;
  const accountTypes = useMemo(() => (isMultiShopOwner ? OWNER_ACCOUNT_TYPES : ACCOUNT_TYPES), [isMultiShopOwner]);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | string>('All');
  const [sortBy, setSortBy] = useState<SortOption>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'ledger'>('list');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentTargetId, setPaymentTargetId] = useState<string | null>(null);

  const operationalAccounts = useMemo(() => {
    return d.accounts.filter((a) => accountTypes.includes(a.type as AccountType));
  }, [d.accounts, accountTypes]);

  const filtered = useMemo(() => {
    let list = operationalAccounts.filter((a) => {
      if (typeFilter !== 'All' && a.type !== typeFilter) return false;
      return true;
    });
    const q = search.trim();
    if (q) {
      list = searchAccounts(list, q);
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'balance') return Math.abs(b.balance ?? 0) - Math.abs(a.balance ?? 0);
      // Sorted by the server's authoritative role rather than by re-deriving
      // "receivable" from the sign and a `type === 'Supplier'` test. That test
      // made an Employee account sort as a receivable, and any negative
      // balance flipped sides.
      if (sortBy === 'receivable') {
        const aRec = a.isReceivable ? (a.balance ?? 0) : -1;
        const bRec = b.isReceivable ? (b.balance ?? 0) : -1;
        return bRec - aRec;
      }
      if (sortBy === 'payable') {
        const aPay = a.isPayable ? (a.balance ?? 0) : -1;
        const bPay = b.isPayable ? (b.balance ?? 0) : -1;
        return bPay - aPay;
      }
      if (sortBy === 'type') return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
      return 0;
    });
  }, [operationalAccounts, search, typeFilter, sortBy]);

  // Default select first account if none selected
  const activeSelectedId = selectedId || (filtered.length > 0 ? filtered[0].id : null);
  const selectedAccount = useMemo(
    () => operationalAccounts.find((a) => a.id === activeSelectedId),
    [operationalAccounts, activeSelectedId]
  );

  const summary = useMemo(() => {
    const debtors = receivablesOf(filtered);
    const creditors = payablesOf(filtered);
    return { count: filtered.length, debtors, creditors };
  }, [filtered]);

  async function save() {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast('Account name is required.', 'err');
      return;
    }
    if (!editing.id && !isValidNational(editing.phone)) {
      toast('Enter a valid phone number (4–15 digits).', 'err');
      return;
    }
    if (editing.phone && !isValidNational(editing.phone)) {
      toast('Enter a valid phone number (4–15 digits).', 'err');
      return;
    }
    setBusy(true);
    try {
      if (editing.id) {
        await updateAccount(shopId, editing.id, {
          name: editing.name.trim(),
          phone: editing.phone.trim(),
          country_code: editing.countryCode || DEFAULT_DIAL,
          is_active: editing.active,
        });
        toast('Account updated.');
      } else {
        const created = await createAccount(shopId, {
          name: editing.name.trim(),
          type: editing.type,
          phone: editing.phone.trim(),
          country_code: editing.countryCode || DEFAULT_DIAL,
          opening_balance: editing.opening > 0 ? editing.opening : undefined,
          opening_balance_type: editing.opening > 0 ? (editing.openingType || 'Debit') : undefined,
          opening_date: editing.opening > 0 ? (editing.openingDate || todayKey()) : undefined,
        });
        toast(`${editing.type} account created.`);
        if (created?.id) setSelectedId(created.id);
      }
      setEditing(null);
      await d.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirmId) return;
    setBusy(true);
    try {
      await deleteAccount(shopId, confirmId);
      toast('Account deleted.');
      setConfirmId(null);
      setEditing(null);
      if (selectedId === confirmId) setSelectedId(null);
      await d.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Joined Two-Pane Workspace Layout (Spacious, balanced enterprise grid) */}
      <div
        className={`accounts-workspace ${mobileView === 'ledger' && activeSelectedId ? 'mobile-show-ledger' : 'mobile-show-list'}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '380px 1fr',
          border: '1px solid var(--line)',
          background: 'var(--canvas)',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Left Pane: Account List */}
        <div
          className="accounts-workspace-list"
          style={{
            borderRight: '1px solid var(--line)',
            background: 'var(--canvas)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* List Search & Add Account + Pay Buttons */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 6, alignItems: 'center', background: 'var(--canvas)', flexShrink: 0 }}>
            <input
              type="text"
              className="field-control"
              placeholder="Search accounts or mobile…"
              style={{ fontSize: 13, height: 34, flex: 1, padding: '0 10px' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Btn
              variant="primary"
              className="btn-icon"
              style={{ width: 34, height: 34, padding: 0 }}
              onClick={() => setEditing(blank())}
              title="Add new account"
            >
              <IconPlus size={16} />
            </Btn>
            <Btn
              variant="secondary"
              className="btn-icon"
              style={{ width: 34, height: 34, padding: 0, fontWeight: 700 }}
              onClick={() => {
                setPaymentTargetId(null);
                setPaymentModalOpen(true);
              }}
              title="Record payment or receipt"
            >
              <IconRupee size={16} />
            </Btn>
          </div>

          {/* Category Filter Chips & Sort Select */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--layer)', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', overflowX: 'auto', scrollbarWidth: 'none' }}>
              <button
                type="button"
                style={{
                  border: '1px solid var(--line)',
                  background: typeFilter === 'All' ? 'var(--blue)' : 'var(--canvas)',
                  color: typeFilter === 'All' ? '#ffffff' : 'var(--ink)',
                  padding: '4px 8px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  borderRadius: 0,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                onClick={() => setTypeFilter('All')}
              >
                All ({operationalAccounts.length})
              </button>
              {accountTypes.map((t) => {
                const count = operationalAccounts.filter((a) => a.type === t).length;
                const active = typeFilter === t;
                return (
                  <button
                    key={t}
                    type="button"
                    style={{
                      border: '1px solid var(--line)',
                      background: active ? 'var(--blue)' : 'var(--canvas)',
                      color: active ? '#ffffff' : 'var(--ink)',
                      padding: '4px 8px',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      borderRadius: 0,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                    onClick={() => setTypeFilter(t)}
                  >
                    {t} ({count})
                  </button>
                );
              })}
            </div>

            {/* Sort & Count row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
              <span>
                <b>{filtered.length}</b> {filtered.length === 1 ? 'account' : 'accounts'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Sort:</span>
                <select
                  className="field-control"
                  style={{ height: 28, fontSize: 12, padding: '0 8px', width: 'auto', background: 'var(--canvas)' }}
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                >
                  <option value="name">Name (A–Z)</option>
                  <option value="balance">Balance (Highest)</option>
                  <option value="receivable">Receivables (Highest)</option>
                  <option value="payable">Payables (Highest)</option>
                  <option value="type">Account Type</option>
                </select>
              </div>
            </div>
          </div>

          {/* Accounts Scrollable List */}
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                No accounts match the filter.
              </div>
            ) : (
              filtered.map((acc: PAccount) => {
                const isSelected = acc.id === activeSelectedId;
                const balNum = acc.balance ?? 0;
                // Authoritative, from accounts/selectors.py. This block
                // re-derived all three from `type === 'Supplier'` and the sign,
                // which classified an Employee as a receivable (green "You'll
                // Get") and, on the row's pill below, painted an advance - which
                // it coloured BLUE - on a background that only had a red branch
                // for. Blue text on a red pill.
                const isReceivable = acc.isReceivable;
                const isPayable = acc.isPayable;
                const statusText = acc.balanceHidden
                  ? 'Restricted'
                  : balNum === 0
                  ? 'Settled'
                  : acc.role ?? (isReceivable ? "You'll Get" : isPayable ? "You'll Give" : 'Advance');
                const statusColor = acc.balanceHidden || balNum === 0
                  ? 'var(--fin-zero, var(--muted))'
                  : isReceivable
                  ? 'var(--rec-fg, #235c35)'
                  : isPayable
                  ? 'var(--pay-fg, #8a2e2e)'
                  : 'var(--adv-fg, #0f62fe)';

                const initials = acc.name
                  .split(' ')
                  .map((w) => w[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || 'AC';

                return (
                  <div
                    key={acc.id}
                    onClick={() => {
                      setSelectedId(acc.id);
                      setMobileView('ledger');
                    }}
                    style={{
                      padding: '11px 14px',
                      borderBottom: '1px solid var(--line)',
                      background: isSelected ? 'var(--layer-accent)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--blue)' : '3px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      transition: 'background-color 0.1s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          background: isSelected ? 'var(--blue)' : 'var(--layer)',
                          color: isSelected ? '#ffffff' : 'var(--ink)',
                          border: '1px solid var(--line)',
                          fontWeight: 700,
                          fontSize: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          letterSpacing: '0.3px',
                        }}
                      >
                        {initials}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              fontWeight: isSelected ? 600 : 500,
                              fontSize: 13.5,
                              color: 'var(--ink)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {acc.name}
                          </span>
                          <Tag kind={TYPE_TAG[acc.type] || 'gray'}>{acc.type}</Tag>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span className="num">{acc.phone || '—'}</span>
                          {acc.code && <span className="num" style={{ color: 'var(--subtle)' }}>· {acc.code}</span>}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      <span
                        className="num"
                        style={{
                          fontSize: 13.5,
                          fontWeight: 700,
                          color: statusColor,
                        }}
                      >
                        {acc.balanceHidden ? '—' : `${money(Math.abs(balNum))} ${balNum === 0 ? '' : (acc.side ?? '')}`}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: statusColor,
                          background: balNum === 0 ? 'transparent' : (isReceivable ? 'rgba(25, 128, 56, 0.1)' : 'rgba(218, 30, 40, 0.1)'),
                          padding: balNum === 0 ? '0' : '1px 5px',
                          borderRadius: 3,
                          marginTop: 2,
                        }}
                      >
                        · {statusText}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Left Pane Footer Summary (Dynamic based on visible filtered accounts) */}
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--line)',
              background: 'var(--layer)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div>
                <span style={{ color: 'var(--muted)' }}>You'll Get: </span>
                <b className="num" style={{ color: 'var(--ok, #198038)' }}>{money(summary.debtors)}</b>
              </div>
              <div>
                <span style={{ color: 'var(--muted)' }}>You'll Give: </span>
                <b className="num" style={{ color: 'var(--err, #da1e28)' }}>{money(summary.creditors)}</b>
              </div>
            </div>
            <span className="num" style={{ fontSize: 11, color: 'var(--subtle)' }}>
              {filtered.length} shown
            </span>
          </div>
        </div>

        {/* Right Pane: Selected Account Detail & Ledger View */}
        <div
          className="accounts-workspace-detail"
          style={{ minWidth: 0, height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--canvas)', display: 'flex', flexDirection: 'column' }}
        >
          {/* Mobile Back Header Bar */}
          <div
            className="accounts-mobile-back"
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--layer)',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexShrink: 0,
            }}
          >
            <Btn
              variant="ghost"
              style={{ fontSize: 13, fontWeight: 600, padding: '0 8px', height: 32 }}
              onClick={() => setMobileView('list')}
            >
              ← Back to accounts
            </Btn>
            {selectedAccount && (
              <span className="num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                {selectedAccount.name}
              </span>
            )}
          </div>
          {selectedAccount ? (
            <AccountLedgerView
              key={selectedAccount.id}
              shopId={shopId}
              accountId={selectedAccount.id}
              onEdit={() => {
                setEditing({
                  id: selectedAccount.id,
                  name: selectedAccount.name,
                  type: selectedAccount.type as AccountType,
                  phone: selectedAccount.phone,
                  countryCode: selectedAccount.countryCode || DEFAULT_DIAL,
                  opening: selectedAccount.opening,
                  // A hidden balance is not 0; read-only displays handle
                  // "restricted" separately from "square".
                  balance: selectedAccount.balance ?? 0,
                  active: selectedAccount.active,
                });
              }}
            />
          ) : (
            <EmptyState
              title="No account selected"
              hint="Select an account from the left list to view its complete ledger transactions and details."
            />
          )}
        </div>
      </div>

      {/* Drawer: Add or Edit Account */}
      <Drawer
        open={!!editing}
        title={editing?.id ? 'Edit account' : 'New account'}
        onClose={() => setEditing(null)}
        footer={
          <>
            {editing?.id && (
              <Btn variant="ghost" style={{ color: 'var(--err)' }} onClick={() => setConfirmId(editing.id!)}>
                Delete
              </Btn>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Btn variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Btn>
              <Btn variant="primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save account'}
              </Btn>
            </div>
          </>
        }
      >
        {editing && (
          <>
            <Field label="Account name" help="Business or contact name this ledger tracks.">
              <input
                className="field-control"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Acme Corp"
                autoFocus
              />
            </Field>

            <div className="form-grid">
              <Field label="Account type">
                <select
                  className="field-control"
                  value={editing.type}
                  disabled={!!editing.id}
                  onChange={(e) => {
                    const t = e.target.value as AccountType;
                    setEditing({
                      ...editing,
                      type: t,
                      openingType: t === 'Supplier' ? 'Credit' : 'Debit',
                    });
                  }}
                >
                  {accountTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>

              <Field label="Mobile / contact" required hint={editing.id ? undefined : 'Required — used for collections.'}>
                <PhoneInput
                  countryCode={editing.countryCode || DEFAULT_DIAL}
                  phone={editing.phone}
                  onCountryCode={(v) => setEditing({ ...editing, countryCode: v })}
                  onPhone={(v) => setEditing({ ...editing, phone: v })}
                  required={!editing.id}
                />
              </Field>

              {!editing.id ? (
                <>
                  <Field label="Opening balance (₹)" help="Double-entry opening balance entry posted to ledger.">
                    <NumInput
                      className="field-control num"
                      step="0.01"
                      placeholder="0.00"
                      value={editing.opening}
                      onChange={(n) => setEditing({ ...editing, opening: n })}
                    />
                  </Field>

                  <Field label="Balance type" help="Customers are normally Debit (Dr); Suppliers are Credit (Cr).">
                    <select
                      className="field-control"
                      value={editing.openingType || 'Debit'}
                      onChange={(e) => setEditing({ ...editing, openingType: e.target.value as 'Debit' | 'Credit' })}
                    >
                      <option value="Debit">Debit (Dr) — Receivable</option>
                      <option value="Credit">Credit (Cr) — Payable</option>
                    </select>
                  </Field>

                  <Field label="Opening date" help="Cut-off date for opening ledger entry.">
                    <input
                      type="date"
                      className="field-control"
                      value={editing.openingDate || todayKey()}
                      onChange={(e) => setEditing({ ...editing, openingDate: e.target.value })}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Opening balance (₹)" help="Ledger-authoritative — set during creation.">
                    <NumInput className="field-control num" step="0.01" allowNegative placeholder="0" disabled value={editing.opening} onChange={() => {}} />
                  </Field>
                  <Field label="Current balance (₹)" help="Ledger-authoritative — posted by sales, purchases and receipts.">
                    <NumInput className="field-control num" step="0.01" allowNegative placeholder="0" disabled value={editing.balance} onChange={() => {}} />
                  </Field>
                </>
              )}

              <Field label="Status">
                <label className="check-row" style={{ height: 40 }}>
                  <input
                    type="checkbox"
                    className="check-box"
                    checked={editing.active}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                  />
                  Active for transactions
                </label>
              </Field>
            </div>
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!confirmId}
        title="Delete this account?"
        message="The ledger and its history reference will be removed. This cannot be undone."
        busy={busy}
        onClose={() => setConfirmId(null)}
        onConfirm={remove}
      />

      <AccountPaymentModal
        open={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false);
          setPaymentTargetId(null);
        }}
        shopId={shopId}
        accounts={d.accounts}
        preselectedAccountId={paymentTargetId ?? activeSelectedId}
        onSuccess={() => d.refresh()}
      />
    </div>
  );
}

export default function AdvancedAccountsPageGuarded() {
  const { can } = useAuth();
  if (!can('accounts')) return <NoAccess what="Accounts" />;
  return <AdvancedAccountsPage />;
}
