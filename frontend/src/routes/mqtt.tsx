import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePageTitle } from '@/hooks/use-page-title'
import { mqttReferenceQuery } from '@/lib/queries'

function Json({ value, label }: { value: unknown; label: string }) {
  return (
    <pre tabIndex={0} aria-label={label} className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

const FIELD_NOTES: [string, string][] = [
  ['name', 'Stable identifier, matching cards.yaml. Never changes and is never used for display.'],
  ['title', 'Display text for the card’s title row. Falls back to name if the card has no title override.'],
  ['lines', '1–4 pre-formatted display strings, shown verbatim. Falls back to the title if the card has no text template.'],
  ['actions', 'The display’s Actions menu, in order: id, label, an optional live state (“on”, “21.5°”), and whether to ask for a second press first. What an action does stays on the server.'],
]

export function MqttPage() {
  usePageTitle('MQTT reference')
  const { data, error, isPending, refetch } = useQuery(mqttReferenceQuery)

  return (
    <>
      <PageHeader
        title="MQTT reference"
        description="The contract with the display, over a dedicated Mosquitto broker. This service publishes status and alerts; the ESP32 publishes only action requests."
      />
      {isPending ? (
        <LoadingBlocks />
      ) : error ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : (
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                Topic <code className="text-base">{data.status_topic}</code>
              </CardTitle>
              <CardDescription>
                Retained, QoS 1. Published on any state change, plus a heartbeat every ~{Math.round(data.heartbeat_interval_seconds)} s, so a
                reconnecting display always gets current state immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Button asChild variant="outline" size="sm" className="w-fit">
                <a href={data.status_schema_url} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" /> JSON Schema
                </a>
              </Button>
              <div>
                <h3 className="mb-2 text-sm font-medium">Live example</h3>
                {data.status_example ? (
                  <Json value={data.status_example} label="Live status payload" />
                ) : (
                  <p className="text-sm text-muted-foreground">Not available yet — no adapter has completed a poll since this process started.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Topic <code className="text-base">{data.camera_topic}</code>
              </CardTitle>
              <CardDescription>
                QoS 1, not retained. Published when an adapter (Frigate) flags an alert-worthy event. The snapshot link is signed and expires shortly, so
                the display can fetch it without a login. Illustrative example:
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Button asChild variant="outline" size="sm" className="w-fit">
                <a href={data.camera_schema_url} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" /> JSON Schema
                </a>
              </Button>
              <Json value={data.camera_example} label="Example camera alert" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Topics <code className="text-base">{data.action_topic}</code> and <code className="text-base">{data.action_result_topic}</code>
              </CardTitle>
              <CardDescription>
                The other direction: the display publishes an action&rsquo;s <code>id</code> (from <code>actions[]</code> above) when it&rsquo;s picked
                on its Actions menu, and gets one reply per request, matched by <code>req</code>. Neither is retained. The server only runs actions listed
                on the Actions page, so the display can&rsquo;t ask for anything else.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <a href={data.action_schema_url} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden="true" /> Request schema
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <a href={data.action_result_schema_url} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden="true" /> Result schema
                  </a>
                </Button>
              </div>
              <Json value={data.action_example} label="Example action request" />
              <Json value={data.action_result_example} label="Example action result" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Field notes</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                {FIELD_NOTES.map(([field, note]) => (
                  <div key={field} className="grid gap-1 sm:grid-cols-[8rem_1fr]">
                    <dt>
                      <code>{field}</code>
                    </dt>
                    <dd className="text-muted-foreground">{note}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Client display limits</CardTitle>
              <CardDescription>
                Fixed buffers on the ESP32. Exceeding one truncates or drops silently on the display; the server logs a warning when a payload would.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                {(
                  [
                    ['services[*].title', `${data.limits.title_max_chars} characters`],
                    ['services[*].lines[]', `${data.limits.line_max_chars.join(' / ')} characters, by position`],
                    ['overall.text', `${data.limits.overall_text_max_chars} characters`],
                    ['services[] (array)', `${data.limits.max_services} entries — anything beyond is dropped, not truncated`],
                    ['actions[*].label', `${data.limits.action_label_max_chars} characters`],
                    ['actions[*].state', `${data.limits.action_state_max_chars} characters (cut to fit by the server)`],
                    ['actions[] (array)', `${data.limits.max_actions} entries`],
                  ] as const
                ).map(([field, limit]) => (
                  <div key={field} className="flex flex-wrap justify-between gap-x-4 border-b pb-2 last:border-0">
                    <dt>
                      <code>{field}</code>
                    </dt>
                    <dd className="text-muted-foreground">{limit}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
