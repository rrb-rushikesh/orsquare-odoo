import { COUNTRY_DIAL_CODES, DEFAULT_DIAL, nationalDigits } from '@/lib/phone'

/**
 * Country-code selector + national phone input.
 *
 * The server re-validates and normalizes every phone, so this component is
 * about clean entry, not enforcement: it keeps the dial code and the national
 * digits as separate values and hands the parent both.
 */
export function PhoneInput({
  countryCode,
  phone,
  onCountryCode,
  onPhone,
  required,
  hint,
}: {
  countryCode: string
  phone: string
  onCountryCode: (v: string) => void
  onPhone: (v: string) => void
  required?: boolean
  hint?: string
}) {
  const dial = countryCode || DEFAULT_DIAL
  return (
    <div className="phone-input-row">
      <select
        className="field-control phone-country"
        value={dial}
        onChange={(e) => onCountryCode(e.target.value)}
        aria-label="Country dial code"
      >
        {COUNTRY_DIAL_CODES.map((c) => (
          <option key={`${c.iso}${c.dial}`} value={c.dial}>
            {c.dial} {c.iso}
          </option>
        ))}
      </select>
      <input
        className="field-control phone-number"
        value={phone}
        onChange={(e) => onPhone(nationalDigits(e.target.value).slice(0, 10))}
        placeholder="10-digit mobile number"
        inputMode="numeric"
        pattern="[0-9]{10}"
        maxLength={10}
        autoComplete="tel-national"
        required={required}
        aria-label="Phone number"
      />
      {hint ? <span className="field-hint-inline">{hint}</span> : null}
    </div>
  )
}
