import type { NativeApi } from "@cozea/assistant-contracts";

import { readConfiguredWsUrl } from "./desktopBridgeClient";
import { createWsNativeApi } from "./wsNativeApi";

function readCachedApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __cozeaCachedNativeApi?: NativeApi }).__cozeaCachedNativeApi;
}

const t3NativeApiOverlays = new Map<symbol, NativeApi>();
let t3NativeApiOverlay: NativeApi | null = null;

function latestT3NativeApiOverlay(): NativeApi | null {
  return Array.from(t3NativeApiOverlays.values()).at(-1) ?? null;
}

function syncT3NativeApiOverlay(): void {
  t3NativeApiOverlay = latestT3NativeApiOverlay();
  if (typeof window === "undefined") return;
  if (t3NativeApiOverlay) {
    (window as Window & { __cozeaCachedNativeApi?: NativeApi }).__cozeaCachedNativeApi =
      t3NativeApiOverlay;
    return;
  }
  delete (window as Window & { __cozeaCachedNativeApi?: NativeApi }).__cozeaCachedNativeApi;
}

/** Phase T5 — when T3 cutover is active, route NativeApi calls through T3 Effect RPC. */
export function registerT3NativeApiOverlay(owner: symbol, api: NativeApi | null): void {
  t3NativeApiOverlays.delete(owner);
  if (api) {
    t3NativeApiOverlays.set(owner, api);
  }
  syncT3NativeApiOverlay();
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
  const waitForNativeApi = async (): Promise<NativeApi> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10_000) {
      const activeApi = t3NativeApiOverlay ?? readNativeApi();
      if (activeApi) return activeApi;
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 25));
    }
    throw new Error("Native API did not become ready. Please retry in a moment");
  };

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
            return (...args: unknown[]) => {
              let cancelled = false;
              let unsubscribe: (() => void) | null = null;
              void waitForNativeApi()
                .then(async (api) => {
                  if (cancelled) return;
                  const namespace = (api as unknown as Record<string, unknown>)[prop] as Record<
                    string,
                    unknown
                  >;
                  const method = namespace?.[subProp];
                  if (typeof method !== "function") return;
                  const cleanup = await method.apply(namespace, args);
                  if (typeof cleanup !== "function") return;
                  if (cancelled) {
                    cleanup();
                  } else {
                    unsubscribe = cleanup;
                  }
                })
                .catch(() => undefined);
              return () => {
                cancelled = true;
                unsubscribe?.();
              };
            };
          }
          return async (...args: unknown[]) => {
            const api = await waitForNativeApi();
            const namespace = (api as unknown as Record<string, unknown>)[prop] as Record<
              string,
              unknown
            >;
            const method = namespace?.[subProp];
            if (typeof method !== "function") {
              throw new Error(`Native API method ${prop}.${subProp} is unavailable`);
            }
            return method.apply(namespace, args);
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
          return waitForNativeApi().then((api) => {
            const method = (api as unknown as Record<string, unknown>)[prop];
            if (typeof method !== "function") {
              throw new Error(`Native API method ${prop} is unavailable`);
            }
            return method.apply(api, args);
          });
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
