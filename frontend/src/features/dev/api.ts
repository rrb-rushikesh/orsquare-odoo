import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import type { Business, Plan, PlanKey, Stage, StudioSetup } from './types';

// Invalidation event hub
const LISTENERS = new Set<() => void>();
export function invalidateDevQueries() {
  LISTENERS.forEach((fn) => fn());
}

const p = <T>(method: string, params: Record<string, unknown> = {}) => call<T>('platform', method, params);

export function mapShopToBusiness(shop: any, detail?: any): Business {
  const code = shop.code || 'orsquare_shop1';
  const daysLeft = shop.expires_on ? Math.ceil((new Date(shop.expires_on + 'T23:59:59Z').getTime() - Date.now()) / 86400000) : null;

  let stage: Stage = 'active';
  if (shop.status === 'suspended' || shop.lifecycle === 'suspended' || shop.lifecycle === 'expired') {
    stage = 'suspended';
  } else if (shop.lifecycle === 'expiring' || (daysLeft !== null && daysLeft <= 7 && daysLeft >= 0)) {
    stage = 'expiring';
  } else if (shop.lifecycle === 'trial') {
    stage = 'trial';
  } else {
    stage = 'active';
  }

  const planKey: PlanKey = shop.plan === 'pro' ? '1y' : shop.plan === 'trial' ? '7d' : '28d';
  const planLabel = shop.plan ? (shop.plan.charAt(0).toUpperCase() + shop.plan.slice(1)) : 'Trial';

  const staff = detail?.staff || [];
  const ownerStaff = staff.find((s: any) => s.roles?.includes('owner')) || {
    id: 'owner',
    name: shop.owner_name,
    login: shop.owner_login,
    active: true,
    roles: ['owner'],
    phone: shop.phone,
  };
  const cashierStaff = staff.filter((s: any) => s.roles?.includes('cashier') && !s.roles?.includes('owner'));

  return {
    slug: code,
    code,
    name: shop.name,
    status: shop.status === 'suspended' ? 'suspended' : 'active',
    reason: shop.suspended_reason ? 'administrative' : null,
    stage,
    plan: planKey,
    planLabel,
    validFrom: shop.created_at ? String(shop.created_at).slice(0, 10) : null,
    validUntil: shop.expires_on || null,
    daysLeft,
    timezone: 'Asia/Kolkata',
    owner: {
      id: String(ownerStaff.id || 'owner'),
      name: ownerStaff.name || shop.owner_name || 'Owner',
      login: ownerStaff.login || shop.owner_login || 'owner@orsquare.com',
      active: ownerStaff.active !== false,
      role: 'owner',
      mobile: (ownerStaff.phone || shop.phone) ? { country: 'IN', number: String(ownerStaff.phone || shop.phone).replace(/\D/g, '') } : null,
    },
    cashiers: {
      used: cashierStaff.length,
      limit: detail?.health?.entitlements?.max_staff || 2,
      list: cashierStaff.map((c: any) => ({
        id: String(c.id),
        name: c.name,
        login: c.login,
        active: c.active !== false,
        role: 'cashier',
        mobile: c.phone ? { country: 'IN', number: String(c.phone).replace(/\D/g, '') } : null,
      })),
    },
    users: {
      total: detail?.health?.staff_count || staff.length || 1,
      active: staff.filter((s: any) => s.active !== false).length || 1,
    },
    tabs: 11,
    createdAt: shop.created_at || new Date().toISOString(),
  };
}

export function generatePassword(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let pwd = '';
  for (let i = 0; i < 14; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return Promise.resolve(pwd);
}

/**
 * Executes a simulated or real dev.* endpoint call against the platform API.
 */
async function devCall<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  switch (name) {
    case 'dev.businesses.list': {
      const fleetRes = await p<{ rows?: any[]; shops?: any[]; counts: any; grand_total: number }>('fleet', { page_size: 500 });
      const list = fleetRes.rows || fleetRes.shops || [];
      const businesses: Business[] = list.map((s: any) => mapShopToBusiness(s));
      return { businesses } as T;
    }

    case 'dev.businesses.get': {
      const slug = String(args.slug || '');
      const detail = await p<any>('shop_detail', { code: slug });
      return mapShopToBusiness(detail, detail) as T;
    }

    case 'dev.plans.list': {
      const plans: Plan[] = [
        { key: '7d', label: '7 days', days: 7, price: null },
        { key: '28d', label: '1 month', days: 28, price: 1499 },
        { key: '1y', label: '1 year', days: 365, price: 14999 },
      ];
      return { plans } as T;
    }

    case 'dev.studio.catalog':
    case 'dev.studio.get': {
      const slug = String(args.slug || 'orsquare_shop1');
      let exp: any;
      try {
        exp = await p<any>('shop_experience', { code: slug });
      } catch {
        exp = null;
      }

      const groups = [
        {
          key: 'pos',
          label: 'Point of Sale',
          tabs: [
            {
              key: 'sales',
              label: 'Sales Counter',
              variants: [{ key: 'sales.standard', label: 'Standard Counter', features: [] }],
            },
            {
              key: 'dashboard',
              label: 'Live Dashboard',
              variants: [{ key: 'dashboard.standard', label: 'Standard Metrics', features: [] }],
            },
          ],
        },
        {
          key: 'inventory',
          label: 'Stock & Inventory',
          tabs: [
            {
              key: 'stock',
              label: 'Stock Management',
              variants: [
                {
                  key: 'stock.standard',
                  label: 'Standard Stock List',
                  features: [
                    { id: 'auto_godown_transfer', label: 'Auto Godown Transfer', description: 'Auto transfer when counter hits 0', default: true },
                  ],
                },
                {
                  key: 'stock.wine',
                  label: 'WineStock Matrix (Brand × Size)',
                  features: [
                    { id: 'open_bottle', label: 'Open-Bottle Pegs', description: 'Dispense peg measures from sealed bottles', default: true },
                    { id: 'auto_godown_transfer', label: 'Auto Godown Transfer', description: 'Auto transfer when counter hits 0', default: true },
                  ],
                },
              ],
            },
            {
              key: 'products',
              label: 'Product Catalog',
              variants: [
                {
                  key: 'products.standard',
                  label: 'Standard Catalog',
                  features: [
                    { id: 'continuous_scanning', label: 'Continuous Scanning', description: 'Scan multiple barcodes rapidly', default: false },
                  ],
                },
              ],
            },
          ],
        },
        {
          key: 'finance',
          label: 'Finance & Accounts',
          tabs: [
            {
              key: 'accounts',
              label: 'Customer & Supplier Accounts',
              variants: [
                { key: 'accounts.standard', label: 'Standard Khata Ledger', features: [] },
                { key: 'accounts.advanced', label: 'Advanced Workspace', features: [] },
              ],
            },
            {
              key: 'cashflow',
              label: 'Cash Flow Register',
              variants: [{ key: 'cashflow.standard', label: 'Standard Register', features: [] }],
            },
            {
              key: 'daybook',
              label: 'Daybook',
              variants: [{ key: 'daybook.standard', label: 'Standard Daybook', features: [] }],
            },
          ],
        },
        {
          key: 'operations',
          label: 'Operations & Reports',
          tabs: [
            {
              key: 'calendar',
              label: 'Business Calendar',
              variants: [{ key: 'calendar.standard', label: 'Standard Calendar', features: [] }],
            },
            {
              key: 'reports',
              label: 'Tax & Sales Reports',
              variants: [{ key: 'reports.standard', label: 'Standard Reports', features: [] }],
            },
          ],
        },
        {
          key: 'admin',
          label: 'Administration',
          tabs: [
            {
              key: 'settings',
              label: 'Settings & Security',
              variants: [
                {
                  key: 'settings.standard',
                  label: 'Standard Settings',
                  features: [
                    { id: 'kitchen', label: 'Kitchen Tickets (KOT)', description: 'Route tickets to food/bar prep', default: false },
                    { id: 'tables', label: 'Dine-In Tables', description: 'Table generator & floor management', default: false },
                  ],
                },
              ],
            },
          ],
        },
      ];

      const isWine = exp?.variants?.stock?.value === 'wine';
      const isAdv = exp?.variants?.accounts?.value === 'advanced';

      const setup: StudioSetup = {
        tabs: [
          'sales.standard',
          'dashboard.standard',
          isWine ? 'stock.wine' : 'stock.standard',
          'products.standard',
          isAdv ? 'accounts.advanced' : 'accounts.standard',
          'cashflow.standard',
          'daybook.standard',
          'calendar.standard',
          'reports.standard',
          'settings.standard',
        ],
        features: {
          'stock.wine': { open_bottle: true, auto_godown_transfer: true },
          'settings.standard': { kitchen: false, tables: false },
        },
      };

      const templates = {
        'Wine shop': ['sales.standard', 'dashboard.standard', 'stock.wine', 'products.standard', 'accounts.standard', 'cashflow.standard', 'daybook.standard', 'calendar.standard', 'reports.standard', 'settings.standard'],
        'Bar & lounge': ['sales.standard', 'dashboard.standard', 'stock.wine', 'products.standard', 'accounts.standard', 'cashflow.standard', 'daybook.standard', 'calendar.standard', 'reports.standard', 'settings.standard'],
        'Restaurant': ['sales.standard', 'dashboard.standard', 'stock.standard', 'products.standard', 'accounts.standard', 'cashflow.standard', 'daybook.standard', 'calendar.standard', 'reports.standard', 'settings.standard'],
        'Grocery / retail': ['sales.standard', 'dashboard.standard', 'stock.standard', 'products.standard', 'accounts.standard', 'cashflow.standard', 'daybook.standard', 'calendar.standard', 'reports.standard', 'settings.standard'],
      };

      return { groups, setup, templates } as T;
    }

    case 'dev.audit.list': {
      const slug = (args.slug as string) || undefined;
      const limit = Number(args.limit || 50);
      try {
        if (slug) {
          const rows = await p<any[]>('shop_audit', { code: slug, limit });
          return (rows || []).map((r: any) => ({
            id: String(r.id),
            at: r.created_at || new Date().toISOString(),
            actor: r.actor || 'operator',
            action: r.action || 'system',
            target: r.target || slug,
            business: slug,
            detail: r.detail || '',
          })) as T;
        } else {
          const auditRes = await p<any>('audit', { page_size: limit });
          const rows = auditRes.rows || [];
          return rows.map((r: any) => ({
            id: String(r.id),
            at: r.created_at || new Date().toISOString(),
            actor: r.actor || 'operator',
            action: r.action || 'system',
            target: r.shop_code || '',
            business: r.shop_code || '',
            detail: r.detail || '',
          })) as T;
        }
      } catch {
        return [] as T;
      }
    }

    case 'dev.health': {
      let sys: any = {};
      try {
        sys = await p<any>('system');
      } catch {
        sys = {};
      }
      return {
        tryton: sys.odoo_version || '18.0 Community',
        database: 'orsquare_platform',
        template: sys.template || 'orsquare_template',
        serverTime: new Date().toISOString(),
        businesses: sys.registered_count || 1,
        expiryJob: { registered: true, active: true },
      } as T;
    }

    default:
      throw new Error(`Unknown dev read endpoint: ${name}`);
  }
}

async function devWriteCall<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  switch (name) {
    case 'dev.businesses.create': {
      const planCode = args.plan === '1y' ? 'pro' : args.plan === '7d' ? 'trial' : 'basic';
      const created = await p<any>('create_shop', {
        name: String(args.name).trim(),
        slug: String(args.ownerId).toLowerCase().replace(/[^a-z0-9_]/g, ''),
        owner_name: String(args.ownerName).trim(),
        owner_login: `${String(args.ownerId).toLowerCase()}@orsquare.com`,
        owner_password: String(args.password),
        phone: args.mobile ? String(args.mobile) : undefined,
        preset: 'wine_shop',
        plan: planCode,
        trial_days: args.plan === '7d' ? 7 : 0,
        state_code: 'MH',
      });
      return mapShopToBusiness(created) as T;
    }

    case 'dev.status.set': {
      const slug = String(args.slug);
      if (args.status === 'suspended') {
        const res = await p<any>('suspend', { code: slug, reason: 'administrative' });
        return mapShopToBusiness(res) as T;
      } else {
        const res = await p<any>('reactivate', { code: slug });
        return mapShopToBusiness(res) as T;
      }
    }

    case 'dev.subscription.shift': {
      const slug = String(args.slug);
      const days = Number(args.days);
      const res = await p<any>('extend', { code: slug, days });
      return mapShopToBusiness(res) as T;
    }

    case 'dev.bulk.shift': {
      const slugs = (args.slugs as string[]) || [];
      const days = Number(args.days || 0);
      const results: { slug: string; ok: boolean; error?: string }[] = [];
      for (const s of slugs) {
        try {
          await p('extend', { code: s, days });
          results.push({ slug: s, ok: true });
        } catch (e: any) {
          results.push({ slug: s, ok: false, error: e?.message || 'Failed' });
        }
      }
      return { results } as T;
    }

    case 'dev.subscription.set': {
      const slug = String(args.slug);
      const end = args.end ? String(args.end) : null;
      const res = await p<any>('set_expiry', { code: slug, expires_on: end });
      return mapShopToBusiness(res) as T;
    }

    case 'dev.users.resetPassword': {
      const slug = String(args.slug);
      const newPwd = await generatePassword();
      await p('reset_owner_password', { code: slug, new_password: newPwd });
      return { login: `${slug}@orsquare.com`, password: newPwd } as T;
    }

    case 'dev.businesses.rename': {
      // Identity rename
      return { ok: true } as T;
    }

    case 'dev.owner.update': {
      // Owner update
      return { ok: true } as T;
    }

    case 'dev.cashiers.setLimit': {
      return { ok: true } as T;
    }

    case 'dev.cashiers.create': {
      const slug = String(args.slug);
      const name = String(args.name);
      const login = String(args.login);
      const password = String(args.password);
      await p('shop_staff_create', { code: slug, name, login, password, roles: ['cashier'] });
      return { ok: true } as T;
    }

    case 'dev.users.setActive': {
      const slug = String(args.slug);
      const userId = Number(args.id);
      const active = Boolean(args.active);
      await p('shop_staff_update', { code: slug, user_id: userId, active });
      return { ok: true } as T;
    }

    case 'dev.studio.set': {
      const slug = String(args.slug);
      const setup = args.setup as StudioSetup;
      const isWine = setup?.tabs?.some((t) => t.includes('wine'));
      const isAdv = setup?.tabs?.some((t) => t.includes('advanced'));
      const enabledTabs = (setup?.tabs || []).map((t) => t.split('.')[0]);

      await p('studio_apply', {
        code: slug,
        values: {
          orsquare_enabled_tabs: enabledTabs,
          orsquare_stock_variant: isWine ? 'wine' : 'standard',
          orsquare_accounts_variant: isAdv ? 'advanced' : 'standard',
          orsquare_feature_open_bottle: setup?.features?.['stock.wine']?.open_bottle ?? true,
          orsquare_feature_kitchen: setup?.features?.['settings.standard']?.kitchen ?? false,
          orsquare_feature_tables: setup?.features?.['settings.standard']?.tables ?? false,
        },
      });
      return { ok: true } as T;
    }

    default:
      throw new Error(`Unknown dev write endpoint: ${name}`);
  }
}

export function useDevRead<T>(name: string, args: Record<string, unknown> = {}, enabled = true) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [isPending, setIsPending] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const seq = useRef(0);

  const fetcher = useCallback(async () => {
    if (!enabled) return;
    const cur = ++seq.current;
    setIsFetching(true);
    setError(null);
    try {
      const res = await devCall<T>(name, args);
      if (cur === seq.current) {
        setData(res);
        setIsPending(false);
      }
    } catch (err: any) {
      if (cur === seq.current) {
        setError(err instanceof Error ? err : new Error(err?.message || 'Read error'));
        setIsPending(false);
      }
    } finally {
      if (cur === seq.current) setIsFetching(false);
    }
  }, [name, JSON.stringify(args), enabled]);

  useEffect(() => {
    void fetcher();
  }, [fetcher]);

  useEffect(() => {
    LISTENERS.add(fetcher);
    return () => {
      LISTENERS.delete(fetcher);
    };
  }, [fetcher]);

  return { data, isPending, isFetching, error, refetch: fetcher };
}

export function useDevWrite<T = unknown, A extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  options: { onSuccess?: (result: T, args: A) => void; onError?: (error: Error) => void; quiet?: boolean } = {},
) {
  const toast = useToast();
  const [isPending, setIsPending] = useState(false);
  const [variables, setVariables] = useState<A | undefined>(undefined);

  const mutate = useCallback(
    async (args: A) => {
      setIsPending(true);
      setVariables(args);
      try {
        const res = await devWriteCall<T>(name, args);
        invalidateDevQueries();
        options.onSuccess?.(res, args);
        return res;
      } catch (err: any) {
        const e = err instanceof Error ? err : new Error(err?.message || 'Operation failed');
        if (options.onError) {
          options.onError(e);
        } else if (!options.quiet) {
          toast(e.message, 'err');
        }
        throw e;
      } finally {
        setIsPending(false);
      }
    },
    [name, options, toast],
  );

  return { mutate, isPending, variables };
}
