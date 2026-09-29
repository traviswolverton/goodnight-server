import { BookOpen, Radio, ScrollText, Zap } from 'lucide-react'
import { useId, useState } from 'react'
import { ChevronToggle, Collapse, Reveal } from '@/components/disclosure'
import { Diag } from '@/components/diag'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CONFIRM_SECONDS } from '@/lib/actions'

/** The sounds, in the order you'd hear them (names are the device contract; DESIGN.md). */
const SOUNDS: [name: string, when: string][] = [
  ['Armed', 'One mid beep: the first press of an action that asks to confirm. Press again to go ahead.'],
  ['Running', 'Two quick rising beeps: it’s being sent to Home Assistant.'],
  ['Success', 'Three rising notes: done, and verified if the action has a check.'],
  ['Failure', 'A low falling buzz: it failed, timed out, or the check never passed.'],
  ['Cancel', 'One soft blip: an armed action timed out or was cancelled.'],
]

export const EXAMPLE_SCRIPT = `script:
  goodnight:
    alias: Goodnight
    sequence:
      - action: cover.close_cover
        target:
          entity_id: [cover.garage_left, cover.garage_right]
      - action: light.turn_off
        target:
          entity_id: light.bedroom`

/** "How actions work": the whole idea on one card that opens and closes. */
export function ActionGuide({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const panel = useId()
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex items-center gap-3 px-4 py-4 sm:px-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <BookOpen className="size-4.5" aria-hidden="true" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <CardTitle>How actions work</CardTitle>
          <CardDescription>A button press, this server, then Home Assistant. Read this once and the rest makes sense.</CardDescription>
        </div>
        <ChevronToggle open={open} onToggle={() => setOpen((v) => !v)} controls={panel} label="Details: How actions work" />
      </CardHeader>
      <Collapse open={open} id={panel}>
        <CardContent className="grid gap-6 border-t px-4 py-5 sm:px-6">
          <GuideSection title="The flow">
            <ol className="grid list-decimal gap-2 pl-5 text-sm marker:font-medium marker:text-muted-foreground">
              <li>
                <strong>You press a button on the device.</strong> It only reports which button, and whether the press was short or
                long. It has no idea what the button does.
              </li>
              <li>
                <strong>This server looks up the action</strong> you bound to that press on the Buttons page, then does the work:
                asking for a second press if you set that, and sending it to Home Assistant.
              </li>
              <li>
                <strong>Home Assistant does the thing.</strong> The server can watch for the result and tell the device with a sound.
              </li>
            </ol>
          </GuideSection>

          <GuideSection title="Three kinds of action">
            <dl className="grid gap-3 text-sm">
              <Kind icon={Zap} name="Call a service">
                One Home Assistant service, like <code>light.toggle</code> on <code>light.desk</code>. The simplest choice when a
                button does one thing.
              </Kind>
              <Kind icon={ScrollText} name="Run a script">
                A script you write in Home Assistant. <strong>The way to do several things at once</strong>, like closing the garage
                and turning off the bedroom lights.
                <div className="mt-2">
                  <Reveal label="Show an example script">
                    <Diag kind="blank">{EXAMPLE_SCRIPT}</Diag>
                  </Reveal>
                </div>
              </Kind>
              <Kind icon={Radio} name="Fire an event">
                Sends an event that a Home Assistant automation reacts to. This is the only kind that needs an automation.
              </Kind>
            </dl>
          </GuideSection>

          <GuideSection title="Safety and feedback">
            <ul className="grid gap-3 text-sm">
              <li>
                <strong>Ask for a second press</strong> for locks, doors, anything you don’t want to trigger by accident. Press once
                to arm it; press the same button the same way again within {CONFIRM_SECONDS} seconds to run it. Anything else cancels.
              </li>
              <li>
                <strong>Check that it worked.</strong> Without a check, “done” only means Home Assistant accepted the request. With
                one, the server waits for the entities you name to reach a state, and fails loudly if they don’t in time.
              </li>
            </ul>
            <div className="mt-3">
              <Reveal label="The sounds you’ll hear">
                <dl className="grid gap-2 text-sm sm:grid-cols-[6rem_1fr] sm:gap-x-4">
                  {SOUNDS.map(([name, when]) => (
                    <div key={name} className="contents">
                      <dt className="font-medium">{name}</dt>
                      <dd className="text-muted-foreground max-sm:mb-1">{when}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">They play from the device’s piezo, and can be turned off on the Device page.</p>
              </Reveal>
            </div>
          </GuideSection>
        </CardContent>
      </Collapse>
    </Card>
  )
}

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  )
}

function Kind({ icon: Icon, name, children }: { icon: typeof Zap; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="font-medium">{name}</dt>
        <dd className="text-muted-foreground">{children}</dd>
      </div>
    </div>
  )
}
