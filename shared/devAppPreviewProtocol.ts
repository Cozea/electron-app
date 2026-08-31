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
