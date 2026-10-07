/**
 * Single source of truth for capability/variant keys and for reading
 * capability-scoped settings out of ShopExperienceInfo. The backend
 * (apps/capabilities) sends full keys and capability-scoped settings only —
 * every frontend consumer of the /api/auth/me/ experience payload must read
 * through these helpers instead of comparing against ad hoc string aliases
 * or flat field access, so a future contract change only needs to change
 * one place.
 */
import type { ShopExperienceInfo } from '@/auth/AuthContext';

export const SURFACE_STOCK = 'surface.stock';
export const SURFACE_SHEET = 'surface.sheet';
export const SURFACE_AI = 'surface.ai';
export const SURFACE_ADVANCED_ACCOUNTING = 'surface.advanced_accounting';
export const SURFACE_LEDGER = 'surface.ledger';

export const VARIANT_STOCK_STANDARD = 'variant.stock.standard';
export const VARIANT_STOCK_WINE = 'variant.stock.wine';

export const GLOBAL_AI_PREF_KEY = 'or2_global_ai_enabled';

export function isGlobalAiEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(GLOBAL_AI_PREF_KEY) !== 'false';
}

export function setGlobalAiEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GLOBAL_AI_PREF_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('or2_global_ai_change', { detail: { enabled } }));
}

export function getCapabilitySettings<T = Record<string, any>>(
  experience: ShopExperienceInfo | undefined,
  capabilityKey: string,
): T | undefined {
  return experience?.settings?.[capabilityKey] as T | undefined;
}
