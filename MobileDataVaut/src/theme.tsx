/**
 * The theme of the app.
 *
 * The colours are named rather than written out, so the whole app can be
 * turned over at once. The choice is kept on the device, so it is still
 * there the next time the app is opened.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from '@lynx-js/react'

import { systemTheme } from './native/appearance.js'
import { getStoredValue, setStoredValue } from './native/storage.js'

export type Theme = 'light' | 'dark' | 'system'

/**
 * The themes that may be chosen, in the order they are offered.
 */
export const THEME_OPTIONS: readonly Theme[] = ['light', 'dark', 'system']

/**
 * What each theme is called on the screen.
 */
export const THEME_LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Follow the system',
}

const THEME_KEY = 'dataVaultTheme'

interface ThemeContextValue {
  /** The theme that was chosen. */
  theme: Theme
  /** The theme that is on the screen. */
  resolved: 'light' | 'dark'
  /** Choose a theme and keep the choice. */
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * The theme of the app.
 *
 * There used to be a copy of this in the app and another in the settings,
 * and each kept its own answer. Changing the theme in the settings changed
 * the settings and nothing else, because the app never heard about it. There
 * is one answer now, and every part of the app asks this for it.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')
  const [system, setSystem] = useState<'light' | 'dark' | null>(null)
  /**
   * The last theme that was chosen outright.
   *
   * It stands in for the system when the device will not say what it wants,
   * so that asking to follow the system never leaves the app unreadable.
   */
  const [fallback, setFallback] = useState<'light' | 'dark'>('light')
  /**
   * Whether the theme was changed while the stored one was being read.
   *
   * The stored theme arrives a moment after the app opens. A choice made in
   * that moment is the newer one, and the stored one must not come back
   * over it.
   */
  const changed = useRef(false)

  useEffect(() => {
    let cancelled = false
    void getStoredValue(THEME_KEY).then((stored) => {
      if (cancelled || changed.current) return
      if (stored !== 'light' && stored !== 'dark' && stored !== 'system') return
      setThemeState(stored)
      if (stored !== 'system') setFallback(stored)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void systemTheme().then((answer) => {
      if (cancelled) return
      setSystem(answer)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setTheme = useCallback((next: Theme) => {
    changed.current = true
    setThemeState(next)
    if (next !== 'system') setFallback(next)
    void setStoredValue(THEME_KEY, next)
  }, [])

  const resolved: 'light' | 'dark' = theme === 'system' ? system ?? fallback : theme

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/**
 * The theme of the app, and the way to change it.
 */
export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}

/**
 * The name of a theme, for the places that only say it in words.
 */
export function themeName(theme: Theme): string {
  return THEME_LABELS[theme]
}
