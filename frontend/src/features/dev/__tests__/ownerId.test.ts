import { describe, expect, it } from 'vitest'
import { OWNER_ID, suggestOwnerId, takenIds } from '../ownerId'

describe('owner ID suggestion', () => {
  it('shortens a name to first name plus last initial', () => {
    expect(suggestOwnerId('Sunil Kumar Agarwal')).toBe('sunila')
    expect(suggestOwnerId('Suresh')).toBe('suresh')
    expect(suggestOwnerId('Dr. Anita Rao')).toBe('anitar')
    expect(suggestOwnerId('Chandrashekhar Venkataraman')).toBe('chandrashe')
  })
  it('avoids an ID that is taken, and is empty for nothing usable', () => {
    expect(suggestOwnerId('Suresh Shah', new Set(['sureshs']))).toBe('sureshs2')
    expect(suggestOwnerId('')).toBe('')
    expect(suggestOwnerId('  ')).toBe('')
  })
  it('counts only logins at our own domain as taken', () => {
    expect([...takenIds(['a@orsquare.com', 'owner@or2.test'])]).toEqual(['a'])
  })
  it('only ever suggests a valid ID', () => {
    for (const n of ['Ravi K', 'Ünal Çelik', 'A B', 'Mary-Jane O’Neil']) {
      const s = suggestOwnerId(n)
      if (s) expect(OWNER_ID.test(s)).toBe(true)
    }
  })
})
