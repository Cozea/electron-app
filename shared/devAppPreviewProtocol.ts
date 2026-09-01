import { normalizeEntryPath, ORG_DEVAPP_PROTOCOL } from "./orgDevAppProtocol";

export const DEV_APP_PREVIEW_HOST_SUFFIX = ".dev";

export function isDevAppPreviewSourceId(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value.trim().toLowerCase());
}

export function buildDevAppPreviewUrl(sourceIdInput: string, entryPath?: string): string {
  const sourceId = sourceIdInput.trim().toLowerCase();
  if (!isDevAppPreviewSourceId(sourceId)) {
    throw new Error("The DevApp preview source id is invalid.");
  }
  return `${ORG_DEVAPP_PROTOCOL}//${sourceId}${DEV_APP_PREVIEW_HOST_SUFFIX}/${normalizeEntryPath(entryPath)}`;
}

export function parseDevAppPreviewUrl(value: string): {
  sourceId: string;
  assetPath: string;
} | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== ORG_DEVAPP_PROTOCOL) return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith(DEV_APP_PREVIEW_HOST_SUFFIX)) return null;
  const sourceId = hostname.slice(0, -DEV_APP_PREVIEW_HOST_SUFFIX.length);
  if (!isDevAppPreviewSourceId(sourceId)) return null;
  return {
    sourceId,
    assetPath: normalizeEntryPath(parsed.pathname.replace(/^\/+/, "") || "index.html"),
  };
}

export type DevAppPreviewNavigationDecision =
  | { allowed: true; reason: "same-preview" | "same-dev-origin" }
  | { allowed: false; reason: "external-https" | "blocked" };

/** Keeps a development preload inside the package view it was prepared for. */
export function evaluateDevAppPreviewNavigation(
  initialUrl: string,
  targetUrl: string,
): DevAppPreviewNavigationDecision {
  const preview = parseDevAppPreviewUrl(initialUrl);
  if (preview) {
    const targetPreview = parseDevAppPreviewUrl(targetUrl);
    if (targetPreview?.sourceId === preview.sourceId) {
      return { allowed: true, reason: "same-preview" };
    }
    return isHttps(targetUrl)
      ? { allowed: false, reason: "external-https" }
      : { allowed: false, reason: "blocked" };
  }

  try {
    const initial = new URL(initialUrl);
    const target = new URL(targetUrl);
    if (
      initial.protocol === "http:" &&
      target.protocol === "http:" &&
      target.origin === initial.origin
    ) {
      return { allowed: true, reason: "same-dev-origin" };
    }
    return target.protocol === "https:"
      ? { allowed: false, reason: "external-https" }
      : { allowed: false, reason: "blocked" };
  } catch {
    return { allowed: false, reason: "blocked" };
  }
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
