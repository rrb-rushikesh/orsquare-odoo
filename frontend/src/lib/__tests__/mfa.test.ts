import { describe, expect, it } from 'vitest';
import { isMfaChallenge } from '../api';
import { devGate } from '@/auth/surface';

describe('two-step sign-in answer', () => {
  it('tells a code challenge from a signed-in identity', () => {
    expect(isMfaChallenge({ mfa_required: true, mfa: 'totp' })).toBe(true);
    expect(isMfaChallenge({ id: 1, name: 'A', login: 'a', roles: ['owner'] } as any)).toBe(false);
  });

  it('an operator who has no authenticator yet is still a developer, so the gate shows the enrolment screen not a redirect', () => {
    const operator = { surface: 'dev', roles: ['developer'] };
    expect(devGate(operator, true)).toBe('allow');
  });
});
