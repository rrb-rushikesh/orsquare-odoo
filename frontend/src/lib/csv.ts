/**
 * Client-side CSV download (UTF-8 with BOM so Excel opens it correctly).
 * Includes the original's formula-injection guard: cells that start with
 * = + - @ TAB CR are prefixed with an apostrophe unless they are plain numbers.
 */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v)
    if (!/^-?[\d.,]+$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const body = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
