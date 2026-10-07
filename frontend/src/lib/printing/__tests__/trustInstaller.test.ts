import { describe, expect, it } from 'vitest'
import { buildTrustInstaller, encodePowerShell } from '../trustInstaller'
import { describeHealth } from '../health'
import type { BridgeSnapshot } from '../bridge'
import type { QueueSummary } from '../queue'

const CERT = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUBrzXLxoSSjuBJ8Iy7/5IQbM+J6QwDQYJKoZIhvcNAQEL
BQAwOzEVMBMGA1UEAwwMT1JTcXVhcmUgUE9TMRUwEwYDVQQKDAxPUlNxdWFyZSBQ
T1MxCzAJBgNVBAYTAklO
-----END CERTIFICATE-----`

const decode = (b64: string) => {
  const bin = atob(b64)
  let out = ''
  for (let i = 0; i < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8))
  return out
}

describe('buildTrustInstaller', () => {
  const cmd = buildTrustInstaller(CERT)
  const lines = cmd.split('\r\n')

  it('writes the public certificate with batch-safe lines', () => {
    expect(cmd).toContain('echo -----BEGIN CERTIFICATE-----')
    expect(cmd).toContain('echo -----END CERTIFICATE-----')
    const from = lines.indexOf('echo -----BEGIN CERTIFICATE-----')
    const to = lines.indexOf('echo -----END CERTIFICATE-----')
    const body = lines.slice(from + 1, to)
    expect(body.length).toBeGreaterThan(0)
    for (const l of body) expect(l.slice(5)).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it('never embeds a private key, and rejects non-certificates', () => {
    expect(() => buildTrustInstaller('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')).toThrow()
    expect(() => buildTrustInstaller(CERT + '\n-----BEGIN PRIVATE KEY-----')).toThrow()
    expect(() => buildTrustInstaller('hello')).toThrow()
  })

  it('carries PowerShell as an encoded command that installs the certificate where QZ honours it', () => {
    const enc = lines.find((l) => l.includes('-EncodedCommand'))!
    const script = decode(enc.split('-EncodedCommand ')[1])
    // QZ only trusts override.crt from ITS INSTALL FOLDER (needs admin once); the per-user file and --allow were not honoured.
    expect(script).toContain('C:\\Program Files\\QZ Tray')
    expect(script).toContain("Join-Path $qz 'override.crt'")
    expect(script).toContain('-Verb RunAs')
    // The result is verified by hash, never assumed from an exit code.
    expect(script).toContain('Get-FileHash')
    expect(script).toContain('qz-tray.exe')
    expect(script).not.toContain('--allow')
    expect(script).not.toContain('%')
  })

  it('stays under the cmd.exe line limit and only uses %APPDATA% as a variable', () => {
    for (const l of lines) expect(l.length).toBeLessThan(8000)
    const vars = cmd.match(/%[^%\r\n]*%/g) ?? []
    expect(new Set(vars)).toEqual(new Set(['%APPDATA%']))
  })

  it('is a CRLF batch file that keeps the window open to show the result', () => {
    expect(cmd.startsWith('@echo off\r\n')).toBe(true)
    expect(cmd).toContain('pause')
  })
})

describe('encodePowerShell', () => {
  it('round-trips through UTF-16LE base64', () => {
    const s = "Write-Host 'café ₹' ; $x = 1"
    expect(decode(encodePowerShell(s))).toBe(s)
  })
})

describe('permission-wait health', () => {
  const b: BridgeSnapshot = { bridge: 'connected', printer: 'P', printerState: 'ready', detail: '', version: '2', awaitingPermission: true, signed: true, lastError: '' }
  const q: QueueSummary = { pending: 1, attention: 0, uncertain: 0, lastError: '', jobs: [] }
  it('tells the cashier QZ is waiting for a click and where the permanent fix is', () => {
    const h = describeHealth(true, b, q)
    expect(h.level).toBe('warn')
    expect(h.label).toContain('Allow printing in QZ')
    expect(h.action).toMatch(/never asks again/)
  })
  it('does not fire in browser mode', () => {
    expect(describeHealth(false, b, q).level).toBe('off')
  })
})
