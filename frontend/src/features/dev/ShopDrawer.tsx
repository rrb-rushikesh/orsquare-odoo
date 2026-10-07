import { useState, useEffect } from 'react';
import { Btn, Field } from '@/components/ui';
import { platformApi } from './api';
import type { PlatformShopDetail, PlatformShopRow } from './types';

interface Props {
  shop: PlatformShopRow | null;
  onClose: () => void;
  onUpdated: (shop: PlatformShopRow) => void;
}

export function ShopDrawer({ shop, onClose, onUpdated }: Props) {
  const [detail, setDetail] = useState<PlatformShopDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  // Password reset state
  const [newPassword, setNewPassword] = useState('');
  const [showPasswordBox, setShowPasswordBox] = useState(false);

  // Suspend state
  const [suspendReason, setSuspendReason] = useState('');
  const [showSuspendBox, setShowSuspendBox] = useState(false);

  useEffect(() => {
    if (!shop) return;
    setDetail(shop);
    setMsg(null);
    setShowPasswordBox(false);
    setShowSuspendBox(false);
    setLoading(true);
    platformApi.getShopDetail(shop.code)
      .then((d) => setDetail(d))
      .catch((e) => setMsg({ text: e?.message || 'Could not fetch shop detail.', type: 'err' }))
      .finally(() => setLoading(false));
  }, [shop]);

  if (!shop) return null;

  async function handleExtend(days: number) {
    if (!shop) return;
    setActionBusy(true);
    try {
      const updated = await platformApi.extendExpiry(shop.code, days);
      setDetail((prev) => prev ? { ...prev, ...updated } : updated);
      onUpdated(updated);
      setMsg({ text: `Expiry extended by ${days} days. New date: ${updated.expires_on}`, type: 'ok' });
    } catch (e: any) {
      setMsg({ text: e?.message || 'Failed to extend expiry.', type: 'err' });
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSuspend() {
    if (!shop || !suspendReason.trim()) return;
    setActionBusy(true);
    try {
      const updated = await platformApi.suspendShop(shop.code, suspendReason.trim());
      setDetail((prev) => prev ? { ...prev, ...updated } : updated);
      onUpdated(updated);
      setShowSuspendBox(false);
      setSuspendReason('');
      setMsg({ text: 'Shop has been suspended.', type: 'ok' });
    } catch (e: any) {
      setMsg({ text: e?.message || 'Failed to suspend shop.', type: 'err' });
    } finally {
      setActionBusy(false);
    }
  }

  async function handleReactivate() {
    if (!shop) return;
    setActionBusy(true);
    try {
      const updated = await platformApi.reactivateShop(shop.code);
      setDetail((prev) => prev ? { ...prev, ...updated } : updated);
      onUpdated(updated);
      setMsg({ text: 'Shop reactivated successfully.', type: 'ok' });
    } catch (e: any) {
      setMsg({ text: e?.message || 'Failed to reactivate shop.', type: 'err' });
    } finally {
      setActionBusy(false);
    }
  }

  async function handleResetPassword() {
    if (!shop || newPassword.length < 8) return;
    setActionBusy(true);
    try {
      await platformApi.resetOwnerPassword(shop.code, newPassword);
      setShowPasswordBox(false);
      setNewPassword('');
      setMsg({ text: 'Owner password has been updated.', type: 'ok' });
    } catch (e: any) {
      setMsg({ text: e?.message || 'Failed to update password.', type: 'err' });
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 480, height: '100%', background: 'var(--layer)', borderLeft: '1px solid var(--line)', padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{shop.name}</h2>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'monospace', marginTop: 4 }}>{shop.code}</div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        {/* Status notice */}
        {msg && (
          <div style={{
            padding: '10px 14px',
            fontSize: 13,
            background: msg.type === 'ok' ? 'var(--green-light, rgba(36, 161, 72, 0.1))' : 'var(--red-light, rgba(218, 30, 40, 0.1))',
            color: msg.type === 'ok' ? 'var(--green, #24a148)' : 'var(--red, #da1e28)',
            border: `1px solid ${msg.type === 'ok' ? 'var(--green, #24a148)' : 'var(--red, #da1e28)'}`
          }}>
            {msg.text}
          </div>
        )}

        {/* Quick Details */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 14, background: 'var(--canvas)', border: '1px solid var(--line)' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase' }}>Owner Login</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>{shop.owner_login}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase' }}>Phone / Mobile</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>{shop.phone || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase' }}>Plan &amp; Lifecycle</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginTop: 2, textTransform: 'capitalize' }}>
              {shop.plan} • {shop.lifecycle}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase' }}>Expires On</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>{shop.expires_on || 'Never'}</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--ink-2)' }}>Operations</div>

          {/* Expiry extension buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="secondary" onClick={() => handleExtend(7)} disabled={actionBusy}>+7 Days</Btn>
            <Btn variant="secondary" onClick={() => handleExtend(30)} disabled={actionBusy}>+30 Days</Btn>
            <Btn variant="secondary" onClick={() => handleExtend(365)} disabled={actionBusy}>+1 Year</Btn>
          </div>

          {/* Password reset trigger */}
          {!showPasswordBox ? (
            <Btn variant="secondary" onClick={() => setShowPasswordBox(true)}>Reset Owner Password</Btn>
          ) : (
            <div style={{ padding: 12, background: 'var(--canvas)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Field label="New Password (min 8 chars)">
                <input
                  className="field-control"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                />
              </Field>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="primary" onClick={handleResetPassword} disabled={actionBusy || newPassword.length < 8}>Save New Password</Btn>
                <Btn variant="secondary" onClick={() => setShowPasswordBox(false)}>Cancel</Btn>
              </div>
            </div>
          )}

          {/* Suspend / Reactivate */}
          {shop.status === 'active' ? (
            !showSuspendBox ? (
              <Btn variant="danger" onClick={() => setShowSuspendBox(true)}>Suspend Shop Access</Btn>
            ) : (
              <div style={{ padding: 12, background: 'var(--canvas)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Field label="Reason for Suspension">
                  <input
                    className="field-control"
                    type="text"
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    placeholder="e.g. Non-payment, violation"
                  />
                </Field>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant="danger" onClick={handleSuspend} disabled={actionBusy || !suspendReason.trim()}>Confirm Suspension</Btn>
                  <Btn variant="secondary" onClick={() => setShowSuspendBox(false)}>Cancel</Btn>
                </div>
              </div>
            )
          ) : (
            <Btn variant="primary" onClick={handleReactivate} disabled={actionBusy}>Reactivate Shop Access</Btn>
          )}
        </div>

        {/* Staff accounts inside shop */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--ink-2)', marginBottom: 8 }}>
            Registered Staff ({detail?.staff?.length || 0})
          </div>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Inspecting database…</div>
          ) : detail?.staff?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {detail.staff.map((u) => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>{u.login} • {u.roles.join(', ')}</div>
                  </div>
                  <span style={{ fontSize: 11, padding: '2px 6px', background: u.active ? 'var(--green-light, #defbe6)' : 'var(--red-light, #fde8e8)', color: u.active ? 'var(--green, #24a148)' : 'var(--red, #da1e28)' }}>
                    {u.active ? 'Active' : 'Disabled'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>No staff accounts found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
