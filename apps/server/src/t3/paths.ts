import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const t3ModuleDir = path.dirname(fileURLToPath(import.meta.url));
/** apps/server/src/t3 → repo root (four levels up). */
export const REPO_ROOT = path.resolve(t3ModuleDir, "../../../..");
export const VENDOR_T3_ROOT = path.join(REPO_ROOT, "vendor/t3code");
export const VENDOR_T3_SERVER_PKG = path.join(VENDOR_T3_ROOT, "apps/server");
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
    major > 22 ||
    (major === 22 && minor >= 16) ||
    major >= 23;
  if (!ok) {
    throw new Error(
      `Node ${nodeVersion} cannot run T3 server (need >= 22.16, >= 23.11, or >= 24)`,
    );
  }
}
