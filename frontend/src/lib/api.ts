/**
 * The ONLY door to the backend.
 *
 * Talks to Odoo's JSON API (`/api/*`) with the httpOnly session cookie the server sets at sign-in; the browser
 * never sees a token.  Every business number comes back from the server: nothing here (or anywhere in the UI)
 * calculates tax, stock or money.
 *
 *   call('sales', 'quote', { payload })      -> POST /api/call
 *   session.login / me / logout              -> /api/session/*
 *   sync.bootstrap / delta / flush           -> /api/sync/*
 */

import { calibrateClockFromHttpDate } from './clock';

const BASE = import.meta.env.VITE_API_URL || '';
const TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  data: any;
  code: string;
  status: number;
  /** True when the request never reached the server (offline, timeout): the caller may queue it. */
  network: boolean;
  constructor(message: string, code = 'error', status = 0, network = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.network = network;
    this.data = { code, message };
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new ApiError(
      e?.name === 'AbortError' ? 'The server took too long to answer.' : 'You appear to be offline.',
      'network', 0, true,
    );
  } finally {
    window.clearTimeout(timer);
  }
  calibrateClockFromHttpDate(res.headers.get('Date'));
  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    /* non-JSON answer (proxy error page) */
  }
  if (envelope && envelope.ok) return envelope.data;
  if (envelope && !envelope.ok) {
    throw new ApiError(envelope.error.message, envelope.error.code, res.status);
  }
  throw new ApiError(
    res.status >= 500 || res.status === 0 ? 'The server is not reachable right now.' : `Request failed (${res.status}).`,
    'http', res.status, res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504,
  );
}

/** Call a whitelisted backend service method, e.g. `call('sales', 'quote', { payload })`. */
export function call<T = any>(service: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return request<T>('POST', '/api/call', { service, method, params });
}

/** The password was right but the account has an authenticator app: the 6-digit code is the second step. */
export interface MfaChallenge { mfa_required: true; mfa: 'totp' }
export const isMfaChallenge = (r: Me | MfaChallenge): r is MfaChallenge => (r as MfaChallenge).mfa_required === true;

export interface MfaSetup { secret: string; url: string; qrcode: string }

export const session = {
  login: (login: string, password: string, shop?: string, surface?: string) =>
    request<Me | MfaChallenge>('POST', '/api/session/login', { login, password, ...(shop ? { shop } : {}), ...(surface ? { surface } : {}) }),
  /** Second sign-in step: the 6-digit code for a password-verified pre-session. */
  mfa: (code: string) => request<Me>('POST', '/api/session/mfa', { code }),
  mfaBegin: () => request<MfaSetup>('POST', '/api/session/mfa/begin', {}),
  mfaEnable: (secret: string, code: string) => request<{ enabled: boolean }>('POST', '/api/session/mfa/enable', { secret, code }),
  mfaDisable: (password: string) => request<{ enabled: boolean }>('POST', '/api/session/mfa/disable', { password }),
  me: () => request<Me>('GET', '/api/session/me'),
  logout: () => request<null>('POST', '/api/session/logout', {}),
};

export const sync = {
  bootstrap: () => request<Bootstrap>('GET', '/api/sync/bootstrap'),
  delta: (sinceSeq: number, sinceTs?: string) =>
    request<Delta>('GET', `/api/sync/delta?since_seq=${sinceSeq}${sinceTs ? `&since_ts=${encodeURIComponent(sinceTs)}` : ''}`),
  flush: (mutations: OutboxMutation[]) => request<FlushResult>('POST', '/api/sync/flush', { mutations }),
};

// ---------------------------------------------------------------------------------------------- wire types

export interface Me {
  id: number;
  name: string;
  login: string;
  surface?: string;
  shop?: string;
  /** Platform operators only: 'admin' may change things, 'support' may only look. */
  platform_role?: 'admin' | 'support';
  mfa?: { enabled: boolean; required?: boolean };
  /** The shop's chosen presentation of a tab (same data, different view). */
  variants?: { stock: 'standard' | 'wine'; accounts: 'standard' | 'advanced' };
  settings_version?: number;
  roles: ('owner' | 'cashier' | 'stockkeeper' | 'developer')[];
  flags: { can_see_money: boolean; can_see_valuation: boolean; can_manage_returns: boolean };
  tabs: string[];
  company: { id: number; name: string; currency: string; tz: string; gstin: string; business_date: string };
  features: {
    open_bottle: boolean; kitchen: boolean; tables: boolean; auto_godown_transfer: boolean;
    continuous_scanning: boolean; default_payment_mode: string;
  };
}

export interface WireProduct {
  id: number; product_id: number; uom_id: number; po_uom_id: number; uoms: { id: number; name: string }[]; brand_id: number; regime_id: number; category: string; category_id: number; low_stock_qty: number;
  name: string; barcode: string; short_code: string; price: number; mrp: number | null; uom: string;
  capacity_ml: number; kind: 'retail' | 'kitchen' | 'consumable'; brand: string; regime: string; can_open: boolean;
  active: boolean; taxes: { name: string; amount: number; amount_type: string; price_include: boolean }[];
  pegs: { ml: number; price: number }[]; variants: { id: number; name: string; price: number }[];
  cost?: number; suggested_price?: number;
}

export interface WireStock {
  product_id: number; name: string; uom: string; godown: number; counter: number; opened_ml: number;
  total: number; low: boolean; value?: number;
}

export interface WireCustomer {
  id: number; name: string; mobile: string; kind: string; receivable: number | null; payable: number | null;
}

export interface Bootstrap {
  schema: number; seq: number; server_ts: string; me: Me;
  products: WireProduct[]; units: any; brands: any[]; categories: { id: number; name: string; regime: string }[];
  regimes: any[]; stock: WireStock[]; open_bottles: any[]; day: any | null; customers: WireCustomer[];
  suppliers: WireCustomer[];
  payment_modes: string[]; floors: any[]; tables: any[]; promos: any[]; discrepancies_open: number;
}

export interface Delta {
  reset?: boolean; seq: number; reason?: string; events?: { seq: number; type: string; [k: string]: any }[];
  patches?: { products?: WireProduct[]; stock?: WireStock[]; open_bottles?: any[]; day?: any; tables?: any[];
    me?: Me; customers?: WireCustomer[]; suppliers?: WireCustomer[] };
  has_more?: boolean; server_ts?: string;
}

export interface OutboxMutation {
  id: string; device_id: string; device_seq: number; kind: 'sale' | 'purchase' | 'stock_transfer'; created_at: string;
  payload: Record<string, unknown>;
}

export interface FlushResult {
  seq: number;
  results: { id: string; status: string; applied_status?: string; result?: any; error?: { code: string; message: string } | null }[];
}
