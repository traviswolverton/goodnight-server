import { Radio, ScrollText, Zap } from 'lucide-react'
import { Diag } from '@/components/diag'
import { Reveal } from '@/components/disclosure'
import { GuideCard, GuideSection, GuideTerm } from '@/components/guide-card'
import { CONFIRM_SECONDS } from '@/lib/actions'
import { SOUND_INFO, SOUND_ORDER } from '@/lib/sounds'

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
export function ActionGuide({ defaultOpen = true, id }: { defaultOpen?: boolean; id?: string }) {
  return (
    <GuideCard
      title="How actions work"
      description="A button press, this server, then Home Assistant. Read this once and the rest makes sense."
      defaultOpen={defaultOpen}
      id={id}
    >
      <GuideSection title="The flow">
        <ol className="grid list-decimal gap-2 pl-5 text-sm marker:font-medium marker:text-muted-foreground">
          <li>
            <strong>You press a button on the device.</strong> It only reports which button, and whether the press was short or long.
            It has no idea what the button does.
          </li>
          <li>
            <strong>This server looks up the action</strong> you bound to that press on the Buttons page, then does the work: asking
            for a second press if you set that, and sending it to Home Assistant.
          </li>
          <li>
            <strong>Home Assistant does the thing.</strong> The server can watch for the result and tell the device with a sound.
          </li>
        </ol>
      </GuideSection>

      <GuideSection title="Three kinds of action">
        <dl className="grid gap-3 text-sm">
          <GuideTerm icon={Zap} name="Call a service">
            One Home Assistant service, like <code>light.toggle</code> on <code>light.desk</code>. The simplest choice when a button
            does one thing.
          </GuideTerm>
          <GuideTerm icon={ScrollText} name="Run a script">
            A script you write in Home Assistant. <strong>The way to do several things at once</strong>, like closing the garage and
            turning off the bedroom lights.
            <div className="mt-2">
              <Reveal label="Show an example script">
                <Diag kind="blank">{EXAMPLE_SCRIPT}</Diag>
              </Reveal>
            </div>
          </GuideTerm>
          <GuideTerm icon={Radio} name="Fire an event">
            Sends an event that a Home Assistant automation reacts to. This is the only kind that needs an automation.
          </GuideTerm>
        </dl>
      </GuideSection>

      <GuideSection title="Safety and feedback">
        <ul className="grid gap-3 text-sm">
          <li>
            <strong>Ask for a second press</strong> for locks, doors, anything you don’t want to trigger by accident. Press once to
            arm it; press the same button the same way again within {CONFIRM_SECONDS} seconds to run it. Anything else cancels.
          </li>
          <li>
            <strong>Check that it worked.</strong> Without a check, “done” only means Home Assistant accepted the request. With one,
            the server waits for the entities you name to reach a state, and fails loudly if they don’t in time.
          </li>
        </ul>
        <div className="mt-1">
          <Reveal label="The sounds you’ll hear">
            <dl className="grid gap-2 text-sm sm:grid-cols-[6rem_1fr] sm:gap-x-4">
              {SOUND_ORDER.map((sound) => (
                <div key={sound} className="contents">
                  <dt className="font-medium">{SOUND_INFO[sound].name}</dt>
                  <dd className="text-muted-foreground max-sm:mb-1">{SOUND_INFO[sound].when}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">They play from the device’s piezo, and can be turned off on the Device page.</p>
          </Reveal>
        </div>
      </GuideSection>
    </GuideCard>
  )
}
