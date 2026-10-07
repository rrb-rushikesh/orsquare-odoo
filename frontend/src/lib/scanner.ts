// Keyboard-wedge barcode capture: Option A.
// The scanner "types" the code like a keyboard, then sends Enter (its suffix).
// We detect machine bursts by inter-keystroke timing and commit on Enter or gap.

export const SCAN_GAP_MS = 55 // max gap between scanner keystrokes
export const SCAN_TIMEOUT_MS = 400 // commit a partial burst after this silence
export const MIN_SCAN_LEN = 4
export const DEDUP_MS = 350 // ignore machine-gun re-reads of the same code (<350ms)

export type ScannerState =
  | 'IDLE'
  | 'RECEIVING'
  | 'COMPLETE'
  | 'VALIDATING'
  | 'RESOLVED'
  | 'ADDING'
  | 'READY'

export interface ScannerCapture {
  detach: () => void
  getState: () => ScannerState
}

export interface ScannerOptions {
  dedupMs?: number
  onStateChange?: (state: ScannerState) => void
}

/** Validates EAN-13 / UPC-A / EAN-8 / GS1-14 check digits. Non-numeric or
 * unknown lengths are not rejected (cannot be validated). */
export function validEan(s: string): boolean {
  const d = s.replace(/\D/g, '')
  if (![8, 12, 13, 14].includes(d.length)) return true
  let sum = 0
  for (let i = 0; i < d.length - 1; i++) {
    sum += Number(d[i]) * ((d.length - 1 - i) % 2 === 0 ? 1 : 3)
  }
  const check = (10 - (sum % 10)) % 10
  return check === Number(d[d.length - 1])
}

let _ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (_ctx) return _ctx
  try {
    const ac = new (window.AudioContext as unknown as new () => AudioContext)()
    _ctx = ac
    void ac.resume?.()
    return ac
  } catch {
    return null
  }
}

/** Short WebAudio beeps: zero assets, works offline. */
export function beep(kind: 'ok' | 'err' = 'ok'): void {
  try {
    const ac = audio()
    if (!ac) return
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.connect(g)
    g.connect(ac.destination)
    const now = ac.currentTime
    if (kind === 'ok') {
      o.frequency.value = 880
      g.gain.setValueAtTime(0.18, now)
      g.gain.linearRampToValueAtTime(0.001, now + 0.1)
      o.start(now)
      o.stop(now + 0.11)
    } else {
      o.frequency.value = 220
      g.gain.setValueAtTime(0.2, now)
      g.gain.linearRampToValueAtTime(0.001, now + 0.05)
      o.start(now)
      o.stop(now + 0.06)
    }
  } catch {
    /* silent on unsupported browsers */
  }
}

/** Strips optional AIM Code ID prefix (e.g. "]E0") and whitespace. */
export function normalizeScan(raw: string): string {
  let s = raw.trim()
  if (s.startsWith(']') && s.length > 3 && /^\][A-Z0-9]{2}/.test(s)) s = s.slice(3)
  return s.trim()
}

/** Checks whether an element is an active text input that should receive normal typing. */
export function isTextInputElement(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'textarea' || (el as HTMLElement).isContentEditable) return true
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type)
  }
  return false
}

/** Installs a global keydown listener that commits a barcode burst to
 *  `onScan` following the formal state machine:
 *  IDLE → RECEIVING → COMPLETE → VALIDATING → RESOLVED → ADDING → READY.
 *
 *  - Captures scans when non-input elements (body, table row, button) have focus.
 *  - Suppresses hardware machine-gun bounce (< dedupMs) for identical barcodes.
 *  - Preserves normal typing in text fields.
 *  - Prevents the scanner's trailing Enter from activating focused buttons.
 */
export function attachScannerCapture(
  onScan: (code: string) => void,
  options?: ScannerOptions
): ScannerCapture {
  const dedupMs = options?.dedupMs ?? DEDUP_MS
  let state: ScannerState = 'IDLE'
  let buf = ''
  let lastAt = 0
  let lastBurst = false
  let idleTimer: number | undefined
  let lastCommittedCode = ''
  let lastCommittedAt = 0

  const setState = (s: ScannerState) => {
    state = s
    options?.onStateChange?.(s)
  }

  const commitBuf = () => {
    if (idleTimer !== undefined) {
      window.clearTimeout(idleTimer)
      idleTimer = undefined
    }
    if (buf.length >= MIN_SCAN_LEN) {
      setState('COMPLETE')
      setState('VALIDATING')
      const rawCode = buf
      const normCode = normalizeScan(rawCode)
      buf = ''
      lastBurst = false

      if (normCode.length >= MIN_SCAN_LEN && validEan(normCode)) {
        const now = performance.now()
        // Hardware machine-gun suppression for identical symbol:
        if (normCode === lastCommittedCode && now - lastCommittedAt < dedupMs) {
          setState('READY')
          setState('IDLE')
          return true
        }
        lastCommittedCode = normCode
        lastCommittedAt = now

        setState('RESOLVED')
        setState('ADDING')
        onScan(normCode)
        setState('READY')
        setState('IDLE')
        return true
      }
    }
    buf = ''
    lastBurst = false
    setState('IDLE')
    return false
  }

  // Suffix-less scanners never send Enter: commit whatever is buffered
  // after SCAN_TIMEOUT_MS of silence.
  const armIdleTimer = () => {
    if (idleTimer !== undefined) window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      idleTimer = undefined
      commitBuf()
    }, SCAN_TIMEOUT_MS)
  }

  const listener = (e: KeyboardEvent) => {
    const el = document.activeElement
    const editable = isTextInputElement(el)

    if (e.key === 'Escape') {
      if (buf) {
        buf = ''
        lastBurst = false
        setState('IDLE')
      }
      return
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      // If we have an active scanner burst outside editable text fields,
      // prevent default to avoid triggering any currently focused button/form or Tab movement.
      if (!editable && buf.length >= MIN_SCAN_LEN) {
        e.preventDefault()
        e.stopPropagation()
        commitBuf()
      }
      return
    }

    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return

    // Allow top-level shortcuts (? for cheat-sheet, / for search focus when buffer is empty)
    if (e.key === '?' || (e.key === '/' && buf.length === 0)) return

    const now = performance.now()
    if (editable) {
      // Keystrokes go to the active text field. Stand down scanner buffer.
      if (idleTimer !== undefined) {
        window.clearTimeout(idleTimer)
        idleTimer = undefined
      }
      buf = ''
      lastBurst = false
      if (state !== 'IDLE') setState('IDLE')
      return
    }

    const isBurst = lastBurst && (now - lastAt <= SCAN_GAP_MS)
    if (isBurst) {
      e.preventDefault()
      e.stopPropagation()
    }

    if (now - lastAt > SCAN_GAP_MS || !lastBurst) {
      // New burst or gap: commit previous if long enough, then start fresh
      if (buf.length >= MIN_SCAN_LEN) {
        commitBuf()
      } else {
        buf = ''
      }
      lastBurst = true
      setState('RECEIVING')
    }
    buf += e.key
    lastAt = now
    armIdleTimer()
  }

  window.addEventListener('keydown', listener, true)
  return {
    detach: () => {
      window.removeEventListener('keydown', listener, true)
      if (idleTimer !== undefined) window.clearTimeout(idleTimer)
    },
    getState: () => state,
  }
}