import { useEffect, useMemo, useState } from 'react'
import { Btn, Field, Panel, Tag, useToast } from '@/components/ui'
import type { InvoicePrefs } from '@/lib/prefs'
import { fetchQzCertificate } from '@/lib/repo'
import { receiptToDoc, type ReceiptData } from '@/lib/receipt'
import { downloadTrustInstaller } from '@/lib/printing/trustInstaller'
import { blocksToHtml, PREVIEW_CSS } from '@/lib/printing/html'
import { layoutDocument } from '@/lib/printing/layout'
import {
  COLS_MAX,
  COLS_MIN,
  CUSTOM_PRESET_ID,
  PAPER_PRESETS,
  paperGeometry,
  presetFromProbe,
  type CodePageId,
  type PrintSettings,
} from '@/lib/printing/presets'
import { sampleReceipt, TEST_SHEETS, type TestKind } from '@/lib/printing/testSheets'
import { usePrintStatus } from '@/lib/printing/usePrintStatus'

type Patch = (p: Partial<PrintSettings>) => void

const CODEPAGES: { id: CodePageId; label: string }[] = [
  { id: 'cp858', label: 'CP858: Western Europe + Euro (most printers)' },
  { id: 'cp437', label: 'CP437: US (every printer has it)' },
  { id: 'cp850', label: 'CP850: Western Europe' },
  { id: 'cp852', label: 'CP852: Central Europe' },
  { id: 'cp860', label: 'CP860: Portuguese' },
  { id: 'cp863', label: 'CP863: Canadian French' },
  { id: 'cp865', label: 'CP865: Nordic' },
  { id: 'cp866', label: 'CP866: Cyrillic' },
  { id: 'windows1252', label: 'Windows-1252' },
  { id: 'auto', label: 'Automatic (switch per character)' },
]

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="pp-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Num({ value, min, max, step = 1, onChange, ariaLabel }: { value: number; min: number; max: number; step?: number; onChange: (n: number) => void; ariaLabel: string }) {
  return (
    <input
      className="field-control num"
      type="number"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))))
      }}
    />
  )
}

/** Live preview: the SAME blocks the printer receives, in a box exactly `cols` characters wide. */
export function ReceiptPreview({ invoice, settings, receipt, stress }: { invoice: InvoicePrefs; settings: PrintSettings; receipt: ReceiptData; stress: boolean }) {
  const { html, cols, lines } = useMemo(() => {
    const src = stress ? sampleReceipt(true) : receipt
    const laid = layoutDocument(receiptToDoc(invoice, src, settings), settings)
    return { html: blocksToHtml(laid.blocks, laid.cols), cols: laid.cols, lines: laid.blocks.length }
  }, [invoice, settings, receipt, stress])
  const g = paperGeometry(settings)
  return (
    <div className="receipt-stage" style={{ minHeight: 320, containerType: 'inline-size', width: '100%' }}>
      <style dangerouslySetInnerHTML={{ __html: PREVIEW_CSS }} />
      {/* Courier advance is 0.6em, so font-size = available width / (cols x 0.6) makes exactly `cols` cells fill the rail: the preview shrinks, it never clips or wraps. */}
      <div
        className="rcpt"
        style={{ width: `${cols}ch`, fontSize: `min(13px, calc((100cqw - 26px) / ${(cols * 0.6).toFixed(2)}))` }}
        aria-label="Receipt preview"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="t-caption" style={{ textAlign: 'center', marginTop: 6 }}>
        {g.paperMm} mm paper &middot; {cols} columns &middot; {lines} lines. The preview is built from the same text the printer receives.
      </div>
    </div>
  )
}

export default function PrintingPanel({
  settings,
  onChange,
  onTest,
}: {
  settings: PrintSettings
  onChange: Patch
  /** Sends a sheet through the real pipeline and reports the outcome. */
  onTest: (kind: TestKind) => Promise<void>
}) {
  const toast = useToast()
  const health = usePrintStatus()
  const g = paperGeometry(settings)
  const qz = settings.backend === 'qz'
  const [printers, setPrinters] = useState<string[]>([])
  const [diag, setDiag] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [probeCols, setProbeCols] = useState('')
  const [setupFile, setSetupFile] = useState<string | null>(null)

  // Refresh the printer list whenever the QZ bridge (re)connects.
  useEffect(() => {
    if (!qz || health.bridge.bridge !== 'connected') return
    let alive = true
    void import('@/lib/printing/bridge').then((b) => b.listPrinters()).then((l) => alive && setPrinters(l)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [qz, health.bridge.bridge])

  async function check() {
    setBusy('check')
    try {
      const { testConnection } = await import('@/lib/printing/bridge')
      const r = await testConnection(settings)
      setPrinters(r.printers)
      if (r.ok) setDiag({ ok: true, text: `QZ Tray ${r.version || ''} connected. Printer: ${r.chosen}. ${r.signed ? 'Trusted: prints silently.' : 'Not signed: QZ will ask to allow. See the setup guide.'}` })
      else setDiag({ ok: false, text: r.error ?? (r.printers.length ? 'No receipt printer matched. Pick one below.' : 'QZ Tray is connected but lists no printers.') })
    } finally {
      setBusy(null)
    }
  }

  async function test(kind: TestKind) {
    setBusy(kind)
    try {
      await onTest(kind)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Test print failed.', 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Panel
        title="Printer connection"
        subtitle="Set up once per counter. Afterwards the cashier never touches it."
        actions={<Tag kind={health.level === 'ok' ? 'green' : health.level === 'error' ? 'red' : 'gray'}>{qz ? health.label.toUpperCase() : 'BROWSER'}</Tag>}
        bodyPad
      >
        <div className="stack" style={{ gap: 14 }}>
          <Field label="Print method" help="Silent: bills go straight to the thermal printer through QZ Tray, no dialogs, no pop-ups, queued if the printer is off. Browser: the normal print dialog.">
            <div className="seg" role="group">
              {(['qz', 'browser'] as const).map((v) => (
                <button key={v} type="button" className={`seg-btn ${settings.backend === v ? 'active' : ''}`} onClick={() => onChange({ backend: v })}>
                  {v === 'qz' ? 'Silent (QZ Tray)' : 'Browser dialog'}
                </button>
              ))}
            </div>
          </Field>

          {qz && (
            <>
              <div className="pp-grid">
                <Field label="Printer" help="Automatic finds the receipt printer by itself and follows it if Windows renames it.">
                  <select className="field-control" value={settings.printer} onChange={(e) => onChange({ printer: e.target.value })}>
                    <option value="">Automatic{health.bridge.printer ? ` (${health.bridge.printer})` : ''}</option>
                    {[...new Set([settings.printer, ...printers].filter(Boolean))].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Printer language" help="ESC/POS fits almost every receipt printer. Choose Star only for Star Micronics models in Star mode.">
                  <select className="field-control" value={settings.language} onChange={(e) => onChange({ language: e.target.value as PrintSettings['language'] })}>
                    <option value="esc-pos">ESC/POS (Epson compatible)</option>
                    <option value="star-line">Star Line mode</option>
                    <option value="star-prnt">StarPRNT</option>
                  </select>
                </Field>
              </div>
              <div className="pp-diag" aria-live="polite">
                <span>
                  QZ Tray: <b>{health.bridge.bridge === 'connected' ? `connected${health.bridge.version ? ` (v${health.bridge.version})` : ''}` : health.bridge.bridge === 'unreachable' ? 'not running' : 'connecting'}</b>
                  {' '}&middot; Trust: <b>{health.bridge.signed ? 'signed (silent)' : 'unsigned (QZ will ask)'}</b>
                  {' '}&middot; Printer: <b>{health.bridge.printer ?? 'none'}</b>
                </span>
                {diag && <span style={{ color: diag.ok ? 'var(--ok-fg,#24a148)' : 'var(--err-fg,#da1e28)' }}>{diag.text}</span>}
              </div>
              <div className={`pp-setup ${health.bridge.awaitingPermission || !health.bridge.signed ? 'pp-setup-attn' : ''}`}>
                <b>Stop the "Allow" pop-ups (one time for this PC)</b>
                <span>
                  {health.bridge.awaitingPermission
                    ? 'QZ Tray is asking for permission right now. Click Allow once, then do the steps below so it never asks again.'
                    : 'If QZ Tray shows "Untrusted website" (or "Allow / Block" on every print), QZ does not trust ORSquare on this PC yet. Clicking Allow or "Remember" cannot fix that: QZ only trusts a certificate that is installed in its own folder. Do this once per PC:'}
                </span>
                <ol>
                  <li>Click <b>Download setup file</b>.</li>
                  <li>Open the downloaded <b>ORSquare-Printer-Setup</b> file (double-click). If Windows warns about the file, choose Run anyway.</li>
                  <li>Windows asks for permission <b>once</b> (it installs into QZ Tray's folder): choose <b>Yes</b>. Wait for "Done". QZ Tray restarts by itself. Printing is silent from now on.</li>
                </ol>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <Btn
                    variant="primary"
                    disabled={busy === 'setup'}
                    onClick={async () => {
                      setBusy('setup')
                      try {
                        setSetupFile(await downloadTrustInstaller(fetchQzCertificate))
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Could not create the setup file. Is the server set up for silent printing?', 'err')
                      } finally {
                        setBusy(null)
                      }
                    }}
                  >
                    {busy === 'setup' ? 'Preparing...' : 'Download setup file'}
                  </Btn>
                  {setupFile && <span className="t-caption">Saved {setupFile}. Open it, then press Check connection.</span>}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Btn variant="secondary" disabled={busy === 'check'} onClick={check}>
                  {busy === 'check' ? 'Checking...' : 'Check connection'}
                </Btn>
              </div>
              <Check label="Hold receipts while the printer reports offline or out of paper (prints when it is back)" checked={settings.holdWhenOffline} onChange={(v) => onChange({ holdWhenOffline: v })} />
            </>
          )}
        </div>
      </Panel>

      <Panel title="Paper & printer size" subtitle="The layout, columns, barcode and margins all follow this." bodyPad>
        <div className="stack" style={{ gap: 14 }}>
          <div className="pp-presets" role="radiogroup" aria-label="Paper preset">
            {[...PAPER_PRESETS, { id: CUSTOM_PRESET_ID, label: 'Custom', hint: 'Enter columns and dots from your printer manual or ruler test', paperMm: 0, printableMm: 0, dots: 0, font: 'a', cols: 0 }].map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={settings.preset === p.id}
                className={`pp-preset ${settings.preset === p.id ? 'active' : ''}`}
                onClick={() => onChange({ preset: p.id as PrintSettings['preset'] })}
              >
                <b>{p.label}</b>
                {p.id !== CUSTOM_PRESET_ID && (
                  <span>
                    {p.paperMm} mm &middot; {p.cols} cols &middot; {p.dots} dots &middot; Font {p.font.toUpperCase()}
                  </span>
                )}
                <span>{p.hint}</span>
              </button>
            ))}
          </div>
          {settings.preset === CUSTOM_PRESET_ID && (
            <div className="pp-grid">
              <Field label="Characters per line"><Num ariaLabel="Characters per line" value={settings.customCols} min={COLS_MIN} max={COLS_MAX} onChange={(n) => onChange({ customCols: n })} /></Field>
              <Field label="Printable dots" help="Head width in dots (384 / 512 / 576 are typical)."><Num ariaLabel="Printable dots" value={settings.customDots} min={192} max={832} onChange={(n) => onChange({ customDots: n })} /></Field>
              <Field label="Font">
                <select className="field-control" value={settings.customFont} onChange={(e) => onChange({ customFont: e.target.value as 'a' | 'b' })}>
                  <option value="a">Font A (large)</option>
                  <option value="b">Font B (small)</option>
                </select>
              </Field>
            </div>
          )}
          <Field label="Not sure which preset? Measure it" help="Press Printer probe under Test & calibrate. Count the characters in row 1 of FONT A (the ruler wraps where the paper ends) and enter it here.">
            <div className="row" style={{ gap: 8 }}>
              <input className="field-control num" style={{ maxWidth: 140 }} inputMode="numeric" placeholder="e.g. 32" aria-label="Characters in row 1 of Font A" value={probeCols} onChange={(e) => setProbeCols(e.target.value.replace(/[^0-9]/g, ''))} />
              <Btn
                variant="secondary"
                disabled={!probeCols}
                onClick={() => {
                  const p = presetFromProbe(Number(probeCols))
                  if (!p) return toast(`Enter a number between ${COLS_MIN} and ${COLS_MAX}.`, 'err')
                  onChange(p)
                  toast('Paper size set from your measurement. Print Sample bill to confirm.')
                }}
              >
                Apply
              </Btn>
            </div>
          </Field>
          <div className="pp-grid">
            <Field label="Left margin (dots)" help="8 dots = 1 mm. Use when the left edge is clipped."><Num ariaLabel="Left margin" value={settings.marginLeft} min={0} max={120} onChange={(n) => onChange({ marginLeft: n })} /></Field>
            <Field label="Right margin (dots)" help="Use when the right edge is clipped."><Num ariaLabel="Right margin" value={settings.marginRight} min={0} max={120} onChange={(n) => onChange({ marginRight: n })} /></Field>
            <Field label="Trim columns" help="Drop the last N columns for printers that clip the final character."><Num ariaLabel="Trim columns" value={settings.colsTrim} min={0} max={4} onChange={(n) => onChange({ colsTrim: n })} /></Field>
          </div>
          <div className="t-caption">
            Result: <b>{g.usableCols}</b> usable columns on {g.paperMm} mm paper ({g.printWidthDots} printable dots).
          </div>
        </div>
      </Panel>

      <Panel title="Receipt layout" subtitle="Compactness and content. The preview updates as you change these." bodyPad>
        <div className="stack" style={{ gap: 14 }}>
          <div className="pp-grid">
            <Field label="Receipt style" help="Polished: title, heavy rules around the total, barcode at the bottom. Classic: plain ruled sections.">
              <select className="field-control" value={settings.style} onChange={(e) => onChange({ style: e.target.value as PrintSettings['style'] })}>
                <option value="polished">Polished</option>
                <option value="classic">Classic</option>
              </select>
            </Field>
            <Field label="Receipt title" help="Centered under the header. Leave empty for none. Try TAX INVOICE.">
              <input className="field-control" maxLength={32} value={settings.receiptTitle} onChange={(e) => onChange({ receiptTitle: e.target.value })} placeholder="SALES RECEIPT" />
            </Field>
            <Field label="Item rows">
              <select className="field-control" value={settings.itemLayout} onChange={(e) => onChange({ itemLayout: e.target.value as PrintSettings['itemLayout'] })}>
                <option value="table">Table: Item | Qty | Rate | Amount</option>
                <option value="stacked">Stacked: name, then qty x rate</option>
              </select>
            </Field>
            <Field label="Line spacing">
              <select className="field-control" value={settings.spacing} onChange={(e) => onChange({ spacing: e.target.value as PrintSettings['spacing'] })}>
                <option value="tight">Compact (saves paper)</option>
                <option value="normal">Normal (printer default)</option>
                <option value="loose">Open</option>
              </select>
            </Field>
            <Field label="Shop name size">
              <select className="field-control" value={settings.headerSize} onChange={(e) => onChange({ headerSize: e.target.value as PrintSettings['headerSize'] })}>
                <option value="large">Large when it fits</option>
                <option value="normal">Normal bold</option>
              </select>
            </Field>
            <Field label="Divider line">
              <select className="field-control" value={settings.ruleChar} onChange={(e) => onChange({ ruleChar: e.target.value as PrintSettings['ruleChar'] })}>
                <option value="-">- - - dashes</option>
                <option value="=">= = = double</option>
                <option value=".">. . . dots</option>
                <option value="*">* * * stars</option>
              </select>
            </Field>
            <Field label="Currency text" help="Printed on totals. Most receipt code pages have no rupee sign, so use Rs."><input className="field-control" maxLength={6} value={settings.currency} onChange={(e) => onChange({ currency: e.target.value })} /></Field>
            <Field label="Character set" help="If accented letters print wrong, try another.">
              <select className="field-control" value={settings.codePage} onChange={(e) => onChange({ codePage: e.target.value as CodePageId })}>
                {CODEPAGES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="pp-toggles">
            <Check label="Show time with date" checked={settings.showTime} onChange={(v) => onChange({ showTime: v })} />
            <Check label="Show served-by" checked={settings.showStaff} onChange={(v) => onChange({ showStaff: v })} />
            <Check label="Show station" checked={settings.showStation} onChange={(v) => onChange({ showStation: v })} />
            <Check label="Number the items" checked={settings.showItemNumbers} onChange={(v) => onChange({ showItemNumbers: v })} />
            <Check label="Show bottle size / unit" checked={settings.showUnit} onChange={(v) => onChange({ showUnit: v })} />
            <Check label="Show item and quantity count" checked={settings.showItemCount} onChange={(v) => onChange({ showItemCount: v })} />
          </div>
          <Check
            label="Print the bill barcode at the bottom: scan it in Sales History to open that bill in a second"
            checked={settings.code !== 'none'}
            onChange={(v) => onChange({ code: v ? 'code128' : 'none' })}
          />
          <div className="pp-grid">
            {settings.code !== 'none' && (
              <Field label="Bill code type" help="Barcode is read by every scanner. QR is read by phones.">
                <select className="field-control" value={settings.code} onChange={(e) => onChange({ code: e.target.value as PrintSettings['code'] })}>
                  <option value="code128">Barcode (Code 128)</option>
                  <option value="qr">QR code</option>
                </select>
              </Field>
            )}
            <Field label="Paper cut">
              <select className="field-control" value={settings.cut} onChange={(e) => onChange({ cut: e.target.value as PrintSettings['cut'] })}>
                <option value="full">Full cut</option>
                <option value="partial">Partial cut (keeps a tab)</option>
                <option value="none">No cutter (tear off)</option>
              </select>
            </Field>
            <Field label="Feed before cut (lines)" help="Raise if the cutter clips the last line."><Num ariaLabel="Feed lines" value={settings.feedLines} min={0} max={12} onChange={(n) => onChange({ feedLines: n })} /></Field>
            <Field label="Blank lines at top"><Num ariaLabel="Top feed" value={settings.topFeed} min={0} max={6} onChange={(n) => onChange({ topFeed: n })} /></Field>
            <Field label="Copies"><Num ariaLabel="Copies" value={settings.copies} min={1} max={3} onChange={(n) => onChange({ copies: n })} /></Field>
            <Field label="Cash drawer" help="Needs a drawer on the printer's RJ11 port.">
              <select className="field-control" value={settings.drawer} onChange={(e) => onChange({ drawer: e.target.value as PrintSettings['drawer'] })}>
                <option value="never">Never open</option>
                <option value="cash">Open on cash bills</option>
                <option value="always">Open on every bill</option>
              </select>
            </Field>
            {settings.drawer !== 'never' && (
              <Field label="Drawer pin">
                <select className="field-control" value={settings.drawerPin} onChange={(e) => onChange({ drawerPin: e.target.value === '1' ? 1 : 0 })}>
                  <option value="0">Pin 2 (most drawers)</option>
                  <option value="1">Pin 5</option>
                </select>
              </Field>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Test & calibrate" subtitle="Short sheets so testing costs little paper. They use exactly the same path as a real bill." bodyPad>
        <div className="stack" style={{ gap: 10 }}>
          <div className="pp-tests">
            {TEST_SHEETS.map((t) => (
              <Btn key={t.id} variant={t.id === 'sample' ? 'primary' : 'secondary'} title={t.hint} disabled={busy !== null} onClick={() => test(t.id)}>
                {busy === t.id ? 'Sending...' : t.label}
              </Btn>
            ))}
          </div>
          <div className="t-caption">Start with Ruler: the last column must be visible with both edge markers. Then Margins box, then Sample bill. Adjust margins, trim or feed above and repeat.</div>
        </div>
      </Panel>
    </div>
  )
}

