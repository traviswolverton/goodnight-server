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
      <Toaster richColors closeButton />
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

const cardsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cards',
  validateSearch: (search: Record<string, unknown>): { card?: string } => ({
    card: typeof search.card === 'string' ? search.card : undefined,
  }),
  component: lazyRouteComponent(() => import('@/routes/cards'), 'CardsPage'),
})

const pixelsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/pixels',
  validateSearch: (search: Record<string, unknown>): { pixel?: number } => {
    const pixel = Number(search.pixel)
    return { pixel: Number.isInteger(pixel) && pixel >= 0 && pixel <= 4 ? pixel : undefined }
  },
  component: lazyRouteComponent(() => import('@/routes/pixels'), 'PixelsPage'),
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

const adaptersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/adapters',
  beforeLoad: requireAdmin,
  component: lazyRouteComponent(() => import('@/routes/adapters'), 'AdaptersPage'),
})

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/users',
  beforeLoad: requireAdmin,
  component: lazyRouteComponent(() => import('@/routes/users'), 'UsersPage'),
})

const mqttRoute = createRoute({ getParentRoute: () => appRoute, path: '/mqtt', component: lazyRouteComponent(() => import('@/routes/mqtt'), 'MqttPage') })
const profileRoute = createRoute({ getParentRoute: () => appRoute, path: '/profile', component: lazyRouteComponent(() => import('@/routes/profile'), 'ProfilePage') })

/** Old addresses (the previous editor page and the server-rendered MQTT
 *  docs) still work as bookmarks: they land on the equivalent page here. */
const oldEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tools/lines-template',
  beforeLoad: () => {
    throw redirect({ to: '/cards' })
  },
})
const oldMqttDocsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docs/mqtt',
  beforeLoad: () => {
    throw redirect({ to: '/mqtt' })
  },
})

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
  oldEditorRoute,
  oldMqttDocsRoute,
  appRoute.addChildren([
    homeRoute,
    cardsRoute,
    pixelsRoute,
    actionsRoute,
    adaptersRoute,
    usersRoute,
    mqttRoute,
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
