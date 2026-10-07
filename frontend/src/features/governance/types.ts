/** Wire shapes of the governance services (`staff.*` in a shop, `platform.shop_*` in the console). */

export type Role = 'owner' | 'cashier' | 'stockkeeper';
export type Flag = 'can_see_money' | 'can_see_valuation' | 'can_manage_returns';

export interface StaffRow {
  id: number;
  name: string;
  login: string;
  active: boolean;
  roles: Role[];
  flags: Record<Flag, boolean>;
  /** Tabs they may open right now (granted AND on for the shop AND in the plan). */
  tabs: string[];
  /** Tabs the owner gave them, whatever the shop currently has switched on. */
  granted_tabs: string[];
  mfa: boolean;
}

export interface PresetInfo {
  code: string;
  name: string;
  description: string;
  version: number;
  values: Record<string, unknown>;
}

export interface Experience {
  version: number;
  profile: string;
  preset_version: number;
  current_preset_version: number;
  plan: string;
  max_staff: number;
  staff_count: number;
  tabs: { key: string; label: string; enabled: boolean; entitled: boolean }[];
  features: { key: string; on: boolean; entitled: boolean }[];
  variants: {
    stock: { value: string; options: [string, string][] };
    accounts: { value: string; options: [string, string][] };
  };
  presets: PresetInfo[];
  settings: Record<string, any>;
}

export interface ChangeRow {
  id: number;
  at: string | null;
  kind: string;
  action: string;
  target: string;
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string;
}

export interface ChangePage {
  total: number;
  limit: number;
  offset: number;
  rows: ChangeRow[];
}

export interface NewStaff {
  name: string;
  login: string;
  password: string;
  roles: Role[];
  phone?: string;
  tabs?: string[];
  flags?: Partial<Record<Flag, boolean>>;
}

export interface StaffPatch {
  roles?: Role[];
  flags?: Partial<Record<Flag, boolean>>;
  tabs?: string[];
  active?: boolean;
}

/**
 * What the shared screens need. A shop owner works on their own shop (`shopGov`); a platform operator works on a
 * shop chosen in the console (`consoleGov(code)`). The screens do not know the difference.
 */
export interface GovApi {
  experience(): Promise<Experience>;
  save(values: Record<string, unknown>, expectedVersion: number): Promise<Experience>;
  applyPreset(code: string, expectedVersion: number): Promise<Experience>;
  staff(): Promise<StaffRow[]>;
  createStaff(input: NewStaff): Promise<StaffRow[]>;
  updateStaff(id: number, patch: StaffPatch): Promise<StaffRow[]>;
  resetPassword(id: number, password: string): Promise<void>;
  resetMfa(id: number): Promise<void>;
  changes(offset: number, limit: number, kind?: string): Promise<ChangePage>;
}
