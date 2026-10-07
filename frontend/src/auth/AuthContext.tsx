import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, isMfaChallenge, session, type Me } from '@/lib/api';
import { startStore, stopStore } from '@/lib/sync';
import { isPlatformDev } from './surface';

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
  /** Resolves to the signed-in identity, or `{ mfaRequired: true }` when the account has an authenticator (then call `completeMfa`). */
  signIn: (login: string, password: string, shop?: string, surface?: string) => Promise<Me | { mfaRequired: true }>;
  completeMfa: (code: string) => Promise<Me>;
  /** The shop's chosen presentation of a tab. */
  variant: (surface: 'stock' | 'accounts') => string;
  refreshUserProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthApi | null>(null);

const SHOP_KEY = 'or2_shop';
const ME_KEY = 'or2_me';

function readCached(): { shop: string; me: Me } | null {
  try {
    const shop = localStorage.getItem(SHOP_KEY);
    const raw = localStorage.getItem(ME_KEY);
    if (!shop || !raw) return null;
    const me = JSON.parse(raw) as Me;
    if (!me || typeof me !== 'object') return null;
    if (!me.flags) {
      me.flags = { can_see_money: true, can_see_valuation: true, can_manage_returns: true };
    }
    if (!me.company) {
      me.company = { id: 0, name: 'ORSquare Platform', currency: 'INR', tz: 'Asia/Kolkata', gstin: '', business_date: '' };
    }
    if (!Array.isArray(me.roles)) {
      me.roles = [];
    }
    if (!Array.isArray(me.tabs)) {
      me.tabs = [];
    }
    if (!me.features || typeof me.features !== 'object') {
      me.features = {} as any;
    }
    return { shop, me };
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
    const normalized: Me = {
      ...m,
      flags: m.flags || { can_see_money: true, can_see_valuation: true, can_manage_returns: true },
      company: m.company || { id: 0, name: 'ORSquare Platform', currency: 'INR', tz: 'Asia/Kolkata', gstin: '', business_date: '' },
      roles: Array.isArray(m.roles) ? m.roles : [],
      tabs: Array.isArray(m.tabs) ? m.tabs : [],
      features: m.features || ({} as any),
    };
    setMe(normalized);
    setReady(true);
    setShopCode(shop);
    setSessionError(null);
    try {
      localStorage.setItem(SHOP_KEY, shop);
      localStorage.setItem(ME_KEY, JSON.stringify(normalized));
    } catch { /* private mode */ }
    if (!isPlatformDev(normalized)) {
      void startStore(shop, normalized);
    }
  }, []);

  const drop = useCallback(() => {
    setMe(null);
    stopStore();
    // Forget the shop too: a stale code (another shop, or 'orsquare_platform' after a developer session) would be sent
    // with the next sign-in and pin it to the wrong database. The server resolves the shop from the login instead.
    try { localStorage.removeItem(ME_KEY); localStorage.removeItem(SHOP_KEY); } catch { /* ignore */ }
  }, []);

  // Restore the session on load. The router renders a splash until this settles, so a refresh on /sales
  // never flashes the login screen - it redirects to /login only on an explicit 401.
  useEffect(() => {
    let alive = true;
    const hydrate = async () => {
      const cached = readCached();
      if (cached?.me && cached?.shop && !isPlatformDev(cached.me)) {
        void startStore(cached.shop, cached.me);
      }
      try {
        const m = await session.me();
        if (alive) adopt(m, m.shop || cached?.shop || '');
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

  const signIn = useCallback(async (login: string, password: string, shop?: string, surface?: string) => {
    const remembered = (() => { try { return localStorage.getItem(SHOP_KEY) || ''; } catch { return ''; } })();
    // Never reuse the platform database for a shop sign-in.
    const cachedShop = shop || (surface === 'dev' ? 'orsquare_platform' : remembered === 'orsquare_platform' ? '' : remembered);
    const m = await session.login(login.trim(), password, cachedShop || undefined, surface);
    if (isMfaChallenge(m)) return { mfaRequired: true as const };
    const resolvedShop = m.shop || cachedShop || (m.company ? `orsquare_shop${m.company.id}` : '');
    adopt(m, resolvedShop);
    return m;
  }, [adopt]);

  const completeMfa = useCallback(async (code: string) => {
    const m = await session.mfa(code);
    adopt(m, m.shop || (m.company ? `orsquare_shop${m.company.id}` : ''));
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
      ? {
          id: shopCode || String(me.company?.id ?? ''),
          name: me.company?.name ?? 'ORSquare Platform',
          code: shopCode,
          role,
          lockInTime: undefined
        }
      : null;
    const user: AppUser | null = me
      ? {
          id: String(me.id),
          name: me.name,
          login: me.login,
          email: me.login,
          role,
          isStaff: false,
          me,
          shops: activeShop ? [activeShop] : [],
          tabs: (me.tabs ?? []).map(key => ({ key, label: key }))
        }
      : null;
    const featureKey = (key: string) => ({ continuousScanning: 'continuous_scanning', autoGodownTransfer: 'auto_godown_transfer' }[key] || key);
    const featureOn = (key: string) => {
      if (!me || !me.features) return false;
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
      seesMoney: !!me?.flags?.can_see_money,
      seesValuation: !!me?.flags?.can_see_valuation,
      canManageReturns: !!me?.flags?.can_manage_returns,
      can: (perm) => tabs.has(perm),
      featureOn,
      variant: (surface) => me?.variants?.[surface] ?? 'standard',
      sessionError, signIn, completeMfa, refreshUserProfile, signOut,
    };
  }, [me, shopCode, ready, sessionError, signIn, completeMfa, refreshUserProfile, signOut]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
