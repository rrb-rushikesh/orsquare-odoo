/**
 * Local-first storage (IndexedDB via Dexie).
 *
 *  - `kv`      the last server snapshot, one record per bootstrap section, so the app opens instantly offline
 *  - `outbox`  durable queue of mutations (sales, purchases) waiting to reach Odoo, in strict device order
 *
 * One database per shop+user, so a shared counter PC never mixes two shops' data.
 */
import Dexie, { type Table } from 'dexie';
export interface OfflineSalePayment { method: 'Cash' | 'UPI' | 'Khata'; amount: string; ref?: string }
export interface OfflineSalePayload { [key: string]: any; lines: any[]; payments: OfflineSalePayment[]; idempotency_key: string }

export interface KvRow { key: string; value: unknown }

export interface OutboxRow {
  /** Idempotency key: also the bill's `client_ref`. Replays are answered, never re-executed. */
  id: string;
  device_seq: number;
  kind: 'sale' | 'purchase' | 'stock_transfer';
  payload: Record<string, unknown>;
  created_at: string;
  status: 'queued' | 'rejected';
  /** Server's reason when it refused the mutation (needs a human). */
  error?: string;
}

class ShopDb extends Dexie {
  kv!: Table<KvRow, string>;
  outbox!: Table<OutboxRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ kv: 'key', outbox: 'id, device_seq, status' });
  }
}

let current: ShopDb | null = null;

export function openShopDb(shop: string, userId: number): ShopDb {
  const name = `or2_${shop}_${userId}`;
  if (current && current.name === name) return current;
  current?.close();
  current = new ShopDb(name);
  return current;
}

export function closeShopDb(): void {
  current?.close();
  current = null;
}

/** Stable per-browser device id (the server orders mutations per device). */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('or2_device_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('or2_device_id', id);
    }
    return id;
  } catch {
    return 'device-unknown';
  }
}
