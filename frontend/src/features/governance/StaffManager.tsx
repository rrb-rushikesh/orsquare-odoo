import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Btn, Drawer, EmptyState, Field, Modal, SearchField, Tag, useToast } from '@/components/ui';
import { IconPlus } from '@/components/icons';
import type { Flag, GovApi, Role, StaffRow } from './types';
import './governance.css';

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', cashier: 'Cashier', stockkeeper: 'Stock keeper' };
const FLAG_LABEL: Record<Flag, { title: string; hint: string }> = {
  can_see_money: { title: 'See money', hint: 'Drawer cash and daily revenue.' },
  can_see_valuation: { title: 'See valuation', hint: 'Purchase rates, margins and stock value.' },
  can_manage_returns: { title: 'Manage returns', hint: 'Refunds and credit notes.' },
};
const TAB_LABEL: Record<string, string> = {
  dashboard: 'Dashboard', sales: 'Sales', purchases: 'Purchases', stock: 'Stock', products: 'Products', accounts: 'Accounts',
  cashflow: 'Cash Flow', daybook: 'Day book', calendar: 'Calendar', reports: 'Reports', settings: 'Settings',
};
const ALL_TABS = Object.keys(TAB_LABEL);
const DEFAULT_TABS: Record<string, string[]> = {
  cashier: ['sales', 'daybook', 'accounts', 'cashflow'],
  stockkeeper: ['stock', 'purchases', 'products'],
};
const MIN_PASSWORD = 8;

/** An owner also holds the cashier and stock-keeper roles underneath; say just "Owner". */
const roleText = (roles: Role[]) => (roles.includes('owner') ? ROLE_LABEL.owner : roles.map((x) => ROLE_LABEL[x]).join(', ') || '—');

function NewStaffModal({ api, onClose, onDone }: { api: GovApi; onClose: () => void; onDone: (rows: StaffRow[]) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('cashier');
  const [tabs, setTabs] = useState<string[]>(DEFAULT_TABS.cashier);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function pickRole(r: Role) {
    setRole(r);
    if (r !== 'owner') setTabs(DEFAULT_TABS[r] ?? []);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const rows = await api.createStaff({
        name: name.trim(), login: login.trim(), password, roles: [role], phone: phone.trim() || undefined,
        tabs: role === 'owner' ? undefined : tabs,
      });
      toast(`${name.trim()} added.`, 'ok');
      onDone(rows);
    } catch (ex: any) {
      setError(ex?.message || 'Could not add this person.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add a staff member" width={540}>
      <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
        {error && <div className="gv-banner err" role="alert">{error}</div>}
        <Field label="Name" required>
          <input className="field-control" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Sign-in (email or username)" required hint="Lower case. Unique across all shops.">
            <input className="field-control" required autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} />
          </Field>
          <Field label="Mobile" hint="They can sign in with this number too.">
            <input className="field-control" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Password" required hint={`At least ${MIN_PASSWORD} characters.`}>
          <input className="field-control" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Role">
          <select className="field-control" value={role} onChange={(e) => pickRole(e.target.value as Role)}>
            <option value="cashier">Cashier</option>
            <option value="stockkeeper">Stock keeper</option>
            <option value="owner">Owner (everything)</option>
          </select>
        </Field>
        {role !== 'owner' && (
          <Field label="Tabs they can open" hint="Start from the role's usual tabs; change any time.">
            <div className="gv-switches">
              {ALL_TABS.map((t) => (
                <label key={t} className={`gv-switch ${tabs.includes(t) ? 'on' : ''}`}>
                  <input type="checkbox" checked={tabs.includes(t)}
                    onChange={(e) => setTabs(e.target.checked ? [...tabs, t] : tabs.filter((x) => x !== t))} />
                  <span className="t">{TAB_LABEL[t]}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add staff member'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PasswordModal({ api, who, onClose }: { api: GovApi; who: StaffRow; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(who.id, password);
      toast(`New password set for ${who.name}. Their other sessions were signed out.`, 'ok');
      onClose();
    } catch (ex: any) {
      setError(ex?.message || 'Could not set the password.');
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`New password for ${who.name}`} width={440}
      footer={<>
        <Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" onClick={() => void save()} disabled={busy || password.length < MIN_PASSWORD}>Set password</Btn>
      </>}>
      {error && <div className="gv-banner err" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      <Field label="New password" hint={`At least ${MIN_PASSWORD} characters. Tell them in person; it is not sent anywhere.`}>
        <input className="field-control" type="password" autoFocus autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
      </Field>
    </Modal>
  );
}

function EditDrawer({ api, row, self, readOnly, onClose, onChanged }: {
  api: GovApi; row: StaffRow; self: boolean; readOnly: boolean; onClose: () => void; onChanged: (rows: StaffRow[]) => void;
}) {
  const toast = useToast();
  const [roles, setRoles] = useState<Role[]>(row.roles.includes('owner') ? ['owner'] : row.roles);
  const [flags, setFlags] = useState(row.flags);
  const [tabs, setTabs] = useState<string[]>(row.granted_tabs);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState(false);
  const isOwner = row.roles.includes('owner');
  const startRoles: Role[] = row.roles.includes('owner') ? ['owner'] : row.roles;
  const dirty = JSON.stringify([roles.slice().sort(), flags, tabs.slice().sort()]) !==
    JSON.stringify([startRoles.slice().sort(), row.flags, row.granted_tabs.slice().sort()]);
  const lock = readOnly || busy;

  async function run(fn: () => Promise<StaffRow[] | void>, ok: string) {
    setBusy(true);
    try {
      const rows = await fn();
      if (rows) onChanged(rows);
      toast(ok, 'ok');
    } catch (ex: any) {
      toast(ex?.message || 'That did not work.', 'err');
    } finally {
      setBusy(false);
    }
  }

  const toggleRole = (r: Role) => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);

  return (
    <>
      <Drawer open onClose={onClose} title={row.name}
        footer={!readOnly ? (
          <>
            <Btn variant="secondary" onClick={() => setPw(true)} disabled={busy}>Set password</Btn>
            <Btn variant="primary" disabled={!dirty || busy || roles.length === 0}
              onClick={() => void run(() => api.updateStaff(row.id, { roles, flags, tabs }), 'Access updated.')}>
              {busy ? 'Saving…' : 'Save access'}
            </Btn>
          </>
        ) : undefined}>
        <div className="dev-mono dev-muted" style={{ fontSize: 12 }}>{row.login}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {row.active ? <Tag tone="green">Active</Tag> : <Tag tone="gray">Disabled</Tag>}
          {row.mfa ? <Tag tone="blue">Two-step on</Tag> : <Tag tone="gray">No two-step</Tag>}
        </div>

        <Field label="Role">
          <div className="gv-switches">
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => {
              const rowLocked = lock || (self && r === 'owner');
              return (
                <label key={r} className={`gv-switch ${roles.includes(r) ? 'on' : ''} ${rowLocked ? 'locked' : ''}`}>
                  <input type="checkbox" checked={roles.includes(r)} disabled={rowLocked} onChange={() => toggleRole(r)} />
                  <span className="t">{ROLE_LABEL[r]}</span>
                </label>
              );
            })}
          </div>
          {self && <span className="gv-hint">You cannot remove your own owner access.</span>}
        </Field>

        <Field label="Can see">
          <div className="gv-switches">
            {(Object.keys(FLAG_LABEL) as Flag[]).map((f) => (
              <label key={f} className={`gv-switch ${flags[f] ? 'on' : ''} ${lock || isOwner ? 'locked' : ''}`}>
                <input type="checkbox" checked={isOwner || flags[f]} disabled={lock || isOwner}
                  onChange={(e) => setFlags({ ...flags, [f]: e.target.checked })} />
                <span><span className="t">{FLAG_LABEL[f].title}</span><span className="d">{FLAG_LABEL[f].hint}</span></span>
              </label>
            ))}
          </div>
          {isOwner && <span className="gv-hint">Owners always see everything.</span>}
        </Field>

        <Field label="Tabs they can open">
          <div className="gv-switches">
            {ALL_TABS.map((t) => {
              const on = isOwner || tabs.includes(t);
              const off = !row.tabs.includes(t) && tabs.includes(t);
              return (
                <label key={t} className={`gv-switch ${on ? 'on' : ''} ${lock || isOwner ? 'locked' : ''}`}>
                  <input type="checkbox" checked={on} disabled={lock || isOwner}
                    onChange={(e) => setTabs(e.target.checked ? [...tabs, t] : tabs.filter((x) => x !== t))} />
                  <span><span className="t">{TAB_LABEL[t]}</span>{off && <span className="d">Given, but the shop has it off</span>}</span>
                </label>
              );
            })}
          </div>
        </Field>

        {!readOnly && !self && (
          <Field label="Account">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn variant={row.active ? 'danger' : 'primary'} disabled={busy}
                onClick={() => void run(() => api.updateStaff(row.id, { active: !row.active }),
                  row.active ? `${row.name} can no longer sign in.` : `${row.name} can sign in again.`)}>
                {row.active ? 'Disable sign-in' : 'Enable sign-in'}
              </Btn>
              {row.mfa && (
                <Btn variant="secondary" disabled={busy}
                  onClick={() => void run(async () => { await api.resetMfa(row.id); return api.staff(); }, 'Two-step removed. They can set it up again.')}>
                  Remove two-step
                </Btn>
              )}
            </div>
          </Field>
        )}
      </Drawer>
      {pw && <PasswordModal api={api} who={row} onClose={() => setPw(false)} />}
    </>
  );
}

/** Team & Access: who works in the shop, what they may open and see. Uses Odoo's own users and groups underneath. */
export function StaffManager({ api, selfId, readOnly = false, maxStaff = 0 }: {
  api: GovApi; selfId?: number; readOnly?: boolean; maxStaff?: number;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try { setRows(await api.staff()); } catch (e: any) { setLoadError(e?.message || 'Could not load staff.'); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const active = rows?.filter((r) => r.active).length ?? 0;
  const atLimit = maxStaff > 0 && active >= maxStaff;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.login.toLowerCase().includes(q));
  }, [rows, search]);
  const current = rows?.find((r) => r.id === editing) ?? null;

  if (loadError) return <div className="gv-banner err" role="alert">{loadError} <Btn size="sm" variant="secondary" onClick={() => void load()}>Retry</Btn></div>;
  if (!rows) return <div className="skeleton" style={{ height: 160 }} />;

  return (
    <div className="gv-stack">
      <div className="gv-bar">
        <SearchField value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch('')} placeholder="Search staff" />
        <span className="gv-hint">
          {active} active{maxStaff > 0 ? ` of ${maxStaff} allowed by the plan` : ''}
        </span>
        <div className="spacer">
          {!readOnly && (
            <Btn variant="primary" onClick={() => (atLimit ? toast('The plan\'s staff limit is reached. Disable someone or upgrade.', 'err') : setAdding(true))}>
              <IconPlus size={14} /> Add staff
            </Btn>
          )}
        </div>
      </div>

      <div className="tbl-scroll" style={{ border: '1px solid var(--line)' }}>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Sign-in</th><th>Role</th><th>Tabs</th><th>Two-step</th><th>Status</th></tr></thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title="No staff found" hint={search ? 'Clear the search.' : 'Add the first staff member.'} /></td></tr>
            ) : shown.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setEditing(r.id)}>
                <td><strong>{r.name}</strong>{r.id === selfId && <span className="dev-muted"> (you)</span>}</td>
                <td className="dev-mono">{r.login}</td>
                <td>{roleText(r.roles)}</td>
                <td className="dev-muted" title={r.tabs.map((t) => TAB_LABEL[t] ?? t).join(', ')}>
                  {r.roles.includes('owner') ? 'All' : `${r.tabs.length} of ${ALL_TABS.length}`}
                </td>
                <td>{r.mfa ? <Tag tone="blue">On</Tag> : <span className="dev-muted">Off</span>}</td>
                <td>{r.active ? <Tag tone="green">Active</Tag> : <Tag tone="gray">Disabled</Tag>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && <NewStaffModal api={api} onClose={() => setAdding(false)} onDone={(r) => { setRows(r); setAdding(false); }} />}
      {current && (
        <EditDrawer api={api} row={current} self={current.id === selfId} readOnly={readOnly}
          onClose={() => setEditing(null)} onChanged={setRows} />
      )}
    </div>
  );
}
