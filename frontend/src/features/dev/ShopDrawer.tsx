import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Drawer, Field, Modal, Tag, useToast } from '@/components/ui';
import { ChangeLog } from '@/features/governance/ChangeLog';
import { StaffManager } from '@/features/governance/StaffManager';
import { StudioEditor } from '@/features/governance/StudioEditor';
import { consoleGov } from '@/features/governance/api';
import { platformApi } from './api';
import { AuditView } from './AuditTab';
import { LIFECYCLE_TONE } from './FleetTab';
import type { Plan, PlatformShopDetail, PlatformShopRow } from './types';

interface Props {
  shop: PlatformShopRow | null;
  canWrite: boolean;
  plans: Plan[];
  onClose: () => void;
  /** The shop's registry row changed (plan, expiry, status). */
  onChanged: (row: PlatformShopRow | null) => void;
  onDeleted: () => void;
}

type Section = 'overview' | 'studio' | 'team' | 'activity';
type Dialog = null | 'password' | 'suspend' | 'archive' | 'delete';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'studio', label: 'Business Studio' },
  { key: 'team', label: 'Team & access' }, { key: 'activity', label: 'Activity' },
];

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes > 1e9 ? 0 : 1)} MB`;

function Overview({ shop, detail, canWrite, plans, onChanged, onDeleted }: {
  shop: PlatformShopRow; detail: PlatformShopDetail | null; canWrite: boolean; plans: Plan[];
  onChanged: (row: PlatformShopRow) => void; onDeleted: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState(shop.plan);
  const [expiry, setExpiry] = useState(shop.expires_on);
  useEffect(() => { setPlan(shop.plan); setExpiry(shop.expires_on); }, [shop.plan, shop.expires_on]);

  const health = detail?.health ?? null;
  const planChanged = plan !== shop.plan || expiry !== (shop.expires_on || '');
  const archived = shop.status === 'archived';
  const blocked = shop.status !== 'active';

  async function run<T extends PlatformShopRow | boolean>(fn: () => Promise<T>, ok: string) {
    setBusy(true);
    try {
      const r = await fn();
      if (typeof r === 'object') onChanged(r);
      toast(ok, 'ok');
      setDialog(null);
      setText('');
      return true;
    } catch (e: any) {
      toast(e?.message || 'That did not work.', 'err');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const close = () => { setDialog(null); setText(''); };

  return (
    <>
      {detail?.live_error && <div className="dev-alert" role="alert">Could not look inside this shop's database: {detail.live_error}</div>}
      {shop.suspended_reason && blocked && <div className="dev-alert" role="status">{archived ? 'Archived' : 'Suspended'}: {shop.suspended_reason}</div>}

      <dl className="dev-kv">
        <div><dt>Owner</dt><dd>{shop.owner_name} <span className="dev-muted">({shop.owner_login})</span></dd></div>
        <div><dt>Mobile</dt><dd>{shop.phone || '—'}</dd></div>
        <div><dt>Plan</dt><dd style={{ textTransform: 'capitalize' }}>{shop.plan} <Tag tone={LIFECYCLE_TONE[shop.lifecycle] ?? 'neutral'}>{shop.lifecycle}</Tag></dd></div>
        <div><dt>Expires</dt><dd>{shop.expires_on || 'No expiry'}</dd></div>
        <div><dt>Created</dt><dd>{shop.created_at ? new Date(shop.created_at + 'Z').toLocaleDateString() : '—'}</dd></div>
        <div><dt>Preset</dt><dd style={{ textTransform: 'capitalize' }}>{(shop.preset || '—').replace('_', ' ')}</dd></div>
      </dl>

      {health && (
        <div>
          <div className="dev-section-title">Health</div>
          <dl className="dev-kv">
            <div><dt>Software</dt><dd>{health.module_version ?? '—'} {health.needs_upgrade && <Tag tone="amber">Needs upgrade to {health.template_version}</Tag>}</dd></div>
            <div><dt>Database size</dt><dd>{mb(health.db_size_bytes)}</dd></div>
            <div><dt>Staff</dt><dd>{health.staff_count}{health.entitlements.max_staff ? ` of ${health.entitlements.max_staff}` : ''}</dd></div>
            <div><dt>Last business day</dt><dd>{health.last_day ?? '—'} {health.day_state && <span className="dev-muted">({health.day_state})</span>}</dd></div>
            <div><dt>Studio version</dt><dd>v{health.settings_version} {health.profile && health.preset_version < health.current_preset_version && <Tag tone="amber">Preset v{health.preset_version} is old</Tag>}</dd></div>
            <div><dt>Sign-in directory</dt><dd>{health.directory ? <Tag tone="green">On</Tag> : <Tag tone="amber">Off — rebuild it in System</Tag>}</dd></div>
          </dl>
        </div>
      )}

      {canWrite && (
        <div>
          <div className="dev-section-title">Subscription</div>
          <div className="dev-form">
            <div className="row">
              <Field label="Plan">
                <select className="field-control" value={plan} disabled={busy} onChange={(e) => setPlan(e.target.value)}>
                  {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Expires on" hint="Empty = no expiry.">
                <input className="field-control" type="date" value={expiry} disabled={busy} onChange={(e) => setExpiry(e.target.value)} />
              </Field>
            </div>
            <div className="dev-actions">
              <Btn variant="primary" disabled={busy || !planChanged}
                onClick={() => void run(() => platformApi.setExpiry(shop.code, expiry || null, plan), 'Subscription updated.')}>
                Save subscription
              </Btn>
              {[7, 30, 365].map((d) => (
                <Btn key={d} variant="secondary" disabled={busy} onClick={() => void run(() => platformApi.extendExpiry(shop.code, d), `Extended by ${d === 365 ? '1 year' : `${d} days`}.`)}>
                  +{d === 365 ? '1 year' : `${d} days`}
                </Btn>
              ))}
            </div>
          </div>
        </div>
      )}

      {canWrite && (
        <div>
          <div className="dev-section-title">Access</div>
          <div className="dev-actions">
            <Btn variant="secondary" disabled={busy} onClick={() => setDialog('password')}>Reset owner password</Btn>
            {blocked
              ? <Btn variant="primary" disabled={busy} onClick={() => void run(() => platformApi.reactivateShop(shop.code), 'Shop is back in service.')}>Reactivate shop</Btn>
              : <Btn variant="danger" disabled={busy} onClick={() => setDialog('suspend')}>Suspend shop</Btn>}
            {!archived && <Btn variant="secondary" disabled={busy} onClick={() => setDialog('archive')}>Archive shop</Btn>}
          </div>
        </div>
      )}

      {canWrite && archived && (
        <div>
          <div className="dev-section-title">Danger zone</div>
          <div className="dev-alert">
            Deleting removes the shop's database, files and sign-in keys for good. This cannot be undone.
            <div style={{ marginTop: 8 }}><Btn variant="danger" disabled={busy} onClick={() => setDialog('delete')}>Delete permanently…</Btn></div>
          </div>
        </div>
      )}

      <Modal open={dialog === 'password'} onClose={close} title="Reset owner password" width={440}
        footer={<><Btn variant="secondary" onClick={close}>Cancel</Btn>
          <Btn variant="primary" disabled={busy || text.length < 8} onClick={() => void run(() => platformApi.resetOwnerPassword(shop.code, text), 'Owner password updated.')}>Save password</Btn></>}>
        <Field label="New password" hint="At least 8 characters. The owner's other sessions are signed out.">
          <input className="field-control" type="password" autoFocus autoComplete="new-password" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={dialog === 'suspend'} onClose={close} title="Suspend shop access" width={440}
        footer={<><Btn variant="secondary" onClick={close}>Cancel</Btn>
          <Btn variant="danger" disabled={busy || !text.trim()} onClick={() => void run(() => platformApi.suspendShop(shop.code, text.trim()), 'Shop suspended.')}>Suspend</Btn></>}>
        <Field label="Reason" hint="Recorded in the audit trail. Staff are blocked at sign-in and see that the shop is suspended.">
          <input className="field-control" autoFocus placeholder="e.g. Non-payment" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={dialog === 'archive'} onClose={close} title="Archive shop" width={440}
        footer={<><Btn variant="secondary" onClick={close}>Cancel</Btn>
          <Btn variant="primary" disabled={busy} onClick={() => void run(() => platformApi.archiveShop(shop.code, text.trim() || undefined), 'Shop archived.')}>Archive</Btn></>}>
        <p style={{ marginTop: 0, fontSize: 13 }}>An archived shop is blocked like a suspended one but kept intact. You can bring it back, or delete it later.</p>
        <Field label="Reason (optional)">
          <input className="field-control" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={dialog === 'delete'} onClose={close} title="Delete shop permanently" width={460}
        footer={<><Btn variant="secondary" onClick={close}>Cancel</Btn>
          <Btn variant="danger" disabled={busy || text !== shop.code}
            onClick={async () => { if (await run(() => platformApi.deleteShop(shop.code, text), 'Shop deleted.')) onDeleted(); }}>Delete forever</Btn></>}>
        <p style={{ marginTop: 0, fontSize: 13 }}>Type <strong className="dev-mono">{shop.code}</strong> to confirm.</p>
        <Field label="Shop code">
          <input className="field-control dev-mono" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}

export function ShopDrawer({ shop, canWrite, plans, onClose, onChanged, onDeleted }: Props) {
  const [section, setSection] = useState<Section>('overview');
  const [detail, setDetail] = useState<PlatformShopDetail | null>(null);
  const code = shop?.code;

  const loadDetail = useCallback(async () => {
    if (!code) return;
    try { setDetail(await platformApi.getShopDetail(code)); } catch { setDetail(null); }
  }, [code]);

  useEffect(() => { setSection('overview'); setDetail(null); void loadDetail(); }, [loadDetail]);

  const api = useMemo(() => (code ? consoleGov(code) : null), [code]);

  return (
    <Drawer open={!!shop} onClose={onClose} title={shop?.name ?? 'Shop'} wide>
      {shop && api && (
        <>
          <div className="dev-mono dev-muted">{shop.code}</div>
          <div className="dev-tabs dev-subtabs" role="tablist" aria-label="Shop sections">
            {SECTIONS.map((s) => (
              <button key={s.key} type="button" role="tab" className="dev-tab" aria-selected={section === s.key} onClick={() => setSection(s.key)}>
                {s.label}
              </button>
            ))}
          </div>

          {section === 'overview' && (
            <Overview shop={shop} detail={detail} canWrite={canWrite} plans={plans} onDeleted={onDeleted}
              onChanged={(row) => { onChanged(row); void loadDetail(); }} />
          )}
          {section === 'studio' && <StudioEditor api={api} readOnly={!canWrite} onSaved={() => { onChanged(null); void loadDetail(); }} />}
          {section === 'team' && <StaffManager api={api} readOnly={!canWrite} maxStaff={detail?.health?.entitlements.max_staff ?? 0} />}
          {section === 'activity' && (
            <div className="dev-stack">
              <div>
                <div className="dev-section-title">Changes made inside this shop</div>
                <ChangeLog api={api} />
              </div>
              <div>
                <div className="dev-section-title">Operator actions on this shop</div>
                <AuditView shopCode={shop.code} />
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
