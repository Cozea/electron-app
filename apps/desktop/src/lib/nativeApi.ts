import type { NativeApi } from "@cozea/assistant-contracts";

import { readConfiguredWsUrl } from "./desktopBridgeClient";
import { createWsNativeApi } from "./wsNativeApi";

function readCachedApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __cozeaCachedNativeApi?: NativeApi }).__cozeaCachedNativeApi;
}

let t3NativeApiOverlay: NativeApi | null = null;

/** Phase T5 — when T3 cutover is active, route NativeApi calls through T3 Effect RPC. */
export function registerT3NativeApiOverlay(api: NativeApi | null): void {
  t3NativeApiOverlay = api;
  if (typeof window !== "undefined") {
    if (api) {
      (window as Window & { __cozeaCachedNativeApi?: NativeApi }).__cozeaCachedNativeApi = api;
    } else {
      delete (window as Window & { __cozeaCachedNativeApi?: NativeApi }).__cozeaCachedNativeApi;
    }
  }
}

function writeCachedApi(api: NativeApi): NativeApi {
  if (typeof window !== "undefined") {
    (window as Window & { __cozeaCachedNativeApi?: NativeApi }).__cozeaCachedNativeApi = api;
  }
  return api;
}

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  const cachedApi = readCachedApi();
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    return writeCachedApi(window.nativeApi);
  }

  const configuredWsUrl = readConfiguredWsUrl();
  if (configuredWsUrl) {
    return writeCachedApi(createWsNativeApi(configuredWsUrl));
  }

  return undefined;
}

function createDeferredNativeApi(): NativeApi {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (t3NativeApiOverlay) {
        return (t3NativeApiOverlay as unknown as Record<string, unknown>)[prop];
      }
      const current = readNativeApi();
      if (current) {
        return (current as unknown as Record<string, unknown>)[prop];
      }
      return new Proxy(() => {}, {
        get(_subTarget, subProp: string) {
          if (t3NativeApiOverlay) {
            return ((t3NativeApiOverlay as unknown as Record<string, unknown>)[prop] as Record<string, unknown>)?.[subProp];
          }
          const activeApi = readNativeApi();
          if (activeApi) {
            return ((activeApi as unknown as Record<string, unknown>)[prop] as Record<string, unknown>)?.[subProp];
          }
          if (subProp.startsWith("on") || subProp.startsWith("subscribe")) {
            return () => () => {};
          }
          return async () => {
            if (t3NativeApiOverlay) {
              const method = ((t3NativeApiOverlay as unknown as Record<string, unknown>)[prop] as Record<string, Function>)?.[subProp];
              if (method) return method();
            }
            throw new Error("Native API is connecting, please retry in a moment");
          };
        },
        apply(_fn, _thisArg, args) {
          if (t3NativeApiOverlay) {
            return ((t3NativeApiOverlay as unknown as Record<string, unknown>)[prop] as Function)(...args);
          }
          const activeApi = readNativeApi();
          if (activeApi) {
            return ((activeApi as unknown as Record<string, unknown>)[prop] as Function)(...args);
          }
          return async () => {
            throw new Error("Native API is connecting, please retry in a moment");
          };
        },
      });
    },
  };
  return new Proxy({} as unknown as Record<string, unknown>, handler) as unknown as NativeApi;
}

export function ensureNativeApi(): NativeApi {
  if (t3NativeApiOverlay) {
    return t3NativeApiOverlay;
  }
  const api = readNativeApi();
  if (api) {
    return api;
  }
  return createDeferredNativeApi();
}
