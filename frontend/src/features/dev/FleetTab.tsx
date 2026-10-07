import { useCallback, useEffect, useRef, useState } from 'react';
import { Btn, EmptyState, IconButton, PageSizePicker, Pager, SearchField, Segmented, Tag, type TagTone } from '@/components/ui';
import { IconPlus, IconRefresh } from '@/components/icons';
import { platformApi } from './api';
import { NewShopModal } from './NewShopModal';
import { ShopDrawer } from './ShopDrawer';
import type { FleetQuery, Lifecycle, Plan, PlatformFleetResponse, PlatformShopRow } from './types';

export const LIFECYCLE_TONE: Record<Lifecycle, TagTone> = {
  active: 'green', trial: 'blue', expiring: 'amber', expired: 'red', suspended: 'red', archived: 'gray',
};
const LIFECYCLES: Lifecycle[] = ['active', 'trial', 'expiring', 'expired', 'suspended', 'archived'];
type Filter = '' | Lifecycle;
type Sort = NonNullable<FleetQuery['sort']>;

const COLUMNS: { key: Sort; label: string }[] = [
  { key: 'name', label: 'Shop' }, { key: 'code', label: 'Database' }, { key: 'owner', label: 'Owner' },
  { key: 'plan', label: 'Plan' }, { key: 'status', label: 'Status' }, { key: 'expires', label: 'Expires' },
];

export function FleetTab({ canWrite }: { canWrite: boolean }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [lifecycle, setLifecycle] = useState<Filter>('');
  const [plan, setPlan] = useState('');
  const [sort, setSort] = useState<Sort>('created');
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<PlatformFleetResponse | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlatformShopRow | null>(null);
  const [showNew, setShowNew] = useState(false);
  const seq = useRef(0);

  // typing waits a moment, so one request per pause rather than one per key
  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => { void platformApi.getPlans().then((r) => setPlans(r.plans)).catch(() => undefined); }, []);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await platformApi.getFleet({ search: debounced, lifecycle, plan: plan || undefined, page, page_size: pageSize, sort, desc });
      if (mine === seq.current) setData(r);
    } catch (e: any) {
      if (mine === seq.current) setError(e?.message || 'Could not load the fleet.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [debounced, lifecycle, plan, page, pageSize, sort, desc]);
  useEffect(() => { void load(); }, [load]);

  const counts = data?.counts ?? {};
  const options: { value: Filter; label: string }[] = [
    { value: '', label: `All (${data?.grand_total ?? 0})` },
    ...LIFECYCLES.map((l) => ({ value: l as Filter, label: `${l[0].toUpperCase()}${l.slice(1)} (${counts[l] ?? 0})` })),
  ];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  function sortBy(key: Sort) {
    if (key === sort) setDesc(!desc);
    else { setSort(key); setDesc(key === 'created'); }
    setPage(1);
  }

  return (
    <div className="dev-stack">
      {error && <div className="dev-alert" role="alert">{error} <Btn size="sm" variant="secondary" onClick={() => void load()}>Retry</Btn></div>}

      <div className="panel-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <SearchField value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch('')}
          placeholder="Search by shop, code, owner or mobile" />
        <select className="field-control" style={{ width: 150 }} value={plan} aria-label="Filter by plan"
          onChange={(e) => { setPlan(e.target.value); setPage(1); }}>
          <option value="">All plans</option>
          {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
        <Segmented label="Lifecycle filter" value={lifecycle} onChange={(v) => { setLifecycle(v); setPage(1); }} options={options} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <IconButton label="Refresh fleet" icon={<IconRefresh size={16} />} onClick={() => void load()} />
          {canWrite && <Btn variant="primary" onClick={() => setShowNew(true)}><IconPlus size={14} /> Provision shop</Btn>}
        </div>
      </div>

      <div className="tbl-scroll" style={{ border: '1px solid var(--line)', opacity: loading && data ? 0.6 : 1 }}>
        <table className="tbl">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} aria-sort={sort === c.key ? (desc ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" className="dev-sort" onClick={() => sortBy(c.key)}>
                    {c.label}{sort === c.key ? (desc ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
              <th className="td-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr><td colSpan={7} className="dev-muted" style={{ textAlign: 'center', padding: 32 }}>Loading shop fleet…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    title={data.grand_total ? 'No shops match this search' : 'No shops provisioned yet'}
                    hint={data.grand_total ? 'Clear the search or choose another filter.' : canWrite ? 'Provision the first shop to get started.' : undefined}
                  />
                </td>
              </tr>
            ) : data.rows.map((s) => (
              <tr key={s.code} className="clickable" onClick={() => setSelected(s)}>
                <td><strong>{s.name}</strong></td>
                <td className="dev-mono dev-muted">{s.code}</td>
                <td>
                  <div>{s.owner_name} <span className="dev-muted">({s.owner_login})</span></div>
                  {s.phone && <div className="dev-muted" style={{ fontSize: 11 }}>{s.phone}</div>}
                </td>
                <td style={{ textTransform: 'capitalize' }}>{s.plan}</td>
                <td><Tag tone={LIFECYCLE_TONE[s.lifecycle] ?? 'neutral'}>{s.lifecycle}</Tag></td>
                <td className="dev-muted">{s.expires_on || 'No expiry'}</td>
                <td className="td-right">
                  <Btn size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setSelected(s); }}>Manage</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span className="dev-muted" style={{ fontSize: 12 }}>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {data.total.toLocaleString()}
          </span>
          <Pager page={page} pages={pages} onPage={setPage} />
          <PageSizePicker value={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} options={[25, 50, 100, 200]} />
        </div>
      )}

      {canWrite && <NewShopModal open={showNew} onClose={() => setShowNew(false)} plans={plans} onCreated={() => { setPage(1); void load(); }} />}
      <ShopDrawer
        shop={selected}
        canWrite={canWrite}
        plans={plans}
        onClose={() => setSelected(null)}
        onChanged={(row) => { if (row) setSelected(row); void load(); }}
        onDeleted={() => { setSelected(null); void load(); }}
      />
    </div>
  );
}
