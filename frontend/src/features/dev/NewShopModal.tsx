import { useState, type FormEvent } from 'react';
import { Btn, Field } from '@/components/ui';
import { platformApi } from './api';
import type { PlatformShopRow } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (shop: PlatformShopRow) => void;
}

export function NewShopModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerLogin, setOwnerLogin] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [preset, setPreset] = useState('wine_shop');
  const [plan, setPlan] = useState('trial');
  const [trialDays, setTrialDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const created = await platformApi.createShop({
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        owner_name: ownerName.trim() || ownerLogin.trim(),
        owner_login: ownerLogin.trim().toLowerCase(),
        owner_password: ownerPassword,
        phone: phone.trim() || undefined,
        preset,
        plan,
        trial_days: Number(trialDays) || 14,
        state_code: 'MH',
      });
      onCreated(created);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create shop.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 520, maxHeight: '90vh', overflowY: 'auto', background: 'var(--layer)', border: '1px solid var(--line)', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Provision New Shop</h2>
          <button className="btn-icon" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-2)' }}>✕</button>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: 'var(--red-light, rgba(218, 30, 40, 0.1))', color: 'var(--red, #da1e28)', border: '1px solid var(--red, #da1e28)', marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Shop Business Name">
            <input
              className="field-control"
              type="text"
              required
              placeholder="e.g. Galaxy Wine Store"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug) {
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20));
                }
              }}
            />
          </Field>

          <Field label="Database Slug (Code)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-2)', fontFamily: 'monospace' }}>orsquare_shop_</span>
              <input
                className="field-control"
                type="text"
                required
                pattern="^[a-z0-9_]{2,25}$"
                placeholder="e.g. galaxy"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              />
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Owner Name">
              <input
                className="field-control"
                type="text"
                required
                placeholder="e.g. Vikram Patel"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </Field>

            <Field label="Phone / Mobile">
              <input
                className="field-control"
                type="tel"
                placeholder="e.g. 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Owner Login ID">
              <input
                className="field-control"
                type="text"
                required
                autoComplete="off"
                placeholder="e.g. vikram"
                value={ownerLogin}
                onChange={(e) => setOwnerLogin(e.target.value)}
              />
            </Field>

            <Field label="Owner Password">
              <input
                className="field-control"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Min 8 characters"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Business Preset">
              <select className="field-control" value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="wine_shop">Wine Shop (Matrix / Pegs)</option>
                <option value="bar">Bar & Lounge</option>
                <option value="restaurant">Restaurant (Tables / KOT)</option>
                <option value="grocery">Grocery / Retail</option>
              </select>
            </Field>

            <Field label="Subscription Plan">
              <select className="field-control" value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option value="trial">Trial (14 Days)</option>
                <option value="basic">Basic Plan</option>
                <option value="pro">Pro Plan</option>
              </select>
            </Field>
          </div>

          {plan === 'trial' && (
            <Field label="Trial Duration (Days)">
              <input
                className="field-control"
                type="number"
                min={1}
                max={90}
                value={trialDays}
                onChange={(e) => setTrialDays(Number(e.target.value))}
              />
            </Field>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn>
            <Btn variant="primary" type="submit" disabled={busy}>
              {busy ? 'Cloning & Provisioning…' : 'Create Shop Database'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
