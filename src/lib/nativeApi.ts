// @ts-nocheck
import type { NativeApi } from "@cozea/assistant-contracts";

import { readConfiguredWsUrl } from "./desktopBridgeClient";
import { createWsNativeApi } from "./wsNativeApi";

function readCachedApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __cozeaCachedNativeApi?: NativeApi }).__cozeaCachedNativeApi;
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

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}
