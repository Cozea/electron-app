// @ts-nocheck
import type { NativeApi } from "@cozea/assistant-contracts";

import { createWsNativeApi } from "./wsNativeApi";

let cachedApi: NativeApi | undefined;

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
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  const desktopWsUrl = window.desktopBridge?.getWsUrl?.();
  if (desktopWsUrl) {
    cachedApi = createWsNativeApi(desktopWsUrl);
    return cachedApi;
  }

  const explicitWebFallbackUrl = readExplicitWebFallbackUrl();
  if (explicitWebFallbackUrl) {
    cachedApi = createWsNativeApi(explicitWebFallbackUrl);
    return cachedApi;
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
