/** Copy text to the clipboard. Falls back to a hidden textarea where the async API is unavailable (an insecure origin, an old WebView). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    try {
      return document.execCommand('copy')
    } finally {
      area.remove()
    }
  }
}
