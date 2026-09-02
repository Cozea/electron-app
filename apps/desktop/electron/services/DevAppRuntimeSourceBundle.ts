import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  canonicalDevAppRuntimeJson,
  DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES,
} from "../../../../shared/devAppContainedRuntime";
import { partsForPublishedPackage, type DevAppParts } from "../../../../shared/devAppParts";
import {
  DEV_APP_MANIFEST_FILENAME,
  parseDevAppPackage,
  type DevAppPackage,
} from "../../../../shared/devAppPackage";
import { packDirectoryToZip } from "./orgDevAppZip";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".output",
  ".turbo",
  ".cache",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const SECRET_FILE = /^(?:\.env(?:\..*)?|.*\.(?:key|pem|p12|pfx))$/i;
const MAX_SOURCE_ENTRIES = 20_000;
const MAX_SOURCE_FILE_BYTES = 32 * 1024 * 1024;

export interface DevAppRuntimeSourceBundle {
  zip: Buffer;
  sourceDigest: string;
  packageManifestDigest: string;
  manifest: DevAppPackage;
  parts: DevAppParts;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function readManifest(projectRoot: string): DevAppPackage {
  const manifestPath = path.join(projectRoot, DEV_APP_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Published executable DevApps require cozea-devapp.json at the project root.");
  }
  const parsed = parseDevAppPackage(fs.readFileSync(manifestPath, "utf8"));
  if (!parsed.manifest) {
    throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  if (!parsed.manifest.worker && parsed.manifest.service?.runtimeKind !== "node") {
    throw new Error("The package has no executable part to build.");
  }
  return parsed.manifest;
}

function assertReproducibleBunProject(projectRoot: string): void {
  const packagePath = path.join(projectRoot, "package.json");
  const lockPath = path.join(projectRoot, "bun.lock");
  if (!fs.existsSync(packagePath) || !fs.existsSync(lockPath)) {
    throw new Error(
      "Contained DevApps require package.json and bun.lock. Run `bun install` in the project, then commit the lockfile.",
    );
  }
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    scripts?: Record<string, unknown>;
  };
  if (typeof packageJson.scripts?.build !== "string" || !packageJson.scripts.build.trim()) {
    throw new Error("Contained DevApps require a deterministic package.json build script.");
  }
}

function copySourceTree(sourceRoot: string, destinationRoot: string): void {
  let entries = 0;
  let bytes = 0;
  const stack: Array<{ source: string; destination: string }> = [
    { source: sourceRoot, destination: destinationRoot },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    fs.mkdirSync(current.destination, { recursive: true, mode: 0o700 });
    for (const entry of fs
      .readdirSync(current.source, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      if (SECRET_FILE.test(entry.name)) {
        throw new Error(`The central build source contains a prohibited secret file: ${entry.name}`);
      }
      const source = path.join(current.source, entry.name);
      const destination = path.join(current.destination, entry.name);
      const stats = fs.lstatSync(source);
      if (stats.isSymbolicLink()) {
        throw new Error("The central build source cannot contain symbolic links.");
      }
      if (stats.isDirectory()) {
        stack.push({ source, destination });
        continue;
      }
      if (!stats.isFile()) continue;
      entries += 1;
      bytes += stats.size;
      if (entries > MAX_SOURCE_ENTRIES || stats.size > MAX_SOURCE_FILE_BYTES) {
        throw new Error("The central build source exceeds its file limits.");
      }
      if (bytes > DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES) {
        throw new Error("The central build source exceeds 128 MB.");
      }
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, stats.mode & 0o111 ? 0o755 : 0o644);
    }
  }
}

/** Creates deterministic, secret-screened input for Cozea's central image builder. */
export function createDevAppRuntimeSourceBundle(projectRootInput: string): DevAppRuntimeSourceBundle {
  const projectRoot = fs.realpathSync.native(projectRootInput);
  const manifest = readManifest(projectRoot);
  assertReproducibleBunProject(projectRoot);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-devapp-source-"));
  try {
    copySourceTree(projectRoot, staging);
    const packed = packDirectoryToZip(staging, {
      maxCompressedBytes: DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES,
      maxExpandedBytes: DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES,
      maxEntries: MAX_SOURCE_ENTRIES,
      maxEntryBytes: MAX_SOURCE_FILE_BYTES,
      maxPathBytes: 512,
      maxCompressionRatio: 200,
    });
    return {
      zip: packed.zip,
      sourceDigest: packed.contentHash,
      packageManifestDigest: sha256(canonicalDevAppRuntimeJson(manifest)),
      manifest,
      parts: partsForPublishedPackage(manifest),
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
