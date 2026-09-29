import { Link } from '@tanstack/react-router'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type AboutSection = 'device' | 'buttons' | 'actions' | 'users'

/** A page header's link to its part of the About page. */
export function AboutLink({ section }: { section: AboutSection }) {
  return (
    <Button asChild variant="ghost" size="sm" className="max-sm:-ml-2.5">
      <Link to="/about" hash={section}>
        <BookOpen aria-hidden="true" /> How it works
      </Link>
    </Button>
  )
}
