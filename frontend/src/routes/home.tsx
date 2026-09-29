import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Database, Radio, Timer } from 'lucide-react'
import { DevicePreview } from '@/components/device-preview'
import { PageHeader } from '@/components/page-header'
import { EmptyState, LoadError, LoadingBlocks } from '@/components/query-state'
import { StatusPill } from '@/components/status-pill'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useDeviceSize } from '@/hooks/use-device-size'
import { useNow } from '@/hooks/use-now'
import { usePageTitle } from '@/hooks/use-page-title'
import { timeAgo } from '@/lib/format'
import { overviewQuery, statusQuery } from '@/lib/queries'
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
        <CardDescription>{overview.overall?.text ?? 'Waiting for the first poll…'}</CardDescription>
        {overview.overall && (
          <CardAction>
            <StatusPill status={overview.overall.level} />
          </CardAction>
        )}
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
  const status = useQuery(statusQuery)
  const [deviceSize] = useDeviceSize()

  return (
    <>
      <PageHeader title={`Welcome, ${username}`} description="Your desk display at a glance." />
      <div className="grid gap-4">
        {overview.isPending ? (
          <LoadingBlocks rows={1} />
        ) : overview.error ? (
          <LoadError error={overview.error} retry={() => void overview.refetch()} />
        ) : (
          <Health overview={overview.data} now={now} />
        )}

        <Card>
          <CardHeader>
            <CardTitle>On the display</CardTitle>
            <CardDescription>What each card is publishing right now. Approximate — not the real font.</CardDescription>
          </CardHeader>
          <CardContent>
            {status.isPending ? (
              <LoadingBlocks rows={1} />
            ) : status.error ? (
              <LoadError error={status.error} retry={() => void status.refetch()} />
            ) : !status.data ? (
              <EmptyState title="Nothing published yet">The first poll hasn't completed. This updates on its own.</EmptyState>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {status.data.services.map((service) => (
                  <li key={service.name} className="min-w-0">
                    <Link
                      to="/cards"
                      search={{ card: service.name }}
                      className="block rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      aria-label={`Edit the ${service.title} card`}
                    >
                      <DevicePreview title={service.title} lines={service.lines} status={service.status} size={deviceSize} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

      </div>
    </>
  )
}
