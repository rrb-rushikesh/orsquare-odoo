import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Field, Modal, Tag, useToast } from '@/components/ui';
import { ApiError } from '@/lib/api';
import type { Experience, GovApi } from './types';
import './governance.css';

const FEATURE_TEXT: Record<string, { title: string; hint: string }> = {
  open_bottle: { title: 'Open bottle (pegs)', hint: 'Sell a bottle in pegs and track what is left in it.' },
  kitchen: { title: 'Kitchen', hint: 'Dishes with no stock count, sent to the kitchen on a ticket.' },
  tables: { title: 'Restaurant tables', hint: 'Open a tab on a table, add to it from any device, pay once.' },
};
const TAB_HINT: Record<string, string> = {
  settings: 'Always on: this is where Business Studio lives.',
};

/** Everything the owner may change here, as one draft that is compared with what the server last said. */
export interface Draft {
  tabs: string[];
  features: Record<string, boolean>;
  stock: string;
  accounts: string;
  autoGodown: boolean;
  scanning: boolean;
  payMode: string;
  cutoff: number;
}

export function toDraft(x: Experience): Draft {
  const s = x.settings;
  return {
    tabs: x.tabs.filter((t) => t.enabled).map((t) => t.key),
    features: Object.fromEntries(x.features.map((f) => [f.key, f.on])),
    stock: x.variants.stock.value,
    accounts: x.variants.accounts.value,
    autoGodown: !!s.orsquare_auto_godown_transfer,
    scanning: !!s.orsquare_continuous_scanning,
    payMode: String(s.orsquare_default_payment_mode ?? 'prompt'),
    cutoff: Number(s.orsquare_cutoff_hour ?? 2),
  };
}

/** Only what changed, in the field names the server expects. */
export function toValues(d: Draft, base: Draft): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  if (d.tabs.slice().sort().join() !== base.tabs.slice().sort().join()) v.orsquare_enabled_tabs = d.tabs;
  for (const [k, on] of Object.entries(d.features)) if (on !== base.features[k]) v[`orsquare_feature_${k}`] = on;
  if (d.stock !== base.stock) v.orsquare_stock_variant = d.stock;
  if (d.accounts !== base.accounts) v.orsquare_accounts_variant = d.accounts;
  if (d.autoGodown !== base.autoGodown) v.orsquare_auto_godown_transfer = d.autoGodown;
  if (d.scanning !== base.scanning) v.orsquare_continuous_scanning = d.scanning;
  if (d.payMode !== base.payMode) v.orsquare_default_payment_mode = d.payMode;
  if (d.cutoff !== base.cutoff) v.orsquare_cutoff_hour = d.cutoff;
  return v;
}

export function StudioEditor({ api, readOnly = false, onSaved }: { api: GovApi; readOnly?: boolean; onSaved?: (x: Experience) => void }) {
  const toast = useToast();
  const [exp, setExp] = useState<Experience | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setConflict(false);
    try {
      const x = await api.experience();
      setExp(x);
      setDraft(toDraft(x));
    } catch (e: any) {
      setError(e?.message || 'Could not load Business Studio.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const base = useMemo(() => (exp ? toDraft(exp) : null), [exp]);
  const changes = useMemo(() => (draft && base ? toValues(draft, base) : {}), [draft, base]);
  const dirty = Object.keys(changes).length > 0;

  if (loading && !exp) return <div className="skeleton" style={{ height: 220 }} />;
  if (error || !exp || !draft) {
    return (
      <div className="gv-banner err" role="alert">
        {error || 'Business Studio is not available.'} <Btn size="sm" variant="secondary" onClick={() => void load()}>Retry</Btn>
      </div>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const locked = readOnly || saving;

  async function save() {
    if (!exp || !dirty) return;
    setSaving(true);
    try {
      const next = await api.save(changes, exp.version);
      setExp(next);
      setDraft(toDraft(next));
      setConflict(false);
      toast('Business Studio saved.', 'ok');
      onSaved?.(next);
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true);
      else toast(e?.message || 'Could not save.', 'err');
    } finally {
      setSaving(false);
    }
  }

  async function applyPreset(code: string) {
    if (!exp) return;
    setSaving(true);
    try {
      const next = await api.applyPreset(code, exp.version);
      setExp(next);
      setDraft(toDraft(next));
      setConflict(false);
      toast('Preset applied. Nothing was deleted.', 'ok');
      onSaved?.(next);
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true);
      else toast(e?.message || 'Could not apply the preset.', 'err');
    } finally {
      setSaving(false);
      setPreset(null);
    }
  }

  const stale = !!exp.profile && exp.preset_version > 0 && exp.preset_version < exp.current_preset_version;
  const presetName = (code: string) => exp.presets.find((p) => p.code === code)?.name ?? code;

  return (
    <div className="gv-stack">
      <div className="gv-bar">
        <strong style={{ fontSize: 14 }}>Business Studio</strong>
        <Tag tone="neutral">v{exp.version}</Tag>
        {exp.plan && <Tag tone="blue">Plan: {exp.plan}</Tag>}
        {exp.profile && <Tag tone="gray">Preset: {presetName(exp.profile)}</Tag>}
        <div className="spacer">
          {dirty && !readOnly && <Btn variant="ghost" onClick={() => setDraft(toDraft(exp))} disabled={saving}>Discard</Btn>}
          {!readOnly && <Btn variant="primary" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</Btn>}
        </div>
      </div>

      {readOnly && <div className="gv-banner">Your level is read-only: you can look but not change.</div>}
      {conflict && (
        <div className="gv-banner warn" role="alert">
          Someone else changed these settings while you were editing. Reload to see their changes, then make yours again.{' '}
          <Btn size="sm" variant="secondary" onClick={() => void load()}>Reload</Btn>
        </div>
      )}
      {stale && (
        <div className="gv-banner warn">
          This shop is on version {exp.preset_version} of the {presetName(exp.profile)} preset; version {exp.current_preset_version} is available.
          Apply it again to update tabs, features and views (nothing is deleted).
        </div>
      )}

      <section className="gv-section" aria-label="Business preset">
        <header><h3>Business type</h3><span className="gv-hint">A starting point. Everything below stays adjustable.</span></header>
        <div className="gv-body">
          <div className="gv-cards" role="radiogroup" aria-label="Business type">
            {exp.presets.map((p) => (
              <button
                key={p.code}
                type="button"
                role="radio"
                aria-checked={exp.profile === p.code}
                className="gv-card"
                disabled={locked}
                onClick={() => setPreset(p.code)}
              >
                <span className="t">{p.name}{exp.profile === p.code && <Tag tone="green">Applied</Tag>}</span>
                <span className="d">{p.description}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="gv-section" aria-label="Tabs">
        <header><h3>Tabs</h3><span className="gv-hint">Switch a tab off and it disappears for everyone, and its server calls are refused.</span></header>
        <div className="gv-body">
          <div className="gv-switches">
            {exp.tabs.map((t) => {
              const on = draft.tabs.includes(t.key);
              const fixed = t.key === 'settings';
              const lock = locked || !t.entitled || fixed;
              return (
                <label key={t.key} className={`gv-switch ${on ? 'on' : ''} ${lock ? 'locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={lock}
                    onChange={(e) => set({ tabs: e.target.checked ? [...draft.tabs, t.key] : draft.tabs.filter((k) => k !== t.key) })}
                  />
                  <span>
                    <span className="t">{t.label}</span>
                    {!t.entitled ? <span className="d">Not in this plan</span> : TAB_HINT[t.key] ? <span className="d">{TAB_HINT[t.key]}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </section>

      <section className="gv-section" aria-label="Features">
        <header><h3>Features</h3></header>
        <div className="gv-body">
          <div className="gv-switches">
            {exp.features.map((f) => {
              const text = FEATURE_TEXT[f.key] ?? { title: f.key, hint: '' };
              const lock = locked || !f.entitled;
              return (
                <label key={f.key} className={`gv-switch ${draft.features[f.key] ? 'on' : ''} ${lock ? 'locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!!draft.features[f.key]}
                    disabled={lock}
                    onChange={(e) => set({ features: { ...draft.features, [f.key]: e.target.checked } })}
                  />
                  <span>
                    <span className="t">{text.title}</span>
                    <span className="d">{f.entitled ? text.hint : 'Not in this plan'}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </section>

      <section className="gv-section" aria-label="Views">
        <header><h3>Views</h3><span className="gv-hint">Same data, different presentation. Quantities, bills and history never change.</span></header>
        <div className="gv-body">
          <Field label="Stock tab">
            <div className="gv-cards" role="radiogroup" aria-label="Stock view">
              {exp.variants.stock.options.map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={draft.stock === value} className="gv-card"
                  disabled={locked} onClick={() => set({ stock: value })}>
                  <span className="t">{label}</span>
                  <span className="d">{value === 'wine' ? 'Brands down, bottle sizes across; godown and counter side by side.' : 'One row per product with its locations.'}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Accounts tab">
            <div className="gv-cards" role="radiogroup" aria-label="Accounts view">
              {exp.variants.accounts.options.map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={draft.accounts === value} className="gv-card"
                  disabled={locked} onClick={() => set({ accounts: value })}>
                  <span className="t">{label}</span>
                  <span className="d">{value === 'advanced' ? 'Parties list beside the ledger, with receipts and payments in one workspace.' : 'The usual parties list and statements.'}</span>
                </button>
              ))}
            </div>
          </Field>
        </div>
      </section>

      <section className="gv-section" aria-label="Sales register">
        <header><h3>Sales register &amp; day</h3></header>
        <div className="gv-body">
          <div className="gv-switches">
            <label className={`gv-switch ${draft.autoGodown ? 'on' : ''} ${locked ? 'locked' : ''}`}>
              <input type="checkbox" checked={draft.autoGodown} disabled={locked} onChange={(e) => set({ autoGodown: e.target.checked })} />
              <span><span className="t">Auto-move godown stock at checkout</span><span className="d">If the counter is short, the rest comes from the godown in the same sale.</span></span>
            </label>
            <label className={`gv-switch ${draft.scanning ? 'on' : ''} ${locked ? 'locked' : ''}`}>
              <input type="checkbox" checked={draft.scanning} disabled={locked} onChange={(e) => set({ scanning: e.target.checked })} />
              <span><span className="t">Continuous scanning</span><span className="d">Keep the scanner focused and lock the cart while scanning.</span></span>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Field label="Default payment">
              <select className="field-control" value={draft.payMode} disabled={locked} onChange={(e) => set({ payMode: e.target.value })}>
                <option value="prompt">Ask every time</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
              </select>
            </Field>
            <Field label="New business day starts at" hint="A sale before this hour belongs to the previous day.">
              <select className="field-control" value={draft.cutoff} disabled={locked} onChange={(e) => set({ cutoff: Number(e.target.value) })}>
                {Array.from({ length: 12 }, (_v, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </section>

      <Modal
        open={preset !== null}
        onClose={() => setPreset(null)}
        title={`Apply the ${preset ? presetName(preset) : ''} preset?`}
        width={460}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setPreset(null)} disabled={saving}>Cancel</Btn>
            <Btn variant="primary" onClick={() => preset && void applyPreset(preset)} disabled={saving}>{saving ? 'Applying…' : 'Apply preset'}</Btn>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13 }}>
          This sets the tabs, features and stock view for this kind of shop. Products, stock, bills and history are not
          touched, and you can still change every switch afterwards.
        </p>
      </Modal>
    </div>
  );
}
