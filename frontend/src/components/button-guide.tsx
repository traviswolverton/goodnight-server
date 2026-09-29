import { Grid2x2, Hand, Timer } from 'lucide-react'
import { GuideCard, GuideSection, GuideTerm } from '@/components/guide-card'
import { BUTTON_LIT_SECONDS, CONFIRM_SECONDS } from '@/lib/actions'

/** "How buttons work". */
export function ButtonGuide({ defaultOpen = true, id }: { defaultOpen?: boolean; id?: string }) {
  return (
    <GuideCard
      title="How buttons work"
      description="Each button runs one action on a short press and another on a long press."
      icon={Grid2x2}
      defaultOpen={defaultOpen}
      id={id}
    >
      <GuideSection title="Short and long presses">
        <dl className="grid gap-3 text-sm">
          <GuideTerm icon={Hand} name="Short press">
            Let go within 0.6 seconds, like a tap.
          </GuideTerm>
          <GuideTerm icon={Timer} name="Long press">
            Keep holding. The device clicks at 0.6 seconds, and that’s when you can let go.
          </GuideTerm>
        </dl>
        <p className="text-sm text-muted-foreground">
          Each has its own action, so one button can do two things: a lamp on a tap, the garage on a hold.
        </p>
      </GuideSection>
      <GuideSection title="Finding a button">
        <p className="text-sm text-muted-foreground">
          Press it on the device and its row lights up here for {BUTTON_LIT_SECONDS} seconds. They’re numbered 1–4 along the top of the
          device and 5–8 along the bottom.
        </p>
      </GuideSection>
      <GuideSection title="Actions that ask to confirm">
        <p className="text-sm text-muted-foreground">
          The first press arms it with one beep. Press the same button the same way again within {CONFIRM_SECONDS} seconds to
          run it. Anything else cancels it.
        </p>
      </GuideSection>
      <GuideSection title="In Home Assistant too">
        <p className="text-sm text-muted-foreground">
          Every press also reaches Home Assistant as a device trigger, whether or not anything is bound here, so a button can start an
          automation directly.
        </p>
      </GuideSection>
    </GuideCard>
  )
}

