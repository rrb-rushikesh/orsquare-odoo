import { useCallback, useEffect, useState } from 'react';
import { Btn, IconButton, Modal, Tag, Tile, useToast } from '@/components/ui';
import { IconRefresh } from '@/components/icons';
import { platformApi, runSliced } from './api';
import type { Plan, PlatformSystemInfo, Progress } from './types';

const mb = (b: number) => `${(b / (1024 * 1024)).toFixed(b > 1e9 ? 0 : 1)} MB`;

function Adopt({ db, plans, onClose, onDone }: { db: string; plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState('trial');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function adopt() {
    setBusy(true);
    setError('');
    try { await platformApi.adoptShop(db, plan); toast(`${db} is now managed.`, 'ok'); onDone(); } catch (e: any) { setError(e?.message || 'Could not adopt.'); setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Put this database under management" width={460}
      footer={<><Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={() => void adopt()} disabled={busy}>{busy ? 'Adding…' : 'Add to fleet'}</Btn></>}>
      {error && <div className="dev-alert" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      <p style={{ marginTop: 0, fontSize: 13 }}>
        <span className="dev-mono">{db}</span> exists but is not in the fleet. Its owner, name and phone are read from the shop itself.
      </p>
      <label className="field"><span className="field-label">Plan</span>
        <select className="field-control" value={plan} onChange={(e) => setPlan(e.target.value)}>
          {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
      </label>
    </Modal>
  );
}

function Rebuild({ onClose }: { onClose: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const done = !!progress && progress.next_offset === null;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  async function start() {
    setRunning(true);
    setError('');
    try { await runSliced((o) => platformApi.rebuildDirectory(o), setProgress); } catch (e: any) { setError(e?.message || 'Stopped.'); } finally { setRunning(false); }
  }
  return (
    <Modal open onClose={running ? () => undefined : onClose} title="Rebuild the sign-in directory" width={500} closeOnEscape={!running}
      footer={<><Btn variant="secondary" onClick={onClose} disabled={running}>{done ? 'Close' : 'Cancel'}</Btn>
        {!done && <Btn variant="primary" onClick={() => void start()} disabled={running}>{running ? 'Working…' : 'Start'}</Btn>}</>}>
      <p style={{ marginTop: 0, fontSize: 13 }}>
        Reads every shop's staff once and records which sign-in belongs to which shop, so sign-in is one quick lookup and the
        same login can never exist in two shops. Safe to repeat.
      </p>
      {error && <div className="dev-alert" role="alert">{error}</div>}
      {progress && (
        <>
          <div className="dev-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
          <div className="dev-muted" style={{ fontSize: 12, marginTop: 6 }}>{progress.done.toLocaleString()} of {progress.total.toLocaleString()} shops{done ? ' — done' : ''}</div>
          {(progress.conflicts?.length ?? 0) > 0 && (
            <div className="dev-alert" role="alert" style={{ marginTop: 8 }}>
              {progress.conflicts!.length} sign-in{progress.conflicts!.length === 1 ? '' : 's'} are used by more than one shop and need fixing:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{progress.conflicts!.slice(0, 8).map((c, i) => <li key={i}><span className="dev-mono">{c.shop}</span> {c.error}</li>)}</ul>
            </div>
          )}
          {progress.failed.length > 0 && (
            <div className="dev-alert" role="alert" style={{ marginTop: 8 }}>
              {progress.failed.length} shop{progress.failed.length === 1 ? '' : 's'} could not be read:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{progress.failed.slice(0, 8).map((f, i) => <li key={i}><span className="dev-mono">{f.shop}</span> {f.error}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export function SystemTab({ canWrite }: { canWrite: boolean }) {
  const [sys, setSys] = useState<PlatformSystemInfo | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adopt, setAdopt] = useState<string | null>(null);
  const [rebuild, setRebuild] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([platformApi.getSystem(), platformApi.getPlans()]);
      setSys(s);
      setPlans(p.plans);
    } catch (e: any) {
      setError(e?.message || 'Could not read the platform state.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="dev-stack">
      <div className="dev-head">
        <div>
          <h2>System diagnostics</h2>
          <div className="dev-muted" style={{ fontSize: 12, marginTop: 2 }}>Engine version, database registry and sign-in directory health.</div>
        </div>
        <IconButton label="Refresh diagnostics" icon={<IconRefresh size={16} />} onClick={() => void load()} />
      </div>
      {error && <div className="dev-alert" role="alert">{error}</div>}
      {loading && !sys && <div className="dev-muted">Reading platform state…</div>}

      {sys && (
        <>
          <div className="tiles">
            <Tile label="Engine" value={sys.engine} />
            <Tile label="Platform module" value={sys.platform_module || '—'} />
            <Tile label="Shop databases" value={sys.shop_databases.toLocaleString()} sub={`${sys.registered_shops.toLocaleString()} registered`} tone="blue" />
            <Tile label="Sign-in keys" value={sys.directory_keys.toLocaleString()} sub="in the directory" />
            <Tile label="Operators" value={sys.operators} sub={sys.require_mfa ? 'authenticator required' : 'authenticator optional'} />
            <Tile label="Platform database" value={mb(sys.platform_db_bytes)} sub={sys.platform_db} />
            <Tile label="Server clock (UTC)" value={<span className="dev-mono">{sys.server_time}</span>} />
          </div>

          <section className="gv-section">
            <header><h3>New-shop template</h3>{sys.template.exists ? <Tag tone="green">Found</Tag> : <Tag tone="red">Missing</Tag>}</header>
            <div className="gv-body">
              <div style={{ fontSize: 13 }}>
                Every new shop is a copy of <span className="dev-mono">{sys.template.db}</span>
                {sys.template.version && <> at software version <strong>{sys.template.version}</strong></>}.
                {!sys.template.exists && ' Create it before provisioning shops.'}
              </div>
            </div>
          </section>

          <section className="gv-section">
            <header>
              <h3>Sign-in directory</h3>
              {canWrite && <Btn size="sm" variant="secondary" onClick={() => setRebuild(true)}>Rebuild directory</Btn>}
            </header>
            <div className="gv-body"><div style={{ fontSize: 13 }}>
              {sys.directory_keys.toLocaleString()} sign-in keys. Each key (login, e-mail or mobile) belongs to exactly one shop, so
              people never type a shop code and the same login cannot exist twice. Rebuild after importing or restoring shops.
            </div></div>
          </section>

          {sys.unregistered_count > 0 && (
            <section className="gv-section">
              <header><h3>{sys.unregistered_count} database{sys.unregistered_count === 1 ? ' is' : 's are'} not in the fleet</h3></header>
              <div className="gv-body">
                <div className="dev-muted" style={{ fontSize: 12 }}>They exist on the database server but cannot be managed until they are added.</div>
                {sys.unregistered.map((db) => (
                  <div key={db} className="dev-staff">
                    <span className="dev-mono">{db}</span>
                    {canWrite && <Btn size="sm" variant="secondary" onClick={() => setAdopt(db)}>Add to fleet</Btn>}
                  </div>
                ))}
                {sys.unregistered_count > sys.unregistered.length && <div className="dev-muted" style={{ fontSize: 12 }}>…and {sys.unregistered_count - sys.unregistered.length} more.</div>}
              </div>
            </section>
          )}
        </>
      )}

      {adopt && <Adopt db={adopt} plans={plans} onClose={() => setAdopt(null)} onDone={() => { setAdopt(null); void load(); }} />}
      {rebuild && <Rebuild onClose={() => { setRebuild(false); void load(); }} />}
    </div>
  );
}
