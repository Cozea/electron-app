export function classifyChatMediaSource(
  source: string,
  cwd?: string,
): { kind: "direct" | "external" | "file" | "blocked"; value: string } {
  const value = source.trim();
  // Provider URLs are links, never automatic requests. A hostname/IP filter
  // cannot prevent redirects or DNS rebinding into the user's private network.
  if (/^https?:/i.test(value) || value.startsWith("//")) {
    try {
      const url = new URL(value.startsWith("//") ? `https:${value}` : value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password)
        return { kind: "blocked", value };
      return { kind: "external", value: url.href };
    } catch {
      return { kind: "blocked", value };
    }
  }
  if (/^(blob:|data:image\/|data:audio\/|data:video\/)/i.test(value))
    return { kind: "direct", value };
  if (!value || /^[#?]/.test(value)) return { kind: "blocked", value };
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      return {
        kind: "file",
        value: decodeURIComponent(
          url.hostname ? `//${url.hostname}${url.pathname}` : url.pathname,
        ).replace(/^\/([A-Za-z]:\/)/, "$1"),
      };
    } catch {
      return { kind: "blocked", value };
    }
  }
  let path: string;
  try {
    path = decodeURIComponent(value.split(/[?#]/)[0]!);
  } catch {
    path = value;
  }
  if (/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) return { kind: "file", value: path };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:|^~[\\/]/.test(path) || !cwd) return { kind: "blocked", value };
  return { kind: "file", value: `${cwd.replace(/[\\/]+$/, "")}/${path}` };
}

export function assetRefreshDelay(expiresAt: number, now = Date.now()): number {
  return Math.max(1000, Math.min(2_147_000_000, expiresAt - now - 30_000));
}

export function resolveSignedAssetUrl(baseUrl: string, relativeUrl: string): string {
  const base = new URL(baseUrl);
  const target = new URL(relativeUrl, base);
  if (target.origin !== base.origin || !/^https?:$/.test(target.protocol))
    throw new Error("Invalid asset URL origin");
  return target.toString();
}
