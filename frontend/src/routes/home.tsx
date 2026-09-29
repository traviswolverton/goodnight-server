import { useQuery } from '@tanstack/react-query'
import { Database, House, Radio } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePageTitle } from '@/hooks/use-page-title'
import { overviewQuery } from '@/lib/queries'
import type { HomeAssistantStatus, Overview } from '@/lib/types'
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

const HOME_ASSISTANT_TEXT: Record<HomeAssistantStatus, string> = {
  connected: 'Connected',
  unreachable: 'Can’t be reached',
  not_set_up: 'Not set up',
}

function Health({ overview }: { overview: Overview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>System health</CardTitle>
        <CardDescription>What this app connects to. Buttons need Home Assistant and the MQTT broker.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <Fact
          icon={House}
          label="Home Assistant"
          value={HOME_ASSISTANT_TEXT[overview.home_assistant]}
          ok={overview.home_assistant === 'connected'}
        />
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
          <Health overview={overview.data} />
        )}
      </div>
    </>
  )
}
