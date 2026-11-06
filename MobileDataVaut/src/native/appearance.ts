/**
 * The theme the device is asking for.
 *
 * The host may say so in the properties it gives the page, and a native
 * module may be asked directly. When neither can answer, nothing is said,
 * and the app stands in with the theme that was last chosen.
 */

type NativeAppearanceModule = {
  isDark: (callback: (value: boolean) => void) => void
}

function getNativeAppearance(): NativeAppearanceModule | null {
  const runtime = globalThis as typeof globalThis & {
    NativeModules?: Record<string, unknown>
  }
  const module = runtime.NativeModules?.DataVaultAppearance
  return module ? (module as NativeAppearanceModule) : null
}

/**
 * The theme the device is asking for, or nothing when it will not say.
 */
export async function systemTheme(): Promise<'light' | 'dark' | null> {
  const globals = (globalThis as typeof globalThis & {
    lynx?: { __globalProps?: { theme?: unknown } }
  }).lynx?.__globalProps
  const published = globals?.theme
  if (published === 'dark' || published === 'light') return published

  const native = getNativeAppearance()
  if (!native) return null

  return new Promise((resolve) => {
    try {
      native.isDark((value) => resolve(value ? 'dark' : 'light'))
    } catch {
      resolve(null)
    }
  })
}
