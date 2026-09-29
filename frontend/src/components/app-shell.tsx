import { useState } from 'react'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut, Menu, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { AppFooter } from '@/components/app-footer'
import { DeviceReadings } from '@/components/device-readings'
import { ErrorBoundary } from '@/components/error-boundary'
import { LogoMark } from '@/components/logo'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { logout, type Role, type User } from '@/lib/auth'
import { navFor } from '@/lib/nav'
import { cn } from '@/lib/utils'

function NavLinks({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="grid gap-1">
      {navFor(role).map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === '/' }}
          onClick={onNavigate}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          )}
          activeProps={{ className: 'bg-accent text-accent-foreground', 'aria-current': 'page' }}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <LogoMark className="size-7" />
      <span className="text-base font-semibold tracking-tight">Bedside Dashboard</span>
    </Link>
  )
}

function UserMenu({ user }: { user: User }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function signOut() {
    try {
      await logout()
    } catch {
      // The session may already be gone; either way we end up signed out here.
    }
    queryClient.clear()
    await navigate({ to: '/login', search: {} })
    toast.success('Signed out')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
          <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground uppercase">
            {user.username.slice(0, 1)}
          </span>
          <span className="hidden max-w-32 truncate text-sm sm:inline">{user.username}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="grid gap-1">
          <span className="truncate">{user.username}</span>
          <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="w-fit capitalize">
            {user.role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserRound aria-hidden="true" /> Your account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell({ user }: { user: User }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <div className="min-h-svh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-svh flex-col gap-6 border-r bg-card p-4 md:flex">
        <div className="px-1 py-1">
          <Brand />
        </div>
        <NavLinks role={user.role} />
        <AppFooter />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-4">
              <SheetHeader className="p-0 pb-4">
                <SheetTitle>
                  <Brand />
                </SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
              </SheetHeader>
              <NavLinks role={user.role} onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          {/* The name lives in the sidebar and the menu; the bar carries the logo and the readings. */}
          <Link
            to="/"
            aria-label="Bedside Dashboard home"
            className="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-[379px]:hidden md:hidden"
          >
            <LogoMark className="size-7" />
          </Link>
          <DeviceReadings />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
          <ErrorBoundary key={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
