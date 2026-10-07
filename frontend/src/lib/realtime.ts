/**
 * Live updates (Centrifugo).
 *
 * Odoo publishes domain events after commit; this client only needs to know that SOMETHING changed so it can pull
 * the durable delta immediately instead of waiting for the next poll.  The push carries no state the app relies on:
 * a missed or duplicated push is harmless because /api/sync/delta is the source of truth.  Channels are chosen by
 * Odoo inside the signed token (the browser cannot subscribe itself to anything).  If realtime is not configured,
 * or the gateway is down, nothing breaks: the 15 s poll keeps the app current.
 */
import { Centrifuge } from 'centrifuge';
import { call } from './api';

interface TokenReply { token: string; channels: string[]; expires_in: number; url: string }

let client: Centrifuge | null = null;
let onPush: (() => void) | null = null;
let pending = 0;

export function isRealtimeLive(): boolean {
  return client?.state === 'connected';
}

export async function startRealtime(trigger: () => void): Promise<void> {
  stopRealtime();
  onPush = trigger;
  let first: TokenReply;
  try {
    first = await call<TokenReply>('realtime', 'token');
  } catch {
    return; // not configured for this shop, or offline: polling covers it
  }
  if (!first.url) return;
  const c = new Centrifuge(first.url, {
    token: first.token,
    getToken: async () => (await call<TokenReply>('realtime', 'token')).token,
  });
  c.on('publication', () => {
    // coalesce a burst (a sale publishes two events) into one pull
    window.clearTimeout(pending);
    pending = window.setTimeout(() => onPush?.(), 40);
  });
  client = c;
  c.connect();
}

export function stopRealtime(): void {
  window.clearTimeout(pending);
  client?.disconnect();
  client = null;
  onPush = null;
}
