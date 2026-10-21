import { useCallback, useEffect, useState } from '@lynx-js/react'

import { getStoredValue, setStoredValue } from './native/storage.js'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'dataVaultTheme'

/**
 * The theme of the app.
 *
 * The colours are named rather than written out, so the whole app can be
 * turned over at once. The choice is kept on the device, so it is still
 * there the next time the app is opened.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    let cancelled = false
    void getStoredValue(THEME_KEY).then((stored) => {
      if (cancelled) return
      setThemeState(stored === 'dark' ? 'dark' : 'light')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    void setStoredValue(THEME_KEY, next)
  }, [])

  return { theme, setTheme }
}
