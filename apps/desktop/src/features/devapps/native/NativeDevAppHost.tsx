import * as React from "react"
import * as ReactJsxRuntime from "react/jsx-runtime"
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type PropsWithChildren,
  type ReactNode,
} from "react"

import { Button } from "@/components/ui/button"

const NATIVE_DEV_APP_HOST_KEY = Symbol.for("cozea.nativeDevAppHost.v1")
const NATIVE_DEV_APP_API_VERSION = 1

interface NativeProjectFile {
  path: string
  sizeBytes: number
}

interface NativeDevAppContextValue {
  app: { id: string; version: string }
  projectId: string
  workspaceId: string
  surfaceId: string
  instanceId: string
  permissions: readonly string[]
  project: {
    readFile(filePath: string): Promise<string>
    writeFile(filePath: string, content: string): Promise<void>
    listFiles(): Promise<NativeProjectFile[]>
  }
  commands: {
    execute(commandId: string, input?: unknown): Promise<unknown>
  }
  storage: {
    get<T = unknown>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
    remove(key: string): Promise<void>
  }
}

interface NativeDevAppDefinition {
  apiVersion: number
  components: Record<string, ComponentType<{ surfaceId: string; instanceId: string }>>
  activate?: (context: NativeDevAppContextValue) =>
    | void
    | (() => void)
    | Promise<void | (() => void)>
  deactivate?: () => void | Promise<void>
  __CozeaContextProvider: ComponentType<PropsWithChildren<{ value: NativeDevAppContextValue }>>
}

interface NativeDevAppModule {
  default?: unknown
}

interface NativeDevAppHostRuntime {
  react: typeof React
  jsxRuntime: typeof ReactJsxRuntime
  jsxDevRuntime: typeof ReactJsxDevRuntime
}

export interface NativeDevAppHostProps {
  appId: string
  appVersion: string
  projectId: string
  workspaceId: string
  surfaceId: string
  instanceId: string
  moduleUrl: string
  stylesUrl?: string | null
  /** Omit to render the first component exported by the descriptor. */
  component?: string | null
  permissions?: readonly string[]
  generation?: string | number
  onExecuteCommand?: (commandId: string, input?: unknown) => Promise<unknown>
  fallback?: ReactNode
}

function installHostRuntime(): void {
  const globals = globalThis as typeof globalThis & Record<PropertyKey, unknown>
  const existing = globals[NATIVE_DEV_APP_HOST_KEY] as NativeDevAppHostRuntime | undefined
  if (existing && existing.react !== React) {
    throw new Error("Another React runtime already owns the native DevApp host.")
  }
  globals[NATIVE_DEV_APP_HOST_KEY] = {
    react: React,
    jsxRuntime: ReactJsxRuntime,
    jsxDevRuntime: ReactJsxDevRuntime,
  } satisfies NativeDevAppHostRuntime
}

installHostRuntime()

function isNativeDefinition(value: unknown): value is NativeDevAppDefinition {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<NativeDevAppDefinition>
  return (
    candidate.apiVersion === NATIVE_DEV_APP_API_VERSION &&
    Boolean(candidate.components) &&
    typeof candidate.components === "object" &&
    typeof candidate.__CozeaContextProvider === "function"
  )
}

export function validateNativeDevAppDefinition(
  module: NativeDevAppModule,
  requestedComponent?: string | null,
): { definition: NativeDevAppDefinition; componentName: string } {
  if (!isNativeDefinition(module.default)) {
    throw new Error(
      "The renderer module must default-export defineNativeDevApp({ components }).",
    )
  }
  const componentName =
    requestedComponent ?? Object.keys(module.default.components).sort()[0] ?? null
  if (!componentName || typeof module.default.components[componentName] !== "function") {
    throw new Error(
      requestedComponent
        ? `The renderer module does not export component ${requestedComponent}.`
        : "The renderer module exports no React components.",
    )
  }
  return { definition: module.default, componentName }
}

function assertPermission(permissions: readonly string[], required: string): void {
  if (!permissions.includes(required)) {
    throw new Error(`This DevApp was not granted ${required}.`)
  }
}

function storageNamespace(appId: string, workspaceId: string): string {
  return `cozea:native-devapp:data:v1:${encodeURIComponent(appId)}:${encodeURIComponent(workspaceId)}`
}

function readStorage(namespace: string): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(namespace)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function writeStorage(namespace: string, state: Record<string, unknown>): void {
  window.localStorage.setItem(namespace, JSON.stringify(state))
}

function buildContext(props: NativeDevAppHostProps): NativeDevAppContextValue {
  const permissions = [...new Set(props.permissions ?? [])].sort()
  const namespace = storageNamespace(props.appId, props.workspaceId)
  return {
    app: { id: props.appId, version: props.appVersion },
    projectId: props.projectId,
    workspaceId: props.workspaceId,
    surfaceId: props.surfaceId,
    instanceId: props.instanceId,
    permissions,
    project: {
      async readFile(filePath) {
        assertPermission(permissions, "project.read")
        const result = await window.electronAPI.project.readFile({
          workspaceId: props.workspaceId,
          filePath,
        })
        if (!result.success || result.content === undefined) {
          throw new Error(result.error ?? `Could not read ${filePath}.`)
        }
        return result.content
      },
      async writeFile(filePath, content) {
        assertPermission(permissions, "project.write")
        const result = await window.electronAPI.project.writeFile({
          workspaceId: props.workspaceId,
          filePath,
          content,
        })
        if (!result.success) throw new Error(result.error ?? `Could not write ${filePath}.`)
      },
      async listFiles() {
        assertPermission(permissions, "project.read")
        const result = await window.electronAPI.project.listFiles({
          workspaceId: props.workspaceId,
        })
        if (!result.success) throw new Error(result.error ?? "Could not list project files.")
        return result.files ?? []
      },
    },
    commands: {
      async execute(commandId, input) {
        if (!props.onExecuteCommand) {
          throw new Error(`Command ${commandId} has no active extension handler.`)
        }
        return await props.onExecuteCommand(commandId, input)
      },
    },
    storage: {
      async get<T>(key: string): Promise<T | null> {
        const value = readStorage(namespace)[key]
        return value === undefined ? null : (value as T)
      },
      async set(key, value) {
        const current = readStorage(namespace)
        current[key] = value
        writeStorage(namespace, current)
      },
      async remove(key) {
        const current = readStorage(namespace)
        delete current[key]
        writeStorage(namespace, current)
      },
    },
  }
}

function moduleUrlForGeneration(url: string, generation: string | number | undefined): string {
  if (generation === undefined) return url
  const parsed = new URL(url)
  parsed.searchParams.set("cozeaNativeGeneration", String(generation))
  return parsed.toString()
}

function useNativeModule(
  moduleUrl: string,
  componentName: string | null | undefined,
  generation: string | number | undefined,
) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; definition: NativeDevAppDefinition; componentName: string }
    | { status: "error"; error: string }
  >({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading" })
    const versionedUrl = moduleUrlForGeneration(moduleUrl, generation)
    void import(/* @vite-ignore */ versionedUrl)
      .then((module: NativeDevAppModule) => {
        if (cancelled) return
        const resolved = validateNativeDevAppDefinition(module, componentName)
        setState({ status: "ready", ...resolved })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: cause instanceof Error ? cause.message : "The native renderer failed to load.",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [componentName, generation, moduleUrl])

  return state
}

function useNativeStyles(stylesUrl: string | null | undefined, generation: string | number | undefined) {
  useEffect(() => {
    if (!stylesUrl) return
    const href = moduleUrlForGeneration(stylesUrl, generation)
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = href
    link.dataset.cozeaNativeDevAppStyle = href
    document.head.append(link)
    return () => link.remove()
  }, [generation, stylesUrl])
}

class NativeDevAppErrorBoundary extends React.Component<
  PropsWithChildren<{ appId: string }>,
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[NativeDevApp:${this.props.appId}]`, error)
  }

  render() {
    if (this.state.error) {
      return (
        <NativeDevAppFailure
          title="This DevApp component crashed"
          detail={this.state.error.message}
        />
      )
    }
    return this.props.children
  }
}

function NativeDevAppFailure({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-content-surface p-6 text-center">
      <div className="max-w-sm space-y-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function ActiveNativeDevApp({
  definition,
  context,
  componentName,
}: {
  definition: NativeDevAppDefinition
  context: NativeDevAppContextValue
  componentName: string
}) {
  const [activationError, setActivationError] = useState<string | null>(null)
  const Component = definition.components[componentName]!
  const Provider = definition.__CozeaContextProvider

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    void Promise.resolve(definition.activate?.(context))
      .then((result) => {
        if (disposed) {
          if (typeof result === "function") result()
          return
        }
        if (typeof result === "function") cleanup = result
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setActivationError(
            cause instanceof Error ? cause.message : "The DevApp activation failed.",
          )
        }
      })
    return () => {
      disposed = true
      cleanup?.()
      void Promise.resolve(definition.deactivate?.()).catch(() => undefined)
    }
  }, [context, definition])

  if (activationError) {
    return <NativeDevAppFailure title="This DevApp could not activate" detail={activationError} />
  }

  return (
    <Provider value={context}>
      <Component surfaceId={context.surfaceId} instanceId={context.instanceId} />
    </Provider>
  )
}

export function NativeDevAppHost(props: NativeDevAppHostProps) {
  const moduleState = useNativeModule(props.moduleUrl, props.component, props.generation)
  useNativeStyles(props.stylesUrl, props.generation)
  const permissionKey = (props.permissions ?? []).slice().sort().join("\0")
  const context = useMemo(
    () => buildContext(props),
    [
      props.appId,
      props.appVersion,
      props.instanceId,
      props.onExecuteCommand,
      permissionKey,
      props.projectId,
      props.surfaceId,
      props.workspaceId,
    ],
  )

  if (moduleState.status === "loading") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-content-surface p-6 text-xs text-muted-foreground">
        {props.fallback ?? "Loading native DevApp…"}
      </div>
    )
  }
  if (moduleState.status === "error") {
    return <NativeDevAppFailure title="This native DevApp could not be loaded" detail={moduleState.error} />
  }

  return (
    <div
      data-cozea-native-devapp={props.appId}
      data-cozea-native-surface={props.surfaceId}
      className="h-full min-h-0 min-w-0 overflow-hidden"
    >
      <NativeDevAppErrorBoundary appId={props.appId}>
        <ActiveNativeDevApp
          definition={moduleState.definition}
          context={context}
          componentName={moduleState.componentName}
        />
      </NativeDevAppErrorBoundary>
    </div>
  )
}

export function NativeDevAppNotInstalled({
  name,
  onRemove,
}: {
  name: string
  onRemove?: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center bg-content-surface p-6 text-center">
      <div className="max-w-sm space-y-3">
        <p className="text-sm font-medium text-foreground">{name} is not installed</p>
        <p className="text-xs text-muted-foreground">
          Reinstall the DevApp to restore this surface, or remove the tile from the workbench.
        </p>
        {onRemove ? (
          <Button type="button" size="sm" variant="outline" onClick={onRemove}>
            Remove tile
          </Button>
        ) : null}
      </div>
    </div>
  )
}
