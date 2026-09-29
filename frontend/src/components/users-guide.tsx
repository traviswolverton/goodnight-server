import { Eye, ShieldCheck, Users } from 'lucide-react'
import { GuideCard, GuideSection, GuideTerm } from '@/components/guide-card'

export function UsersGuide({ defaultOpen = true, id }: { defaultOpen?: boolean; id?: string }) {
  return (
    <GuideCard
      title="Accounts and roles"
      description="Everyone signs in with their own account. A role decides what they can change."
      icon={Users}
      defaultOpen={defaultOpen}
      id={id}
    >
      <GuideSection title="Two roles">
        <dl className="grid gap-3 text-sm">
          <GuideTerm icon={ShieldCheck} name="Admin">
            Can change everything: connections, settings, users, and the actions, buttons and device.
          </GuideTerm>
          <GuideTerm icon={Eye} name="Viewer">
            Can look around and preview, but not save a change. Good for family or a guest who just wants to see the state.
          </GuideTerm>
        </dl>
      </GuideSection>
      <GuideSection title="Signing in and out">
        <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
          <li>Changing someone’s role, disabling them, resetting their password or deleting them signs them out straight away.</li>
          <li>Disabling keeps the account (and its history) but stops it signing in. Deleting removes it for good.</li>
          <li>Anyone can change their own password from the account menu, under “Your account”.</li>
          <li>You can’t change your own role, disable or delete yourself here, so there’s always an administrator.</li>
        </ul>
      </GuideSection>
      <GuideSection title="The Activity tab">
        <p className="text-sm text-muted-foreground">
          Sign-ins and every change made through the app, most recent first. How long entries are kept is set on the Settings page.
        </p>
      </GuideSection>
    </GuideCard>
  )
}
