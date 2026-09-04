export const NATIVE_DEV_APP_RUNTIME_BRIDGE_VERSION = 1 as const
export const NATIVE_DEV_APP_RUNTIME_BRIDGE_KEY = "cozea.native-devapp-runtime/v1"
export const NATIVE_DEV_APP_RUNTIME_VIRTUAL_PREFIX = "\0cozea:native-runtime:"

export const NATIVE_DEV_APP_RUNTIME_IMPORTS = {
  react: "react",
  "react/jsx-runtime": "jsx-runtime",
  "react/jsx-dev-runtime": "jsx-dev-runtime",
  "@cozea/devapp-api/native": "native",
  "@cozea/devapp-api/ui": "ui",
} as const

export type NativeDevAppRuntimeImport = keyof typeof NATIVE_DEV_APP_RUNTIME_IMPORTS
export type NativeDevAppRuntimeResource =
  (typeof NATIVE_DEV_APP_RUNTIME_IMPORTS)[NativeDevAppRuntimeImport]

export interface NativeDevAppRuntimeBridgeShape {
  version: typeof NATIVE_DEV_APP_RUNTIME_BRIDGE_VERSION
  react: Record<string, unknown>
  jsxRuntime: Record<string, unknown>
  jsxDevRuntime: Record<string, unknown>
  nativeApi: Record<string, unknown>
  uiApi: Record<string, unknown>
}

export function nativeDevAppRuntimeVirtualId(source: string): string | null {
  const resource = NATIVE_DEV_APP_RUNTIME_IMPORTS[source as NativeDevAppRuntimeImport]
  return resource ? `${NATIVE_DEV_APP_RUNTIME_VIRTUAL_PREFIX}${resource}` : null
}

function bridgePrelude(namespace: keyof Omit<NativeDevAppRuntimeBridgeShape, "version">): string {
  return `
const bridge = globalThis[Symbol.for(${JSON.stringify(NATIVE_DEV_APP_RUNTIME_BRIDGE_KEY)})];
if (!bridge || bridge.version !== ${NATIVE_DEV_APP_RUNTIME_BRIDGE_VERSION}) {
  throw new Error("The Cozea native DevApp runtime bridge is unavailable or incompatible.");
}
const api = bridge.${namespace};
`
}

const REACT_EXPORTS = [
  "Activity",
  "Children",
  "Component",
  "Fragment",
  "Profiler",
  "PureComponent",
  "StrictMode",
  "Suspense",
  "act",
  "cache",
  "captureOwnerStack",
  "cloneElement",
  "createContext",
  "createElement",
  "createRef",
  "forwardRef",
  "isValidElement",
  "lazy",
  "memo",
  "startTransition",
  "use",
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
  "version",
] as const

function namedExports(names: readonly string[]): string {
  return names.map((name) => `export const ${name} = api.${name};`).join("\n")
}

/**
 * Virtual module source bundled into every native renderer artifact.
 *
 * The proxy contains no React implementation. It reads the immutable bridge installed by Cozea,
 * so hooks, contexts and JSX all resolve to the exact host runtime even when a package has its own
 * dependency graph.
 */
export function nativeDevAppRuntimeProxySource(virtualId: string): string | null {
  if (!virtualId.startsWith(NATIVE_DEV_APP_RUNTIME_VIRTUAL_PREFIX)) return null
  const resource = virtualId.slice(NATIVE_DEV_APP_RUNTIME_VIRTUAL_PREFIX.length)

  if (resource === "react") {
    return `${bridgePrelude("react")}
export default api;
${namedExports(REACT_EXPORTS)}
`
  }
  if (resource === "jsx-runtime") {
    return `${bridgePrelude("jsxRuntime")}
export const Fragment = api.Fragment;
export const jsx = api.jsx;
export const jsxs = api.jsxs;
`
  }
  if (resource === "jsx-dev-runtime") {
    return `${bridgePrelude("jsxDevRuntime")}
export const Fragment = api.Fragment;
export const jsxDEV = api.jsxDEV;
`
  }
  if (resource === "native") {
    return `${bridgePrelude("nativeApi")}
export const NATIVE_DEV_APP_DEFINITION_KIND = api.NATIVE_DEV_APP_DEFINITION_KIND;
export const NativeDevAppHostProvider = api.NativeDevAppHostProvider;
export const defineNativeDevApp = api.defineNativeDevApp;
export const isNativeDevAppDefinition = api.isNativeDevAppDefinition;
export const useDevAppContext = api.useDevAppContext;
`
  }
  if (resource === "ui") {
    return `${bridgePrelude("uiApi")}
export const DEV_APP_UI_API_VERSION = api.DEV_APP_UI_API_VERSION;
export const Button = api.Button;
export const EmptyState = api.EmptyState;
export const Input = api.Input;
export const Panel = api.Panel;
export const PanelToolbar = api.PanelToolbar;
`
  }
  return null
}
