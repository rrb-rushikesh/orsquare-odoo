import { useMemo, useSyncExternalStore } from 'react'
import { loadPrefs } from '../prefs'
import { getBridgeSnapshot, subscribeBridge } from './bridge'
import { describeHealth, type PrintHealth } from './health'
import { getQueueSummary, subscribeQueue } from './service'

export type { HealthLevel, PrintHealth } from './health'

export function usePrintStatus(): PrintHealth {
  const b = useSyncExternalStore(subscribeBridge, getBridgeSnapshot)
  const q = useSyncExternalStore(subscribeQueue, getQueueSummary)
  const qz = loadPrefs().print.backend === 'qz'
  return useMemo(() => ({ ...describeHealth(qz, b, q), bridge: b, queue: q }), [qz, b, q])
}
