import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useData } from '@/data/DataProvider'
import { createAccount, deleteAccount, updateAccount, type PAccount } from '@/lib/repo'
import { money, payablesOf, receivablesOf } from '@/lib/utils'
import { searchAccounts } from '@/lib/search'
import { todayKey } from '@/lib/clock'
import { ACCOUNT_TYPES, OWNER_ACCOUNT_TYPES, type AccountType } from '@/types'
import {
  NoAccess,
  Btn,
  IconButton,
  SearchField,
  ToolbarSelect,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  NumInput,
  Panel,
  Tag,
  Tile,
  useToast,
} from '@/components/ui'
import { DataTable, type DTCol } from '@/components/DataTable'
import { PhoneInput } from '@/components/PhoneInput'
import { DEFAULT_DIAL, isValidNational } from '@/lib/phone'
import { IconRupee, IconPlus } from '@/components/icons'
import { AccountLedgerView } from '@/components/accounts/AccountLedgerView'
import { AccountPaymentModal } from '@/components/accounts/AccountPaymentModal'

type Draft = {
  id?: string
  name: string
  type: AccountType
  phone: string
  countryCode: string
  opening: number
  balance: number
  active: boolean
  openingType?: 'Debit' | 'Credit'
  openingDate?: string
}

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
})

const TYPE_TAG: Record<AccountType, string> = {
  Customer: 'gray',
  Supplier: 'blue',
  Employee: 'gray',
  Retailer: 'purple',
}

function AccountsPage() {
  const { wsUid, user, activeShop } = useAuth()
  const d = useData()
  const toast = useToast()
  const shopId = wsUid
  const isOwner = activeShop?.role === 'owner'
  // Retailer (connected-outlet) accounts are an enterprise-owner surface:
  // a single-shop owner login never sees the Retailers category.
  const isMultiShopOwner = isOwner && (user?.shops?.length ?? 0) > 1
  const accountTypes = useMemo(() => isMultiShopOwner ? OWNER_ACCOUNT_TYPES : ACCOUNT_TYPES, [isMultiShopOwner])

  const connectedShops = useMemo(() => {
    if (!isMultiShopOwner || !user?.shops) return []
    return user.shops.filter((s) => s.id !== activeShop?.id)
  }, [isMultiShopOwner, user?.shops, activeShop?.id])

  const [selectedShopId, setSelectedShopId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'All' | AccountType>('All')
  const [positionFilter, setPositionFilter] = useState<'all' | 'receivable' | 'payable' | 'settled'>('all')
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentTargetId, setPaymentTargetId] = useState<string | null>(null)

  // Dashboard drill-down: ?filter=receivables|payables opens the matching
  // ledger register so "Customers owe" / "You owe suppliers" land on the
  // actual accounts behind the number.
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const f = searchParams.get('filter')
    if (f === 'receivables') setTypeFilter('Customer')
    else if (f === 'payables') setTypeFilter('Supplier')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [viewingAccountId, setViewingAccountId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const operationalAccounts = useMemo(() => {
    return d.accounts.filter((a) => accountTypes.includes(a.type as AccountType))
  }, [d.accounts, accountTypes])

  const filtered = useMemo(() => {
    const base = operationalAccounts.filter((a) => {
      if (typeFilter !== 'All' && a.type !== typeFilter) return false
      if (positionFilter !== 'all') {
        const bal = a.balance || 0
        const isSupp = a.type === 'Supplier'
        const isPayable = isSupp ? bal > 0 : bal < 0
        const isReceivable = isSupp ? bal < 0 : bal > 0
        const isSettled = bal === 0
        if (positionFilter === 'receivable' && !isReceivable) return false
        if (positionFilter === 'payable' && !isPayable) return false
        if (positionFilter === 'settled' && !isSettled) return false
      }
      return true
    })
    const q = search.trim()
    if (!q) return base
    return searchAccounts(base, q)
  }, [operationalAccounts, search, typeFilter, positionFilter])

  const cols = useMemo<DTCol<PAccount>[]>(
    () => [
      {
        key: 'name',
        label: 'Name',
        sortValue: (a) => a.name.toLowerCase(),
        render: (a) => {
          const initials = (a.name || 'Account')
            .split(' ')
            .filter(Boolean)
            .map((w) => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'var(--layer-accent, #e0e0e0)',
                  color: 'var(--ink, #161616)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {initials}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="cell-main" style={{ fontWeight: 600 }}>{a.name}</span>
                {a.phone && <span className="td-muted num" style={{ fontSize: 11 }}>{a.phone}</span>}
              </div>
            </div>
          )
        },
      },
      {
        key: 'type',
        label: 'Type',
        sortValue: (a) => a.type,
        render: (a) => <Tag kind={TYPE_TAG[a.type as AccountType]}>{a.type}</Tag>,
      },
      {
        key: 'phone',
        label: 'Mobile',
        sortValue: (a) => a.phone,
        render: (a) => <span className="td-muted num">{a.phone || '—'}</span>,
      },
      {
        key: 'position',
        label: 'Position',
        sortValue: (a) => a.role ?? 'Settled',
        render: (a) => {
          if (a.balanceHidden) return <Tag kind="gray">Restricted</Tag>
          if (a.isSettled) return <Tag kind="gray">Settled</Tag>
          if (a.isPayable) {
            return (
              <span style={{ color: 'var(--pay-fg, #8a2e2e)', fontWeight: 600, fontSize: 12 }}>
                ● Payable
              </span>
            )
          }
          if (a.isReceivable) {
            return (
              <span style={{ color: 'var(--rec-fg, #235c35)', fontWeight: 600, fontSize: 12 }}>
                ● Receivable
              </span>
            )
          }
          // An advance is money on the WRONG side of the account - the shop
          // holds cash for the party rather than being owed by them. It used to
          // be labelled "Receivable" or "Payable" purely from the sign, which
          // put a customer who had prepaid into the Sundry Debtors register as
          // money "You'll Get".
          return (
            <span style={{ color: 'var(--adv-fg, #0f62fe)', fontWeight: 600, fontSize: 12 }}>
              ● {a.role ?? 'Advance'}
            </span>
          )
        },
      },
      {
        key: 'balance',
        label: 'Balance',
        align: 'right',
        sortValue: (a) => a.balance ?? 0,
        render: (a) => {
          // A hidden balance is not a zero balance. It used to render as
          // "Settled ₹0.00", telling a role that may not see money that the
          // firm owes nothing.
          if (a.balanceHidden) {
            return <span className="num" style={{ color: 'var(--muted)' }}>—</span>
          }
          if (!a.balance) return <span className="num" style={{ color: 'var(--muted)' }}>{money(0)}</span>
          // Dr/Cr and the position label come from accounts/selectors.py, one
          // authority, so they cannot disagree with the Ledger tab.
          const color = a.isReceivable
            ? 'var(--rec-fg, #235c35)'
            : a.isPayable
            ? 'var(--pay-fg, #8a2e2e)'
            : a.isAdvance
            ? 'var(--adv-fg, #0f62fe)'
            : 'var(--fin-zero, var(--muted))'
          const statusText = a.isReceivable ? 'Receivable' : a.isPayable ? 'Payable' : a.isAdvance ? 'Advance' : a.role ?? 'Settled'
          const pillBg = a.isReceivable
            ? 'var(--rec-bg, #edf6f0)'
            : a.isPayable
            ? 'var(--pay-bg, #faebeb)'
            : a.isAdvance
            ? 'var(--adv-bg, #edf5ff)'
            : 'transparent'
          return (
            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', whiteSpace: 'nowrap' }}>
              <span className="num" style={{ fontWeight: 700, fontSize: 13, color }}>
                {money(Math.abs(a.balance))}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color,
                  marginTop: 2,
                  padding: '1px 6px',
                  background: pillBg,
                }}
              >
                {statusText}
              </span>
            </div>
          )
        },
      },
      {
        key: 'status',
        label: 'Status',
        sortValue: (a) => (a.active ? 'Active' : 'Inactive'),
        render: (a) => (a.active ? <Tag kind="green">Active</Tag> : <Tag kind="gray">Inactive</Tag>),
      },
    ],
    []
  )

  const summary = useMemo(() => {
    const byType = Object.fromEntries(accountTypes.map((t) => [t, filtered.filter((a) => a.type === t).length])) as Record<AccountType, number>
    // Type-aware totals dynamically calculated from visible filtered accounts
    const debtors = receivablesOf(filtered)
    const creditors = payablesOf(filtered)
    return { byType, debtors, creditors }
  }, [filtered, accountTypes])

  async function provisionConnectedRetailers() {
    if (!isMultiShopOwner || !connectedShops.length) return
    setBusy(true)
    let added = 0
    let skipped = 0
    try {
      for (const sh of connectedShops) {
        const expectedCode = `RET-${sh.code}`
        const exists = d.accounts.some((a) => a.code === expectedCode || a.name === `Retailer — ${sh.name}`)
        if (exists) continue
        if (!sh.phone || !String(sh.phone).trim()) {
          // A ledger must always be contactable; the API rejects a blank
          // phone. Skip and report rather than aborting the whole batch.
          skipped++
          continue
        }
        await createAccount(shopId, {
          name: `Retailer — ${sh.name}`,
          type: 'Retailer',
          phone: sh.phone,
          country_code: DEFAULT_DIAL,
          code: expectedCode,
        })
        added++
      }
      if (added > 0) {
        toast(`Added ${added} connected retailer shop account${added === 1 ? '' : 's'}.`)
        await d.refresh()
      } else if (skipped === 0) {
        toast('All connected retailer shop accounts are already configured.')
      }
      if (skipped > 0) {
        toast(`${skipped} shop${skipped === 1 ? '' : 's'} skipped — add a phone number on the shop first.`, 'warn')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not provision retailer accounts.', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!editing) return
    if (!editing.name.trim()) {
      toast('Account name is required.', 'err')
      return
    }
    // Phone is mandatory at creation (server enforces the same rule) and must
    // be a plausible national number, not just any text.
    if (!editing.id && !isValidNational(editing.phone)) {
      toast('Enter a valid phone number (4–15 digits).', 'err')
      return
    }
    if (editing.phone && !isValidNational(editing.phone)) {
      toast('Enter a valid phone number (4–15 digits).', 'err')
      return
    }
    setBusy(true)
    try {
      if (editing.id) {
        // Balance/opening/type are ledger-authoritative: profile fields only.
        await updateAccount(shopId, editing.id, {
          name: editing.name.trim(),
          phone: editing.phone.trim(),
          country_code: editing.countryCode || DEFAULT_DIAL,
          is_active: editing.active,
        })
        toast('Account updated.')
      } else {
        const matchedShop = connectedShops.find((s) => s.id === selectedShopId)
        await createAccount(shopId, {
          name: editing.name.trim(),
          type: editing.type,
          phone: editing.phone.trim(),
          country_code: editing.countryCode || DEFAULT_DIAL,
          code: editing.type === 'Retailer' && matchedShop ? `RET-${matchedShop.code}` : undefined,
          opening_balance: editing.opening > 0 ? editing.opening : undefined,
          opening_balance_type: editing.opening > 0 ? (editing.openingType || 'Debit') : undefined,
          opening_date: editing.opening > 0 ? (editing.openingDate || todayKey()) : undefined,
        })
        toast(`${editing.type} account created.`)
      }
      setEditing(null)
      setSelectedShopId('')
      d.refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirmId) return
    setBusy(true)
    try {
      // 409 from the backend surfaces its own message ("has transaction/ledger
      // history... deactivate instead").
      await deleteAccount(shopId, confirmId)
      toast('Account deleted.')
      setConfirmId(null)
      setEditing(null)
      d.refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>

      <div className={`tiles ${isMultiShopOwner ? 'tiles-5' : 'tiles-4'}`}>
        <Tile label="Customers" value={summary.byType.Customer} note="Receivable accounts" />
        {isMultiShopOwner && (
          <Tile label="Retailers" value={summary.byType.Retailer || 0} note="Connected shops" />
        )}
        <Tile label="Suppliers" value={summary.byType.Supplier} note="Payable accounts" />
        <Tile label="Receivables (You'll Get)" value={<span style={{ color: 'var(--ok, #198038)' }}>{money(summary.debtors)}</span>} note="Owed to this shop" />
        <Tile label="Payables (You'll Give)" value={<span style={{ color: 'var(--err, #da1e28)' }}>{money(summary.creditors)}</span>} note="Owed to suppliers" />
      </div>

      <Panel>
        <div className="panel-head">
          <div className="panel-title-group">
            <h3 className="panel-title">All accounts</h3>
            <span className="t-caption">{filtered.length} shown</span>
          </div>
          <div className="panel-actions">
            <SearchField
              placeholder="Search by name or mobile…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
            />
            <ToolbarSelect width="sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} title="Filter by account type">
              <option value="All">All types</option>
              {accountTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </ToolbarSelect>
            <ToolbarSelect
              width="sm"
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value as any)}
              title="Filter by position"
            >
              <option value="all">All positions</option>
              <option value="receivable">Receivable</option>
              <option value="payable">Payable</option>
              <option value="settled">Settled</option>
            </ToolbarSelect>
            {isMultiShopOwner && connectedShops.length > 0 && (
              <Btn variant="secondary" onClick={provisionConnectedRetailers} title="Create accounts for any unconfigured retailer shops in this enterprise">
                + Provision shops
              </Btn>
            )}
            <IconButton
              variant="secondary"
              label="Record payment or receipt"
              tooltip="Record payment or receipt"
              onClick={() => {
                setPaymentTargetId(null)
                setPaymentModalOpen(true)
              }}
              icon={<IconRupee size={16} />}
            />
            <Btn variant="primary" onClick={() => {
              setSelectedShopId('')
              setEditing(blank())
            }}>
              <IconPlus size={14} style={{ marginRight: 5, verticalAlign: '-1px' }} />
              Add Account
            </Btn>
          </div>
        </div>

        {d.accounts.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            hint="Add your first customer or supplier to get started."
          />
        ) : (
          <DataTable
            cols={cols}
            rows={filtered}
            defaultSort={{ key: 'name', dir: 'asc' }}
            onRowClick={(a) => setViewingAccountId(a.id)}
            rowKey={(a) => a.id}
            empty={
              <EmptyState
                title="No accounts found"
                hint="Try clearing the search or filter."
              />
            }
          />
        )}
      </Panel>

      {/* Account Detail & Ledger Drawer */}
      <Drawer
        open={!!viewingAccountId}
        title="Account Detail & Ledger"
        onClose={() => setViewingAccountId(null)}
        xwide
      >
        {viewingAccountId && (
          <AccountLedgerView
            shopId={shopId}
            accountId={viewingAccountId}
            onEdit={() => {
              const acc = d.accounts.find((a) => a.id === viewingAccountId)
              if (acc) {
                setEditing({
                  id: acc.id,
                  name: acc.name,
                  type: acc.type as AccountType,
                  phone: acc.phone,
                  countryCode: acc.countryCode || DEFAULT_DIAL,
                  opening: acc.opening,
                  // A hidden balance is not 0; the edit dialog needs a number,
                  // and the read-only displays handle "restricted" separately.
                  balance: acc.balance ?? 0,
                  active: acc.active,
                })
                setViewingAccountId(null)
              }
            }}
          />
        )}
      </Drawer>

      <Drawer
        open={!!editing}
        title={editing?.id ? 'Edit account' : 'New account'}
        onClose={() => {
          setEditing(null)
          setSelectedShopId('')
        }}
        footer={
          <>
            {editing?.id && (
              <Btn variant="ghost" style={{ color: 'var(--err)' }} onClick={() => setConfirmId(editing.id!)}>
                Delete
              </Btn>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Btn variant="secondary" onClick={() => {
                setEditing(null)
                setSelectedShopId('')
              }}>Cancel</Btn>
              <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save account'}</Btn>
            </div>
          </>
        }
      >
        {editing && (
          <>
            {isMultiShopOwner && editing.type === 'Retailer' && connectedShops.length > 0 && !editing.id && (
              <Field label="Connected retailer shop" help="Select a connected retailer outlet in this enterprise to auto-fill details.">
                <select
                  className="field-control"
                  value={selectedShopId}
                  onChange={(e) => {
                    const sId = e.target.value
                    setSelectedShopId(sId)
                    const matched = connectedShops.find((s) => s.id === sId)
                    if (matched) {
                      setEditing({
                        ...editing,
                        name: `Retailer — ${matched.name}`,
                        phone: matched.phone || '',
                        countryCode: DEFAULT_DIAL,
                      })
                    }
                  }}
                >
                  <option value="">-- Choose connected shop --</option>
                  {connectedShops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Account name" help="Business or person this ledger tracks.">
              <input className="field-control" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Sharma & Sons" autoFocus />
            </Field>
            <div className="form-grid">
              <Field label="Account type">
                <select
                  className="field-control"
                  value={editing.type}
                  disabled={!!editing.id}
                  onChange={(e) => {
                    const t = e.target.value as AccountType
                    setEditing({
                      ...editing,
                      type: t,
                      openingType: t === 'Supplier' ? 'Credit' : 'Debit',
                    })
                  }}
                >
                  {accountTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Mobile / contact" required hint={editing.id ? undefined : 'Required — used for collections and delivery.'}>
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
                  <Field label="Opening balance (₹)" help="Double-entry opening entry posted to ledger.">
                    <NumInput
                      className="field-control num"
                      step="0.01"
                      placeholder="0.00"
                      value={editing.opening}
                      onChange={(n) => setEditing({ ...editing, opening: n })}
                    />
                  </Field>
                  <Field label="Opening position" help="Receivable (customer owes shop); Payable (shop owes supplier).">
                    <select
                      className="field-control"
                      value={editing.openingType || 'Debit'}
                      onChange={(e) => setEditing({ ...editing, openingType: e.target.value as 'Debit' | 'Credit' })}
                    >
                      <option value="Debit">Receivable (Owed to Shop)</option>
                      <option value="Credit">Payable (Owed to Supplier)</option>
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
                  <input type="checkbox" className="check-box" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
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
          setPaymentModalOpen(false)
          setPaymentTargetId(null)
        }}
        shopId={shopId}
        accounts={d.accounts}
        preselectedAccountId={paymentTargetId}
        onSuccess={() => d.refresh()}
      />
    </>
  )
}

export default function AccountsPageGuarded() {
  const { can } = useAuth()
  if (!can('accounts')) return <NoAccess what="Accounts" />
  return <AccountsPage />
}
