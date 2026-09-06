/**
 * A working `localStorage` for the node test environment.
 *
 * Under Bun, `globalThis.localStorage` exists but is an empty object: no
 * `setItem`, no `getItem`. zustand's `createJSONStorage(() => localStorage)`
 * resolves that object once, at module import time, and caches it — so every
 * store that persists throws "storage.setItem is not a function" on its first
 * write, and a `vi.stubGlobal` inside a test file lands far too late to help,
 * because imports are hoisted above it.
 *
 * A setup file is the only place a replacement lands before the stores are
 * imported. Five stores persist this way, so this belongs here rather than in
 * any one suite.
 */
function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key)
    },
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  const existing = (globalThis as Record<string, unknown>)[name] as Storage | undefined
  // Leave a real implementation alone; only stand in for a missing or hollow one.
  if (existing && typeof existing.setItem === "function") continue
  Object.defineProperty(globalThis, name, {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  })
}
