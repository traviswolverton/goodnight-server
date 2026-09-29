import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { BedDouble, House, Server } from 'lucide-react'
import { ActionGuide } from '@/components/action-guide'
import { ButtonGuide } from '@/components/button-guide'
import { DeviceGuide } from '@/components/device-guide'
import { FlowArrow, FlowNode } from '@/components/flow'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UsersGuide } from '@/components/users-guide'
import { usePageTitle } from '@/hooks/use-page-title'

export function AboutPage() {
  usePageTitle('About')
  const hash = useRouterState({ select: (s) => s.location.hash })
  return <AboutContent scrollTo={hash || undefined} />
}

/** How the parts fit together. Every page's "How it works" link lands on its
 *  own card here (`scrollTo` is that card's id). */
export function AboutContent({ scrollTo }: { scrollTo?: string }) {
  useEffect(() => {
    // Not every environment can scroll (tests); the cards are all open, so it's a nicety.
    if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [scrollTo])

  return (
    <div className="max-w-3xl">
      <PageHeader title="About" description="How the pieces fit together. Each page has a “How it works” link to its part." />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>The big picture</CardTitle>
            <CardDescription>The device senses. This server decides. Home Assistant does.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="sr-only">The bedside device and this server talk to each other over MQTT. This server asks Home Assistant to do things.</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-3" aria-hidden="true">
              <FlowNode icon={BedDouble} label="Device" />
              <FlowArrow label="MQTT" />
              <FlowNode icon={Server} label="This server" accent />
              <FlowArrow />
              <FlowNode icon={House} label="Home Assistant" />
            </div>
          </CardContent>
        </Card>
        <DeviceGuide id="device" />
        <ButtonGuide id="buttons" />
        <ActionGuide id="actions" />
        <UsersGuide id="users" />
      </div>
    </div>
  )
}
