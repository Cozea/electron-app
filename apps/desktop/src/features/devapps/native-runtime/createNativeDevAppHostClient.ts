import type {
  DevAppJsonValue,
  NativeDevAppHostClient,
  NativeDevAppIdentity,
  NativeDevAppSurfaceIdentity,
} from "../../../../../../packages/devapp-api/src/native"

export interface CreateNativeDevAppHostClientOptions {
  identity: NativeDevAppIdentity
  surface: NativeDevAppSurfaceIdentity
  locale?: string
  executeCommand?: (commandId: string, argument?: DevAppJsonValue) => Promise<unknown>
  request?: (method: string, params?: DevAppJsonValue) => Promise<unknown>
  storageNamespace?: string
}

/**
 * Creates the renderer-side SDK façade for one surface instance.
 *
 * Storage/settings are namespaced and JSON-only. Privileged commands and requests are
 * delegated to the host callbacks, which are expected to cross the typed Electron bridge;
 * no raw IPC object is exposed to the package.
 */
export function createNativeDevAppHostClient(
  options: CreateNativeDevAppHostClientOptions,
): NativeDevAppHostClient {
  const namespace =
    options.storageNamespace ??
    `cozea:native-devapp:${options.identity.installationId}:${options.surface.instanceId}`
  const settingPrefix = `${namespace}:setting:`
  const storagePrefix = `${namespace}:data:`

  return {
    identity: Object.freeze({ ...options.identity }),
    surface: Object.freeze({ ...options.surface }),
    locale: options.locale || document.documentElement.lang || navigator.language || "en",
    commands: {
      execute: async (commandId, argument) => {
        if (!options.executeCommand) {
          throw new Error(`DevApp command ${commandId} has no active extension host.`)
        }
        return await options.executeCommand(commandId, argument)
      },
    },
    settings: {
      get: async <Value extends DevAppJsonValue = DevAppJsonValue>(
        settingId: string,
      ): Promise<Value | undefined> => readJson<Value>(`${settingPrefix}${settingId}`),
      set: async (settingId, value) => {
        writeJson(`${settingPrefix}${settingId}`, value)
        window.dispatchEvent(
          new CustomEvent(settingEventName(namespace, settingId), { detail: value }),
        )
      },
      subscribe: (settingId, listener) => {
        const eventName = settingEventName(namespace, settingId)
        const handle = (event: Event) => {
          listener((event as CustomEvent<DevAppJsonValue | undefined>).detail)
        }
        window.addEventListener(eventName, handle)
        return { dispose: () => window.removeEventListener(eventName, handle) }
      },
    },
    storage: {
      get: async <Value extends DevAppJsonValue = DevAppJsonValue>(
        key: string,
      ): Promise<Value | undefined> => readJson<Value>(`${storagePrefix}${key}`),
      set: async (key, value) => writeJson(`${storagePrefix}${key}`, value),
      delete: async (key) => localStorage.removeItem(`${storagePrefix}${key}`),
    },
    theme: {
      get colorScheme() {
        return document.documentElement.classList.contains("dark") ? "dark" : "light"
      },
      subscribe: (listener) => {
        const observer = new MutationObserver(() => {
          listener(document.documentElement.classList.contains("dark") ? "dark" : "light")
        })
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class"],
        })
        return { dispose: () => observer.disconnect() }
      },
    },
    request: async (method, params) => {
      if (!options.request) {
        throw new Error(`DevApp host method ${method} is unavailable.`)
      }
      return await options.request(method, params)
    },
  }
}

function readJson<Value extends DevAppJsonValue>(key: string): Value | undefined {
  const raw = localStorage.getItem(key)
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as Value
  } catch {
    localStorage.removeItem(key)
    return undefined
  }
}

function writeJson(key: string, value: DevAppJsonValue): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function settingEventName(namespace: string, settingId: string): string {
  return `${namespace}:setting:${settingId}:changed`
}
