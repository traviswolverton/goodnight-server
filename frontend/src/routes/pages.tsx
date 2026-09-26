import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/hooks/use-page-title'

export function NotFoundPage() {
  usePageTitle('Page not found')
  return (
    <div className="mx-auto grid max-w-sm gap-3 py-20 text-center">
      <p className="text-5xl font-semibold tracking-tight text-muted-foreground">404</p>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">That page doesn't exist, or it has moved.</p>
      <Button asChild className="mx-auto mt-2">
        <Link to="/">Back to Home</Link>
      </Button>
    </div>
  )
}
