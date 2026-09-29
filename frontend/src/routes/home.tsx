import { useQuery } from '@tanstack/react-query'
import { Database, Radio, Timer } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useNow } from '@/hooks/use-now'
import { usePageTitle } from '@/hooks/use-page-title'
import { timeAgo } from '@/lib/format'
import { overviewQuery } from '@/lib/queries'
import type { Overview } from '@/lib/types'
import { cn } from '@/lib/utils'

function Fact({ icon: Icon, label, value, ok }: { icon: typeof Radio; label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className={cn('size-4', ok === false ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
      <div className="grid">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn('text-sm font-medium', ok === false && 'text-destructive')}>{value}</span>
      </div>
    </div>
  )
}

function Health({ overview, now }: { overview: Overview; now: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>System health</CardTitle>
        <CardDescription>
          {overview.last_poll_ts === null
            ? 'Waiting for the first poll…'
            : `Adapters are polled every ${overview.poll_interval_seconds} s.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <Fact icon={Timer} label="Last poll" value={timeAgo(overview.last_poll_ts, now)} />
        <Fact
          icon={Radio}
          label="MQTT broker"
          value={overview.mqtt_connected ? 'Connected' : 'Not connected'}
          ok={overview.mqtt_connected}
        />
        <Fact
          icon={Database}
          label="Accounts database"
          value={overview.database_available ? 'Available' : 'Unavailable'}
          ok={overview.database_available}
        />
      </CardContent>
    </Card>
  )
}

export function HomePage({ username }: { username: string }) {
  usePageTitle()
  const now = useNow()
  const overview = useQuery(overviewQuery)

  return (
    <>
      <PageHeader title={`Welcome, ${username}`} description="Your bedside display at a glance." />
      <div className="grid gap-4">
        {overview.isPending ? (
          <LoadingBlocks rows={1} />
        ) : overview.error ? (
          <LoadError error={overview.error} retry={() => void overview.refetch()} />
        ) : (
          <Health overview={overview.data} now={now} />
        )}
      </div>
    </>
  )
}
