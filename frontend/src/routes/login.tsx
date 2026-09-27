import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { LoginForm } from '@/components/login-form'
import { LogoMark } from '@/components/logo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePageTitle } from '@/hooks/use-page-title'
import { isServerPath, safeNext, sessionQuery, type Session } from '@/lib/auth'

const route = getRouteApi('/login')

/** Go where the user was headed: inside this app via the router, to a
 *  server-rendered page (the current editor) with a real page load. */
function useContinueTo(next: string | undefined) {
  const router = useRouter()
  return () => {
    const target = safeNext(next) ?? '/'
    if (isServerPath(target)) window.location.assign(target)
    else router.history.replace(target)
  }
}

export function LoginPage() {
  usePageTitle('Sign in')
  const { next } = route.useSearch()
  const queryClient = useQueryClient()
  const continueTo = useContinueTo(next)

  // Already signed in (e.g. arrived here via a server redirect with a live session).
  const existing = queryClient.getQueryData(sessionQuery.queryKey)
  useEffect(() => {
    if (existing) continueTo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onSuccess(session: Session) {
    queryClient.setQueryData(sessionQuery.queryKey, session)
    continueTo()
  }

  return (
    <main className="grid min-h-svh place-items-center px-4 py-10">
      <div className="grid w-full max-w-sm gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-12" />
          <h1 className="text-2xl font-semibold tracking-tight">Bedside Dashboard</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use your Bedside Dashboard account.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm onSuccess={onSuccess} />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
