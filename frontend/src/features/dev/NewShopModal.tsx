import { useState, type FormEvent } from 'react';
import { Btn, Field, Modal } from '@/components/ui';
import { platformApi } from './api';
import type { Plan, PlatformShopRow } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (shop: PlatformShopRow) => void;
  plans: Plan[];
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);

/** The form unmounts with the modal, so every opening starts empty. */
function NewShopForm({ onClose, onCreated, plans }: Omit<Props, 'open'>) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [ownerLogin, setOwnerLogin] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [preset, setPreset] = useState('wine_shop');
  const [plan, setPlan] = useState('trial');
  const [trialDays, setTrialDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const created = await platformApi.createShop({
        name: name.trim(),
        slug,
        owner_name: ownerName.trim() || ownerLogin.trim(),
        owner_login: ownerLogin.trim().toLowerCase(),
        owner_password: ownerPassword,
        phone: phone.trim() || undefined,
        preset,
        plan,
        trial_days: plan === 'trial' ? Number(trialDays) || 14 : 0,
        state_code: 'MH',
      });
      onCreated(created);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create shop.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="dev-form">
      {error && <div className="dev-alert" role="alert">{error}</div>}

      <Field label="Shop business name" required>
        <input className="field-control" required autoFocus placeholder="e.g. Galaxy Wine Store" value={name}
          onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} />
      </Field>

      <Field label="Database code" required hint="Lowercase letters, numbers and _ (2 to 30). Cannot be changed later.">
        <div className="dev-prefix">
          <span className="dev-mono">orsquare_shop_</span>
          <input className="field-control" required pattern="[a-z0-9_]{2,30}" placeholder="galaxy" value={slug}
            onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); }} />
        </div>
      </Field>

      <div className="row">
        <Field label="Owner name" required>
          <input className="field-control" required placeholder="e.g. Vikram Patel" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
        </Field>
        <Field label="Mobile" hint="The owner can sign in with this number.">
          <input className="field-control" type="tel" placeholder="9876543210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>

      <div className="row">
        <Field label="Owner login" required hint="Email or username. Unique across all shops.">
          <input className="field-control" required autoComplete="off" placeholder="owner@shop.com" value={ownerLogin} onChange={(e) => setOwnerLogin(e.target.value)} />
        </Field>
        <Field label="Owner password" required hint="At least 8 characters.">
          <input className="field-control" type="password" required minLength={8} autoComplete="new-password" value={ownerPassword}
            onChange={(e) => setOwnerPassword(e.target.value)} />
        </Field>
      </div>

      <div className="row">
        <Field label="Business preset">
          <select className="field-control" value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="wine_shop">Wine shop (pegs, brand × size stock)</option>
            <option value="bar">Bar &amp; lounge</option>
            <option value="restaurant">Restaurant (tables, kitchen)</option>
            <option value="grocery">Grocery / retail</option>
          </select>
        </Field>
        <Field label="Plan">
          <select className="field-control" value={plan} onChange={(e) => setPlan(e.target.value)}>
            {(plans.length ? plans : [{ code: 'trial', name: 'Trial' } as Plan]).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </Field>
      </div>

      {plan === 'trial' && (
        <Field label="Trial length (days)">
          <input className="field-control" type="number" min={1} max={90} value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} />
        </Field>
      )}

      <div className="dev-form-foot">
        <Btn variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" type="submit" loading={busy}>{busy ? 'Provisioning…' : 'Create shop'}</Btn>
      </div>
    </form>
  );
}

export function NewShopModal({ open, onClose, onCreated, plans }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Provision new shop" width={560} closeOnEscape>
      <NewShopForm onClose={onClose} onCreated={onCreated} plans={plans} />
    </Modal>
  );
}
