import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useWorkspace } from './workspace';
import * as repo from '@/lib/repo';
import { loadPrefs } from '@/lib/prefs';
import type { PProduct, PAccount, PSale, PPurchase, PVoucher, PIncExp, PTransfer, PCategory, PUnit } from '@/lib/repo';
import type { TablesConfig } from '@/types';
export interface MetaState { units: string[]; categories: string[]; unitsRaw: PUnit[]; categoriesRaw: PCategory[]; tables: TablesConfig }
export interface DataState {
  online: boolean; stockValue: number | null; ready: boolean; errors: string[]; products: PProduct[]; accounts: PAccount[]; sales: PSale[]; purchases: PPurchase[];
  payments: PVoucher[]; incexp: PIncExp[]; transfers: PTransfer[]; purchaseEdits: any[]; tabs: any[];
  meta: MetaState | null; salesSummary: any; rates: Record<string, number>; refresh: () => void;
}
const Context = createContext<DataState | null>(null);
export function DataProvider({ children }: { children: ReactNode }) {
  const w = useWorkspace();
  const route = useLocation().pathname;
  const [tick, setTick] = useState(0);
  const [rows, setRows] = useState<Partial<DataState>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [loadedRoute, setLoadedRoute] = useState('');
  const products = useMemo(() => w.products.map(p => repo.productRow(p, w.stock.find(s => s.product_id === p.product_id))), [w.products, w.stock]);
  useEffect(() => {
    if (w.status !== 'ready') return;
    let alive = true;
    const loaders: [keyof DataState, () => Promise<any>][] = [];
    if (['/', '/accounts', '/purchases', '/cashflow', '/ledger'].includes(route)) loaders.push(['accounts', () => repo.listAccounts('')]);
    if (['/', '/sales', '/cashflow', '/ledger'].includes(route)) loaders.push(['sales', () => repo.listSales('')]);
    if (['/', '/accounts', '/purchases', '/cashflow', '/ledger'].includes(route)) loaders.push(['purchases', () => repo.listPurchases('')]);
    if (route === '/stock') loaders.push(['stockValue', async () => (await repo.stockValue())?.total ?? null]);
    if (route === '/cashflow') loaders.push(['incexp', () => repo.listIncExp('')]);
    if (route === '/' || route === '/sales') loaders.push(['salesSummary', () => repo.salesSummary('')]);
    void Promise.allSettled(loaders.map(async ([key, get]) => [key, await get()] as const)).then(results => {
      if (!alive) return;
      const patch: Partial<DataState> = {}; const failures: string[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') Object.assign(patch, { [result.value[0]]: result.value[1] });
        else failures.push(result.reason?.message || 'Could not load this view.');
      }
      setRows(patch); setErrors(failures); setLoadedRoute(route);
    });
    return () => { alive = false; };
  }, [route, w.status, w.seq, tick]);
  const value = useMemo<DataState>(() => {

    const categoriesRaw = w.categories.map(c => ({ ...c, id: String(c.id), isDefault: false, originPreset: '' }));
    const unitsRaw = [...(w.units?.base_units || []), ...(w.units?.shop_units || [])].map((u: any) => ({ ...u, id: String(u.id), isDefault: false, originPreset: null, kind: 'piece', baseFactor: 1 }));
    return { online: w.online, ready: w.status === 'ready' && (loadedRoute === route || ['/stock', '/products', '/settings'].includes(route)),
      errors: [...errors, ...(w.error ? [w.error] : [])], products, accounts: [...w.customers, ...w.suppliers].map(repo.accountRow),
      sales: [], purchases: [], payments: [], incexp: [], transfers: [], purchaseEdits: [], tabs: [],
      meta: { categories: categoriesRaw.map(c => c.name), units: unitsRaw.map(u => u.name), categoriesRaw, unitsRaw, tables: loadPrefs().tables },
      stockValue: null, salesSummary: null, rates: {}, ...rows, refresh: () => { setTick(t => t + 1); void repo.listProducts('').then(() => import('@/lib/sync').then(s => s.refreshNow())); } };
  }, [w, products, rows, errors, loadedRoute, route]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useData(): DataState { const d = useContext(Context); if (!d) throw new Error('Missing DataProvider'); return d; }
