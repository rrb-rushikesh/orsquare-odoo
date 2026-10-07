import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, IconButton, Pager, SearchField } from '@/components/ui';
import { IconRefresh } from '@/components/icons';
import { platformApi } from './api';
import type { PlatformAuditPage } from './types';

/** The server sends naive UTC timestamps; show them in the operator's local time. */
export function utcStamp(at: string): string {
  const iso = at.replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString();
}

const PAGE = 50;

/**
 * The operator audit trail, filtered and paged on the server. `shopCode` pins it to one shop (used in the shop
 * drawer); the Audit tab shows everything.
 */
export function AuditView({ shopCode }: { shopCode?: string }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PlatformAuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(q.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await platformApi.getAudit({
        page, page_size: PAGE, shop_code: shopCode, action: action || undefined, actor: actor.trim() || undefined,
        q: debounced || undefined, date_from: from || undefined, date_to: to || undefined,
      });
      if (mine === seq.current) setData(r);
    } catch (e: any) {
      if (mine === seq.current) setError(e?.message || 'Could not load the audit trail.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [page, shopCode, action, actor, debounced, from, to]);
  useEffect(() => { void load(); }, [load]);

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <div className="dev-stack">
      <div className="panel-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} placeholder="Search detail, shop or action" />
        <select className="field-control" style={{ width: 190 }} value={action} aria-label="Filter by action" onChange={(e) => reset(setAction)(e.target.value)}>
          <option value="">All actions</option>
          {(data?.actions ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input className="field-control" style={{ width: 150 }} placeholder="Operator" aria-label="Operator" value={actor} onChange={(e) => reset(setActor)(e.target.value)} />
        <label className="dev-date">From <input className="field-control" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} /></label>
        <label className="dev-date">To <input className="field-control" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} /></label>
        <div style={{ marginLeft: 'auto' }}>
          <IconButton label="Refresh audit trail" icon={<IconRefresh size={16} />} onClick={() => void load()} />
        </div>
      </div>
      {error && <div className="dev-alert" role="alert">{error}</div>}

      <div className="tbl-scroll" style={{ border: '1px solid var(--line)', opacity: loading && data ? 0.6 : 1 }}>
        <table className="tbl">
          <thead><tr><th>When</th><th>Operator</th><th>Action</th>{!shopCode && <th>Shop</th>}<th>Detail</th></tr></thead>
          <tbody>
            {!data ? (
              <tr><td colSpan={5} className="dev-muted" style={{ textAlign: 'center', padding: 32 }}>Loading audit trail…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr><td colSpan={5}><EmptyState title="No audit events match" hint="Clear a filter, or act in the console and it appears here." /></td></tr>
            ) : data.rows.map((r) => (
              <tr key={r.id}>
                <td className="dev-muted" style={{ whiteSpace: 'nowrap' }}>{utcStamp(r.at)}</td>
                <td>{r.actor}</td>
                <td className="dev-mono">{r.action}</td>
                {!shopCode && <td className="dev-mono">{r.shop_code || '—'}</td>}
                <td className="dev-muted">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span className="dev-muted" style={{ fontSize: 12 }}>{data.total.toLocaleString()} events</span>
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>
      )}
    </div>
  );
}

export function AuditTab() {
  return (
    <div className="dev-stack">
      <div className="dev-head">
        <div>
          <h2>Operator audit trail</h2>
          <div className="dev-muted" style={{ fontSize: 12, marginTop: 2 }}>Append-only record of every platform action. It cannot be edited or deleted.</div>
        </div>
      </div>
      <AuditView />
    </div>
  );
}
