import { call } from '@/lib/api';
import type {
  PlatformFleetResponse,
  PlatformShopDetail,
  PlatformAuditRow,
  PlatformSystemInfo,
  PlatformShopRow,
} from './types';

export const platformApi = {
  getFleet: (search?: string, lifecycle?: string): Promise<PlatformFleetResponse> =>
    call<PlatformFleetResponse>('platform', 'fleet', { search, lifecycle }),

  getShopDetail: (code: string): Promise<PlatformShopDetail> =>
    call<PlatformShopDetail>('platform', 'shop_detail', { code }),

  createShop: (payload: {
    name: string;
    slug: string;
    owner_name: string;
    owner_login: string;
    owner_password: string;
    phone?: string;
    preset?: string;
    plan?: string;
    trial_days?: number;
    state_code?: string;
  }): Promise<PlatformShopRow> =>
    call<PlatformShopRow>('platform', 'create_shop', payload),

  suspendShop: (code: string, reason: string): Promise<PlatformShopRow> =>
    call<PlatformShopRow>('platform', 'suspend', { code, reason }),

  reactivateShop: (code: string): Promise<PlatformShopRow> =>
    call<PlatformShopRow>('platform', 'reactivate', { code }),

  resetOwnerPassword: (code: string, new_password: string): Promise<boolean> =>
    call<boolean>('platform', 'reset_owner_password', { code, new_password }),

  extendExpiry: (code: string, days: number): Promise<PlatformShopRow> =>
    call<PlatformShopRow>('platform', 'extend', { code, days }),

  setExpiry: (code: string, expires_on: string, plan?: string): Promise<PlatformShopRow> =>
    call<PlatformShopRow>('platform', 'set_expiry', { code, expires_on, plan }),

  applyStudio: (code: string, values?: Record<string, any>, preset?: string): Promise<Record<string, any>> =>
    call<Record<string, any>>('platform', 'studio_apply', { code, values, preset }),

  getAudit: (limit = 100, shop_code?: string): Promise<PlatformAuditRow[]> =>
    call<PlatformAuditRow[]>('platform', 'audit', { limit, shop_code }),

  getSystem: (): Promise<PlatformSystemInfo> =>
    call<PlatformSystemInfo>('platform', 'system'),
};
