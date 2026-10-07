import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconCheck, IconChevronRight, IconDownload, IconPlus, IconRefresh, IconX } from '@/components/icons'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { SearchField } from '@/components/ui/Toolbar'
import { Tag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import { ICON } from '@/components/ui/tokens'
import { TD_BASE, TH_BASE, TH_PAD } from '@/components/ui/tableStyles'
import { downloadCsv } from '@/lib/csv'
import { displayMobile } from '@/lib/mobile'
import { cx } from '@/lib/cx'
import { useDevRead, useDevWrite } from './api'
import { BusinessPanel } from './BusinessPanel'
import { leftText, showDate, STAGE_LABEL } from './format'
import { NewBusinessDialog } from './NewBusinessDialog'
import { CopyButton, StageTag } from './parts'
import type { Business, Stage } from './types'

type Filter = 'all' | Exclude<Stage, 'unavailable'>
const FILTERS: Filter[] = ['all', 'active', 'trial', 'expiring', 'suspended']

/**
 * The fleet: every business on one searchable, filterable grid. A row opens the business panel at /dev/b/<slug>; ticking rows offers
 * the same plus-or-minus days to all of them at once. Every value is read live from each business's own database.
 */
export function FleetPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isPending, error, refetch, isFetching } = useDevRead<{ businesses: Business[] }>('dev.businesses.list')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [days, setDays] = useState('')
  const bulk = useDevWrite<{ results: { slug: string; ok: boolean; error?: string }[] }>('dev.bulk.shift', {
    onSuccess: ({ results }) => {
      const failed = results.filter((r) => !r.ok)
      toast(failed.length ? `${results.length - failed.length} changed, ${failed.length} failed: ${failed[0].error}` : `${results.length} business${results.length === 1 ? '' : 'es'} changed`, failed.length ? 'err' : 'ok')
      setPicked(new Set())
      setDays('')
    },
  })

  const all = data?.businesses ?? []
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length }
    for (const b of all) c[b.stage] = (c[b.stage] ?? 0) + 1
    return c
  }, [all])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((b) => (filter === 'all' || b.stage === filter) && (!q || [b.name, b.slug, b.code, b.owner?.name, b.owner?.login, b.owner?.mobile?.number].some((v) => v?.toLowerCase().includes(q))))
  }, [all, filter, query])
  const taken = useMemo(() => new Set(all.flatMap((b) => [b.owner?.login, ...b.cashiers.list.map((c) => c.login)].filter((l): l is string => !!l))), [all])

  const n = /^-?\d+$/.test(days.trim()) ? parseInt(days, 10) : NaN
  const togglePick = (s: string) => setPicked((p) => { const x = new Set(p); if (x.has(s)) x.delete(s); else x.add(s); return x })
  const allPicked = rows.length > 0 && rows.every((b) => picked.has(b.slug))

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center gap-8">
        <h1 className="m-0 mr-4 text-s18 font-normal">Businesses</h1>
        <SearchField placeholder="Search business, owner, ID or mobile" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search businesses" />
        <div className="max-w-full overflow-x-auto">
        <Segmented
          label="Filter by stage"
          appearance="toolbar"
          semantics="buttons"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f, label: f === 'all' ? 'All' : STAGE_LABEL[f] }))}
          renderLabel={(o) => (
            <>
              {o.label}
              <span className="ml-6 text-s12 opacity-70">{counts[o.value] ?? 0}</span>
            </>
          )}
        />
        </div>
        <IconButton label="Refresh" variant="ghost" toolbar loading={isFetching} onClick={() => void refetch()}>
          <IconRefresh size={ICON.lg} />
        </IconButton>
        <IconButton
          label="Download the shown businesses as CSV"
          variant="ghost"
          toolbar
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv('businesses.csv', rows.map((b) => ({
              Business: b.name, Code: `${b.slug}/${b.code}`, Status: STAGE_LABEL[b.stage], Plan: b.planLabel ?? 'Custom',
              'Valid until': b.validUntil ?? '', 'Days left': b.daysLeft ?? '', Owner: b.owner?.name ?? '', 'Owner ID': b.owner?.login ?? '',
              Mobile: b.owner?.mobile ? displayMobile(b.owner.mobile.country, b.owner.mobile.number) : '',
              Cashiers: b.cashiers.used, 'Cashier limit': b.cashiers.limit, Tabs: b.tabs,
            })))
          }
        >
          <IconDownload size={ICON.lg} />
        </IconButton>
        <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          <IconPlus size={ICON.lg} /> New business
        </Button>
      </div>

      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-6 bg-inverse-surface px-12 py-6 text-s13 text-white" role="region" aria-label="Selected businesses">
          <b>{picked.size} selected</b>
          <span className="text-inverse-ink-muted">Move the end date of all of them:</span>
          {[-7, 7, 28].map((q) => (
            <Button key={q} size="sm" variant="ghost" toolbar onClick={() => setDays(String(q))} aria-pressed={n === q}>{q > 0 ? `+${q}` : q}</Button>
          ))}
          <Input size="dense" fluid={false} className="w-88 text-center font-semibold" placeholder="± days" aria-label="Days to add or take away" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, ''))} />
          <IconButton label="Apply to the selected businesses" variant="primary" disabled={!Number.isFinite(n) || n === 0} loading={bulk.isPending} onClick={() => bulk.mutate({ slugs: [...picked], days: n, reason: 'bulk change from the fleet' })}>
            <IconCheck size={ICON.md} />
          </IconButton>
          <IconButton label="Clear selection" variant="ghost" className="ml-auto text-white" onClick={() => setPicked(new Set())}>
            <IconX size={ICON.md} />
          </IconButton>
        </div>
      )}

      {error && <p role="alert" className="m-0 text-s13 text-err-fg">{error.message}</p>}
      <div className="overflow-x-auto border border-line bg-canvas">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={cx(TH_BASE, 'w-36 px-12 py-8')}>
                <input type="checkbox" aria-label="Select all shown" className="size-14 accent-blue" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((b) => b.slug)))} />
              </th>
              {['Business', 'Status', 'Subscription', 'Owner', 'Cashiers', 'Tabs'].map((h) => (
                <th key={h} className={cx(TH_BASE, TH_PAD, 'px-12 py-8')}>{h}</th>
              ))}
              <th className={cx(TH_BASE, 'w-80')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.slug} onClick={() => navigate(`/dev/b/${b.slug}`)} className={cx('cursor-pointer hover:bg-layer', slug === b.slug && 'bg-layer-accent')}>
                <td className={cx(TD_BASE, 'px-12 py-7')} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${b.name}`} className="size-14 accent-blue" checked={picked.has(b.slug)} onChange={() => togglePick(b.slug)} />
                </td>
                <td className={cx(TD_BASE, 'px-12 py-7')}>
                  <div className="text-s13h font-semibold">{b.name}</div>
                  <div className="font-mono text-s11h text-muted">/{b.slug}/{b.code}</div>
                </td>
                <td className={cx(TD_BASE, 'px-12 py-7')}>{b.error ? <Tag tone="gray" title={b.error}>Unavailable</Tag> : <StageTag b={b} />}</td>
                <td className={cx(TD_BASE, 'px-12 py-7')}>
                  <div className="text-s13h">{b.planLabel ?? 'Custom'}</div>
                  <div className={cx('text-s11h', b.daysLeft !== null && b.daysLeft < 0 ? 'text-err-fg' : b.daysLeft !== null && b.daysLeft <= 7 ? 'text-warn-fg' : 'text-muted')}>
                    {b.validUntil ? `${showDate(b.validUntil)} · ${leftText(b.daysLeft)}` : '—'}
                  </div>
                </td>
                <td className={cx(TD_BASE, 'px-12 py-7')}>
                  {b.owner ? (
                    <>
                      <div className="text-s13h">{b.owner.name}</div>
                      <div className="font-mono text-s11h text-muted">{b.owner.login.split('@')[0]}{b.owner.mobile ? ` · ${displayMobile(b.owner.mobile.country, b.owner.mobile.number)}` : ''}</div>
                    </>
                  ) : b.error ? '—' : <Tag tone="warn">No owner</Tag>}
                </td>
                <td className={cx(TD_BASE, 'px-12 py-7 tabular-nums')}>{b.error ? '—' : <>{b.cashiers.used} <span className="text-muted">/ {b.cashiers.limit}</span></>}</td>
                <td className={cx(TD_BASE, 'px-12 py-7 tabular-nums text-muted')}>{b.error ? '—' : b.tabs}</td>
                <td className={cx(TD_BASE, 'px-4 py-3 text-right')} onClick={(e) => e.stopPropagation()}>
                  <span className="inline-flex">
                    {b.owner && <CopyButton value={b.owner.login} label="Copy owner login" />}
                    <IconButton label="Open business" variant="ghost" onClick={() => navigate(`/dev/b/${b.slug}`)}>
                      <IconChevronRight size={ICON.md} />
                    </IconButton>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isPending && <p className="m-0 p-16 text-s13 text-muted">Loading.</p>}
        {!isPending && rows.length === 0 && (
          <div className="flex flex-col items-center gap-8 px-16 py-32 text-center text-s13 text-muted">
            {all.length === 0 ? (
              <>
                <b className="text-ink">No businesses yet</b>
                <span>Create the first business and its owner.</span>
                <Button variant="primary" onClick={() => setCreating(true)}><IconPlus size={ICON.lg} /> New business</Button>
              </>
            ) : (
              <b className="text-ink">No business matches</b>
            )}
          </div>
        )}
      </div>

      {slug && <BusinessPanel key={slug} slug={slug} />}
      <NewBusinessDialog open={creating} taken={taken} onClose={() => setCreating(false)} onCreated={(b) => { setCreating(false); navigate(`/dev/b/${b.slug}`) }} />
    </div>
  )
}
