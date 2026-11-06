import { useTheme } from '../theme.js'

/**
 * The button that turns the theme over.
 *
 * It is in the bar of the home screen, so that the theme can be changed
 * without going to the settings to look for it.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const mark = theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <view
      className="theme-toggle"
      bindtap={() => setTheme(next)}
      accessibility-label={theme === 'dark' ? 'Turn on the light theme' : 'Turn on the dark theme'}
    >
      <text className="theme-toggle__mark">{mark}</text>
    </view>
  )
}
