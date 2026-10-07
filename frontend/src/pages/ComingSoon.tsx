import { EmptyState, Panel } from '@/components/ui'

/** Placeholder for a tab whose screen is still being rebuilt on the new backend. */
export default function ComingSoon({ title }: { title: string }) {
  return (
    <Panel>
      <div className="panel-body">
        <EmptyState title={`${title} is being rebuilt`} hint="This screen is moving onto the new Odoo backend and will be back shortly." />
      </div>
    </Panel>
  )
}
