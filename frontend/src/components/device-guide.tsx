import type { ReactNode } from 'react'
import { BedDouble, Droplets, Hand, Hourglass, House, PersonStanding, SlidersHorizontal, Save, Server, Sun, Thermometer, Unplug, Volume2, Wifi, WifiOff, type LucideIcon } from 'lucide-react'
import { ButtonsGraphic, FlowArrow, FlowChip, FlowNode, FlowPanel } from '@/components/flow'
import { GuideCard, GuideSection } from '@/components/guide-card'
import { cn } from '@/lib/utils'

export function DeviceGuide({ defaultOpen = true, id }: { defaultOpen?: boolean; id?: string }) {
  return (
    <GuideCard
      title="About the device"
      description="A screen, buttons, a buzzer and room sensors, by the bed."
      icon={BedDouble}
      defaultOpen={defaultOpen}
      id={id}
    >
      <div className="grid gap-3">
        <FlowPanel
          n={1}
          title="It reports"
          summary="The device sends its temperature, humidity, light and motion readings, and every button press, to this server over MQTT."
        >
          <div className="flex w-full flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
            <div className="grid gap-2 rounded-lg border bg-card p-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <BedDouble className="size-4" /> Device
              </span>
              <div className="flex flex-wrap gap-1.5">
                <FlowChip icon={Thermometer} label="Temp" />
                <FlowChip icon={Droplets} label="Humidity" />
                <FlowChip icon={Sun} label="Light" />
                <FlowChip icon={PersonStanding} label="Motion" />
                <FlowChip icon={Hand} label="Presses" />
              </div>
            </div>
            <FlowArrow label="MQTT" downOnPhone />
            <FlowNode icon={Server} label="Server" accent />
          </div>
        </FlowPanel>

        <FlowPanel
          n={2}
          title="The server decides"
          summary="This server works out what a button press does and tells Home Assistant. It sends the device its settings and sounds."
          caption="The device only says which button. The Buttons page says what it does."
        >
          <ButtonsGraphic label="Press" />
          <FlowArrow />
          <FlowNode icon={Server} label="Decides" accent />
          <FlowArrow />
          <FlowNode icon={House} label="Home Assistant" />
          <div className="flex basis-full items-center gap-2 text-xs text-muted-foreground">
            <Server className="size-4" /> <FlowArrow />
            <FlowChip icon={Volume2} label="Sounds" />
            <FlowChip icon={SlidersHorizontal} label="Settings" />
            <FlowArrow /> <BedDouble className="size-4" />
          </div>
        </FlowPanel>

        <FlowPanel
          n={3}
          title="Saving reaches it now"
          summary="Saving a setting on this page sends it to the device straight away. If the device is off, it gets the settings when it reconnects."
          caption="If it’s off, it catches up when it reconnects."
        >
          <FlowChip icon={Save} label="Save" />
          <FlowArrow />
          <FlowNode icon={BedDouble} label="Device" accent />
        </FlowPanel>
      </div>

      <GuideSection title="What the status means">
        <dl className="grid gap-2.5 text-sm">
          <StatusTerm icon={Wifi} tone="text-success" name="Online">
            Connected and reporting.
          </StatusTerm>
          <StatusTerm icon={WifiOff} tone="text-destructive" name="Offline">
            Dropped off. Check its power and Wi-Fi.
          </StatusTerm>
          <StatusTerm icon={Hourglass} tone="text-muted-foreground" name="Not heard from yet">
            Nothing since the server started, as while it’s being set up.
          </StatusTerm>
          <StatusTerm icon={Unplug} tone="text-warning" name="Server not connected to the broker">
            The server can’t reach the broker. Fix it in Settings.
          </StatusTerm>
        </dl>
      </GuideSection>
    </GuideCard>
  )
}

/** A status: its own icon (a different shape each, never colour alone), its name, one line. */
function StatusTerm({ icon: Icon, tone, name, children }: { icon: LucideIcon; tone: string; name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
      <dt className="col-span-2 flex items-center gap-3 font-medium">
        <Icon className={cn('size-5 shrink-0', tone)} aria-hidden="true" />
        {name}
      </dt>
      <dd className="col-start-2 text-muted-foreground">{children}</dd>
    </div>
  )
}
