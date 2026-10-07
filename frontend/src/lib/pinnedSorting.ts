import { useState, useCallback, useMemo } from 'react'

export type SortMode = 'most-sold' | 'alpha'

/**
 * Storage hook for persisting pinned items and sorting mode.
 * Preserves pinning across page navigation and reloads.
 */
export function usePinnedSorting(storageKey: string, defaultSortMode: SortMode = 'most-sold') {
  const pinStorageKey = `orsquare_pins_${storageKey}`

  const [sortMode, setSortModeState] = useState<SortMode>(() => {
    return defaultSortMode
  })

  const [pinnedKeys, setPinnedKeysState] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(pinStorageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) return parsed.map(String)
      }
    } catch {
      // ignore
    }
    return []
  })

  const setSortMode = useCallback((mode: SortMode) => {
    setSortModeState(mode)
  }, [])

  const toggleSortMode = useCallback(() => {
    setSortModeState((prev) => {
      const next = prev === 'most-sold' ? 'alpha' : 'most-sold'
      return next
    })
  }, [])

  const setPinnedKeys = useCallback((keys: string[] | ((prev: string[]) => string[])) => {
    setPinnedKeysState((prev) => {
      const next = typeof keys === 'function' ? keys(prev) : keys
      try {
        localStorage.setItem(pinStorageKey, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [pinStorageKey])

  const pinItem = useCallback((key: string) => {
    setPinnedKeys((prev) => {
      if (prev.includes(key)) return prev
      return [...prev, key]
    })
  }, [setPinnedKeys])

  const unpinItem = useCallback((key: string) => {
    setPinnedKeys((prev) => prev.filter((k) => k !== key))
  }, [setPinnedKeys])

  const togglePin = useCallback((key: string) => {
    setPinnedKeys((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key)
      } else {
        return [...prev, key]
      }
    })
  }, [setPinnedKeys])

  const movePinnedItem = useCallback((fromIndex: number, toIndex: number) => {
    setPinnedKeys((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [setPinnedKeys])

  const pinnedSet = useMemo(() => new Set(pinnedKeys), [pinnedKeys])

  return {
    sortMode,
    setSortMode,
    toggleSortMode,
    pinnedKeys,
    pinnedSet,
    setPinnedKeys,
    pinItem,
    unpinItem,
    togglePin,
    movePinnedItem,
  }
}

/**
 * High-performance sorting function separating pinned vs unpinned items.
 *
 * Rule (the application-wide product ordering standard,
 * docs/CONVENTIONS.md §3.3):
 *   1. Pinned items, in their exact manual order — never displaced, whatever
 *      the demand numbers say.
 *   2. Unpinned items by the selected mode.
 *   3. 'most-sold' = rolling 4-business-day sold quantity (including today),
 *      tie-broken by most recent sale activity, then by the caller's existing
 *      deterministic order (Array#sort is stable, so untouched ties keep the
 *      order the backend sent).
 *   4. 'alpha' = label order.
 */
export function sortWithPinned<T>({
  items,
  keyExtractor,
  pinnedKeys,
  sortMode,
  salesValueExtractor,
  recencyValueExtractor,
  alphaValueExtractor,
}: {
  items: T[]
  keyExtractor: (item: T) => string
  pinnedKeys: string[]
  sortMode: SortMode
  salesValueExtractor: (item: T) => number
  /** Most recent sale as a comparable number (epoch ms); 0 when never sold. */
  recencyValueExtractor?: (item: T) => number
  alphaValueExtractor: (item: T) => string
}): T[] {
  if (items.length <= 1) return items

  const itemMap = new Map<string, T>()
  const unpinned: T[] = []
  const pinnedKeySet = new Set(pinnedKeys)

  for (const item of items) {
    const key = keyExtractor(item)
    if (pinnedKeySet.has(key)) {
      itemMap.set(key, item)
    } else {
      unpinned.push(item)
    }
  }

  // 1. Gather pinned items in the exact manual sequence of pinnedKeys
  const pinnedPart: T[] = []
  for (const key of pinnedKeys) {
    const it = itemMap.get(key)
    if (it !== undefined) {
      pinnedPart.push(it)
    }
  }

  // 2. Sort unpinned items
  unpinned.sort((a, b) => {
    if (sortMode === 'most-sold') {
      const soldA = salesValueExtractor(a)
      const soldB = salesValueExtractor(b)
      if (soldB !== soldA) return soldB - soldA
      if (recencyValueExtractor) {
        const recA = recencyValueExtractor(a)
        const recB = recencyValueExtractor(b)
        if (recB !== recA) return recB - recA
      }
      // Full tie: fall back to the caller's deterministic order. `alpha` keeps
      // its alphabetical behaviour because for Stock and Sheet the incoming
      // order is already the backend's name/brand order; `Array#sort` is
      // stable so this is deterministic either way.
      return alphaValueExtractor(a).localeCompare(alphaValueExtractor(b))
    } else {
      return alphaValueExtractor(a).localeCompare(alphaValueExtractor(b))
    }
  })

  return [...pinnedPart, ...unpinned]
}
