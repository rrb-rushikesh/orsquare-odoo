export type Lifecycle = 'active' | 'trial' | 'expiring' | 'expired' | 'suspended' | 'archived';
export type ShopStatus = 'active' | 'suspended' | 'archived';
export type OperatorLevel = 'admin' | 'support';

export interface PlatformShopRow {
  code: string;
  name: string;
  owner_name: string;
  owner_login: string;
  phone: string;
  plan: string;
  status: ShopStatus;
  lifecycle: Lifecycle;
  expires_on: string;
  suspended_reason: string;
  created_at: string | null;
  preset: string;
}

export interface PlatformFleetResponse {
  rows: PlatformShopRow[];
  /** Rows matching the current search/filter (for paging). */
  total: number;
  page: number;
  page_size: number;
  /** Fleet-wide counts per lifecycle, whatever the filter. */
  counts: Partial<Record<Lifecycle, number>>;
  grand_total: number;
}

export interface FleetQuery {
  search?: string;
  lifecycle?: Lifecycle | '';
  plan?: string;
  page?: number;
  page_size?: number;
  sort?: 'created' | 'name' | 'code' | 'plan' | 'expires' | 'status' | 'owner';
  desc?: boolean;
}

export interface ShopHealth {
  module_version: string | null;
  template_version: string | null;
  needs_upgrade: boolean;
  db_size_bytes: number;
  staff_count: number;
  last_day: string | null;
  day_state: string | null;
  settings_version: number;
  profile: string;
  preset_version: number;
  current_preset_version: number;
  blocked: boolean;
  directory: boolean;
  entitlements: { plan?: string; features?: string[] | null; tabs?: string[] | null; max_staff?: number };
}

export interface PlatformShopDetail extends PlatformShopRow {
  health: ShopHealth | null;
  live_error?: string;
}

export interface PlatformAuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  shop_code: string;
  detail: string;
}

export interface AuditQuery {
  page?: number;
  page_size?: number;
  shop_code?: string;
  action?: string;
  actor?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
}

export interface PlatformAuditPage {
  rows: PlatformAuditRow[];
  total: number;
  page: number;
  page_size: number;
  actions: string[];
}

export interface PlatformSystemInfo {
  engine: string;
  platform_db: string;
  platform_module: string;
  server_time: string;
  shop_databases: number;
  registered_shops: number;
  unregistered: string[];
  unregistered_count: number;
  counts: Partial<Record<Lifecycle, number>>;
  plans: Record<string, number>;
  directory_keys: number;
  operators: number;
  template: { db: string; exists: boolean; version: string | null };
  require_mfa: boolean;
  platform_db_bytes: number;
}

export interface Plan {
  code: string;
  name: string;
  description: string;
  sequence: number;
  features: string[];
  tabs: string[];
  max_staff: number;
  builtin: boolean;
  shops: number;
}

export interface PlansResponse {
  plans: Plan[];
  features: string[];
  tabs: string[];
}

export interface Operator {
  id: number;
  name: string;
  login: string;
  active: boolean;
  role: OperatorLevel;
  mfa: boolean;
}

export interface Progress {
  total: number;
  done: number;
  next_offset: number | null;
  failed: { code?: string; shop?: string; error: string }[];
  conflicts?: { shop: string; error: string }[];
}
