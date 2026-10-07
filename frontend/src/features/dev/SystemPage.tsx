import { IconRefresh } from '@/components/icons'
import { IconButton } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { Tag } from '@/components/ui/Tag'
import { ICON } from '@/components/ui/tokens'
import { useDevRead } from './api'
import { showWhen } from './format'
import { Prop } from './parts'
import type { Health } from './types'

/** What the platform is running on: versions, the databases that matter, and whether the job that records expiry is scheduled. */
export function SystemPage() {
  const { data, isPending, error, refetch, isFetching } = useDevRead<Health>('dev.health')
  return (
    <div className="flex max-w-720 flex-col gap-12">
      <div className="flex items-center gap-8">
        <h1 className="m-0 text-s18 font-normal">System</h1>
        <IconButton label="Refresh" variant="ghost" loading={isFetching} onClick={() => void refetch()}>
          <IconRefresh size={ICON.lg} />
        </IconButton>
      </div>
      {error && <p role="alert" className="m-0 text-s13 text-err-fg">{error.message}</p>}
      {isPending && <p className="m-0 text-s13 text-muted">Loading.</p>}
      {data && (
        <Panel className="grid grid-cols-3 gap-x-16 gap-y-14 p-16 narrow:grid-cols-2">
          <Prop label="Tryton">{data.tryton}</Prop>
          <Prop label="Platform database"><span className="font-mono text-s12h">{data.database}</span></Prop>
          <Prop label="Shop template"><span className="font-mono text-s12h">{data.template}</span></Prop>
          <Prop label="Businesses">{data.businesses}</Prop>
          <Prop label="Server time">{showWhen(data.serverTime)}</Prop>
          <Prop label="Expiry job">
            {data.expiryJob.registered ? <Tag tone={data.expiryJob.active ? 'ok' : 'warn'}>{data.expiryJob.active ? 'Scheduled' : 'Registered, inactive'}</Tag> : <Tag tone="err">Not registered</Tag>}
          </Prop>
        </Panel>
      )}
      <p className="m-0 text-s12h text-muted">
        Subscription expiry is enforced on every request from the dates. The scheduled job only records it as a suspension; it runs where
        the platform’s <span className="font-mono">trytond-cron</span> process runs.
      </p>
    </div>
  )
}
