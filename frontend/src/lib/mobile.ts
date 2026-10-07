import { COUNTRIES, type Country } from './countries'

/** One place for the mobile-number rules the forms apply while typing. The server re-validates with the same data (backend/or2/phone.py). */
export const DEFAULT_COUNTRY = 'IN'

export const countryOf = (iso: string): Country => COUNTRIES.find((c) => c[0] === iso) ?? COUNTRIES[0]

/** The dial code the account contract carries ("+91") for a country, and the country a dial code stands for (the first listed: "+1" is shared). */
export const dialOf = (iso: string) => `+${countryOf(iso)[2]}`
export const countryOfDial = (dial: string): string => COUNTRIES.find((c) => `+${c[2]}` === dial)?.[0] ?? DEFAULT_COUNTRY

export const maxDigits = (c: Country) => Math.max(...c[3])

/** "10", "9–12" or "10 or 11": how many digits a country's mobile numbers have. */
export function lengthText(lengths: readonly number[]): string {
  const a = [...lengths].sort((x, y) => x - y)
  if (a.length === 1) return String(a[0])
  return a.every((v, i) => i === 0 || v === a[i - 1] + 1) ? `${a[0]}–${a[a.length - 1]}` : a.join(' or ')
}

/** The typed value as national digits: strips spaces and dashes, and a pasted "+91 98765 00101" keeps only the number. */
export function cleanNumber(raw: string, country: Country): string {
  const plus = raw.trim().startsWith('+')
  let digits = raw.replace(/\D/g, '')
  const [, , dial, lengths] = country
  const longest = Math.max(...lengths)
  const shortest = Math.min(...lengths)
  if (plus && digits.startsWith(dial)) digits = digits.slice(dial.length)
  else if (!plus && digits.length > longest && digits.startsWith(dial) && digits.length - dial.length >= shortest) digits = digits.slice(dial.length)
  return digits.slice(0, longest)
}

/** What is wrong with this number, in a plain sentence, or '' when it is acceptable. */
export function mobileProblem(iso: string, number: string): string {
  const c = countryOf(iso)
  if (!number) return 'Enter the mobile number.'
  if (!c[3].includes(number.length)) return `${c[1]} mobile numbers have ${lengthText(c[3])} digits. You entered ${number.length}.`
  if (c[0] === 'IN' && !/^[6-9]/.test(number)) return 'Indian mobile numbers start with 6, 7, 8 or 9.'
  return ''
}

/** "+91 98765 00101" for display. */
export const displayMobile = (iso: string, number: string) => `+${countryOf(iso)[2]} ${number}`
