import * as React from "react"
import * as jsxRuntime from "react/jsx-runtime"
import * as jsxDevRuntime from "react/jsx-dev-runtime"

import * as nativeApi from "../../../../../../packages/devapp-api/src/native"
import * as uiApi from "../../../../../../packages/devapp-api/src/ui"
import {
  NATIVE_DEV_APP_RUNTIME_BRIDGE_KEY,
  NATIVE_DEV_APP_RUNTIME_BRIDGE_VERSION,
  type NativeDevAppRuntimeBridgeShape,
} from "@shared/nativeDevAppRuntime"

function frozenNamespace(value: object): Record<string, unknown> {
  return Object.freeze({ ...value }) as Record<string, unknown>
}

export function createNativeDevAppRuntimeBridge(): NativeDevAppRuntimeBridgeShape {
  return Object.freeze({
    version: NATIVE_DEV_APP_RUNTIME_BRIDGE_VERSION,
    react: frozenNamespace(React),
    jsxRuntime: frozenNamespace(jsxRuntime),
    jsxDevRuntime: frozenNamespace(jsxDevRuntime),
    nativeApi: frozenNamespace(nativeApi),
    uiApi: frozenNamespace(uiApi),
  })
}

/**
 * Installs one immutable bridge before any native DevApp module is evaluated.
 * Virtual proxy modules bundled by the builder resolve hooks and contexts through this object,
 * guaranteeing that extensions share Cozea's exact React runtime.
 */
export function installNativeDevAppRuntimeBridge(): NativeDevAppRuntimeBridgeShape {
  const symbol = Symbol.for(NATIVE_DEV_APP_RUNTIME_BRIDGE_KEY)
  const existing = Reflect.get(globalThis, symbol) as NativeDevAppRuntimeBridgeShape | undefined
  if (existing) {
    if (existing.version !== NATIVE_DEV_APP_RUNTIME_BRIDGE_VERSION) {
      throw new Error("A different native DevApp runtime bridge version is already installed.")
    }
    return existing
  }

  const bridge = createNativeDevAppRuntimeBridge()
  const installed = Reflect.defineProperty(globalThis, symbol, {
    value: bridge,
    configurable: false,
    enumerable: false,
    writable: false,
  })
  if (!installed) throw new Error("Could not install the native DevApp runtime bridge.")
  return bridge
}
