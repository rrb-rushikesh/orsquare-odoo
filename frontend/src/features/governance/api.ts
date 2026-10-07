import { call } from '@/lib/api';
import type { ChangePage, Experience, GovApi, NewStaff, StaffPatch, StaffRow } from './types';

/** An owner governing their own shop. Every call is re-checked by the server (owner only). */
export const shopGov: GovApi = {
  experience: () => call<Experience>('staff', 'get_experience'),
  save: async (values, expectedVersion) => {
    await call('staff', 'update_settings', { values, expected_version: expectedVersion });
    return call<Experience>('staff', 'get_experience');
  },
  applyPreset: async (code, expectedVersion) => {
    await call('staff', 'apply_preset', { name: code, expected_version: expectedVersion });
    return call<Experience>('staff', 'get_experience');
  },
  staff: () => call<StaffRow[]>('staff', 'list_staff'),
  createStaff: async (input: NewStaff) => {
    await call('staff', 'create_staff', {
      name: input.name, login: input.login, password: input.password, roles: input.roles,
      flags: input.flags, tabs: input.tabs, phone: input.phone || undefined,
    });
    return call<StaffRow[]>('staff', 'list_staff');
  },
  updateStaff: async (id: number, patch: StaffPatch) => {
    await call('staff', 'update_staff', { user_id: id, ...patch });
    return call<StaffRow[]>('staff', 'list_staff');
  },
  resetPassword: async (id, password) => { await call('staff', 'reset_staff_password', { user_id: id, new_password: password }); },
  resetMfa: async (id) => { await call('staff', 'reset_staff_mfa', { user_id: id }); },
  changes: (offset, limit, kind) => call<ChangePage>('staff', 'audit_log', { offset, limit, kind: kind || undefined }),
};

/** A platform operator governing one shop from the Developer Console (the shop's own rules and log still apply). */
export const consoleGov = (code: string): GovApi => ({
  experience: () => call<Experience>('platform', 'shop_experience', { code }),
  save: (values, expectedVersion) =>
    call<Experience>('platform', 'studio_apply', { code, values, expected_version: expectedVersion }),
  applyPreset: (preset, expectedVersion) =>
    call<Experience>('platform', 'studio_apply', { code, preset, expected_version: expectedVersion }),
  staff: () => call<StaffRow[]>('platform', 'shop_staff', { code }),
  createStaff: async (input: NewStaff) =>
    (await call<{ staff: StaffRow[] }>('platform', 'shop_staff_create', {
      code, name: input.name, login: input.login, password: input.password, roles: input.roles,
      flags: input.flags, tabs: input.tabs, phone: input.phone || undefined,
    })).staff,
  updateStaff: (id, patch) => call<StaffRow[]>('platform', 'shop_staff_update', { code, user_id: id, ...patch }),
  resetPassword: async (id, password) => { await call('platform', 'shop_staff_reset_password', { code, user_id: id, new_password: password }); },
  resetMfa: async (id) => { await call('platform', 'shop_staff_reset_mfa', { code, user_id: id }); },
  changes: (offset, limit, kind) => call<ChangePage>('platform', 'shop_audit', { code, offset, limit, kind: kind || undefined }),
});
