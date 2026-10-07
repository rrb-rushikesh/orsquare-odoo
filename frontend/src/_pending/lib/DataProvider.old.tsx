/**
 * DataProvider: DRF-backed equivalent of the 01-era Firestore DataProvider.
 *
 * Exposes `d.*` collections (products, accounts, sales, purchases, payments,
 * incexp, transfers, purchaseEdits, tabs, meta, salesSummary, rates) loaded
 * from the backend via the repo intelligence layer. Pages keep the exact
 * 01 pattern (`const d = useData()`), only the transport changed.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import * as repo from '@/lib/repo';
import { loadPrefs } from '@/lib/prefs';
import type { Perm } from '@/auth/AuthContext';
import type { TablesConfig } from '@/types';
import type { PProduct, PAccount, PSale, PPurchase, PVoucher, PIncExp, PTransfer, PCategory, PUnit } from '@/lib/repo';

/** Master-data snapshot (units/categories) behind `d.meta`. Raw rows carry
 *  the typed-unit fields (kind, base_factor, default_unit) as of Feature 1. */
export interface MetaState {
  units: string[]
  categories: string[]
  unitsRaw: PUnit[]
  categoriesRaw: PCategory[]
  tables: TablesConfig
}

export interface DataState {
  ready: boolean;
  errors: string[];
  accounts: PAccount[];
  products: PProduct[];
  purchases: PPurchase[];
  sales: PSale[];
  payments: PVoucher[];
  incexp: PIncExp[];
  transfers: PTransfer[];
  purchaseEdits: any[];
  tabs: any[];
  meta: MetaState | null;
  salesSummary: any | null;
  rates: Record<string, number>;
  refresh: () => void;
}

type Coll = 'accounts' | 'products' | 'purchases' | 'sales' | 'payments' | 'incexp' | 'transfers' | 'purchaseEdits';

const COLLS: Coll[] = ['accounts', 'products', 'purchases', 'sales', 'payments', 'incexp', 'transfers', 'purchaseEdits'];

const ROUTE_SUBS: Record<string, Coll[]> = {
  '/': ['accounts', 'products', 'purchases', 'payments', 'incexp', 'sales'],
  '/accounts': ['accounts', 'purchases'],
  '/ledger': ['accounts', 'purchases', 'sales', 'payments', 'incexp'],
  '/purchases': ['purchases', 'products', 'accounts', 'purchaseEdits'],
  '/products': ['products'],
  '/sales': ['products', 'accounts', 'sales'],
  '/stock': ['products', 'transfers'],
  '/cashflow': ['payments', 'incexp', 'sales', 'accounts'],
  '/daybook': ['sales', 'transfers', 'products', 'incexp'],
  '/calendar': ['accounts', 'products', 'purchases', 'sales', 'payments', 'incexp'],
  '/settings': [],
};

/** Essential collections that must be loaded before marking a route ready.
 *  Non-essential collections continue loading in the background without blocking the UI. */
const ESSENTIAL_COLLS: Record<string, Coll[]> = {
  '/': ['sales', 'accounts'],
  '/accounts': ['accounts'],
  '/ledger': ['accounts'],
  '/purchases': ['purchases', 'products'],
  '/products': ['products'],
  '/sales': ['products'],
  '/stock': ['products'],
  '/cashflow': ['payments', 'incexp'],
  '/daybook': ['sales'],
  '/calendar': ['sales'],
  '/settings': [],
};

/** Perms that allow loading each collection. A collection the session may
 *  not read is skipped entirely: never fetched, so an employee's device
 *  holds no sensitive rows and 403s can't strand the page on a skeleton.
 *  Exceptions are deliberate: /sales needs customer accounts for khata, and
 *  /daybook needs sales rows for its (money-free) glance counts. */
const COLL_PERMS: Record<Coll, Perm[]> = {
  accounts: ['accounts', 'sales', 'purchases', 'cashflow', 'reports'],
  products: ['products', 'sales', 'stock', 'purchases', 'daybook', 'reports'],
  purchases: ['purchases', 'reports'],
  sales: ['sales', 'daybook', 'cashflow', 'reports'],
  payments: ['cashflow', 'reports'],
  incexp: ['cashflow', 'reports'],
  transfers: ['stock', 'daybook', 'reports'],
  purchaseEdits: ['reports'],
};

const loaders: Record<Coll, (shopId: string) => Promise<any[]>> = {
  accounts: (s) => repo.listAccounts(s),
  products: (s) => repo.listProducts(s),
  purchases: (s) => repo.listPurchases(s),
  sales: (s) => repo.listSales(s),
  payments: (s) => repo.listVouchers(s, 'payments'),
  incexp: (s) => repo.listIncExp(s),
  transfers: (s) => repo.listTransfers(s),
  purchaseEdits: (s) => repo.listPurchaseEdits(s),
};

// Short-TTL in-memory cache so route changes don't refetch every collection.
// Written only after a SUCCESSFUL load, and only for collections the current
// perms may read (loading is already perm-gated above), so a lower-privileged
// session never inherits another role's cached rows. refresh() bypasses it.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { data: any[]; at: number }>();

const DataCtx = createContext<DataState | null>(null);

export function DataProvider({ uid, perms, pv = 0, children }: { uid: string; perms: string[] | null; pv?: number; children: ReactNode }) {
  const loc = useLocation();
  const [rows, setRows] = useState<Record<Coll, any[]>>({ accounts: [], products: [], purchases: [], sales: [], payments: [], incexp: [], transfers: [], purchaseEdits: [] });
  const [loaded, setLoaded] = useState<Set<Coll>>(new Set());
  const [failed, setFailed] = useState<Set<Coll>>(new Set());
  const [meta, setMeta] = useState<MetaState | null>(() => {
    try {
      const raw = localStorage.getItem(`xpo_meta_${uid}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...parsed, tables: loadPrefs().tables };
      }
    } catch { /* ignore */ }
    return null;
  });
  const [salesSummary, setSalesSummary] = useState<any | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  const tickRef = useRef(0);
  // Identity ref for (shop, perms version, route collection set), see below.
  const identityRef = useRef('');

  // Route identity = first path segment ('/purchases/some-id' → '/purchases')
  // so ROUTE_SUBS matches the sub-lists keyed by top-level route.
  const routeKey = '/' + (loc.pathname.split('/').filter(Boolean)[0] ?? '');

  const want = useMemo(() => {
    const route = ROUTE_SUBS[routeKey] || COLLS;
    // No perms (staff/dev or unknown) → full route set, same as before.
    if (!perms || perms.length === 0) return new Set(route);
    return new Set(route.filter((c) => (COLL_PERMS[c] ?? []).some((p) => perms.includes(p))));
  }, [routeKey, perms]);

  // Identity that decides whether on-screen rows are CLEARED: only the shop
  // and the set of collections being loaded. A pv change (live capability or
  // permission refresh) still triggers a refetch through the effect deps
  // below, but deliberately does NOT clear `loaded`/`failed`, so current rows
  // stay rendered while fresh data arrives — no skeleton flash over an open
  // bill. The cache key includes pv, so a pv change always misses the cache
  // and genuinely refetches.
  const identity = `${uid}:${[...want].sort().join(',')}`;

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    const target = [...want];

    // refresh() (tick bump) bypasses the cache; route changes reuse it.
    const bypassCache = tickRef.current !== tick;
    tickRef.current = tick;

    const identityChanged = identityRef.current !== identity;
    identityRef.current = identity;
    if (identityChanged) {
      setRows((prev) => ({ ...prev }));
      setLoaded(new Set());
      setFailed(new Set());
    }

    // Rates (our selling rate per product) are needed at the counter by anyone
    // with 'sales': derived from the already-loaded products rows, no second
    // fetch. The sales SUMMARY is money, only sessions that may see
    // reports/dashboard aggregates fetch it.
    const canSeeRates = !perms || perms.length === 0 || perms.includes('sales');
    const canSeeSummary = !perms || perms.length === 0 || perms.includes('reports');

    const applyRates = (products: any[]) => {
      if (canSeeRates) setRates(Object.fromEntries(products.map((p: any) => [p.id, p.rate])));
    };

    Promise.all(target.map(async (c) => {
      const key = `${uid}:${pv}:${c}`;
      const hit = bypassCache ? undefined : cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        if (!alive) return;
        setRows((prev) => ({ ...prev, [c]: hit.data }));
        setLoaded((prev) => new Set(prev).add(c));
        if (c === 'products') applyRates(hit.data);
        return;
      }
      try {
        const data = await loaders[c](uid);
        if (!alive) return;
        cache.set(key, { data, at: Date.now() });
        setRows((prev) => ({ ...prev, [c]: data }));
        setLoaded((prev) => new Set(prev).add(c));
        if (c === 'products') applyRates(data);
      } catch (err) {
        if (!alive) return;
        setFailed((prev) => new Set(prev).add(c));
      }
    }));

    if (canSeeSummary) {
      (async () => {
        try {
          const sum = await repo.salesSummary(uid);
          if (!alive) return;
          setSalesSummary(sum);
        } catch { /* non-fatal */ }
      })();
    }

    return () => { alive = false; };
  }, [uid, want, tick, pv]);

  // Meta (units/categories) for master screens. Loaded on route/identity
  // change here, and refetched EXPLICITLY by refresh() (see below) so an
  // inline master create ("+") invalidates the list without relying on an
  // effect dependency — adding `tick` to this effect's deps caused a
  // cleanup/fetch loop that cancelled every response (meta never loaded).
  const metaSeq = useRef(0);
  const fetchMeta = useCallback(async () => {
    if (!uid) return;
    const seq = ++metaSeq.current;
    try {
      const [units, categories] = await Promise.all([repo.listUnits(uid), repo.listCategories(uid)]);
      if (seq !== metaSeq.current) return;
      const meta: MetaState = { units: units.map((u) => u.name), categories: categories.map((c) => c.name), unitsRaw: units, categoriesRaw: categories, tables: loadPrefs().tables };
      try {
        localStorage.setItem(`xpo_meta_${uid}`, JSON.stringify({ units: meta.units, categories: meta.categories, unitsRaw: units, categoriesRaw: categories }));
      } catch { /* ignore */ }
      setMeta(meta);
    } catch { /* non-fatal: master lists simply stay as-is */ }
  }, [uid]);

  useEffect(() => {
    if (!uid || (!want.has('products') && !want.has('purchases'))) return;
    void fetchMeta();
  }, [uid, want, fetchMeta]);

  // LIVE MULTI-DEVICE UPDATE FIX (2026-08-31): rendered state previously had
  // NO refresh path for changes made by OTHER devices, an owner parked on
  // the dashboard saw frozen numbers all shift while cashiers billed.
  // lib/sync.ts dispatches 'xpo_data_changed' whenever a background delta
  // (any device's writes) or an offline-queue flush lands; refetching here
  // (throttled) keeps every screen within one poll interval (≤15s) of the
  // server. Returning to a visible tab also refetches immediately.
  useEffect(() => {
    if (!uid) return;
    let lastBump = 0;
    const bump = () => {
      const now = Date.now();
      if (now - lastBump < 5000) return; // ≥5s between reactive refetches
      lastBump = now;
      setTick((t) => t + 1);
    };
    const onDataChanged = () => bump();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') bump();
    };
    window.addEventListener('xpo_data_changed', onDataChanged);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('xpo_data_changed', onDataChanged);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [uid]);

  const essential = useMemo(() => {
    const list = ESSENTIAL_COLLS[routeKey] || [];
    return new Set(list.filter((c) => want.has(c)));
  }, [routeKey, want]);

  const ready = useMemo(() => {
    // If essential collections are specified for this route, mark ready as soon as essentials arrive
    if (essential.size > 0) {
      for (const c of essential) {
        if (!loaded.has(c) && !failed.has(c)) return false;
      }
      return true;
    }
    for (const c of want) {
      if (!loaded.has(c) && !failed.has(c)) return false;
    }
    return true;
  }, [want, essential, loaded, failed]);

  // refresh() bumps the collections tick AND explicitly refetches the master
  // meta, so a mutation (product/master create/edit) reliably rebuilds the
  // unit/category option lists everywhere.
  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    void fetchMeta();
  }, [fetchMeta]);
  const errors = useMemo(() => [...failed], [failed]);
  const emptyTabs = useMemo(() => [], []);

  const value: DataState = useMemo(() => ({
    ready,
    errors,
    accounts: rows.accounts,
    products: rows.products,
    purchases: rows.purchases,
    sales: rows.sales,
    payments: rows.payments,
    incexp: rows.incexp,
    transfers: rows.transfers,
    purchaseEdits: rows.purchaseEdits,
    tabs: emptyTabs,
    meta,
    salesSummary,
    rates,
    refresh,
  }), [ready, errors, rows, emptyTabs, meta, salesSummary, rates, refresh]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}