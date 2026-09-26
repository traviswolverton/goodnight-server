import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import './index.css'
import { ThemeProvider } from '@/components/theme-provider'
import { ApiError, setCsrfToken, setUnauthorizedHandler } from '@/lib/api'
import { sessionQuery } from '@/lib/auth'
import { createAppRouter } from '@/router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't hammer the API on client errors (auth, validation, 404).
      retry: (count, error) => !(error instanceof ApiError && error.status < 500 && error.status !== 0) && count < 2,
    },
  },
})
const router = createAppRouter(queryClient)

// The session expired (or was revoked) while the app was open: drop everything
// cached for the old user and go to the login screen, remembering where we were.
setUnauthorizedHandler(() => {
  setCsrfToken(null)
  queryClient.clear()
  queryClient.setQueryData(sessionQuery.queryKey, null)
  const here = router.state.location
  if (here.pathname !== '/login') {
    void router.navigate({ to: '/login', search: { next: here.href } })
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
