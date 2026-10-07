import { describe, expect, it } from 'vitest';
import { devGate, homeFor, isPlatformDev } from '../surface';

// The platform answer carries a `company` like a shop answer does. Routing must ignore it.
const developer = { surface: 'dev', roles: ['developer'], company: { id: 1, name: 'ORSquare Platform' } };
const owner = { roles: ['owner'], company: { id: 7, name: 'Krishna Wines' } };
const cashier = { roles: ['cashier'], company: { id: 7, name: 'Krishna Wines' } };

describe('isPlatformDev', () => {
  it('accepts the server-stated developer identity, with or without a company', () => {
    expect(isPlatformDev(developer)).toBe(true);
    expect(isPlatformDev({ surface: 'dev' })).toBe(true);
    expect(isPlatformDev({ roles: ['developer'] })).toBe(true);
  });

  it('rejects retail staff and empty or malformed identities', () => {
    expect(isPlatformDev(owner)).toBe(false);
    expect(isPlatformDev(cashier)).toBe(false);
    expect(isPlatformDev(null)).toBe(false);
    expect(isPlatformDev(undefined)).toBe(false);
    expect(isPlatformDev({ roles: null })).toBe(false);
    expect(isPlatformDev({})).toBe(false);
  });
});

describe('devGate (the /dev route decision)', () => {
  it('never redirects while the session is restoring', () => {
    expect(devGate(null, false)).toBe('wait');
    expect(devGate(owner, false)).toBe('wait');
  });

  it('shows the developer sign-in to a visitor who is not signed in', () => {
    expect(devGate(null, true)).toBe('login');
  });

  it('lets a developer in even though the platform identity has a company (regression: /dev <-> / loop)', () => {
    expect(devGate(developer, true)).toBe('allow');
  });

  it('sends every kind of retail staff to their shop', () => {
    expect(devGate(owner, true)).toBe('shop');
    expect(devGate(cashier, true)).toBe('shop');
    expect(devGate({ roles: [] }, true)).toBe('shop');
  });
});

describe('homeFor', () => {
  it('routes each surface to its own home so /dev and / can never bounce each other', () => {
    expect(homeFor(developer)).toBe('/dev');
    expect(homeFor(owner)).toBe('/');
    // A developer is allowed in /dev and a retail user is sent to /: the two decisions never disagree.
    for (const who of [developer, owner, cashier]) {
      const target = homeFor(who);
      expect(devGate(who, true) === 'allow').toBe(target === '/dev');
    }
  });
});
