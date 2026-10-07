import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, session, type Me } from '@/lib/api';
import { startStore, stopStore } from '@/lib/sync';

/**
 * Who is signed in and what they may see.
 *
 * Identity lives in Odoo (users, groups); this context only mirrors `staff.me()` so the UI can hide what the
 * server would refuse anyway.  The server re-checks every call - hiding here is convenience, never security.
 */

/** Tab keys exactly as the backend grants them. */
export type Perm =
  | 'dashboard' | 'sales' | 'purchases' | 'stock' | 'products' | 'accounts' | 'cashflow' | 'daybook'
  | 'calendar' | 'reports' | 'settings';

export interface ShopInfo {
  id: string;
  name: string;
  code: string;
  role: string;
  phone?: string;
  /** Business-day cutoff is applied by the server; kept for display only. */
  lockInTime?: string;
  experience?: ShopExperienceInfo;
  tenant_name?: string;
  is_primary?: boolean;
}
export interface ShopExperienceInfo { version: number; profile: string; surfaces: Record<string, boolean>; variants: Record<string, string>; settings: Record<string, any> }

export interface AppUser {
  id: string;
  name: string;
  login: string;
  role: string;
  isStaff: false;
  me: Me;
  email: string;
  shops: ShopInfo[];
  tabs: { key: string; label: string }[];
}

export interface AuthApi {
  user: AppUser | null;
  me: Me | null;
  activeShop: ShopInfo | null;
  shopCode: string;
  wsUid: string;
  ready: boolean;
  role: string;
  isOwner: boolean;
  isEmployee: boolean;
  isOwnerAccount: boolean;
  isMultiShop: boolean;
  surfaceOn: (key: string) => boolean;
  feature: (key: string) => { enabled: boolean; owner_only: boolean; mode?: string };
  seesMoney: boolean;
  seesValuation: boolean;
  canManageReturns: boolean;
  can: (perm: Perm) => boolean;
  featureOn: (key: string) => boolean;
  sessionError: string | null;
  signIn: (login: string, password: string, shop?: string) => Promise<Me>;
  refreshUserProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthApi | null>(null);

const SHOP_KEY = 'or2_shop';
const ME_KEY = 'or2_me';

function readCached(): { shop: string; me: Me } | null {
  try {
    const shop = localStorage.getItem(SHOP_KEY);
    const me = localStorage.getItem(ME_KEY);
    return shop && me ? { shop, me: JSON.parse(me) as Me } : null;
  } catch {
    return null;
  }
}

/** Features that are always available to billing staff; the rest come from the shop's own switches. */
const ALWAYS_ON = new Set(['discount', 'quick_discount', 'custom_rate', 'khata_credit', 'today_sales_checkout']);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => readCached(), []);
  const [me, setMe] = useState<Me | null>(() => initial?.me ?? null);
  const [shopCode, setShopCode] = useState(() => initial?.shop ?? '');
  const [ready, setReady] = useState(() => !!initial?.me);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const adopt = useCallback((m: Me, shop: string) => {
    setMe(m);
    setReady(true);
    setShopCode(shop);
    setSessionError(null);
    try {
      localStorage.setItem(SHOP_KEY, shop);
      localStorage.setItem(ME_KEY, JSON.stringify(m));
    } catch { /* private mode */ }
    void startStore(shop, m);
  }, []);

  const drop = useCallback(() => {
    setMe(null);
    stopStore();
    try { localStorage.removeItem(ME_KEY); } catch { /* ignore */ }
  }, []);

  // Restore the session on load. The router renders a splash until this settles, so a refresh on /sales
  // never flashes the login screen - it redirects to /login only on an explicit 401.
  useEffect(() => {
    let alive = true;
    const hydrate = async () => {
      const cached = readCached();
      if (cached?.me && cached?.shop) {
        void startStore(cached.shop, cached.me);
      }
      try {
        const m = await session.me();
        if (alive) adopt(m, cached?.shop || '');
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) {
          drop();
          setReady(true);
        } else if (cached && e instanceof ApiError && e.network) {
          adopt(cached.me, cached.shop); // offline reopen: run from the local copy
          setSessionError('Working offline - bills will sync when the connection returns.');
        } else {
          setSessionError(e instanceof Error ? e.message : 'Could not reach the server.');
        }
      }
    };
    void hydrate();
    const onOnline = () => void hydrate();
    const onUnauthorized = () => drop();
    window.addEventListener('or2:unauthorized', onUnauthorized);
    window.addEventListener('online', onOnline);
    return () => { alive = false; window.removeEventListener('or2:unauthorized', onUnauthorized); window.removeEventListener('online', onOnline); };
  }, [adopt, drop]);

  const signIn = useCallback(async (login: string, password: string, shop?: string) => {
    const cachedShop = shop || localStorage.getItem(SHOP_KEY) || '';
    const m = await session.login(login.trim(), password, cachedShop || undefined);
    const resolvedShop = m.shop || cachedShop || (m.company ? `orsquare_shop${m.company.id}` : '');
    adopt(m, resolvedShop);
    return m;
  }, [adopt]);

  const refreshUserProfile = useCallback(async () => {
    try { adopt(await session.me(), shopCode); } catch { /* the sync loop surfaces connectivity */ }
  }, [adopt, shopCode]);

  const signOut = useCallback(async () => {
    try { await session.logout(); } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        setSessionError('Could not sign out. Reconnect and try again.');
        return;
      }
    }
    drop();
  }, [drop]);

  const value = useMemo<AuthApi>(() => {
    const isOwner = !!me?.roles.includes('owner');
    const tabs = new Set<string>(me?.tabs ?? []);
    const role = me ? (isOwner ? 'owner' : me.roles[0] || '') : '';
    const activeShop: ShopInfo | null = me
      ? { id: shopCode || String(me.company.id), name: me.company.name, code: shopCode, role, lockInTime: undefined }
      : null;
    const user: AppUser | null = me
      ? { id: String(me.id), name: me.name, login: me.login, email: me.login, role, isStaff: false, me,
          shops: activeShop ? [activeShop] : [], tabs: me.tabs.map(key => ({ key, label: key })) }
      : null;
    const featureKey = (key: string) => ({ continuousScanning: 'continuous_scanning', autoGodownTransfer: 'auto_godown_transfer' }[key] || key);
    const featureOn = (key: string) => {
      if (!me) return false;
      const mapped = featureKey(key);
      if (mapped in me.features) return !!(me.features as Record<string, unknown>)[mapped];
      return ALWAYS_ON.has(mapped);
    };
    return {
      user, me, activeShop, shopCode,
      wsUid: me ? `${shopCode}:${me.id}` : '',
      ready, role, isOwner, isEmployee: !!me && !isOwner,
      isOwnerAccount: false, isMultiShop: false,
      surfaceOn: key => key === 'surface.ledger' ? tabs.has('reports') : key === 'surface.advanced_accounting' ? true : key === 'surface.stock',
      feature: key => ({ enabled: featureOn(key), owner_only: false }),
      seesMoney: !!me?.flags.can_see_money,
      seesValuation: !!me?.flags.can_see_valuation,
      canManageReturns: !!me?.flags.can_manage_returns,
      can: (perm) => tabs.has(perm),
      featureOn,
      sessionError, signIn, refreshUserProfile, signOut,
    };
  }, [me, shopCode, ready, sessionError, signIn, refreshUserProfile, signOut]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
