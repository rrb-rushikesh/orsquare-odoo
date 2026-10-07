import { useEffect, useMemo, useRef, useState } from 'react'
import { Btn, Drawer } from './ui'
import type { SheetPdfData, SheetPdfOptions, SheetPaper } from '@/lib/sheetPdf'

const SUMMARY_SECTION = 'day summary';

const DEFAULT: SheetPdfOptions = {
  paper: 'A4', orientation: 'landscape', marginMm: 8, fontSize: 7,
  headerFooter: true, mode: 'full', selectedSections: [], closingLayout: 'grouped',
};

export function SheetPrintPanel({ open, onClose, data }: { open: boolean; onClose: () => void; data: SheetPdfData | null }) {
  const [options, setOptions] = useState<SheetPdfOptions>(DEFAULT)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(false)
  const key = useMemo(() => JSON.stringify({ data, options }), [data, options])

  /**
   * Sections come from the registers the server actually returned, not from a
   * hardcoded [liquor, beer, others] list. A shop with a Kitchen register (or
   * any renamed/custom register) previously could not print that section at
   * all, and the default selection silently missed it.
   */
  const availableSections = useMemo(() => {
    const names = (data?.sections || []).map((s) => s.tabLabel.toLowerCase());
    return [...names, SUMMARY_SECTION];
  }, [data]);

  // A section that disappears (register emptied, tab filtered) must not stay
  // selected, or the PDF renders "No sections selected." for a real selection.
  useEffect(() => {
    setOptions((o) => {
      const kept = o.selectedSections.filter((s) => availableSections.includes(s));
      return kept.length === o.selectedSections.length ? o : { ...o, selectedSections: kept };
    });
  }, [availableSections]);

  // Default to everything the first time real data arrives.
  //
  // The guard must be `data`, not `availableSections.length`. This component is
  // mounted permanently by SheetPage (open={printOpen}), so on first render the
  // Sheet is still loading and `data` is null. availableSections is then
  // ['day summary'] — non-empty — so an empty-data guard primed the panel with
  // the summary alone and latched `primed.current = true`. When the registers
  // arrived the selection was never extended, and Print produced a PDF holding
  // only the Day Summary page: the register itself silently did not print.
  const primed = useRef(false);
  useEffect(() => {
    if (primed.current || !data || !data.sections.length) return;
    primed.current = true;
    setOptions((o) => (o.selectedSections.length ? o : { ...o, selectedSections: availableSections }));
  }, [availableSections, data]);

  useEffect(() => {
    if (!open || !data) return
    let alive = true
    let url: string | null = null
    setRendering(true)
    setError('')
    setPreviewUrl(null)
    import('@/lib/sheetPdf').then(({ makeSheetPdf }) => makeSheetPdf(data, options)).then(blob => {
      if (!alive) return
      url = URL.createObjectURL(blob)
      setPreviewUrl(url)
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : 'PDF could not be built.') })
      .finally(() => { if (alive) setRendering(false) })
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
    // key represents every input that affects the PDF bytes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])

  const setPaper = (paper: SheetPaper) => setOptions(o => ({ ...o, paper, mode: paper === 'A4' ? 'full' : 'closing' }))
  const setSection = (name: string) => setOptions(o => ({ ...o, selectedSections: o.selectedSections.includes(name)
    ? o.selectedSections.filter(s => s !== name) : [...o.selectedSections, name] }))
  /** One-click intents. The two jobs a shop actually has — "print me today's
   *  sheet" and "print me the count sheet" — were previously reachable only by
   *  finding the Mode dropdown, and the closing mode silently inherited
   *  whatever section selection was left over. */
  const printFullSheet = () => setOptions(o => ({ ...o, paper: 'A4', mode: 'full', selectedSections: availableSections }))
  const printClosingStock = () => setOptions(o => ({ ...o, paper: 'A4', mode: 'closing', selectedSections: availableSections.filter(s => s !== SUMMARY_SECTION) }))
  return <Drawer open={open} onClose={onClose} title="Print sheet" xwide footer={<>
    <span style={{ flex: 1, fontSize: 12 }}>Print at Actual size (100%). Never select Fit or Shrink.</span>
    <Btn onClick={printFullSheet}>Full sheet</Btn>
    <Btn onClick={printClosingStock}>Closing stock</Btn>
    <Btn variant="primary" disabled={!previewUrl} onClick={() => { if (previewUrl) window.open(previewUrl, '_blank', 'noopener,noreferrer') }}>Open PDF to print</Btn>
  </>}>
    <div className="sheet-print-options">
      <div role="group" aria-label="What to print"><strong>What to print</strong>
        <Btn variant={options.paper === 'A4' && options.mode === 'full' ? 'primary' : 'ghost'} onClick={printFullSheet}>Full sheet</Btn>
        <Btn variant={options.mode === 'closing' ? 'primary' : 'ghost'} onClick={printClosingStock}>Closing stock only</Btn>
      </div>
      <div role="group" aria-label="Page template"><strong>Template</strong>{(['A4', '80mm', '58mm'] as const).map(p =>
        <Btn key={p} variant={options.paper === p ? 'primary' : 'ghost'} onClick={() => setPaper(p)}>{p}</Btn>)}</div>
      {options.paper === 'A4' && <>
        <label>Mode <select className="field-control" value={options.mode} onChange={e => setOptions(o => ({ ...o, mode: e.target.value as 'full' | 'closing' }))}>
          <option value="full">Full sheet</option><option value="closing">Closing stock</option>
        </select></label>
        {options.mode === 'closing' && <label>Closing layout <select className="field-control" value={options.closingLayout} onChange={e => setOptions(o => ({ ...o, closingLayout: e.target.value as 'grouped' | 'flat' }))}>
          <option value="grouped">Grouped by brand</option>
          <option value="flat">Every variant, one per line</option>
        </select></label>}
        <label>Orientation <select className="field-control" value={options.orientation} onChange={e => setOptions(o => ({ ...o, orientation: e.target.value as 'portrait' | 'landscape' }))}>
          <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
        </select></label>
        <label>Margin (mm) <input className="field-control" type="number" min="4" max="20" value={options.marginMm} onChange={e => setOptions(o => ({ ...o, marginMm: Math.min(20, Math.max(4, Number(e.target.value) || 4)) }))} /></label>
        <label>Text size <select className="field-control" value={options.fontSize} onChange={e => setOptions(o => ({ ...o, fontSize: Number(e.target.value) }))}>
          <option value="6">Dense</option><option value="7">Standard</option><option value="9">Large</option>
        </select></label>
        <label><input type="checkbox" checked={options.headerFooter} onChange={e => setOptions(o => ({ ...o, headerFooter: e.target.checked }))} /> Header and footer</label>
      </>}
      <div role="group" aria-label="Sections"><strong>Sections</strong>{availableSections.map(name =>
        <label key={name}><input type="checkbox" checked={options.selectedSections.includes(name)} onChange={() => setSection(name)} /> {name}</label>)}</div>
    </div>
    {options.mode === 'closing' && <p className="t-caption">
      Printed in the order shown on screen: pinned brands first, then the demand ranking.
      {options.closingLayout === 'grouped' ? ' Each brand is headed and totalled.' : ''}
    </p>}
    {options.paper !== 'A4' && <p className="t-caption">Closing count only: product, closing quantity, tick box.</p>}
    {rendering && <p role="status">Building preview…</p>}
    {error && <p role="alert">{error}</p>}
    {previewUrl && <object type="application/pdf" data={previewUrl} aria-label="Sheet PDF preview" style={{ width: '100%', height: '60vh', border: '1px solid var(--line)' }}>
      {/* Chrome refuses to render a PDF inside an <iframe>; <object> embeds the
          viewer reliably. The link is the fallback for browsers that refuse both. */}
      <a href={previewUrl} target="_blank" rel="noopener noreferrer">Open the sheet PDF</a>
    </object>}
  </Drawer>
}
