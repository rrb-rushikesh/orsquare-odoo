import { useCallback, useEffect, useState } from 'react';
import { Btn, EmptyState, Pager, Tag, type TagTone } from '@/components/ui';
import { IconRefresh } from '@/components/icons';
import type { ChangePage, ChangeRow, GovApi } from './types';
import './governance.css';

const PAGE = 25;
const KINDS: [string, string][] = [['', 'Everything'], ['staff', 'Staff access'], ['settings', 'Business Studio'], ['preset', 'Presets'], ['security', 'Security']];
const KIND_TONE: Record<string, TagTone> = { staff: 'blue', settings: 'green', preset: 'green', security: 'red', platform: 'gray' };

const pretty = (v: unknown): string => {
  if (v === null || v === undefined || v === false || v === '') return 'off / empty';
  if (v === true) return 'on';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const nice = (key: string) => key.replace(/^orsquare_/, '').replace(/_/g, ' ');

/** "what changed": for each thing the entry names, what it was and what it became. */
function Changes({ row }: { row: ChangeRow }) {
  const after = row.after ?? {};
  const before = row.before ?? {};
  const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);
  const keys = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]) && !(empty(after[k]) && empty(before[k])));
  if (!keys.length) return <span className="dev-muted">{row.note || '—'}</span>;
  return (
    <dl className="gv-diff">
      {keys.map((k) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{nice(k)}</dt>
          <dd>
            {k in before && <span className="from">{pretty(before[k])}</span>}
            {k in before && ' → '}
            {pretty(after[k])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The shop's own governance log: who changed which role, tab, feature or password, and when. */
export function ChangeLog({ api }: { api: GovApi }) {
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ChangePage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.changes((page - 1) * PAGE, PAGE, kind)); } catch (e: any) { setError(e?.message || 'Could not load the log.'); }
  }, [api, kind, page]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="gv-stack">
      <div className="gv-bar">
        <select className="field-control" style={{ width: 200 }} value={kind} aria-label="Kind of change"
          onChange={(e) => { setKind(e.target.value); setPage(1); }}>
          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="gv-hint">{data ? `${data.total} entries` : ''}</span>
        <div className="spacer"><Btn variant="secondary" onClick={() => void load()}><IconRefresh size={14} /> Refresh</Btn></div>
      </div>
      {error && <div className="gv-banner err" role="alert">{error}</div>}
      <div className="tbl-scroll" style={{ border: '1px solid var(--line)' }}>
        <table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>About</th><th>Change</th></tr></thead>
          <tbody>
            {!data ? (
              <tr><td colSpan={5} className="dev-muted" style={{ textAlign: 'center', padding: 24 }}>Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr><td colSpan={5}><EmptyState title="Nothing recorded yet" hint="Changes to staff, tabs, features and passwords appear here." /></td></tr>
            ) : data.rows.map((r) => (
              <tr key={r.id}>
                <td className="dev-muted" style={{ whiteSpace: 'nowrap' }}>{r.at ? new Date(`${r.at.replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(r.at) ? '' : 'Z'}`).toLocaleString() : '—'}</td>
                <td>{r.actor || '—'}</td>
                <td><Tag tone={KIND_TONE[r.kind] ?? 'neutral'}>{r.kind}</Tag> {r.action.replace(/_/g, ' ')}</td>
                <td className="dev-mono">{r.target || '—'}</td>
                <td><Changes row={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pager page={page} pages={Math.max(1, Math.ceil(data.total / PAGE))} onPage={setPage} />}
    </div>
  );
}
