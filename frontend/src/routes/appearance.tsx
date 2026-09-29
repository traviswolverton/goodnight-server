import type { ReactNode } from 'react'
import { Check, Monitor, Moon, RotateCcw, Sun } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { StatusPill } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePageTitle } from '@/hooks/use-page-title'
import { ACCENTS, RADII, useTheme, type Theme } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'

const MODES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
]

/** How the corners are drawn in the picker (fixed, so it doesn't follow the current choice). */
const CORNER_SAMPLE = { sharp: 'rounded-[2px]', default: 'rounded-[8px]', round: 'rounded-[16px]' } as const

export function AppearancePage() {
  usePageTitle('Appearance')
  const { theme, setTheme, accent, setAccent, radius, setRadius, reset } = useTheme()

  return (
    <>
      <PageHeader
        title="Appearance"
        description="How this app looks in this browser. Saved on this device only, and it applies to light and dark alike."
        actions={
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw aria-hidden="true" /> Reset to defaults
          </Button>
        }
      />
      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChoiceCard title="Mode" description="System follows your device’s light or dark setting.">
            <ChoiceGroup label="Mode" columns="grid-cols-3">
              {MODES.map(({ id, label, icon: Icon }) => (
                <Choice key={id} name="mode" value={id} checked={theme === id} onSelect={() => setTheme(id)} label={label}>
                  <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
                </Choice>
              ))}
            </ChoiceGroup>
          </ChoiceCard>

          <ChoiceCard title="Corners" description="How rounded buttons, cards and fields are.">
            <ChoiceGroup label="Corners" columns="grid-cols-3">
              {RADII.map(({ id, label }) => (
                <Choice key={id} name="corners" value={id} checked={radius === id} onSelect={() => setRadius(id)} label={label}>
                  <span className={cn('h-6 w-10 border-2 border-primary/70 bg-accent', CORNER_SAMPLE[id])} aria-hidden="true" />
                </Choice>
              ))}
            </ChoiceGroup>
          </ChoiceCard>
        </div>

        <ChoiceCard title="Accent color" description="Highlights, buttons, the focus ring and the logo. Light blue is the default.">
          <ChoiceGroup label="Accent color" columns="grid-cols-3 sm:grid-cols-6">
            {ACCENTS.map(({ id, label, swatch }) => (
              <Choice key={id} name="accent" value={id} checked={accent === id} onSelect={() => setAccent(id)} label={label}>
                <span className="size-7 rounded-full shadow-inner ring-1 ring-black/10" style={{ backgroundColor: swatch }} aria-hidden="true" />
              </Choice>
            ))}
          </ChoiceGroup>
        </ChoiceCard>

        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>Both modes at once, so you can see the choice in each.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <PreviewPanel mode="light" />
            <PreviewPanel mode="dark" />
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function ChoiceCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function ChoiceGroup({ label, columns, children }: { label: string; columns: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-3', columns)}>
      {children}
    </div>
  )
}

/** A tile that's really a radio button: keyboard and screen-reader behaviour
 *  come from the input; the tile just draws it. */
function Choice({
  name,
  value,
  checked,
  onSelect,
  label,
  children,
}: {
  name: string
  value: string
  checked: boolean
  onSelect: () => void
  label: string
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border bg-card px-3 py-4 text-sm font-medium transition-colors',
        'hover:bg-accent/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        checked && 'border-primary bg-accent/40 ring-2 ring-primary/30',
      )}
    >
      <input type="radio" className="sr-only" name={name} value={value} checked={checked} onChange={onSelect} />
      {children}
      {label}
      {checked && <Check className="absolute top-1.5 right-1.5 size-4 text-primary" aria-hidden="true" />}
    </label>
  )
}

/** A small mock-up drawn only from the theme's tokens, inside a `.light` or
 *  `.dark` scope so it shows that mode whatever the page is showing. */
function PreviewPanel({ mode }: { mode: 'light' | 'dark' }) {
  return (
    <div className={cn(mode, 'grid gap-3 rounded-xl border bg-background p-4 text-foreground')}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{mode === 'light' ? 'Light' : 'Dark'}</p>
      <div className="grid gap-1 text-sm font-medium">
        <span className="rounded-md bg-accent px-3 py-1.5 text-accent-foreground">Settings</span>
        <span className="px-3 py-1.5 text-muted-foreground">Users</span>
      </div>
      <div className="grid gap-3 rounded-lg border bg-card p-3 text-card-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Home Assistant</span>
          <StatusPill status="ok" label="Connected" />
        </div>
        <span className="h-8 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground">http://homeassistant.local</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Save</span>
          <span className="rounded-md border px-3 py-1.5 text-sm font-medium">Cancel</span>
          <span className="ml-auto h-5 w-9 rounded-full bg-primary p-0.5" aria-hidden="true">
            <span className="ml-auto block size-4 rounded-full bg-primary-foreground" />
          </span>
        </div>
      </div>
    </div>
  )
}
