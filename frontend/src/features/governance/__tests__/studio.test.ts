import { describe, expect, it } from 'vitest';
import { toDraft, toValues } from '../StudioEditor';
import type { Experience } from '../types';

const exp = (over: Partial<Experience> = {}): Experience => ({
  version: 3, profile: 'bar', preset_version: 2, current_preset_version: 2, plan: 'starter', max_staff: 3, staff_count: 1,
  tabs: [
    { key: 'sales', label: 'Sales', enabled: true, entitled: true },
    { key: 'stock', label: 'Stock', enabled: true, entitled: true },
    { key: 'reports', label: 'Reports', enabled: false, entitled: false },
    { key: 'settings', label: 'Settings', enabled: true, entitled: true },
  ],
  features: [{ key: 'open_bottle', on: true, entitled: true }, { key: 'kitchen', on: false, entitled: false }],
  variants: { stock: { value: 'wine', options: [['standard', 'Standard'], ['wine', 'Wine']] }, accounts: { value: 'standard', options: [] } },
  presets: [],
  settings: { orsquare_auto_godown_transfer: true, orsquare_continuous_scanning: false, orsquare_default_payment_mode: 'prompt', orsquare_cutoff_hour: 2 },
  ...over,
});

describe('Business Studio draft', () => {
  it('starts from what the server says', () => {
    const d = toDraft(exp());
    expect(d.tabs).toEqual(['sales', 'stock', 'settings']);
    expect(d.features).toEqual({ open_bottle: true, kitchen: false });
    expect(d.stock).toBe('wine');
    expect(d.cutoff).toBe(2);
  });

  it('sends nothing when nothing changed, so Save stays disabled', () => {
    const base = toDraft(exp());
    expect(toValues({ ...base }, base)).toEqual({});
    expect(toValues({ ...base, tabs: ['settings', 'stock', 'sales'] }, base)).toEqual({}); // order alone is not a change
  });

  it('sends only the fields that changed, under the server field names', () => {
    const base = toDraft(exp());
    const changed = toValues({
      ...base, tabs: ['sales', 'settings'], features: { open_bottle: false, kitchen: false }, stock: 'standard',
      scanning: true, payMode: 'upi', cutoff: 4,
    }, base);
    expect(changed).toEqual({
      orsquare_enabled_tabs: ['sales', 'settings'], orsquare_feature_open_bottle: false, orsquare_stock_variant: 'standard',
      orsquare_continuous_scanning: true, orsquare_default_payment_mode: 'upi', orsquare_cutoff_hour: 4,
    });
  });
});
