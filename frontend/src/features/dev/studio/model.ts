import type { StudioFeature, StudioGroup, StudioSetup, StudioTab, StudioVariant } from '../types'

/**
 * Pure helpers over a Business Studio setup. The setup is what the server stores: the enabled variant keys (`tabs`) and the feature
 * switches that differ from their default (`features`). The server validates every setup; these only keep the draft consistent
 * while it is edited (one variant per tab, switches cleared when the variant changes).
 */
export const allTabs = (groups: StudioGroup[]): StudioTab[] => groups.flatMap((g) => g.tabs)

/** The variant a tab currently uses, or its first (the default) when the tab is off. */
export const variantOf = (tab: StudioTab, setup: StudioSetup): StudioVariant =>
  tab.variants.find((v) => setup.tabs.includes(v.key)) ?? tab.variants[0]

export const isOn = (tab: StudioTab, setup: StudioSetup) => tab.variants.some((v) => setup.tabs.includes(v.key))

export function setTabOn(setup: StudioSetup, tab: StudioTab, on: boolean): StudioSetup {
  const keep = setup.tabs.filter((k) => !tab.variants.some((v) => v.key === k))
  const features = { ...setup.features }
  if (!on) tab.variants.forEach((v) => delete features[v.key])
  return { tabs: on ? [...keep, variantOf(tab, setup).key] : keep, features }
}

export function setVariant(setup: StudioSetup, tab: StudioTab, key: string): StudioSetup {
  const features = { ...setup.features }
  tab.variants.forEach((v) => delete features[v.key]) // switches belong to one variant: a new variant starts from its defaults
  return { tabs: [...setup.tabs.filter((k) => !tab.variants.some((v) => v.key === k)), key], features }
}

export const featureOn = (setup: StudioSetup, variant: StudioVariant, feature: StudioFeature) =>
  setup.features[variant.key]?.[feature.id] ?? feature.default

export function setFeature(setup: StudioSetup, variant: StudioVariant, feature: StudioFeature, on: boolean): StudioSetup {
  const flags = { ...(setup.features[variant.key] ?? {}) }
  if (on === feature.default) delete flags[feature.id]
  else flags[feature.id] = on
  const features = { ...setup.features }
  if (Object.keys(flags).length) features[variant.key] = flags
  else delete features[variant.key]
  return { ...setup, features }
}

export const resetFeatures = (setup: StudioSetup, variant: StudioVariant): StudioSetup => {
  const features = { ...setup.features }
  delete features[variant.key]
  return { ...setup, features }
}

/** Switches of the tab's current variant that differ from their default. */
export const changedFeatures = (tab: StudioTab, setup: StudioSetup) => Object.keys(setup.features[variantOf(tab, setup).key] ?? {}).length

/** A tab differs from the default when it uses a non-default variant or has switched features. */
export const isChanged = (tab: StudioTab, setup: StudioSetup) =>
  isOn(tab, setup) && (variantOf(tab, setup).key !== tab.variants[0].key || changedFeatures(tab, setup) > 0)

export function summary(groups: StudioGroup[], setup: StudioSetup) {
  const tabs = allTabs(groups)
  return {
    total: tabs.length,
    on: tabs.filter((t) => isOn(t, setup)).length,
    variants: tabs.filter((t) => isOn(t, setup) && t.variants.length > 1).length,
    features: tabs.reduce((n, t) => n + (isOn(t, setup) ? changedFeatures(t, setup) : 0), 0),
  }
}

export interface Hit {
  tab: StudioTab
  variant?: StudioVariant
  feature?: StudioFeature
}

/** Search across tabs, variants and features: the way to reach one item among hundreds. */
export function search(groups: StudioGroup[], query: string, limit = 30): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  for (const tab of allTabs(groups)) {
    if (tab.label.toLowerCase().includes(q)) hits.push({ tab })
    for (const variant of tab.variants) {
      if (tab.variants.length > 1 && variant.label.toLowerCase().includes(q)) hits.push({ tab, variant })
      for (const feature of variant.features) {
        if (`${feature.label} ${feature.description}`.toLowerCase().includes(q)) hits.push({ tab, variant, feature })
      }
    }
  }
  return hits.slice(0, limit)
}
