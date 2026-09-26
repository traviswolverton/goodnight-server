import { useQuery } from '@tanstack/react-query'
import { formatUptime } from '@/lib/format'
import { overviewQuery } from '@/lib/queries'

/** Version and uptime, quietly, at the bottom of the sidebar. */
export function AppFooter() {
  const { data } = useQuery(overviewQuery)
  if (!data) return null
  return (
    <p className="mt-auto px-3 text-xs text-muted-foreground">
      Version {data.version}
      <br />
      Up {formatUptime(data.uptime_seconds)}
    </p>
  )
}
