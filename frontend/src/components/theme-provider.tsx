import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ACCENTS,
  DEFAULT_ACCENT,
  DEFAULT_RADIUS,
  RADII,
  ThemeContext,
  type Accent,
  type Radius,
  type Theme,
  type ThemeContextValue,
} from '@/hooks/use-theme'

const THEME_KEY = 'dd-theme'
const ACCENT_KEY = 'dd-accent'
const RADIUS_KEY = 'dd-radius'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** A stored choice, if it's still one we offer; otherwise the default.
 *  Storage can be blocked (private mode, site data cleared): defaults then. */
function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored && (allowed as readonly string[]).includes(stored)) return stored as T
  } catch {
    // Fall through to the default.
  }
  return fallback
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Not persisted; still applies for this visit.
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => read<Theme>(THEME_KEY, ['light', 'dark', 'system'], 'system'))
  const [accent, setAccentState] = useState<Accent>(() =>
    read(ACCENT_KEY, ACCENTS.map((a) => a.id), DEFAULT_ACCENT),
  )
  const [radius, setRadiusState] = useState<Radius>(() => read(RADIUS_KEY, RADII.map((r) => r.id), DEFAULT_RADIUS))
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
  }, [resolvedTheme])

  // Before paint, so a stored accent never flashes the default one.
  useLayoutEffect(() => {
    document.documentElement.dataset.accent = accent
    document.documentElement.dataset.radius = radius
  }, [accent, radius])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (next) => {
        setThemeState(next)
        write(THEME_KEY, next)
      },
      accent,
      setAccent: (next) => {
        setAccentState(next)
        write(ACCENT_KEY, next)
      },
      radius,
      setRadius: (next) => {
        setRadiusState(next)
        write(RADIUS_KEY, next)
      },
      reset: () => {
        setThemeState('system')
        setAccentState(DEFAULT_ACCENT)
        setRadiusState(DEFAULT_RADIUS)
        write(THEME_KEY, null)
        write(ACCENT_KEY, null)
        write(RADIUS_KEY, null)
      },
    }),
    [theme, resolvedTheme, accent, radius],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
