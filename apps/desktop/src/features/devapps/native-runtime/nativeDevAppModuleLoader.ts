import {
  isNativeDevAppDefinition,
  type DevAppDisposable,
  type DevAppSubscription,
  type NativeDevAppComponent,
  type NativeDevAppDefinition,
  type NativeDevAppHostClient,
} from "../../../../../../packages/devapp-api/src/native"
import { parseNativeDevAppModuleUrl } from "@shared/nativeDevAppModuleProtocol"

export type NativeDevAppModuleImporter = (moduleUrl: string) => Promise<unknown>

const moduleCache = new Map<string, Promise<NativeDevAppDefinition>>()

const defaultImporter: NativeDevAppModuleImporter = (moduleUrl) =>
  import(/* @vite-ignore */ moduleUrl)

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

async function importAndValidate(
  moduleUrl: string,
  importer: NativeDevAppModuleImporter,
): Promise<NativeDevAppDefinition> {
  if (!parseNativeDevAppModuleUrl(moduleUrl)) {
    throw new Error("The native DevApp module URL is invalid or untrusted.")
  }
  const loaded = await importer(moduleUrl)
  const definition = (loaded as { default?: unknown } | null)?.default
  if (!isNativeDevAppDefinition(definition)) {
    throw new Error("The native DevApp renderer does not export a valid default definition.")
  }
  return definition
}

export async function loadNativeDevAppDefinition(options: {
  moduleUrl: string
  importer?: NativeDevAppModuleImporter
  cache?: boolean
}): Promise<NativeDevAppDefinition> {
  const importer = options.importer ?? defaultImporter
  if (options.cache === false || options.importer) {
    return importAndValidate(options.moduleUrl, importer)
  }
  let pending = moduleCache.get(options.moduleUrl)
  if (!pending) {
    pending = importAndValidate(options.moduleUrl, importer).catch((error) => {
      moduleCache.delete(options.moduleUrl)
      throw error
    })
    moduleCache.set(options.moduleUrl, pending)
  }
  return pending
}

export function forgetNativeDevAppModule(moduleUrl: string): void {
  moduleCache.delete(moduleUrl)
}

export function resolveNativeDevAppComponent(
  definition: NativeDevAppDefinition,
  componentName: string,
): NativeDevAppComponent {
  const component = definition.components[componentName]
  if (!component) {
    throw new Error(`The native DevApp does not export component ${componentName}.`)
  }
  return component
}

async function disposeSubscription(subscription: DevAppSubscription): Promise<void> {
  if (typeof subscription === "function") {
    await subscription()
    return
  }
  await subscription.dispose()
}

export async function activateNativeDevAppDefinition(
  definition: NativeDevAppDefinition,
  host: NativeDevAppHostClient,
): Promise<DevAppDisposable> {
  const subscriptions: DevAppSubscription[] = []
  let activationDisposable: DevAppDisposable | undefined
  let disposed = false

  try {
    const activated = await definition.activate?.({
      host,
      subscriptions: {
        add(subscription) {
          if (disposed) {
            void disposeSubscription(subscription)
            return
          }
          subscriptions.push(subscription)
        },
      },
    })
    if (activated) activationDisposable = activated
  } catch (error) {
    await Promise.allSettled(subscriptions.reverse().map(disposeSubscription))
    throw asError(error)
  }

  return {
    async dispose() {
      if (disposed) return
      disposed = true
      const failures: Error[] = []
      const disposeOne = async (operation: () => void | Promise<void>) => {
        try {
          await operation()
        } catch (error) {
          failures.push(asError(error))
        }
      }
      if (activationDisposable) {
        await disposeOne(() => activationDisposable!.dispose())
      }
      for (const subscription of subscriptions.reverse()) {
        await disposeOne(() => disposeSubscription(subscription))
      }
      if (definition.deactivate) {
        await disposeOne(() => definition.deactivate!())
      }
      if (failures.length > 0) throw new AggregateError(failures, "Native DevApp deactivation failed.")
    },
  }
}
