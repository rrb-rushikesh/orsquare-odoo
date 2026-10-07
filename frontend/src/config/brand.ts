/**
 * Centralized Brand Configuration: OR² / ORSQUARE.
 * Update brand metadata here to universally restyle the entire application.
 * `name` is the display brand (OR²); `nameFull`/`legalName` are used for
 * documentation, legal pages and formal references (ORSQUARE).
 */
export const BRAND_CONFIG = {
  name: "OR²",
  nameFull: "ORSQUARE",
  legalName: "ORSQUARE",
  shortTagline: "Simple business operations",
  tagline: "One simple platform to run your entire business",
  logoText: "OR²",
  version: "v2.24",
  currencySymbol: "₹",
  currencyCode: "INR",
  copyrightYear: 2026,
} as const;

export type BrandConfig = typeof BRAND_CONFIG;
