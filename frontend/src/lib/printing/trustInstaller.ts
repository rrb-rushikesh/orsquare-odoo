/**
 * One-time "trust printing on this PC" setup file.
 *
 * Why it exists: QZ Tray shows "Untrusted website: Allow / Block" for any site whose signing certificate does not
 * chain to a root QZ trusts, and "Remember this decision" stays unavailable. QZ's documented way to trust a
 * certificate you issued yourself is to put the public certificate at `override.crt` in QZ Tray's INSTALL folder
 * (https://qz.io/docs/provisioning, "ca" step; QZ maintainers: "override.crt should be copied to the root of
 * C:\Program Files\QZ Tray\"). Writing it to the user profile, or adding it to QZ's allow-list, was tried first and
 * is NOT honoured for real (non-localhost) sites: QZ logged "Problem building certificate chain" and kept prompting.
 * With the file in the install folder QZ logs "Successfully chained certificate" and requests are silent.
 *
 * The install folder is under Program Files, so this needs administrator rights ONCE: the setup file shows a single
 * Windows permission prompt. It is a tiny .cmd that:
 *   1. writes ORSquare's PUBLIC certificate to %APPDATA%\qz\override.crt   (staging copy)
 *   2. copies it into QZ Tray's install folder (elevated, one Windows prompt) and verifies the hash
 *   3. removes the older per-user override line from qz-tray.properties (ignored by QZ, only confusing)
 *   4. restarts QZ Tray so it loads the certificate
 *
 * Only the public certificate is embedded. The PowerShell runs as -EncodedCommand so no quoting/escaping problem can
 * corrupt it. Re-running is harmless (a QZ upgrade/reinstall wipes the install folder, so it may be needed again).
 */

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  $dir = Join-Path $env:APPDATA 'qz'
  $crt = Join-Path $dir 'override.crt'
  if (-not (Test-Path $crt)) { throw 'The certificate file was not written.' }
  $qz = @('C:\\Program Files\\QZ Tray', 'C:\\Program Files (x86)\\QZ Tray') | Where-Object { Test-Path (Join-Path $_ 'qz-tray.jar') } | Select-Object -First 1
  if (-not $qz) { throw 'QZ Tray is not installed. Install it from qz.io, then run this file again.' }
  $dest = Join-Path $qz 'override.crt'
  $same = { (Test-Path $dest) -and ((Get-FileHash $dest).Hash -eq (Get-FileHash $crt).Hash) }
  if (-not (& $same)) {
    Write-Host 'Windows will ask for permission once. Choose Yes.' -ForegroundColor Yellow
    $inner = "Copy-Item -Force -LiteralPath '$crt' -Destination '$dest'"
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
    try {
      Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $enc
    } catch {
      throw 'Windows permission was declined. Run this file again and choose Yes.'
    }
    if (-not (& $same)) { throw 'The certificate could not be installed into QZ Tray. Administrator permission is required.' }
  }
  $props = Join-Path $dir 'qz-tray.properties'
  if (Test-Path $props) {
    $keep = @(Get-Content $props | Where-Object { $_ -notmatch '^authcert\\.override=' })
    Set-Content -Path $props -Value $keep -Encoding ASCII
  }
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'javaw.exe' -and $_.CommandLine -like '*qz-tray*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep -Seconds 2
  Start-Process (Join-Path $qz 'qz-tray.exe')
  Write-Host ''
  Write-Host 'Done. ORSquare can now print on this PC without asking.' -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host ('Setup could not finish: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
`.trim()

/** UTF-16LE base64, the encoding powershell.exe -EncodedCommand expects. */
export function encodePowerShell(script: string): string {
  const bytes: number[] = []
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i)
    bytes.push(c & 0xff, c >> 8)
  }
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** Builds the .cmd text. Throws if what it was given is not a public certificate (never embeds a key). */
export function buildTrustInstaller(certPem: string): string {
  const pem = certPem.replace(/\r/g, '').trim()
  if (/PRIVATE KEY/.test(pem)) throw new Error('Refusing to embed a private key.')
  const m = pem.match(/-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/)
  if (!m) throw new Error('Not a PEM certificate.')
  const body = m[1].replace(/\s+/g, '')
  const lines = body.match(/.{1,64}/g) ?? []
  // Base64 characters are all safe inside a batch `echo`.
  const crtEchoes = ['echo -----BEGIN CERTIFICATE-----', ...lines.map((l) => `echo ${l}`), 'echo -----END CERTIFICATE-----']
  return [
    '@echo off',
    'title ORSquare - allow printing on this PC (one time)',
    'echo.',
    'echo Setting up silent printing for ORSquare on this PC...',
    'if not exist "%APPDATA%\\qz" mkdir "%APPDATA%\\qz"',
    '(',
    ...crtEchoes,
    ') > "%APPDATA%\\qz\\override.crt"',
    `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodePowerShell(PS_SCRIPT)}`,
    'echo.',
    'pause',
    '',
  ].join('\r\n')
}

/** Browser: fetches the certificate from the server and saves the setup file. Returns the file name. */
export async function downloadTrustInstaller(fetchCertificate: () => Promise<string>): Promise<string> {
  const cmd = buildTrustInstaller(await fetchCertificate())
  const name = 'ORSquare-Printer-Setup.cmd'
  const url = URL.createObjectURL(new Blob([cmd], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return name
}
