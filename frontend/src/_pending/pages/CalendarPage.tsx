import { useAuth } from '@/auth/AuthContext'
import { NoAccess } from '@/components/ui'
import ReportCalendar from '@/components/ReportCalendar'

function CalendarPage() {
  return (
    <>
      <ReportCalendar />
    </>
  )
}

export default function CalendarPageGuarded() {
  const { can } = useAuth()
  if (!can('reports')) return <NoAccess what="Calendar" />
  return <CalendarPage />
}
