/**
 * Offline-only price estimate.
 *
 * While the device has no connection the server cannot quote, but the cashier still has to tell the customer an
 * amount.  Indian shelf prices include tax, so the estimate is simply rate x qty less the bill discount.  It is
 * shown with an "estimate" label and is NEVER sent as authority: Odoo prices the bill when it syncs.
 */
export interface EstimateLine { qty: number; rate: number }
export interface BillDiscount { kind: 'percent' | 'amount'; value: number }

export function estimateTotal(lines: EstimateLine[], discount: BillDiscount | null): number {
  const gross = lines.reduce((sum, l) => sum + l.qty * l.rate, 0);
  if (!discount || discount.value <= 0) return round2(gross);
  const off = discount.kind === 'percent' ? (gross * discount.value) / 100 : discount.value;
  return round2(Math.max(0, gross - off));
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
