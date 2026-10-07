import { call } from '@/lib/api';
import type {
  AuditQuery, FleetQuery, Operator, OperatorLevel, PlansResponse, PlatformAuditPage, PlatformFleetResponse,
  PlatformShopDetail, PlatformShopRow, PlatformSystemInfo, Progress,
} from './types';

const p = <T>(method: string, params: Record<string, unknown> = {}) => call<T>('platform', method, params);

/** Every call is re-checked by the server: admin may change, support may only look, both need the authenticator. */
export const platformApi = {
  // fleet & shops
  getFleet: (q: FleetQuery = {}): Promise<PlatformFleetResponse> => p('fleet', { ...q, lifecycle: q.lifecycle || undefined }),
  getShopDetail: (code: string): Promise<PlatformShopDetail> => p('shop_detail', { code }),
  createShop: (payload: {
    name: string; slug: string; owner_name: string; owner_login: string; owner_password: string;
    phone?: string; preset?: string; plan?: string; trial_days?: number; state_code?: string;
  }): Promise<PlatformShopRow> => p('create_shop', payload),
  suspendShop: (code: string, reason: string): Promise<PlatformShopRow> => p('suspend', { code, reason }),
  reactivateShop: (code: string): Promise<PlatformShopRow> => p('reactivate', { code }),
  archiveShop: (code: string, reason?: string): Promise<PlatformShopRow> => p('archive', { code, reason }),
  deleteShop: (code: string, confirm: string): Promise<boolean> => p('delete_shop', { code, confirm }),
  resetOwnerPassword: (code: string, new_password: string): Promise<boolean> => p('reset_owner_password', { code, new_password }),
  extendExpiry: (code: string, days: number): Promise<PlatformShopRow> => p('extend', { code, days }),
  setExpiry: (code: string, expires_on: string | null, plan?: string): Promise<PlatformShopRow> => p('set_expiry', { code, expires_on, plan }),
  // plans
  getPlans: (): Promise<PlansResponse> => p('plans'),
  savePlan: (plan: { code: string; name: string; features: string[]; tabs: string[]; max_staff: number; description?: string }): Promise<PlansResponse> =>
    p('save_plan', plan),
  deletePlan: (code: string): Promise<PlansResponse> => p('delete_plan', { code }),
  pushPlan: (code: string, offset: number, limit = 25): Promise<Progress> => p('push_plan', { code, offset, limit }),
  // operators
  getOperators: (): Promise<Operator[]> => p('operators'),
  createOperator: (o: { name: string; login: string; password: string; role: OperatorLevel }): Promise<Operator> => p('create_operator', o),
  setOperatorRole: (user_id: number, role: OperatorLevel): Promise<Operator> => p('set_operator_role', { user_id, role }),
  setOperatorActive: (user_id: number, active: boolean): Promise<Operator> => p('set_operator_active', { user_id, active }),
  resetOperatorPassword: (user_id: number, new_password: string): Promise<boolean> => p('reset_operator_password', { user_id, new_password }),
  resetOperatorMfa: (user_id: number): Promise<boolean> => p('reset_operator_mfa', { user_id }),
  // audit & system
  getAudit: (q: AuditQuery = {}): Promise<PlatformAuditPage> => p('audit', q as Record<string, unknown>),
  getSystem: (): Promise<PlatformSystemInfo> => p('system'),
  rebuildDirectory: (offset: number, limit = 25): Promise<Progress> => p('rebuild_directory', { offset, limit }),
  adoptShop: (db_name: string, plan = 'trial'): Promise<PlatformShopRow> => p('adopt_unregistered', { db_name, plan }),
};

/** Run a sliced, resumable job (push a plan, rebuild the directory) until it reports it is done. */
export async function runSliced(
  step: (offset: number) => Promise<Progress>,
  onProgress: (p: Progress) => void,
): Promise<Progress> {
  let offset = 0;
  const failed: Progress['failed'] = [];
  const conflicts: NonNullable<Progress['conflicts']> = [];
  for (;;) {
    const r = await step(offset);
    failed.push(...r.failed);
    conflicts.push(...(r.conflicts ?? []));
    const merged = { ...r, failed, conflicts };
    onProgress(merged);
    if (r.next_offset === null) return merged;
    offset = r.next_offset;
  }
}
