type NativeStorageModule = {
  getItem: (key: string, callback: (value: string | null) => void) => void
  setItem: (key: string, value: string, callback?: (value?: unknown) => void) => void
  removeItem: (key: string, callback?: (value?: unknown) => void) => void
}

const memory = new Map<string, string>()

function getNativeStorage(): NativeStorageModule | null {
  const runtime = globalThis as typeof globalThis & {
    NativeModules?: Record<string, unknown>
  }
  const module = runtime.NativeModules?.DataVaultSecureStorage
  return module ? (module as NativeStorageModule) : null
}

export function getStoredValue(key: string): Promise<string | null> {
  const native = getNativeStorage()
  if (!native) return Promise.resolve(memory.get(key) ?? null)

  return new Promise((resolve) => {
    native.getItem(key, (value) => resolve(value ?? null))
  })
}

export function setStoredValue(key: string, value: string): Promise<void> {
  memory.set(key, value)
  const native = getNativeStorage()
  if (!native) return Promise.resolve()

  return new Promise((resolve) => {
    native.setItem(key, value, () => resolve())
  })
}

export function removeStoredValue(key: string): Promise<void> {
  memory.delete(key)
  const native = getNativeStorage()
  if (!native) return Promise.resolve()

  return new Promise((resolve) => {
    native.removeItem(key, () => resolve())
  })
}
