import { useEffect, useMemo, useState, type ReactNode } from "react"

import {
  NativeDevAppHostProvider,
  type DevAppJsonValue,
  type NativeDevAppComponent,
  type NativeDevAppDefinition,
  type NativeDevAppHostClient,
} from "../../../../../../packages/devapp-api/src/native"
import { NativeDevAppErrorBoundary } from "./NativeDevAppErrorBoundary"
import {
  activateNativeDevAppDefinition,
  loadNativeDevAppDefinition,
  resolveNativeDevAppComponent,
  type NativeDevAppModuleImporter,
} from "./nativeDevAppModuleLoader"
import { useNativeDevAppStyle } from "./nativeDevAppStyles"

interface ReadyModule {
  definition: NativeDevAppDefinition
  component: NativeDevAppComponent
}

type ModuleState =
  | { status: "loading" }
  | { status: "ready"; module: ReadyModule }
  | { status: "error"; error: Error }

export interface NativeDevAppSurfaceFrameProps {
  appId: string
  host: NativeDevAppHostClient
  component: NativeDevAppComponent
  instanceState?: DevAppJsonValue
  onInstanceStateChange?: (next: DevAppJsonValue | undefined) => void
}

export function NativeDevAppSurfaceFrame({
  appId,
  host,
  component: SurfaceComponent,
  instanceState,
  onInstanceStateChange,
}: NativeDevAppSurfaceFrameProps) {
  return (
    <NativeDevAppHostProvider value={host}>
      <div
        className="h-full min-h-0 min-w-0 overflow-hidden"
        data-cozea-devapp={appId}
        data-cozea-devapp-version={host.identity.version}
        data-cozea-devapp-surface={host.surface.surfaceId}
        data-cozea-devapp-instance={host.surface.instanceId}
      >
        <SurfaceComponent
          instanceState={instanceState}
          setInstanceState={(next) => onInstanceStateChange?.(next)}
        />
      </div>
    </NativeDevAppHostProvider>
  )
}

export interface NativeDevAppSurfaceHostProps {
  moduleUrl: string
  stylesUrl?: string | null
  componentName: string
  host: NativeDevAppHostClient
  instanceState?: DevAppJsonValue
  onInstanceStateChange?: (next: DevAppJsonValue | undefined) => void
  importer?: NativeDevAppModuleImporter
  loadingFallback?: ReactNode
  errorFallback?: (error: Error) => ReactNode
  onError?: (error: Error) => void
}

function defaultErrorFallback(error: Error): ReactNode {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center" role="alert">
      <div className="max-w-md space-y-2">
        <p className="text-sm font-medium text-foreground">DevApp could not open</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    </div>
  )
}

export function NativeDevAppSurfaceHost({
  moduleUrl,
  stylesUrl = null,
  componentName,
  host,
  instanceState,
  onInstanceStateChange,
  importer,
  loadingFallback = <div className="h-full bg-content-surface" aria-busy="true" />,
  errorFallback = defaultErrorFallback,
  onError,
}: NativeDevAppSurfaceHostProps) {
  const [moduleState, setModuleState] = useState<ModuleState>({ status: "loading" })
  const resetKey = `${moduleUrl}:${componentName}:${host.surface.instanceId}`
  const styleError = useNativeDevAppStyle(stylesUrl)

  useEffect(() => {
    let active = true
    setModuleState({ status: "loading" })
    void loadNativeDevAppDefinition({ moduleUrl, importer })
      .then((definition) => ({
        definition,
        component: resolveNativeDevAppComponent(definition, componentName),
      }))
      .then((loaded) => {
        if (active) setModuleState({ status: "ready", module: loaded })
      })
      .catch((cause) => {
        if (!active) return
        const error = cause instanceof Error ? cause : new Error(String(cause))
        setModuleState({ status: "error", error })
        onError?.(error)
      })
    return () => {
      active = false
    }
  }, [componentName, importer, moduleUrl, onError])

  const definition = moduleState.status === "ready" ? moduleState.module.definition : null
  useEffect(() => {
    if (!definition) return
    let active = true
    let lease: Awaited<ReturnType<typeof activateNativeDevAppDefinition>> | null = null
    void activateNativeDevAppDefinition(definition, host)
      .then((nextLease) => {
        if (!active) {
          void nextLease.dispose()
          return
        }
        lease = nextLease
      })
      .catch((cause) => {
        if (!active) return
        const error = cause instanceof Error ? cause : new Error(String(cause))
        setModuleState({ status: "error", error })
        onError?.(error)
      })
    return () => {
      active = false
      if (!lease) return
      try {
        void Promise.resolve(lease.dispose()).catch((cause: unknown) => {
          onError?.(cause instanceof Error ? cause : new Error(String(cause)))
        })
      } catch (cause) {
        onError?.(cause instanceof Error ? cause : new Error(String(cause)))
      }
    }
  }, [definition, host, onError])

  const effectiveError = useMemo(() => {
    if (styleError) return styleError
    return moduleState.status === "error" ? moduleState.error : null
  }, [moduleState, styleError])

  if (effectiveError) return errorFallback(effectiveError)
  if (moduleState.status !== "ready") return loadingFallback

  return (
    <NativeDevAppErrorBoundary
      resetKey={resetKey}
      fallback={errorFallback}
      onError={(error) => onError?.(error)}
    >
      <NativeDevAppSurfaceFrame
        appId={host.identity.appId}
        host={host}
        component={moduleState.module.component}
        instanceState={instanceState}
        onInstanceStateChange={onInstanceStateChange}
      />
    </NativeDevAppErrorBoundary>
  )
}
