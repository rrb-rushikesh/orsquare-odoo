import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Btn, ConfirmDialog, EmptyState, Field, Modal, Tag, useToast } from '@/components/ui';
import { IconPlus, IconRefresh } from '@/components/icons';
import { platformApi, runSliced } from './api';
import type { Plan, PlansResponse, Progress } from './types';

const FEATURE_LABEL: Record<string, string> = { open_bottle: 'Open bottle (pegs)', kitchen: 'Kitchen', tables: 'Restaurant tables' };
const TAB_LABEL: Record<string, string> = {
  dashboard: 'Dashboard', sales: 'Sales', purchases: 'Purchases', stock: 'Stock', products: 'Products', accounts: 'Accounts',
  cashflow: 'Cash Flow', daybook: 'Day book', calendar: 'Calendar', reports: 'Reports', settings: 'Settings',
};

function Checks({ all, chosen, label, onChange, disabled }: {
  all: string[]; chosen: string[]; label: (k: string) => string; onChange: (v: string[]) => void; disabled?: boolean;
}) {
  return (
    <div className="gv-switches">
      {all.map((k) => (
        <label key={k} className={`gv-switch ${chosen.includes(k) ? 'on' : ''} ${disabled ? 'locked' : ''}`}>
          <input type="checkbox" checked={chosen.includes(k)} disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? [...chosen, k] : chosen.filter((x) => x !== k))} />
          <span className="t">{label(k)}</span>
        </label>
      ))}
    </div>
  );
}

function PlanModal({ plan, catalog, onClose, onSaved }: {
  plan: Plan | null; catalog: PlansResponse; onClose: () => void; onSaved: (r: PlansResponse) => void;
}) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [features, setFeatures] = useState<string[]>(plan?.features ?? []);
  const [tabs, setTabs] = useState<string[]>(plan?.tabs ?? []);
  const [maxStaff, setMaxStaff] = useState(plan?.max_staff ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(await platformApi.savePlan({ code: code.trim().toLowerCase(), name, description, features, tabs, max_staff: maxStaff }));
    } catch (ex: any) {
      setError(ex?.message || 'Could not save the plan.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={plan ? `Edit plan: ${plan.name}` : 'New plan'} width={620}>
      <form onSubmit={submit} className="dev-form">
        {error && <div className="dev-alert" role="alert">{error}</div>}
        <div className="row">
          <Field label="Name" required><input className="field-control" required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Code" required hint={plan ? 'Fixed once created.' : 'Lower case letters, numbers and _.'}>
            <input className="field-control dev-mono" required pattern="[a-z][a-z0-9_]{1,19}" disabled={!!plan} value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
          </Field>
        </div>
        <Field label="Description"><input className="field-control" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Features included" hint="Tick none to include them all.">
          <Checks all={catalog.features} chosen={features} label={(k) => FEATURE_LABEL[k] ?? k} onChange={setFeatures} />
        </Field>
        <Field label="Tabs included" hint="Tick none to include them all. Settings is always included.">
          <Checks all={catalog.tabs} chosen={tabs} label={(k) => TAB_LABEL[k] ?? k} onChange={setTabs} />
        </Field>
        <Field label="Most staff accounts" hint="0 = no limit.">
          <input className="field-control" type="number" min={0} style={{ maxWidth: 160 }} value={maxStaff} onChange={(e) => setMaxStaff(Number(e.target.value))} />
        </Field>
        <div className="dev-form-foot">
          <Btn variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PushModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const done = !!progress && progress.next_offset === null;

  async function start() {
    setRunning(true);
    setError('');
    try { await runSliced((o) => platformApi.pushPlan(plan.code, o), setProgress); } catch (e: any) { setError(e?.message || 'Stopped.'); } finally { setRunning(false); }
  }

  return (
    <Modal open onClose={running ? () => undefined : onClose} title={`Apply "${plan.name}" to its shops`} width={480} closeOnEscape={!running}
      footer={<><Btn variant="secondary" onClick={onClose} disabled={running}>{done ? 'Close' : 'Cancel'}</Btn>
        {!done && <Btn variant="primary" onClick={() => void start()} disabled={running}>{running ? 'Applying…' : 'Apply now'}</Btn>}</>}>
      <p style={{ marginTop: 0, fontSize: 13 }}>
        Sends this plan's current limits to the {plan.shops.toLocaleString()} shop{plan.shops === 1 ? '' : 's'} on it. Nothing in a shop is
        deleted: what the plan no longer includes simply stops being available. It runs in small slices and can be repeated safely.
      </p>
      {error && <div className="dev-alert" role="alert">{error}</div>}
      {progress && (
        <>
          <div className="dev-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
          <div className="dev-muted" style={{ fontSize: 12, marginTop: 6 }}>{progress.done.toLocaleString()} of {progress.total.toLocaleString()} shops{done ? ' — done' : ''}</div>
          {progress.failed.length > 0 && (
            <div className="dev-alert" role="alert" style={{ marginTop: 8 }}>
              {progress.failed.length} could not be updated:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{progress.failed.slice(0, 8).map((f) => <li key={f.code}><span className="dev-mono">{f.code}</span> {f.error}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export function PlansTab({ canWrite }: { canWrite: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [pushing, setPushing] = useState<Plan | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await platformApi.getPlans()); } catch (e: any) { setError(e?.message || 'Could not load plans.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove() {
    if (!deleting) return;
    try { setData(await platformApi.deletePlan(deleting.code)); toast('Plan deleted.', 'ok'); } catch (e: any) { toast(e?.message || 'Could not delete.', 'err'); }
    setDeleting(null);
  }

  return (
    <div className="dev-stack">
      <div className="dev-head">
        <div>
          <h2>Plans &amp; entitlements</h2>
          <div className="dev-muted" style={{ fontSize: 12, marginTop: 2 }}>What each plan includes. A shop can never switch on more than its plan allows.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" onClick={() => void load()}><IconRefresh size={14} /> Refresh</Btn>
          {canWrite && <Btn variant="primary" onClick={() => setEditing('new')}><IconPlus size={14} /> New plan</Btn>}
        </div>
      </div>
      {error && <div className="dev-alert" role="alert">{error}</div>}

      <div className="tbl-scroll" style={{ border: '1px solid var(--line)' }}>
        <table className="tbl">
          <thead><tr><th>Plan</th><th>Features</th><th>Tabs</th><th>Staff</th><th className="td-right">Shops</th>{canWrite && <th className="td-right">Actions</th>}</tr></thead>
          <tbody>
            {!data ? (
              <tr><td colSpan={6} className="dev-muted" style={{ textAlign: 'center', padding: 32 }}>Loading plans…</td></tr>
            ) : data.plans.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title="No plans" /></td></tr>
            ) : data.plans.map((p) => (
              <tr key={p.code}>
                <td><strong>{p.name}</strong> <span className="dev-mono dev-muted">{p.code}</span>{p.builtin && <> <Tag tone="gray">built-in</Tag></>}
                  {p.description && <div className="dev-muted" style={{ fontSize: 11 }}>{p.description}</div>}</td>
                <td>{p.features.length ? p.features.map((f) => <Tag key={f} tone="blue">{FEATURE_LABEL[f] ?? f}</Tag>) : <span className="dev-muted">All</span>}</td>
                <td>{p.tabs.length ? `${p.tabs.length} of ${data.tabs.length}` : <span className="dev-muted">All</span>}</td>
                <td>{p.max_staff || <span className="dev-muted">No limit</span>}</td>
                <td className="td-right">{p.shops.toLocaleString()}</td>
                {canWrite && (
                  <td className="td-right">
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <Btn size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Btn>
                      <Btn size="sm" variant="secondary" disabled={p.shops === 0} onClick={() => setPushing(p)}>Apply to shops</Btn>
                      {!p.builtin && <Btn size="sm" variant="danger" disabled={p.shops > 0} onClick={() => setDeleting(p)}>Delete</Btn>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && data && (
        <PlanModal plan={editing === 'new' ? null : editing} catalog={data}
          onClose={() => setEditing(null)} onSaved={(r) => { setData(r); setEditing(null); toast('Plan saved. Use "Apply to shops" to send it out.', 'ok'); }} />
      )}
      {pushing && <PushModal plan={pushing} onClose={() => { setPushing(null); void load(); }} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => void remove()}
        title={`Delete the ${deleting?.name ?? ''} plan?`} message="No shop uses it. This cannot be undone." confirmLabel="Delete plan" />
    </div>
  );
}
