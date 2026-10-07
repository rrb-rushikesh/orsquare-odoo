import { describe, expect, it } from 'vitest'
import { backoffMs, classifyStatus, isVirtualPrinter, pickPrinter } from '../printerSelect'

describe('pickPrinter', () => {
  const names = ['Microsoft Print to PDF', 'OneNote (Desktop)', '80mm Series Printer', 'HP LaserJet 1020']
  it('uses the configured printer when installed (case-insensitive)', () => {
    expect(pickPrinter(names, '80MM series printer', null)).toBe('80mm Series Printer')
  })
  it('auto-detects the thermal printer and ignores virtual ones', () => {
    expect(pickPrinter(names, '', 'Microsoft Print to PDF')).toBe('80mm Series Printer')
  })
  it('recognises common brands', () => {
    for (const n of ['GOBBLER SP-POS89UED', 'Xprinter XP-N160II', 'EPSON TM-T82 Receipt', 'POS-80C', 'RONGTA RP326', 'Star TSP143III', 'TVS RP 3160']) {
      expect(pickPrinter(['HP LaserJet', n], '', null)).toBe(n)
    }
  })
  it('follows a renamed printer only when exactly one thermal candidate exists', () => {
    expect(pickPrinter(['POS-80C (copy 1)', 'HP LaserJet'], 'POS-80C', null)).toBe('POS-80C (copy 1)')
    expect(pickPrinter(['POS-80C (copy 1)', 'Xprinter XP-58'], 'POS-80C', null)).toBeNull()
  })
  it('falls back to the Windows default or the only physical printer, never a virtual one', () => {
    expect(pickPrinter(['HP LaserJet', 'Microsoft Print to PDF'], '', 'HP LaserJet')).toBe('HP LaserJet')
    expect(pickPrinter(['Canon X', 'Microsoft Print to PDF'], '', 'Microsoft Print to PDF')).toBe('Canon X')
    expect(pickPrinter(['Microsoft Print to PDF'], '', 'Microsoft Print to PDF')).toBeNull()
  })
  it('does not guess between several unrelated printers', () => {
    expect(pickPrinter(['Canon X', 'Brother Y'], '', null)).toBeNull()
  })
  it('flags virtual printers', () => {
    expect(isVirtualPrinter('Microsoft XPS Document Writer')).toBe(true)
    expect(isVirtualPrinter('80mm Series Printer')).toBe(false)
  })
})

describe('classifyStatus', () => {
  it('maps Windows/QZ statuses', () => {
    expect(classifyStatus('OK')).toBe('ready')
    expect(classifyStatus('printing')).toBe('ready')
    expect(classifyStatus('OFFLINE')).toBe('offline')
    expect(classifyStatus('NOT_AVAILABLE')).toBe('offline')
    expect(classifyStatus('PAPER_OUT')).toBe('attention')
    expect(classifyStatus('Door Open')).toBe('attention')
    expect(classifyStatus('')).toBe('unknown')
    expect(classifyStatus('SOMETHING_NEW')).toBe('unknown')
  })
})

describe('backoffMs', () => {
  it('grows and caps', () => {
    expect(backoffMs(0)).toBe(1000)
    expect(backoffMs(3)).toBe(8000)
    expect(backoffMs(20)).toBe(30_000)
  })
})

import { presetFromProbe } from '../presets'
describe('presetFromProbe', () => {
  it('maps measured Font A columns to the matching built-in preset', () => {
    expect(presetFromProbe(32)?.preset).toBe('58-a')
    expect(presetFromProbe(48)?.preset).toBe('80-a')
    expect(presetFromProbe(42)?.preset).toBe('80-epson')
  })
  it('falls back to custom with dots = cols x 12', () => {
    const p = presetFromProbe(36)!
    expect(p.preset).toBe('custom')
    expect(p.customCols).toBe(36)
    expect(p.customDots).toBe(432)
  })
  it('rejects nonsense', () => {
    expect(presetFromProbe(5)).toBeNull()
    expect(presetFromProbe(NaN)).toBeNull()
  })
})
