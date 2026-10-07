import { describe, it, expect } from 'vitest'
import { calKey, ddisplay, dateRowMatches } from '@/components/ui/DateRangeFilter'
import { CONTROL, ICON } from '@/components/ui/tokens'

describe('Date & Calendar utilities', () => {
  it('formats calendar keys with zero padding', () => {
    expect(calKey(2026, 9, 7)).toBe('2026-10-07') // Month index 9 = October
    expect(calKey(2026, 0, 5)).toBe('2026-01-05')
  })

  it('formats display dates nicely', () => {
    expect(ddisplay('2026-10-07')).toContain('Oct')
    expect(ddisplay('')).toBe('')
    expect(ddisplay(null)).toBe('')
  })

  it('matches date rows correctly across day keys without timezone skew', () => {
    expect(dateRowMatches('2026-10-07T12:00:00Z', '2026-10-01', '2026-10-10')).toBe(true)
    expect(dateRowMatches('2026-09-30T12:00:00Z', '2026-10-01', '2026-10-10')).toBe(false)
    expect(dateRowMatches('2026-10-11T12:00:00Z', '2026-10-01', '2026-10-10')).toBe(false)
    expect(dateRowMatches('2026-10-07T12:00:00Z', null, null)).toBe(true)
  })
})

describe('UI Design Tokens', () => {
  it('has consistent control and icon tokens', () => {
    expect(CONTROL.height).toBe(40)
    expect(CONTROL.heightSm).toBe(32)
    expect(CONTROL.gap).toBe(8)
    expect(ICON.md).toBe(15)
    expect(ICON.lg).toBe(16)
  })
})
