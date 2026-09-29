import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
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

export function MqttPage() {
  usePageTitle('MQTT reference')
  const { data, error, isPending, refetch } = useQuery(mqttReferenceQuery)

  return (
    <>
      <PageHeader
        title="MQTT reference"
        description="The topics between this server and the bedside device. The device reports readings and button presses; the server sends it settings and sounds."
      />
      {isPending ? (
        <LoadingBlocks />
      ) : error ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : (
        <div className="grid gap-4">
          {data.topics.map((t) => (
            <Card key={t.topic}>
              <CardHeader>
                <CardTitle>
                  <code className="text-base">{t.topic}</code>
                </CardTitle>
                <CardDescription>
                  {t.direction}, {t.retained ? 'retained' : 'not retained'}. {t.about}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Json value={t.example} label={`Example ${t.topic} message`} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
