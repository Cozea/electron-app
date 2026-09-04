import fs from "node:fs";
import contractManifest from "../../../../packages/contracts/src/t3/SYNC_MANIFEST.json";
import path from "node:path";
import { fileURLToPath } from "node:url";

const t3ModuleDir = path.dirname(fileURLToPath(import.meta.url));
/** apps/server/src/t3 → repo root (four levels up). */
export const REPO_ROOT = path.resolve(t3ModuleDir, "../../../..");
export const VENDOR_T3_ROOT = path.join(REPO_ROOT, "vendor/t3code");

interface ResolveT3RuntimeRootOptions {
  readonly explicitRoot?: string;
  readonly resourcesPath?: string;
  readonly exists?: (candidate: string) => boolean;
}

export function resolveT3RuntimeRoot(options: ResolveT3RuntimeRootOptions = {}): string | null {
  const explicitRoot = options.explicitRoot?.trim();
  if (explicitRoot) return explicitRoot;

  const resourcesPath = options.resourcesPath?.trim();
  if (!resourcesPath) return null;
  const candidate = path.join(resourcesPath, "t3-runtime");
  const exists = options.exists ?? fs.existsSync;
  return exists(path.join(candidate, "dist/bin.mjs")) ? candidate : null;
}

export const T3_RUNTIME_ROOT = resolveT3RuntimeRoot({
  explicitRoot: process.env.COZEA_T3_RUNTIME_ROOT,
  resourcesPath: typeof process.resourcesPath === "string" ? process.resourcesPath : undefined,
});
export const VENDOR_T3_SERVER_PKG = T3_RUNTIME_ROOT ?? path.join(VENDOR_T3_ROOT, "apps/server");
export const VENDOR_T3_SERVER_BIN = path.join(VENDOR_T3_SERVER_PKG, "dist/bin.mjs");

export const DEFAULT_T3_SERVER_HOST = "127.0.0.1";
export const DEFAULT_T3_SERVER_PORT = 13_773;

export function vendorT3ServerBinExists(): boolean {
  return fs.existsSync(VENDOR_T3_SERVER_BIN);
}

export function assertNodeVersionForT3Server(nodeVersion: string = process.version): void {
  const match = /^v?(\d+)\.(\d+)\./.exec(nodeVersion.trim());
  if (!match) {
    throw new Error(`Unrecognized Node version: ${nodeVersion}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const ok =
    major > 24 ||
    (major === 24 && minor >= 10) ||
    (major === 23 && minor >= 11) ||
    (major === 22 && minor >= 16);
  if (!ok) {
    throw new Error(
      `Node ${nodeVersion} cannot run T3 server (need ^22.16, ^23.11, or >=24.10)`,
    );
  }
}

/** Refuse mixed client/runtime installations before opening persisted state. */
export function assertT3RuntimeIdentity(
  runtimeRoot: string = VENDOR_T3_SERVER_PKG,
  expectedPin: string = contractManifest.pin,
): void {
  const metadataPath = path.join(runtimeRoot, "cozea-runtime.json");
  let actual: unknown;
  try {
    if (fs.existsSync(metadataPath)) {
      const metadata: unknown = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      actual = metadata && typeof metadata === "object" && "t3Pin" in metadata
        ? metadata.t3Pin : undefined;
    } else {
      actual = fs.readFileSync(path.join(runtimeRoot, "dist", ".cozea-runtime-pin"), "utf8").trim().split(":")[0];
    }
  } catch {
    actual = undefined;
  }
  if (actual !== expectedPin) {
    throw new Error("Cozea's provider runtime does not match this app. Reinstall the matching app build, or run bun run prepare:t3-runtime in this checkout. Conversation data has not been opened.");
  }
}
