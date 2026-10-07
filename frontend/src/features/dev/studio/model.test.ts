import { describe, expect, it } from 'vitest'
import type { StudioGroup, StudioSetup } from '../types'
import { featureOn, isChanged, isOn, search, setFeature, setTabOn, setVariant, summary, variantOf } from './model'

const feat = (id: string, def = true) => ({ id, label: id.toUpperCase(), description: '', default: def })
const groups: StudioGroup[] = [
  {
    key: 'g',
    label: 'G',
    tabs: [
      { key: 'sales', label: 'Sales', variants: [{ key: 'sales', label: 'Standard', features: [feat('pos'), feat('discount', false)] }] },
      {
        key: 'stock',
        label: 'Stock',
        variants: [
          { key: 'stock', label: 'Standard', features: [] },
          { key: 'stock-wine', label: 'Wine', features: [feat('size')] },
        ],
      },
    ],
  },
]
const [sales, stock] = groups[0].tabs
const empty: StudioSetup = { tabs: ['sales'], features: {} }

describe('studio setup', () => {
  it('keeps one variant per tab and clears switches when the variant changes', () => {
    let s = setVariant({ tabs: ['stock'], features: { stock: { x: true } } }, stock, 'stock-wine')
    expect(s.tabs).toEqual(['stock-wine'])
    expect(s.features).toEqual({})
    s = setTabOn(s, stock, false)
    expect(isOn(stock, s)).toBe(false)
    s = setTabOn(s, stock, true)
    expect(variantOf(stock, s).key).toBe('stock') // back to the default variant
  })

  it('stores only the switches that differ from their default', () => {
    const v = sales.variants[0]
    let s = setFeature(empty, v, v.features[1], true)
    expect(s.features).toEqual({ sales: { discount: true } })
    expect(featureOn(s, v, v.features[1])).toBe(true)
    s = setFeature(s, v, v.features[1], false)
    expect(s.features).toEqual({})
  })

  it('summarises and finds across the tree', () => {
    const s = setFeature({ tabs: ['sales', 'stock-wine'], features: {} }, sales.variants[0], sales.variants[0].features[0], false)
    expect(summary(groups, s)).toEqual({ total: 2, on: 2, variants: 1, features: 1 })
    expect(isChanged(stock, s)).toBe(true)
    expect(search(groups, 'wine').map((h) => h.variant?.key)).toContain('stock-wine')
    expect(search(groups, 'size')[0].feature?.id).toBe('size')
    expect(search(groups, '')).toEqual([])
  })
})
