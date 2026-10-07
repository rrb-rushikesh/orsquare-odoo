/**
 * Decimal-exact money helpers for the POS register.
 *
 * The backend (`apps/sales/services.py`) computes every money value with
 * Python `Decimal` and `ROUND_HALF_UP` at 2 decimals, then enforces strict
 * equality between the client-sent payment total and its own grand total
 * ("Payment mismatch" HTTP 400). JavaScript `Math.round(n * 100) / 100` on a
 * binary float is NOT the same rounding: `5.75 * 18 / 100` is stored as
 * `1.0349999999999999`, so a naive `round2` yields `1.03` while the backend
 * yields `1.04` — a one-paisa gap that rejects otherwise valid retail bills at
 * common 5% / 18% GST boundaries.
 *
 * These helpers work in integer paise so the arithmetic is exact and the
 * result matches `Decimal.quantize(Decimal('0.01'), ROUND_HALF_UP)`.
 */

/** Convert a money number (rupees, up to 2dp) to integer paise. */
export function toPaise(n: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100)
}

/** Convert integer paise back to a money number. */
export function fromPaise(p: number): number {
  return p / 100
}

/**
 * Exact round-half-up of `num / den` for non-negative integers, without
 * floating point error at the .5 boundary.
 */
export function divRoundHalfUp(num: number, den: number): number {
  if (den <= 0) return 0
  const q = Math.floor(num / den)
  const rem = num - q * den
  return rem * 2 >= den ? q + 1 : q
}

/**
 * Line GST in paise: round_half_up(lineTaxablePaise * gstRatePct / 100).
 * `gstRatePct` is an integer GST slab (0/5/12/18/28).
 */
export function gstPaise(lineTaxablePaise: number, gstRatePct: number): number {
  return divRoundHalfUp(lineTaxablePaise * gstRatePct, 100)
}

/**
 * Per-tax CGST/SGST split: each half-rate is rounded INDEPENDENTLY
 * (round-half-up). This is the statutory per-tax method and matches the
 * backend's complete_sale() tax-exclusive rule AND Odoo's l10n_in CGST/SGST
 * group tax to the paisa (rounding the combined amount once and splitting can
 * drift by 1 paisa on 5% lines with odd subtotals).
 */
export function gstSplitPaise(
  lineTaxablePaise: number,
  gstRatePct: number,
): { cgst: number; sgst: number; total: number } {
  if (gstRatePct <= 0) return { cgst: 0, sgst: 0, total: 0 }
  const half = gstRatePct / 2
  const cgst = divRoundHalfUp(lineTaxablePaise * half, 100)
  const sgst = divRoundHalfUp(lineTaxablePaise * half, 100)
  return { cgst, sgst, total: cgst + sgst }
}

/**
 * Proportional allocation in paise: round_half_up(totalPaise * partPaise / wholePaise).
 * Uses BigInt so the intermediate product cannot lose precision on large bills
 * (`partPaise * wholePaise` can exceed Number.MAX_SAFE_INTEGER).
 */
export function allocatePaise(totalPaise: number, partPaise: number, wholePaise: number): number {
  if (wholePaise <= 0) return 0
  const num = BigInt(Math.round(totalPaise)) * BigInt(Math.round(partPaise))
  const den = BigInt(Math.round(wholePaise))
  const q = num / den
  const rem = num - q * den
  const rounded = rem * 2n >= den ? q + 1n : q
  return Number(rounded)
}
