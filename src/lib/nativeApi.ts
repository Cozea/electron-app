// @ts-nocheck
import type { NativeApi } from "@cozea/assistant-contracts";

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

function readExplicitWebFallbackUrl(): string | null {
  const rawUrl = import.meta.env.VITE_WS_URL;
  if (typeof rawUrl !== "string") {
    return null;
  }

  const trimmed = rawUrl.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  const cachedApi = readCachedApi();
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    return writeCachedApi(window.nativeApi);
  }

  const desktopWsUrl = window.desktopBridge?.getWsUrl?.();
  if (desktopWsUrl) {
    return writeCachedApi(createWsNativeApi(desktopWsUrl));
  }

  const explicitWebFallbackUrl = readExplicitWebFallbackUrl();
  if (explicitWebFallbackUrl) {
    return writeCachedApi(createWsNativeApi(explicitWebFallbackUrl));
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
