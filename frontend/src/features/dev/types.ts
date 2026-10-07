export type Lifecycle = 'active' | 'trial' | 'expiring' | 'expired' | 'suspended';

export interface PlatformShopRow {
  code: string;
  name: string;
  owner_name: string;
  owner_login: string;
  phone: string;
  plan: 'trial' | 'basic' | 'pro';
  status: 'active' | 'suspended';
  lifecycle: Lifecycle;
  expires_on: string;
  suspended_reason: string;
  created_at: string | null;
  preset: string;
}

export interface PlatformFleetResponse {
  rows: PlatformShopRow[];
  counts: Record<string, number>;
  total: number;
}

export interface PlatformAuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  shop_code: string;
  detail: string;
}

export interface PlatformSystemInfo {
  engine: string;
  platform_db: string;
  platform_module: string;
  server_time: string;
  shop_databases: number;
  registered_shops: number;
  unregistered: string[];
}

export interface PlatformShopDetail extends PlatformShopRow {
  staff?: {
    id: number;
    name: string;
    login: string;
    active: boolean;
    roles: string[];
    flags: Record<string, boolean>;
    tabs: string[];
  }[];
  settings?: Record<string, any>;
  presets?: Record<string, any>;
}
