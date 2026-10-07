/**
 * Which surface a signed-in identity belongs to.
 *
 * The decision uses ONLY what the server states about the identity (`surface` / `roles`). It must never use
 * `me.company`: the platform answer carries a company too, so a company check turns every developer into
 * "retail staff" and bounces them between /dev and / forever.
 */
export interface SurfaceIdentity {
  surface?: string;
  roles?: string[] | null;
}

export function isPlatformDev(me: SurfaceIdentity | null | undefined): boolean {
  return !!me && (me.surface === 'dev' || (Array.isArray(me.roles) && me.roles.includes('developer')));
}

/** Where a signed-in identity lives. */
export function homeFor(me: SurfaceIdentity | null | undefined): '/dev' | '/' {
  return isPlatformDev(me) ? '/dev' : '/';
}

/**
 * Pure routing decision for the /dev route (kept pure so it is unit-tested):
 *  - 'wait'   session still restoring: show the splash, never redirect
 *  - 'login'  nobody signed in: show the developer sign-in
 *  - 'shop'   retail staff: send to their shop
 *  - 'allow'  platform developer
 */
export function devGate(me: SurfaceIdentity | null | undefined, ready: boolean): 'wait' | 'login' | 'shop' | 'allow' {
  if (!ready) return 'wait';
  if (!me) return 'login';
  return isPlatformDev(me) ? 'allow' : 'shop';
}
