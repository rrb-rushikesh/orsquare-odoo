/**
 * Country dial codes for the phone field.
 *
 * Mirrors backend/apps/core/phone.py (the server re-validates and normalizes,
 * so a crafted request can never store a malformed number). Kept as a small
 * static list: no dependency, no network round-trip, predictable ordering
 * (default market first, then alphabetical).
 */

export interface CountryDial {
  iso: string
  dial: string
  name: string
}

export const COUNTRY_DIAL_CODES: CountryDial[] = [
  { iso: 'IN', dial: '+91', name: 'India' },
  { iso: 'AE', dial: '+971', name: 'United Arab Emirates' },
  { iso: 'AU', dial: '+61', name: 'Australia' },
  { iso: 'BD', dial: '+880', name: 'Bangladesh' },
  { iso: 'BH', dial: '+973', name: 'Bahrain' },
  { iso: 'BR', dial: '+55', name: 'Brazil' },
  { iso: 'CA', dial: '+1', name: 'Canada' },
  { iso: 'CH', dial: '+41', name: 'Switzerland' },
  { iso: 'CN', dial: '+86', name: 'China' },
  { iso: 'DE', dial: '+49', name: 'Germany' },
  { iso: 'EG', dial: '+20', name: 'Egypt' },
  { iso: 'ES', dial: '+34', name: 'Spain' },
  { iso: 'FR', dial: '+33', name: 'France' },
  { iso: 'GB', dial: '+44', name: 'United Kingdom' },
  { iso: 'HK', dial: '+852', name: 'Hong Kong' },
  { iso: 'ID', dial: '+62', name: 'Indonesia' },
  { iso: 'IE', dial: '+353', name: 'Ireland' },
  { iso: 'IT', dial: '+39', name: 'Italy' },
  { iso: 'JP', dial: '+81', name: 'Japan' },
  { iso: 'KE', dial: '+254', name: 'Kenya' },
  { iso: 'KW', dial: '+965', name: 'Kuwait' },
  { iso: 'LK', dial: '+94', name: 'Sri Lanka' },
  { iso: 'MY', dial: '+60', name: 'Malaysia' },
  { iso: 'MU', dial: '+230', name: 'Mauritius' },
  { iso: 'MV', dial: '+960', name: 'Maldives' },
  { iso: 'NG', dial: '+234', name: 'Nigeria' },
  { iso: 'NP', dial: '+977', name: 'Nepal' },
  { iso: 'NL', dial: '+31', name: 'Netherlands' },
  { iso: 'NZ', dial: '+64', name: 'New Zealand' },
  { iso: 'OM', dial: '+968', name: 'Oman' },
  { iso: 'PH', dial: '+63', name: 'Philippines' },
  { iso: 'PK', dial: '+92', name: 'Pakistan' },
  { iso: 'QA', dial: '+974', name: 'Qatar' },
  { iso: 'RU', dial: '+7', name: 'Russia' },
  { iso: 'SA', dial: '+966', name: 'Saudi Arabia' },
  { iso: 'SG', dial: '+65', name: 'Singapore' },
  { iso: 'TH', dial: '+66', name: 'Thailand' },
  { iso: 'TR', dial: '+90', name: 'Turkey' },
  { iso: 'US', dial: '+1', name: 'United States' },
  { iso: 'ZA', dial: '+27', name: 'South Africa' },
]

export const DEFAULT_DIAL = '+91'

/** Digits only, and drop a leading trunk zero (India/UK style). */
export function nationalDigits(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '')
  if (digits.length > 1 && digits.startsWith('0')) digits = digits.replace(/^0+/, '')
  return digits
}

export function isValidNational(raw: string): boolean {
  const digits = nationalDigits(raw)
  return digits.length >= 4 && digits.length <= 15
}

export function formatE164(dial: string, raw: string): string {
  const digits = nationalDigits(raw)
  return digits ? `${dial}${digits}` : ''
}
