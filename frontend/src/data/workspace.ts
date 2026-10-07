import { useMemo, useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type Snapshot } from '@/lib/sync';
import type { WireProduct } from '@/lib/api';
import type { ProductLike } from '@/lib/search';

/** A product as the screens show it: catalogue row + live stock, joined once per sync. */
export interface CounterProduct extends ProductLike {
  id: string;
  /** Odoo product.product id: what billing sends. */
  productId: number;
  /** Odoo product.template id: what the catalogue edits. */
  templateId: number;
  uomId: number;
  poUomId: number;
  uoms: { id: number; name: string }[];
  brandId: number;
  regimeId: number;
  categoryId: number;
  brand: string;
  regime: string;
  kind: 'retail' | 'kitchen' | 'consumable';
  lowStockQty: number;
  /** Odoo's suggested selling price (cost + category margin), only for roles that see valuation. */
  suggestedPrice?: number;
  name: string;
  code: string;
  barcode: string;
  category: string;
  unit: string;
  /** Selling price (what the counter charges unless the cashier overrides it). */
  rate: number;
  mrp: number;
  counterPcs: number;
  godownPcs: number;
  /** Server-computed total (counter + godown + open): never summed in the UI. */
  totalPcs: number;
  openedMl: number;
  lowStock: boolean;
  isKitchen: boolean;
  canOpen: boolean;
  capacityMl: number;
  pegs: WireProduct['pegs'];
  active: boolean;
  /** Purchase cost: only present when the signed-in role may see valuation. */
  cost?: number;
}

export interface Workspace extends Snapshot {
  counterProducts: CounterProduct[];
  productById: Map<number, CounterProduct>;
}

/** Convenience: re-fetch everything (used after changing catalogue masters, which deltas do not carry). */
export { bootstrapNow, refreshNow } from '@/lib/sync';

export function useWorkspace(): Workspace {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => {
    const stock = new Map(snap.stock.map((s) => [s.product_id, s]));
    const counterProducts: CounterProduct[] = snap.products.map((p) => {
      const s = stock.get(p.product_id);
      return {
        id: String(p.product_id), productId: p.product_id, templateId: p.id, uomId: p.uom_id, poUomId: p.po_uom_id, uoms: p.uoms, brandId: p.brand_id,
        regimeId: p.regime_id, categoryId: p.category_id, brand: p.brand, regime: p.regime, kind: p.kind,
        lowStockQty: p.low_stock_qty, suggestedPrice: p.suggested_price, name: p.name, code: p.short_code, barcode: p.barcode,
        category: p.category, unit: p.uom, rate: p.price, mrp: p.mrp ?? p.price,
        counterPcs: s?.counter ?? 0, godownPcs: s?.godown ?? 0, totalPcs: s?.total ?? 0, openedMl: s?.opened_ml ?? 0, lowStock: !!s?.low,
        isKitchen: p.kind === 'kitchen', canOpen: p.can_open, capacityMl: p.capacity_ml, pegs: p.pegs,
        active: p.active, cost: p.cost,
      };
    });
    return { ...snap, counterProducts, productById: new Map(counterProducts.map((p) => [p.productId, p])) };
  }, [snap]);
}
