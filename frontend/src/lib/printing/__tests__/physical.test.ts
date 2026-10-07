/**
 * OPT-IN physical printer run (real QZ Tray + real printer). Skipped unless QZ_PHYSICAL=1.
 *
 *   QZ_PHYSICAL=1 QZ_SHEETS=ruler,margins QZ_PRESET=80-a npx vitest run physical
 *
 * Signs with the local private key (.qz-secrets/) exactly like the server does, so a pass here also proves
 * the trust chain (override.crt) is correct: any QZ permission dialog would hang the call and fail the test.
 */
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import qz from 'qz-tray'
import { encodeBlocks, toBase64 } from '../escpos'
import { layoutDocument } from '../layout'
import { pickPrinter } from '../printerSelect'
import { defaultPrintSettings, type PrintSettings } from '../presets'
import { buildTestSheet, TEST_SHEETS, type TestKind } from '../testSheets'
const invoice = { shopName: 'ORSQUARE TEST SHOP', tagline: 'Fresh every day', addressLine: '12 MG Road', addressLine2: 'Pune 411057', phone: '98765 43210', gstin: '27AAAAA0000A1Z5', prefix: 'INV-', footerNote: 'Thank you. Visit again.' }

const on = process.env.QZ_PHYSICAL === '1'

describe.skipIf(!on)('physical printer (QZ Tray)', () => {
  it('prints the requested sheets silently', async () => {
    const cert = readFileSync('.qz-secrets/qz-signing.crt', 'utf8')
    const key = readFileSync('.qz-secrets/qz-signing.key', 'utf8')
    const q = qz as any
    q.api.setWebSocketType(WebSocket)
    q.api.setPromiseType((r: any) => new Promise(r))
    q.api.setSha256Type((d: string) => require('node:crypto').createHash('sha256').update(d).digest('hex'))
    q.security.setCertificatePromise((res: any) => res(cert))
    q.security.setSignatureAlgorithm('SHA512')
    q.security.setSignaturePromise((msg: string) => (res: any) => res(createSign('RSA-SHA512').update(msg).sign(key, 'base64')))

    await q.websocket.connect({ host: 'localhost', usingSecure: false, retries: 0 })
    // QZ_CUSTOM="cols,dots,font" (e.g. 32,576,a) selects the custom preset for printers that do not match a built-in one.
    const [cc, cd, cf] = (process.env.QZ_CUSTOM ?? '').split(',')
    const custom = cc ? { preset: 'custom' as const, customCols: Number(cc), customDots: Number(cd || 576), customFont: (cf || 'a') as 'a' | 'b' } : {}
    const s: PrintSettings = { ...defaultPrintSettings, backend: 'qz', preset: (process.env.QZ_PRESET ?? '80-a') as never, feedLines: Number(process.env.QZ_FEED ?? 3), ...custom }
    const names: string[] = await q.printers.find()
    const printer = pickPrinter(names, process.env.QZ_PRINTER ?? '', await q.printers.getDefault())
    expect(printer, `printers: ${names.join(', ')}`).toBeTruthy()
    const kinds = (process.env.QZ_SHEETS ?? 'ruler').split(',') as TestKind[]
    for (const k of kinds) {
      expect(TEST_SHEETS.map((t) => t.id)).toContain(k)
      const sheet = buildTestSheet(k, invoice, s)
      const bytes = encodeBlocks(sheet.laid.blocks, sheet.laid.cols, s, { cash: sheet.cash })
      await q.print(q.configs.create(printer, { jobName: sheet.label, encoding: null }), [{ type: 'raw', format: 'command', flavor: 'base64', data: toBase64(bytes) }])
    }
    await q.websocket.disconnect()
    expect(layoutDocument).toBeTruthy()
  }, 60_000)
})
