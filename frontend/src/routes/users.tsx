import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, KeyRound, Pencil, RefreshCw, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { sessionQuery, type Role, type User } from '@/lib/auth'
import { describeAction } from '@/lib/audit'
import { formatDateTime } from '@/lib/format'
import { toastError } from '@/lib/mutations'
import { auditQuery, usersQuery } from '@/lib/queries'
import { MIN_PASSWORD_LENGTH } from '@/routes/profile'

export function UsersPage() {
  usePageTitle('Users')
  return (
    <>
      <PageHeader title="Users" description="Who can sign in, and what they can change." />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Accounts</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>
      </Tabs>
    </>
  )
}

type Dialogs = { kind: 'create' } | { kind: 'edit'; user: User } | { kind: 'reset'; user: User } | { kind: 'delete'; user: User } | null

function UsersTab() {
  const queryClient = useQueryClient()
  const me = useQuery(sessionQuery).data?.user
  const users = useQuery(usersQuery)
  const [dialog, setDialog] = useState<Dialogs>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: usersQuery.queryKey })

  const remove = useMutation({
    mutationFn: (user: User) => api(`/api/users/${user.id}`, { method: 'DELETE' }),
    onSuccess: (_, user) => {
      toast.success(`Deleted ${user.username}.`)
      void refresh()
    },
    onError: (e) => toastError(e, 'Failed to delete the user'),
  })

  if (users.isPending) return <LoadingBlocks rows={2} />
  if (users.error) return <LoadError error={users.error} retry={() => void users.refetch()} />

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setDialog({ kind: 'create' })}>
          <UserPlus aria-hidden="true" /> Add user
        </Button>
      </div>
      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Last sign-in</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="font-medium">
                      {user.username}
                      {user.id === me?.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                    </div>
                    {user.email && <div className="text-xs text-muted-foreground">{user.email}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="capitalize">
                        {user.role}
                      </Badge>
                      {!user.is_active && <Badge variant="outline">Disabled</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{formatDateTime(user.last_login_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${user.username}`} onClick={() => setDialog({ kind: 'edit', user })}>
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Reset password for ${user.username}`} onClick={() => setDialog({ kind: 'reset', user })}>
                        <KeyRound aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete ${user.username}`}
                        disabled={user.id === me?.id}
                        onClick={() => setDialog({ kind: 'delete', user })}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dialog?.kind === 'create' && <CreateUserDialog onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === 'edit' && <EditUserDialog user={dialog.user} isSelf={dialog.user.id === me?.id} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === 'reset' && <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Delete ${dialog?.kind === 'delete' ? dialog.user.username : ''}?`}
        destructive
        confirmLabel="Delete user"
        description="They're signed out immediately and can no longer sign in. This can't be undone."
        onConfirm={() => dialog?.kind === 'delete' && remove.mutate(dialog.user)}
      />
    </>
  )
}

function RoleSelect({ id, value, onChange, disabled }: { id: string; value: Role; onChange: (role: Role) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="viewer">Viewer — can look and preview</SelectItem>
        <SelectItem value="admin">Admin — can change everything</SelectItem>
      </SelectContent>
    </Select>
  )
}

function CreateUserDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('viewer')

  const create = useMutation({
    mutationFn: () => api('/api/users', { method: 'POST', body: { username: username.trim(), password, role, email: email.trim() || null } }),
    onSuccess: () => {
      toast.success(`Created ${username.trim()}.`)
      onSaved()
      onClose()
    },
    onError: (e) => toastError(e, 'Failed to create the user'),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>They sign in with this username and password, and can change the password themselves.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="new-username">Username</Label>
            <Input id="new-username" value={username} autoCapitalize="none" spellCheck={false} required onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-email">Email (optional)</Label>
            <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-user-password">Initial password</Label>
            <Input id="new-user-password" type="password" autoComplete="new-password" value={password} required onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-role">Role</Label>
            <RoleSelect id="new-role" value={role} onChange={setRole} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !username.trim() || password.length < MIN_PASSWORD_LENGTH}>
              {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({ user, isSelf, onClose, onSaved }: { user: User; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<Role>(user.role)
  const [active, setActive] = useState(user.is_active)
  const [email, setEmail] = useState(user.email ?? '')

  const save = useMutation({
    mutationFn: () => api(`/api/users/${user.id}`, { method: 'PATCH', body: { role, is_active: active, email } }),
    onSuccess: () => {
      toast.success(`Saved ${user.username}.`)
      onSaved()
      onClose()
    },
    onError: (e) => toastError(e, 'Failed to save the user'),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {user.username}</DialogTitle>
          <DialogDescription>Changing the role or disabling the account signs them out.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-role">Role</Label>
            <RoleSelect id="edit-role" value={role} onChange={setRole} disabled={isSelf} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="edit-active">Account enabled</Label>
            <Switch id="edit-active" checked={active} onCheckedChange={setActive} disabled={isSelf} />
          </div>
          {isSelf && <p className="text-xs text-muted-foreground">You can't change your own role or disable yourself.</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () => api(`/api/users/${user.id}/reset-password`, { method: 'POST', body: { password } }),
    onSuccess: () => {
      toast.success(`Password reset for ${user.username}. They were signed out.`)
      onClose()
    },
    onError: (e) => toastError(e, 'Failed to reset the password'),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {user.username}</DialogTitle>
          <DialogDescription>Choose a new password and pass it on to them. Their current sessions end.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault()
            reset.mutate()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="reset-password">New password</Label>
            <Input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={reset.isPending || password.length < MIN_PASSWORD_LENGTH}>
              {reset.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ActivityTab() {
  const audit = useQuery(auditQuery)
  if (audit.isPending) return <LoadingBlocks rows={2} />
  if (audit.error) return <LoadError error={audit.error} retry={() => void audit.refetch()} />
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Sign-ins and every change made through the app. Most recent first.</p>
        <Button variant="outline" size="sm" onClick={() => void audit.refetch()} disabled={audit.isFetching}>
          <RefreshCw className={audit.isFetching ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
        </Button>
      </div>
      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="hidden md:table-cell">From</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.data.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(entry.ts)}</TableCell>
                  <TableCell>{entry.username ?? '—'}</TableCell>
                  <TableCell>
                    <span title={entry.action}>{describeAction(entry.action)}</span>
                    {entry.target && <span className="ml-2 text-xs text-muted-foreground">{entry.target}</span>}
                    {entry.detail && <span className="ml-2 text-xs text-muted-foreground">{JSON.stringify(entry.detail)}</span>}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">{entry.ip ?? '—'}</TableCell>
                </TableRow>
              ))}
              {audit.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="p-6 text-center text-muted-foreground">
                    Nothing recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
