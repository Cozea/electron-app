import {
  createContext,
  createElement,
  useContext,
  type ButtonHTMLAttributes,
  type ComponentType,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from "react"

export const NATIVE_DEV_APP_MODULE_API_VERSION = 1 as const

export interface NativeDevAppProjectFile {
  path: string
  sizeBytes: number
}

export interface NativeDevAppProjectApi {
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
  listFiles(): Promise<NativeDevAppProjectFile[]>
}

export interface NativeDevAppCommandApi {
  execute(commandId: string, input?: unknown): Promise<unknown>
}

export interface NativeDevAppStorageApi {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

export interface NativeDevAppContextValue {
  app: {
    id: string
    version: string
  }
  projectId: string
  workspaceId: string
  surfaceId: string
  instanceId: string
  permissions: readonly string[]
  project: NativeDevAppProjectApi
  commands: NativeDevAppCommandApi
  storage: NativeDevAppStorageApi
}

export interface NativeDevAppComponentProps {
  surfaceId: string
  instanceId: string
}

export interface NativeDevAppDefinition {
  apiVersion: typeof NATIVE_DEV_APP_MODULE_API_VERSION
  components: Record<string, ComponentType<NativeDevAppComponentProps>>
  activate?: (context: NativeDevAppContextValue) => void | (() => void) | Promise<void | (() => void)>
  deactivate?: () => void | Promise<void>
  /** Host-only provider. Package authors never call this directly. */
  __CozeaContextProvider: ComponentType<PropsWithChildren<{ value: NativeDevAppContextValue }>>
}

export interface NativeDevAppDefinitionInput {
  components: Record<string, ComponentType<NativeDevAppComponentProps>>
  activate?: NativeDevAppDefinition["activate"]
  deactivate?: NativeDevAppDefinition["deactivate"]
}

const NativeDevAppContext = createContext<NativeDevAppContextValue | null>(null)

function CozeaContextProvider({
  value,
  children,
}: PropsWithChildren<{ value: NativeDevAppContextValue }>) {
  return createElement(NativeDevAppContext.Provider, { value }, children)
}

/** Defines the stable renderer ABI consumed by Cozea's native DevApp host. */
export function defineNativeDevApp(input: NativeDevAppDefinitionInput): NativeDevAppDefinition {
  if (!input || typeof input !== "object" || !input.components) {
    throw new Error("defineNativeDevApp requires a component map.")
  }
  return {
    apiVersion: NATIVE_DEV_APP_MODULE_API_VERSION,
    components: input.components,
    ...(input.activate ? { activate: input.activate } : {}),
    ...(input.deactivate ? { deactivate: input.deactivate } : {}),
    __CozeaContextProvider: CozeaContextProvider,
  }
}

export function useDevAppContext(): NativeDevAppContextValue {
  const value = useContext(NativeDevAppContext)
  if (!value) {
    throw new Error("This component is not mounted inside a Cozea native DevApp surface.")
  }
  return value
}

export function DevAppButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return createElement("button", {
    ...props,
    type,
    className: [
      "inline-flex h-8 items-center justify-center rounded-md border border-border bg-primary px-3",
      "text-xs font-medium text-primary-foreground shadow-sm transition-colors",
      "hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    ]
      .filter(Boolean)
      .join(" "),
  })
}

export function DevAppPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return createElement("div", {
    ...props,
    className: ["flex h-full min-h-0 flex-col bg-content-surface text-foreground", className]
      .filter(Boolean)
      .join(" "),
  })
}

export function DevAppToolbar({
  title,
  actions,
  className,
}: {
  title: string
  actions?: ReactNode
  className?: string
}) {
  return createElement(
    "header",
    {
      className: [
        "flex h-10 shrink-0 items-center gap-3 border-b border-border/60 px-3",
        className,
      ]
        .filter(Boolean)
        .join(" "),
    },
    createElement("h2", { className: "min-w-0 flex-1 truncate text-xs font-medium" }, title),
    actions ? createElement("div", { className: "flex shrink-0 items-center gap-1" }, actions) : null,
  )
}

export function DevAppEmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return createElement(
    "div",
    { className: "flex min-h-0 flex-1 items-center justify-center p-6 text-center" },
    createElement(
      "div",
      { className: "max-w-sm space-y-3" },
      createElement("h3", { className: "text-sm font-medium text-foreground" }, title),
      description
        ? createElement("p", { className: "text-xs leading-relaxed text-muted-foreground" }, description)
        : null,
      action ? createElement("div", { className: "flex justify-center" }, action) : null,
    ),
  )
}
