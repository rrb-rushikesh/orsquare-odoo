/**
 * The workspace store: one in-memory snapshot of the shop, kept in step with Odoo.
 *
 *   open        -> render the last local snapshot immediately, then bootstrap from the server
 *   every 15 s  -> /api/sync/delta (also on focus / back online); a cursor Odoo does not know -> full re-bootstrap
 *   billing     -> online: sales.settle.  Offline (network error only): durable outbox, flushed in device order
 *
 * The snapshot is a read cache.  It is never a ledger: counts shown while offline are display hints, and the
 * next patch from the server replaces them.
 */
import { call, sync, ApiError, type Bootstrap, type Me, type WireCustomer, type WireProduct, type WireStock } from './api';
import { closeShopDb, deviceId, openShopDb, type OutboxRow } from './db';
import { isRealtimeLive, startRealtime, stopRealtime } from './realtime';

export interface Snapshot {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  online: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  seq: number;
  me: Me | null;
  products: WireProduct[];
  stock: WireStock[];
  customers: WireCustomer[];
  suppliers: WireCustomer[];
  categories: Bootstrap['categories'];
  units: Bootstrap['units'] | null;
  brands: Bootstrap['brands'];
  regimes: Bootstrap['regimes'];
  openBottles: any[];
  day: any | null;
  floors: any[];
  tables: any[];
  promos: any[];
  discrepanciesOpen: number;
  /** Bills waiting to reach the server / refused by it. */
  pending: number;
  rejected: OutboxRow[];
}

const EMPTY: Snapshot = {
  status: 'loading', error: null, online: true, syncing: false, lastSyncedAt: null, seq: 0, me: null,
  products: [], stock: [], customers: [], suppliers: [], categories: [], units: null, brands: [], regimes: [], openBottles: [],
  day: null, floors: [], tables: [], promos: [], discrepanciesOpen: 0, pending: 0, rejected: [],
};

let snap: Snapshot = EMPTY;
const listeners = new Set<() => void>();
let db: ReturnType<typeof openShopDb> | null = null;
let timer: number | null = null;
let serverTs: string | undefined;
let flushing = false;
let bound = false;

const emit = () => {
  listeners.forEach((l) => l());
  window.dispatchEvent(new CustomEvent('xpo_sync_change', { detail: status() }));
};
export interface SyncStatus { isOnline: boolean; isSyncing: boolean; pendingCount: number; lastSyncedAt: string | null; lastError: string | null }
const status = (): SyncStatus => ({ isOnline: snap.online, isSyncing: snap.syncing, pendingCount: snap.pending, lastSyncedAt: snap.lastSyncedAt, lastError: snap.error });
export async function getSyncStatus(): Promise<SyncStatus> { return status(); }
export const pullCatalogDelta = async (_shop?: string) => refreshNow();
export const flushOfflineSalesQueue = async () => refreshNow();
export interface QueueInspectionRow { id: string; idempotency_key: string; status: string; total: number; lineCount: number; attempts: number; created_at: string; last_error?: string }
export async function listQueueForReview(): Promise<QueueInspectionRow[]> {
  if (!db) return [];
  return (await db.outbox.toArray()).map(r => ({ id: r.id, idempotency_key: r.id, status: r.status, total: Number(r.payload.estimated_total ?? NaN),
    lineCount: Array.isArray(r.payload.lines) ? r.payload.lines.length : 0, attempts: 0, created_at: r.created_at, last_error: r.error }));
}
export async function retryQueuedSale(_id: string): Promise<void> { throw new ApiError('Rejected bills need review before retrying.', 'not_available'); }
export async function discardQueuedSale(id: string): Promise<void> {
  const row = await db?.outbox.get(id);
  if (!row || row.status !== 'rejected') throw new ApiError('Only a rejected bill can be discarded.');
  await discardRejected(id);
}
export async function getOfflineCacheStats() { return { products: snap.products.length, categories: snap.categories.length, customers: snap.customers.length,
  queue: db ? await db.outbox.count() : 0, lastSync: snap.lastSyncedAt }; }
export async function purgeCatalogCache() {
  await db?.kv.bulkDelete(['products', 'categories', 'customers', 'snapshotVersion']);
  await bootstrapNow();
}
function set(patch: Partial<Snapshot>) {
  snap = { ...snap, ...patch };
  emit();
}

export const getSnapshot = () => snap;
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// ------------------------------------------------------------------------------------------------ persistence

/** Bump when the snapshot gains or changes a section: devices holding an older copy re-download instead of showing gaps. */
const SNAPSHOT_VERSION = 4;

const SECTIONS = ['me', 'products', 'stock', 'customers', 'suppliers', 'categories', 'units', 'brands', 'regimes', 'openBottles',
  'day', 'floors', 'tables', 'promos', 'discrepanciesOpen', 'seq', 'serverTs'] as const;

async function persist() {
  if (!db) return;
  const rows = [...SECTIONS.map((key) => ({ key: key as string, value: key === 'serverTs' ? serverTs : (snap as any)[key] })), { key: 'snapshotVersion', value: SNAPSHOT_VERSION }];
  try { await db.kv.bulkPut(rows); } catch { /* storage full or blocked: the app still works online */ }
}

async function loadLocal(): Promise<boolean> {
  if (!db) return false;
  try {
    const rows = await db.kv.toArray();
    if (!rows.length) return false;
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!m.me || m.snapshotVersion !== SNAPSHOT_VERSION) return false;   // older copy: bootstrap again
    serverTs = m.serverTs as string | undefined;
    const patch: any = {};
    for (const k of SECTIONS) if (k !== 'serverTs' && m[k] !== undefined) patch[k] = m[k];
    set({ ...patch, status: 'ready' });
    return true;
  } catch {
    return false;
  }
}

async function refreshOutboxCounts() {
  if (!db) return;
  const all = await db.outbox.toArray();
  set({ pending: all.filter((r) => r.status === 'queued').length, rejected: all.filter((r) => r.status === 'rejected') });
}

// ------------------------------------------------------------------------------------------------ server -> snapshot

function applyBootstrap(b: Bootstrap) {
  serverTs = b.server_ts;
  set({
    status: 'ready', error: null, online: true, seq: b.seq, me: b.me, products: b.products, stock: b.stock,
    customers: b.customers, suppliers: b.suppliers ?? [], categories: b.categories, units: b.units, brands: b.brands, regimes: b.regimes,
    openBottles: b.open_bottles, day: b.day, floors: b.floors, tables: b.tables, promos: b.promos,
    discrepanciesOpen: b.discrepancies_open, lastSyncedAt: new Date().toISOString(),
  });
  void persist();
}

function upsertById<T extends { id: number }>(rows: T[], incoming: T[]): T[] {
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const r of incoming) map.set(r.id, r);
  return [...map.values()];
}

async function pullDelta() {
  const d = await sync.delta(snap.seq, serverTs);
  if (d.reset) return bootstrapNow();
  const p = d.patches || {};
  const patch: Partial<Snapshot> = { seq: d.seq, online: true, lastSyncedAt: new Date().toISOString() };
  if (p.products) patch.products = upsertById(snap.products, p.products);
  if (p.stock) patch.stock = p.stock;
  if (p.open_bottles) patch.openBottles = p.open_bottles;
  if (p.day) patch.day = p.day;
  if (p.tables) patch.tables = p.tables;
  if (p.customers) patch.customers = p.customers;
  if (p.suppliers) patch.suppliers = p.suppliers;
  if (p.me) patch.me = p.me;
  serverTs = d.server_ts || serverTs;
  set(patch);
  void persist();
  // A settings change (features, tabs, roles) alters many sections at once: take a fresh snapshot.
  if (p.me) return bootstrapNow();
  if (d.has_more) await pullDelta();
}

export async function bootstrapNow() {
  applyBootstrap(await sync.bootstrap());
}

export async function refreshNow(): Promise<void> {
  if (snap.syncing) return;
  set({ syncing: true });
  try {
    await flushOutbox();
    if (snap.status === 'ready' && snap.seq) await pullDelta();
    else await bootstrapNow();
    set({ error: null });
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) {
      window.dispatchEvent(new CustomEvent('or2:unauthorized'));
    } else if (err.network) {
      set({ online: false });
    } else {
      set({ error: err.message, status: snap.status === 'loading' ? 'error' : snap.status });
    }
  } finally {
    set({ syncing: false });
  }
}

// ------------------------------------------------------------------------------------------------ outbox

async function flushOutbox() {
  if (!db || flushing) return;
  flushing = true;
  try {
    const rows = (await db.outbox.where('status').equals('queued').sortBy('device_seq')).slice(0, 25);
    if (!rows.length) return;
    const res = await sync.flush(rows.map((r) => ({
      id: r.id, device_id: deviceId(), device_seq: r.device_seq, kind: r.kind, created_at: r.created_at,
      payload: r.payload,
    })));
    for (const r of res.results) {
      if (r.status === 'ok' || r.status === 'duplicate') {
        if (r.status === 'duplicate' && r.applied_status === 'error') {
          await db.outbox.update(r.id, { status: 'rejected', error: r.error?.message || 'Refused by the server' });
        } else {
          await db.outbox.delete(r.id);
        }
      } else if (r.status === 'error') {
        await db.outbox.update(r.id, { status: 'rejected', error: r.error?.message || 'Refused by the server' });
      }
      /* out_of_order: left queued; the earlier mutation is retried first on the next pass */
    }
  } finally {
    flushing = false;
    await refreshOutboxCounts();
  }
}

async function nextDeviceSeq(): Promise<number> {
  const key = 'or2_device_seq';
  // The server expects exactly last+1 per device, so the counter must survive reloads.
  const server = Number(localStorage.getItem(key) || '0');
  const top = db ? (await db.outbox.orderBy('device_seq').last())?.device_seq ?? 0 : 0;
  const next = Math.max(server, top) + 1;
  localStorage.setItem(key, String(next));
  return next;
}

export interface SettleResult {
  queued: boolean;
  result?: any;
}

const SERVICE_OF: Record<'sale' | 'purchase', [string, string]> = { sale: ['sales', 'settle'], purchase: ['purchases', 'record_bill'] };

/**
 * Send a mutation that the offline spec allows to be queued (a sale or a purchase bill).
 * Online: straight to Odoo.  Only a NETWORK failure queues it (a business refusal such as "not enough stock" is
 * shown to the user, never silently queued).  The `client_ref` is the idempotency key either way.
 */
export async function submitMutation(kind: 'sale' | 'purchase', payload: Record<string, unknown> & { client_ref: string }): Promise<SettleResult> {
  const [service, method] = SERVICE_OF[kind];
  try {
    const result = await call(service, method, { payload });
    void refreshNow();
    return { queued: false, result };
  } catch (e) {
    if (!(e instanceof ApiError) || !e.network || !db) throw e;
    const row: OutboxRow = {
      id: payload.client_ref, device_seq: await nextDeviceSeq(), kind,
      payload: { ...payload, offline: true }, created_at: new Date().toISOString(), status: 'queued',
    };
    await db.outbox.put(row);
    set({ online: false });
    await refreshOutboxCounts();
    return { queued: true };
  }
}

/** Bill a sale: straight to Odoo when online, otherwise into the durable outbox. */
export const submitSale = (payload: Record<string, unknown> & { client_ref: string }) => submitMutation('sale', payload);

/**
 * Queue-first mutation for actions with no natural idempotency key of their own (stock transfers).
 * The action is written to the durable outbox FIRST and then flushed: the server remembers the mutation id, so a
 * lost response followed by a retry can never move the stock twice.  Returns `queued: true` when the device is
 * offline (it will be applied on reconnect); a refusal by Odoo is thrown to the caller with the server's reason.
 */
export async function submitQueued(kind: 'stock_transfer', payload: Record<string, unknown>): Promise<SettleResult> {
  if (!db) throw new ApiError('The shop is not ready yet.', 'state');
  const id = crypto.randomUUID();
  await db.outbox.put({ id, device_seq: await nextDeviceSeq(), kind, payload, created_at: new Date().toISOString(), status: 'queued' });
  await refreshOutboxCounts();
  try {
    await flushOutbox();
  } catch (e) {
    if (e instanceof ApiError && e.network) { set({ online: false }); return { queued: true }; }
    throw e;
  }
  const row = await db.outbox.get(id);
  if (!row) { void refreshNow(); return { queued: false } }
  if (row.status === 'rejected') {
    await db.outbox.delete(id);
    await refreshOutboxCounts();
    throw new ApiError(row.error || 'Odoo refused this action.', 'rejected');
  }
  return { queued: true };   // out-of-order or still waiting: stays queued
}

export async function discardRejected(id: string) {
  await db?.outbox.delete(id);
  await refreshOutboxCounts();
}

// ------------------------------------------------------------------------------------------------ lifecycle

const POLL_VISIBLE = 15_000;
const POLL_VISIBLE_WITH_PUSH = 60_000;   // a live socket tells us about changes; the poll is only a safety net
const POLL_HIDDEN = 60_000;

function schedule() {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    await refreshNow();
    schedule();
  }, document.hidden ? POLL_HIDDEN : isRealtimeLive() ? POLL_VISIBLE_WITH_PUSH : POLL_VISIBLE);
}

export async function startStore(shop: string, me: Me) {
  stopStore();
  db = openShopDb(shop, me.id);
  snap = { ...EMPTY, me, online: navigator.onLine };
  emit();
  await refreshOutboxCounts();
  await loadLocal();
  if (!bound) {
    bound = true;
    window.addEventListener('online', () => void refreshNow());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshNow(); });
  }
  await refreshNow();
  schedule();
  void startRealtime(() => void refreshNow());
}

export function stopStore() {
  stopRealtime();
  if (timer) window.clearTimeout(timer);
  timer = null;
  closeShopDb();
  db = null;
  serverTs = undefined;
  snap = EMPTY;
  emit();
}

/** Forget everything stored on this device for this user (sign-out on a shared PC). */
export async function wipeLocal() {
  try { await db?.delete(); } catch { /* ignore */ }
  stopStore();
}
