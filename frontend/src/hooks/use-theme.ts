import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark' | 'system'

/** Accent hues (the Appearance page). `swatch` is only for drawing the
 *  choice; the real colours come from html[data-accent] in index.css. */
export const ACCENTS = [
  { id: 'sky', label: 'Sky', swatch: 'oklch(0.62 0.13 235)' },
  { id: 'indigo', label: 'Indigo', swatch: 'oklch(0.58 0.16 272)' },
  { id: 'violet', label: 'Violet', swatch: 'oklch(0.58 0.16 305)' },
  { id: 'rose', label: 'Rose', swatch: 'oklch(0.6 0.17 5)' },
  { id: 'teal', label: 'Teal', swatch: 'oklch(0.6 0.1 195)' },
  { id: 'green', label: 'Green', swatch: 'oklch(0.6 0.115 165)' },
] as const
export type Accent = (typeof ACCENTS)[number]['id']

export const RADII = [
  { id: 'sharp', label: 'Sharp' },
  { id: 'default', label: 'Default' },
  { id: 'round', label: 'Round' },
] as const
export type Radius = (typeof RADII)[number]['id']

export const DEFAULT_ACCENT: Accent = 'sky'
export const DEFAULT_RADIUS: Radius = 'default'

export interface ThemeContextValue {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
  accent: Accent
  setAccent: (accent: Accent) => void
  radius: Radius
  setRadius: (radius: Radius) => void
  /** Back to the light-blue accent, default corners and the system mode. */
  reset: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>')
  return context
}
