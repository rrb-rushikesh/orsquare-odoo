import { useMemo, useState } from 'react'
import { IconChevronDown } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { Tag } from '@/components/ui/Tag'
import { cx } from '@/lib/cx'
import type { StudioData, StudioSetup, StudioTab } from '../types'
import {
  allTabs, changedFeatures, featureOn, isChanged, isOn, resetFeatures, search, setFeature, setTabOn, setVariant, summary, variantOf, type Hit,
} from './model'

/**
 * Business Studio: one panel to decide what a business gets, built for the hierarchy Business -> Tabs -> Variants -> Features.
 * Three columns follow the hierarchy, so the screen never grows with the number of items: tabs are grouped and collapsible, a tab shows
 * only its own variants, a variant shows only its own features. Search reaches any item in one step; "changed" shows only what differs
 * from the defaults. Today there are few variants and no switchable features: the third column then says so, and the structure
 * is ready for hundreds.
 */
export function StudioPanel({
  open,
  title,
  data,
  value,
  onClose,
  onSave,
  saving,
}: {
  open: boolean
  title: string
  data: StudioData
  value: StudioSetup
  onClose: () => void
  onSave: (setup: StudioSetup) => void
  saving?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={undefined} ariaLabel={`Business Studio, ${title}`} width="min(1180px, 97vw)" flush>
      {open && <Workbench title={title} data={data} value={value} onClose={onClose} onSave={onSave} saving={saving} />}
    </Modal>
  )
}

function Workbench({
  title, data, value, onClose, onSave, saving,
}: {
  title: string
  data: StudioData
  value: StudioSetup
  onClose: () => void
  onSave: (setup: StudioSetup) => void
  saving?: boolean
}) {
  const [draft, setDraft] = useState<StudioSetup>(value)
  const tabs = useMemo(() => allTabs(data.groups), [data.groups])
  const [selKey, setSelKey] = useState<string | undefined>(() => tabs.find((t) => isOn(t, value))?.key ?? tabs[0]?.key)
  const [shut, setShut] = useState<Set<string>>(new Set())
  const [changesOnly, setChangesOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const sel = tabs.find((t) => t.key === selKey) ?? tabs[0]
  const sum = summary(data.groups, draft)
  const hits = search(data.groups, query)
  const dirty = JSON.stringify(draft) !== JSON.stringify(value)

  const jump = (h: Hit) => {
    setSelKey(h.tab.key)
    if (h.variant && variantOf(h.tab, draft).key !== h.variant.key) setDraft(setVariant(draft, h.tab, h.variant.key))
    setQuery('')
    if (h.feature) setTimeout(() => document.getElementById(`feat-${h.feature!.id}`)?.scrollIntoView({ block: 'center' }), 0)
  }

  return (
    <div className="flex h-[min(760px,92dvh)] min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-12 border-b border-line px-20 py-12">
        <div className="min-w-0">
          <div className="text-s11h font-semibold uppercase tracking-caption text-muted">Business Studio</div>
          <h2 className="m-0 truncate text-s16 font-medium">{title}</h2>
        </div>
        <div className="relative ml-12 min-w-200 max-w-360 flex-1">
          <Input appearance="toolbar" size="dense" fluid placeholder="Search tabs, variants or features" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query.trim() && (
            <div className="absolute top-full right-0 left-0 z-10 max-h-280 overflow-y-auto border border-line-strong bg-canvas">
              {hits.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => jump(h)}
                  className="flex w-full cursor-pointer items-baseline gap-8 border-0 bg-transparent px-12 py-7 text-left text-s13 hover:bg-layer-accent"
                >
                  <b className="font-medium">{h.feature?.label ?? h.variant?.label ?? h.tab.label}</b>
                  <span className="text-muted">{[h.tab.label, h.variant && h.feature ? h.variant.label : ''].filter(Boolean).filter((x) => x !== (h.feature?.label ?? h.variant?.label ?? h.tab.label)).join(' › ')}</span>
                </button>
              ))}
              {hits.length === 0 && <div className="px-12 py-8 text-s13 text-muted">No match.</div>}
            </div>
          )}
        </div>
        <Select
          fluid={false}
          appearance="toolbar"
          size="toolbarSelect"
          className="w-170"
          aria-label="Start from a template"
          value=""
          onChange={(e) => {
            const keys = data.templates[e.target.value]
            if (keys) {
              setDraft({ tabs: keys, features: {} })
              setSelKey(tabs.find((t) => t.variants.some((v) => keys.includes(v.key)))?.key)
            }
          }}
        >
          <option value="">Start from template…</option>
          {Object.keys(data.templates).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <label className="flex cursor-pointer items-center gap-6 text-s13">
          <input type="checkbox" className="size-14 accent-blue" checked={changesOnly} onChange={(e) => setChangesOnly(e.target.checked)} />
          Changed only
        </label>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[290px_290px_minmax(0,1fr)] narrow:grid-cols-1 narrow:overflow-y-auto">
        <Column title="Tabs" caption={`${sum.on} on`}>
          {data.groups.map((g) => {
            const rows = g.tabs.filter((t) => !changesOnly || isChanged(t, draft))
            if (!rows.length) return null
            const closed = shut.has(g.key)
            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => setShut((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}
                  aria-expanded={!closed}
                  className="sticky top-0 z-1 flex w-full cursor-pointer items-center gap-6 border-0 bg-canvas px-14 pt-8 pb-4 text-left text-s11h font-semibold uppercase tracking-caption text-muted"
                >
                  <IconChevronDown size={11} className={cx(closed && '-rotate-90')} />
                  {g.label}
                  <span className="text-subtle">{rows.length}</span>
                </button>
                {!closed && rows.map((t) => <TabRow key={t.key} tab={t} setup={draft} selected={t.key === sel?.key} onSelect={() => setSelKey(t.key)} onToggle={(on) => { setDraft(setTabOn(draft, t, on)); setSelKey(t.key) }} />)}
              </div>
            )
          })}
          {changesOnly && !tabs.some((t) => isChanged(t, draft)) && <Empty title="Nothing changed" text="Every tab is on its default." />}
        </Column>

        <Column title="Variants" caption="pick one version of the tab">
          {sel && !isOn(sel, draft) ? (
            <Empty title={`${sel.label} is off`} text="The business will not see this tab.">
              <Button variant="primary" size="sm" onClick={() => setDraft(setTabOn(draft, sel, true))}>Turn on</Button>
            </Empty>
          ) : (
            sel && (
              <div className="flex flex-col gap-8 p-12">
                {sel.variants.map((v) => {
                  const on = variantOf(sel, draft).key === v.key
                  return (
                    <button
                      key={v.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setDraft(setVariant(draft, sel, v.key))}
                      className={cx('flex cursor-pointer items-start gap-10 border bg-canvas px-12 py-10 text-left', on ? 'border-2 border-blue bg-layer-accent px-11 py-9' : 'border-line hover:border-blue')}
                    >
                      <span className={cx('relative mt-2 size-14 shrink-0 rounded-full border bg-canvas', on ? 'border-blue' : 'border-line-strong')}>{on && <span className="absolute inset-3 rounded-full bg-blue" />}</span>
                      <span>
                        <b className="font-semibold">{v.label}</b>
                        <span className="block text-s12 text-muted">
                          {v.features.length} feature{v.features.length === 1 ? '' : 's'}
                          {v.key === sel.variants[0].key ? ' · default' : ''}
                        </span>
                      </span>
                    </button>
                  )
                })}
                {sel.variants.length === 1 && <p className="m-0 text-s12 text-muted">{sel.label} has one variant today. More appear here when they exist.</p>}
              </div>
            )
          )}
        </Column>

        <Column
          title="Features"
          caption={sel && isOn(sel, draft) ? variantOf(sel, draft).label : ''}
          extra={
            sel && isOn(sel, draft) && variantOf(sel, draft).features.length > 0 ? (
              <>
                <Input size="dense" appearance="toolbar" fluid={false} className="w-160" placeholder="Filter" aria-label="Filter features" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <Button size="sm" variant="ghost" onClick={() => setDraft(resetFeatures(draft, variantOf(sel, draft)))} disabled={!changedFeatures(sel, draft)}>Reset</Button>
              </>
            ) : null
          }
        >
          {sel && isOn(sel, draft) ? <Features tab={sel} setup={draft} filter={filter} onChange={setDraft} /> : <Empty title="Tab is off" text="Turn it on to configure its features." />}
        </Column>
      </div>

      <footer className="flex flex-wrap items-center gap-8 border-t border-line px-20 py-12">
        <span className="text-s13">
          <b>{sum.on}</b> of {sum.total} tabs on · <b>{sum.variants}</b> with a chosen variant · <b>{sum.features}</b> feature{sum.features === 1 ? '' : 's'} changed
        </span>
        <span className="ml-auto flex gap-8">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!dirty || sum.on === 0} onClick={() => onSave(draft)}>Save setup</Button>
        </span>
      </footer>
    </div>
  )
}

function Column({ title, caption, extra, children }: { title: string; caption?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col border-r border-line last:border-r-0 narrow:min-h-240 narrow:border-r-0 narrow:border-b">
      <div className="flex items-center gap-8 border-b border-line bg-layer px-14 py-8">
        <b className="text-s13 font-semibold">{title}</b>
        {caption && <span className="truncate text-s12 text-muted">{caption}</span>}
        <span className="ml-auto flex items-center gap-6">{extra}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  )
}

function TabRow({ tab, setup, selected, onSelect, onToggle }: { tab: StudioTab; setup: StudioSetup; selected: boolean; onSelect: () => void; onToggle: (on: boolean) => void }) {
  const on = isOn(tab, setup)
  const n = changedFeatures(tab, setup)
  return (
    <div
      onClick={onSelect}
      className={cx('flex cursor-pointer items-center gap-10 border-b border-l-3 border-b-layer px-12 py-7 hover:bg-layer', selected ? 'border-l-blue bg-layer-accent' : 'border-l-transparent', !on && 'text-subtle')}
    >
      <span onClick={(e) => e.stopPropagation()}>
        <Switch size="sm" checked={on} onCheckedChange={onToggle} label={`${tab.label} on`} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-s13 font-medium">{tab.label}</div>
        <div className="truncate text-s12 text-muted">{on ? variantOf(tab, setup).label : 'Off'}</div>
      </div>
      {tab.variants.length > 1 && <Tag tone="gray">{tab.variants.length}</Tag>}
      {n > 0 && <Tag tone="warn">{n}</Tag>}
    </div>
  )
}

function Features({ tab, setup, filter, onChange }: { tab: StudioTab; setup: StudioSetup; filter: string; onChange: (s: StudioSetup) => void }) {
  const variant = variantOf(tab, setup)
  if (!variant.features.length)
    return <Empty title="No configurable features yet" text={`${variant.label} has nothing to switch on or off today. Features added later appear here.`} />
  const q = filter.trim().toLowerCase()
  const rows = variant.features.filter((f) => !q || `${f.label} ${f.description}`.toLowerCase().includes(q))
  return (
    <div>
      {rows.map((f) => {
        const on = featureOn(setup, variant, f)
        return (
          <div key={f.id} id={`feat-${f.id}`} className={cx('flex items-start gap-12 border-b border-b-layer px-16 py-9', on !== f.default && 'bg-warn-bg/40')}>
            <div className="min-w-0 flex-1">
              <div className="text-s13 font-medium">{f.label} {on !== f.default && <Tag tone="warn">changed</Tag>}</div>
              <div className="text-s12 text-muted">{f.description} <span className="text-subtle">Default: {f.default ? 'on' : 'off'}</span></div>
            </div>
            <Switch checked={on} onCheckedChange={(next) => onChange(setFeature(setup, variant, f, next))} label={f.label} />
          </div>
        )
      })}
      {rows.length === 0 && <Empty title="No feature matches" text="" />}
    </div>
  )
}

function Empty({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 px-24 py-32 text-center text-s13 text-muted">
      <b className="text-ink">{title}</b>
      {text && <span>{text}</span>}
      {children}
    </div>
  )
}
