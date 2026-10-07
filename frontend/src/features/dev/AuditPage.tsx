import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconRefresh } from '@/components/icons'
import { IconButton } from '@/components/ui/Button'
import { ToolbarSelect, SearchField } from '@/components/ui/Toolbar'
import { ICON } from '@/components/ui/tokens'
import { TD_BASE, TH_BASE } from '@/components/ui/tableStyles'
import { cx } from '@/lib/cx'
import { useDevRead } from './api'
import { showWhen } from './format'
import type { AuditEvent, Business } from './types'

/** Who did what to which business, newest first. Append-only: nothing here can be edited, and no password is ever in it. */
export function AuditPage() {
  const [slug, setSlug] = useState('')
  const [query, setQuery] = useState('')
  const fleet = useDevRead<{ businesses: Business[] }>('dev.businesses.list')
  const { data, isPending, error, refetch, isFetching } = useDevRead<AuditEvent[]>('dev.audit.list', { slug, limit: 300 })
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter((e) => !q || `${e.actor} ${e.action} ${e.target} ${e.detail}`.toLowerCase().includes(q))
  }, [data, query])
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center gap-8">
        <h1 className="m-0 mr-4 text-s18 font-normal">Audit</h1>
        <SearchField placeholder="Search the log" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the audit log" />
        <ToolbarSelect width="lg" aria-label="Business" value={slug} onChange={(e) => setSlug(e.target.value)}>
          <option value="">All businesses</option>
          {fleet.data?.businesses.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </ToolbarSelect>
        <IconButton label="Refresh" variant="ghost" toolbar loading={isFetching} onClick={() => void refetch()}>
          <IconRefresh size={ICON.lg} />
        </IconButton>
      </div>
      {error && <p role="alert" className="m-0 text-s13 text-err-fg">{error.message}</p>}
      <div className="overflow-x-auto border border-line bg-canvas">
        <table className="w-full border-collapse">
          <thead>
            <tr>{['When', 'Who', 'Action', 'Business', 'Detail'].map((h) => <th key={h} className={cx(TH_BASE, 'px-12 py-8')}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-layer">
                <td className={cx(TD_BASE, 'px-12 py-6 text-muted')}>{showWhen(e.at)}</td>
                <td className={cx(TD_BASE, 'px-12 py-6')}>{e.actor}</td>
                <td className={cx(TD_BASE, 'px-12 py-6 font-medium')}>{e.action}</td>
                <td className={cx(TD_BASE, 'px-12 py-6')}>{e.business ? <Link to={`/dev/b/${e.business}`} className="text-blue-link">{e.target || e.business}</Link> : e.target || '—'}</td>
                <td className={cx(TD_BASE, 'max-w-420 truncate px-12 py-6 text-muted')} title={e.detail}>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {isPending && <p className="m-0 p-16 text-s13 text-muted">Loading.</p>}
        {!isPending && rows.length === 0 && <p className="m-0 p-16 text-s13 text-muted">Nothing recorded.</p>}
      </div>
    </div>
  )
}
