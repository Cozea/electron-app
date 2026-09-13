#!/usr/bin/env node
/**
 * Checkpoint PH2-B/PH2-C: drive a real main-owned WebContentsView under Electron.
 *
 * Compiles the browser services to CommonJS in a temp directory, then runs
 * tests/browser/nativeSurfaceSmoke.cjs with the Electron binary. Kept out of
 * `bun run test` because it needs a display and a real Electron process.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-native-surface-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  return result.status ?? 1;
}

// process.exit() inside try would skip the finally below and leak the temp
// build directory, so the exit code is carried out and applied last.
let exitCode = 1;
try {
  // The type-only import of a path-aliased contracts module cannot resolve
  // without the app tsconfig, and is erased anyway; emit regardless.
  run("node_modules/.bin/tsc", [
    "--module", "commonjs",
    "--target", "es2022",
    "--moduleResolution", "node",
    "--skipLibCheck",
    "--esModuleInterop",
    "--outDir", outDir,
    "--rootDir", ".",
    "apps/desktop/electron/services/browser/BrowserSurfaceNativeHost.ts",
  ], { stdio: "ignore" });

  const entry = path.join(outDir, "apps/desktop/electron/services/browser/BrowserSurfaceNativeHost.js");
  if (!fs.existsSync(entry)) {
    console.error(`[smoke-native-browser-surface] compilation produced no output at ${entry}`);
  } else {
    exitCode = run("node_modules/.bin/electron", ["tests/browser/nativeSurfaceSmoke.cjs"], {
      env: { ...process.env, COZEA_NATIVE_SURFACE_BUILD: outDir },
    });
  }
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
process.exit(exitCode);
