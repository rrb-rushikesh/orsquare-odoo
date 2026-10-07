import { describe, expect, it } from 'vitest';
import { utcStamp } from '../AuditTab';

describe('utcStamp', () => {
  it('reads the server\'s naive timestamps as UTC', () => {
    const naive = utcStamp('2026-10-07T12:00:00.123456');
    const zoned = utcStamp('2026-10-07T12:00:00.123456Z');
    expect(naive).toBe(zoned);
  });

  it('keeps an explicit offset', () => {
    expect(utcStamp('2026-10-07T17:30:00+05:30')).toBe(utcStamp('2026-10-07T12:00:00Z'));
  });

  it('falls back to the raw text for a value it cannot read', () => {
    expect(utcStamp('not a date')).toBe('not a date');
  });
});
