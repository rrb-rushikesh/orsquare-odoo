import { useMemo, useState } from 'react'
import { COUNTRIES } from '@/lib/countries'
import { cleanNumber, countryOf, lengthText, maxDigits } from '@/lib/mobile'
import { cx } from '@/lib/cx'
import { IconChevronDown } from '@/components/icons'
import { Input } from './Field'
import { MenuPopover, useMenu } from './Menu'

export interface Mobile {
  country: string
  number: string
}

/**
 * Mobile number: a searchable country picker joined to the number input. The number is capped at the longest length the country
 * allows, counts as you type, and a pasted "+91 98765 00101" is cleaned. The sentence for a wrong number (`mobileProblem`) is shown
 * by the surrounding Field; this control shows the live count. Countries and lengths come from libphonenumber (lib/countries.ts);
 * the server decides.
 */
export function PhoneField({ value, onChange, invalid }: { value: Mobile; onChange: (next: Mobile) => void; invalid?: boolean }) {
  const menu = useMenu()
  const [query, setQuery] = useState('')
  const country = countryOf(value.country)
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '')
    return COUNTRIES.filter((c) => !q || c[1].toLowerCase().includes(q) || c[0].toLowerCase() === q || c[2].startsWith(q)).slice(0, 60)
  }, [query])
  const pick = (iso: string) => {
    onChange({ country: iso, number: value.number.slice(0, maxDigits(countryOf(iso))) })
    menu.close()
    setQuery('')
  }
  const n = value.number.length
  const complete = country[3].includes(n)
  return (
    <div className="flex flex-col gap-4">
      <div ref={menu.ref} className="relative flex items-stretch">
        <button
          type="button"
          onClick={menu.toggle}
          aria-haspopup="listbox"
          aria-expanded={menu.open}
          aria-label={`Country: ${country[1]}`}
          className="flex h-ctl shrink-0 cursor-pointer items-center gap-6 border-0 border-b border-b-subtle bg-layer-2 px-10 text-s13 font-semibold text-ink hover:bg-layer-hover"
        >
          <span className="bg-ink px-4 py-1 text-s10 text-white">{country[0]}</span>+{country[2]}
          <IconChevronDown size={12} />
        </button>
        <Input
          fluid={false}
          className={cx('min-w-0 flex-1 font-medium tabular-nums', invalid && 'border-b-err')}
          value={value.number}
          inputMode="numeric"
          autoComplete="tel-national"
          aria-label="Mobile number"
          aria-invalid={invalid || undefined}
          placeholder={'9'.repeat(Math.min(...country[3], 10))}
          onChange={(e) => onChange({ ...value, number: cleanNumber(e.target.value, country) })}
        />
        {menu.open && (
          <MenuPopover placement="below-start" className="w-340">
            <div className="border-b border-line p-8">
              <Input
                size="dense"
                autoFocus
                placeholder="Search country or code"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && rows[0]) pick(rows[0][0])
                }}
              />
            </div>
            <div className="max-h-240 overflow-y-auto" role="listbox" aria-label="Countries">
              {rows.map((c) => (
                <button
                  key={c[0]}
                  type="button"
                  role="option"
                  aria-selected={c[0] === country[0]}
                  onClick={() => pick(c[0])}
                  className={cx(
                    'flex w-full cursor-pointer items-center gap-8 border-0 bg-transparent px-12 py-6 text-left text-s13 hover:bg-layer-accent',
                    c[0] === country[0] && 'bg-layer-accent',
                  )}
                >
                  <span className="bg-layer-2 px-4 py-1 text-s10 font-semibold">{c[0]}</span>
                  <span className="min-w-0 flex-1 truncate">{c[1]}</span>
                  <span className="text-s12 text-muted">
                    +{c[2]} · {lengthText(c[3])} digits
                  </span>
                </button>
              ))}
              {rows.length === 0 && <div className="px-12 py-10 text-s13 text-muted">No country matches.</div>}
            </div>
          </MenuPopover>
        )}
      </div>
      <div className="flex justify-between text-s12 text-muted">
        <span>
          {country[1]} · {lengthText(country[3])} digits
        </span>
        <span className={cx('tabular-nums', complete && 'font-semibold text-ok-fg')}>
          {n} / {lengthText(country[3])}
        </span>
      </div>
    </div>
  )
}
