import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Btn, EmptyState, Field, Modal, Tag, useToast } from '@/components/ui';
import { IconPlus, IconRefresh } from '@/components/icons';
import { platformApi } from './api';
import type { Operator, OperatorLevel } from './types';

const MIN_PASSWORD = 12;
const LEVEL_TEXT: Record<OperatorLevel, string> = { admin: 'Admin', support: 'Support (read-only)' };

function NewOperator({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<OperatorLevel>('support');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await platformApi.createOperator({ name, login, password, role }); onDone(); } catch (ex: any) { setError(ex?.message || 'Could not add.'); setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Add an operator" width={480}>
      <form onSubmit={submit} className="dev-form">
        {error && <div className="dev-alert" role="alert">{error}</div>}
        <Field label="Name" required><input className="field-control" required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Sign-in (email)" required hint="Unique across the whole platform."><input className="field-control" required autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} /></Field>
        <Field label="Password" required hint={`At least ${MIN_PASSWORD} characters. They must set up an authenticator app at first sign-in.`}>
          <input className="field-control" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Level">
          <select className="field-control" value={role} onChange={(e) => setRole(e.target.value as OperatorLevel)}>
            <option value="support">Support — can look, cannot change</option>
            <option value="admin">Admin — can change everything</option>
          </select>
        </Field>
        <div className="dev-form-foot">
          <Btn variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add operator'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PasswordModal({ who, onClose }: { who: Operator; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try { await platformApi.resetOperatorPassword(who.id, password); toast(`Password set for ${who.name}.`, 'ok'); onClose(); } catch (e: any) { setError(e?.message || 'Could not set it.'); setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`New password for ${who.name}`} width={440}
      footer={<><Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={() => void save()} disabled={busy || password.length < MIN_PASSWORD}>Set password</Btn></>}>
      {error && <div className="dev-alert" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      <Field label="New password" hint={`At least ${MIN_PASSWORD} characters. Their other sessions are signed out.`}>
        <input className="field-control" type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Who can sign in to this console and what they may do. Admin only. */
export function OperatorsTab({ selfId }: { selfId: number }) {
  const toast = useToast();
  const [rows, setRows] = useState<Operator[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pw, setPw] = useState<Operator | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setRows(await platformApi.getOperators()); } catch (e: any) { setError(e?.message || 'Could not load operators.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(op: Operator, fn: () => Promise<unknown>, ok: string) {
    setBusy(op.id);
    try { await fn(); toast(ok, 'ok'); await load(); } catch (e: any) { toast(e?.message || 'That did not work.', 'err'); } finally { setBusy(null); }
  }

  return (
    <div className="dev-stack">
      <div className="dev-head">
        <div>
          <h2>Operators</h2>
          <div className="dev-muted" style={{ fontSize: 12, marginTop: 2 }}>People who can sign in here. Everyone needs an authenticator app. There is always at least one active admin.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" onClick={() => void load()}><IconRefresh size={14} /> Refresh</Btn>
          <Btn variant="primary" onClick={() => setAdding(true)}><IconPlus size={14} /> Add operator</Btn>
        </div>
      </div>
      {error && <div className="dev-alert" role="alert">{error}</div>}
      <div className="tbl-scroll" style={{ border: '1px solid var(--line)' }}>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Sign-in</th><th>Level</th><th>Authenticator</th><th>Status</th><th className="td-right">Actions</th></tr></thead>
          <tbody>
            {!rows ? (
              <tr><td colSpan={6} className="dev-muted" style={{ textAlign: 'center', padding: 32 }}>Loading operators…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title="No operators" /></td></tr>
            ) : rows.map((o) => {
              const self = o.id === selfId;
              return (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong>{self && <span className="dev-muted"> (you)</span>}</td>
                  <td className="dev-mono">{o.login}</td>
                  <td>
                    <select className="field-control" style={{ width: 190 }} value={o.role} disabled={self || busy === o.id} aria-label={`Level of ${o.name}`}
                      onChange={(e) => void act(o, () => platformApi.setOperatorRole(o.id, e.target.value as OperatorLevel), `${o.name} is now ${LEVEL_TEXT[e.target.value as OperatorLevel]}.`)}>
                      <option value="admin">{LEVEL_TEXT.admin}</option>
                      <option value="support">{LEVEL_TEXT.support}</option>
                    </select>
                  </td>
                  <td>{o.mfa ? <Tag tone="green">Set up</Tag> : <Tag tone="amber">Not yet</Tag>}</td>
                  <td>{o.active ? <Tag tone="green">Active</Tag> : <Tag tone="gray">Disabled</Tag>}</td>
                  <td className="td-right">
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <Btn size="sm" variant="secondary" disabled={busy === o.id} onClick={() => setPw(o)}>Password</Btn>
                      {o.mfa && <Btn size="sm" variant="secondary" disabled={busy === o.id}
                        onClick={() => void act(o, () => platformApi.resetOperatorMfa(o.id), `${o.name} must set up the authenticator again.`)}>Reset authenticator</Btn>}
                      {!self && <Btn size="sm" variant={o.active ? 'danger' : 'primary'} disabled={busy === o.id}
                        onClick={() => void act(o, () => platformApi.setOperatorActive(o.id, !o.active), o.active ? `${o.name} can no longer sign in.` : `${o.name} can sign in again.`)}>
                        {o.active ? 'Disable' : 'Enable'}</Btn>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adding && <NewOperator onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast('Operator added.', 'ok'); void load(); }} />}
      {pw && <PasswordModal who={pw} onClose={() => setPw(null)} />}
    </div>
  );
}
