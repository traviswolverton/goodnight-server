import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { ErrorPanel } from '@/components/error-boundary'
import { LoadingBlocks } from '@/components/query-state'
import { Toaster } from '@/components/ui/sonner'
import { safeNext, sessionQuery, type Session } from '@/lib/auth'
import { HomePage } from '@/routes/home'
import { LoginPage } from '@/routes/login'
import { NotFoundPage } from '@/routes/pages'

interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <Outlet />
      {/* Lifted clear of the sticky Save bar on the Device and Settings pages, so a
          "Saved" toast never covers the button you just pressed. */}
      <Toaster richColors closeButton offset={{ bottom: '5rem' }} mobileOffset={{ bottom: '7rem' }} />
    </>
  ),
  notFoundComponent: NotFoundPage,
  errorComponent: ({ error, reset }) => <ErrorPanel error={error} reset={reset} />,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === 'string' ? safeNext(search.next) : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery)
    // Already signed in: skip the form and go where they were headed.
    if (session) throw redirect({ to: search.next ?? '/' })
  },
  component: LoginPage,
})

/** Everything that needs a signed-in user. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const session: Session | null = await context.queryClient.ensureQueryData(sessionQuery)
    if (!session) throw redirect({ to: '/login', search: { next: safeNext(location.href) } })
    return { session }
  },
  component: function Shell() {
    const { session } = appRoute.useRouteContext()
    return <AppShell user={session.user} />
  },
})

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: function Home() {
    const { session } = appRoute.useRouteContext()
    return <HomePage username={session.user.username} />
  },
})

const deviceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/device',
  component: lazyRouteComponent(() => import('@/routes/device'), 'DevicePage'),
})

const diagnosticsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/diagnostics',
  component: lazyRouteComponent(() => import('@/routes/diagnostics'), 'DiagnosticsPage'),
})

const buttonsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/buttons',
  component: lazyRouteComponent(() => import('@/routes/buttons'), 'ButtonsPage'),
})

const actionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/actions',
  component: lazyRouteComponent(() => import('@/routes/actions'), 'ActionsPage'),
})

/** Admin-only pages: viewers are sent home rather than shown an empty error. */
function requireAdmin({ context }: { context: { session: Session } }) {
  if (context.session.user.role !== 'admin') throw redirect({ to: '/' })
}

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  beforeLoad: requireAdmin,
  component: lazyRouteComponent(() => import('@/routes/settings'), 'SettingsPage'),
})

const appearanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/appearance',
  component: lazyRouteComponent(() => import('@/routes/appearance'), 'AppearancePage'),
})

const aboutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/about',
  component: lazyRouteComponent(() => import('@/routes/about'), 'AboutPage'),
})

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/users',
  beforeLoad: requireAdmin,
  component: lazyRouteComponent(() => import('@/routes/users'), 'UsersPage'),
})

const mqttRoute = createRoute({ getParentRoute: () => appRoute, path: '/mqtt', component: lazyRouteComponent(() => import('@/routes/mqtt'), 'MqttPage') })
const profileRoute = createRoute({ getParentRoute: () => appRoute, path: '/profile', component: lazyRouteComponent(() => import('@/routes/profile'), 'ProfilePage') })

/** Unknown URLs: inside the app shell for signed-in users; anonymous visitors
 *  are sent to the login screen first (the parent's beforeLoad) rather than
 *  learning anything from a bare 404. */
const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: NotFoundPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    homeRoute,
    deviceRoute,
    diagnosticsRoute,
    actionsRoute,
    buttonsRoute,
    settingsRoute,
    appearanceRoute,
    usersRoute,
    mqttRoute,
    aboutRoute,
    profileRoute,
    notFoundRoute,
  ]),
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    // Pages load on demand; show a skeleton only if a page takes a moment.
    defaultPendingMs: 150,
    defaultPendingComponent: () => <LoadingBlocks rows={2} />,
    defaultErrorComponent: ({ error, reset }) => <ErrorPanel error={error} reset={reset} />,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
