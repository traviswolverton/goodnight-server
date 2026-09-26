import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { sessionQuery } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'
import { errorMessage } from '@/lib/mutations'

export const MIN_PASSWORD_LENGTH = 12

export function ProfilePage() {
  usePageTitle('Profile')
  const { data } = useQuery(sessionQuery)
  const user = data?.user
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const change = useMutation({
    mutationFn: () => api('/api/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } }),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      setProblem(null)
      toast.success('Password changed. You were signed out everywhere else.')
    },
    onError: (e) => setProblem(errorMessage(e)),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (next.length < MIN_PASSWORD_LENGTH) return setProblem(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    if (next !== confirm) return setProblem('The new passwords don’t match.')
    setProblem(null)
    change.mutate()
  }

  return (
    <>
      <PageHeader title="Your account" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Username</span>
              <span className="font-medium">{user?.username}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Role</span>
              <Badge variant={user?.role === 'admin' ? 'default' : 'secondary'} className="capitalize">
                {user?.role}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Last sign-in</span>
              <span>{formatDateTime(user?.last_login_at)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>You’ll stay signed in here; other devices are signed out.</CardDescription>
          </CardHeader>
          <CardContent>
            {user && !user.has_password ? (
              <p className="text-sm text-muted-foreground">This account signs in through an external provider, so it has no password to change.</p>
            ) : (
              <form onSubmit={submit} className="grid gap-4" noValidate>
                <div className="grid gap-2">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
                  <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
                {problem && (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{problem}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" disabled={change.isPending || !current || !next || !confirm}>
                  {change.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Change password
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
