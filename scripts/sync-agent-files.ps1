# Keeps AGENTS.md and CLAUDE.md byte-identical.
# Copies the most recently modified one over the other. Run after editing either file.
$root = Split-Path -Parent $PSScriptRoot
$a = Join-Path $root 'AGENTS.md'
$c = Join-Path $root 'CLAUDE.md'

if (-not (Test-Path $a) -and -not (Test-Path $c)) { Write-Error 'Neither AGENTS.md nor CLAUDE.md exists.'; exit 1 }
if (-not (Test-Path $c)) { Copy-Item $a $c; Write-Host 'Created CLAUDE.md from AGENTS.md'; exit 0 }
if (-not (Test-Path $a)) { Copy-Item $c $a; Write-Host 'Created AGENTS.md from CLAUDE.md'; exit 0 }

if ((Get-FileHash $a).Hash -eq (Get-FileHash $c).Hash) { Write-Host 'Already identical.'; exit 0 }

if ((Get-Item $a).LastWriteTimeUtc -ge (Get-Item $c).LastWriteTimeUtc) {
  Copy-Item $a $c -Force; Write-Host 'Synced AGENTS.md -> CLAUDE.md'
} else {
  Copy-Item $c $a -Force; Write-Host 'Synced CLAUDE.md -> AGENTS.md'
}
