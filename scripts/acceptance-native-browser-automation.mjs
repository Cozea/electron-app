#!/usr/bin/env node
/**
 * PH3-C and the lifecycle gates: drive the real T3BrowserSurfaceService -- the
 * real T3 preview manager, its Effect runtime and its Playwright locators --
 * against a real main-owned WebContentsView under Electron.
 *
 * The native smoke drives BrowserSurfaceNativeHost alone and stubs automation.
 * This drives the whole automation stack, so it proves T3 operates the exact
 * contents the user sees for every operation, not merely at registration.
 *
 * Bundled with esbuild rather than tsc because the service reaches into vendored
 * T3 TypeScript whose workspace packages export source. Kept out of
 * `bun run test` because it needs a display and a real Electron process.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-native-automation-"));
const bundle = path.join(outDir, "T3BrowserSurfaceService.cjs");

function loadEsbuild() {
  const store = path.join(root, "node_modules/.bun");
  const version = fs
    .readdirSync(store)
    .filter((entry) => /^esbuild@\d/.test(entry))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1);
  if (!version) throw new Error(`No esbuild package in ${store}`);
  return createRequire(import.meta.url)(path.join(store, version, "node_modules/esbuild"));
}

/**
 * Vite's `?raw` imports a file as its text. The vendored T3 runtime relies on it
 * to embed Playwright's injected script as a string and inject it into pages;
 * bundling that file as code instead would execute Playwright inside main at
 * load time, where it tries to locate its own package from a path that no
 * longer exists. Honour the semantics rather than route around them.
 */
const rawTextImports = {
  name: "vite-raw-as-text",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
      namespace: "raw-text",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw-text" }, async (args) => ({
      contents: await fs.promises.readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

// process.exit() inside try would skip the finally below and leak the temp
// bundle directory, so the exit code is carried out and applied last.
let exitCode = 1;
try {
  await loadEsbuild().build({
    entryPoints: [path.join(root, "apps/desktop/electron/services/T3BrowserSurfaceService.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: bundle,
    logLevel: "error",
    plugins: [rawTextImports],
    external: [
      "electron",
      // Optional native accelerators for `ws`. They locate themselves relative
      // to their own package, which a bundle breaks; ws falls back without them.
      "bufferutil",
      "utf-8-validate",
      // A native file watcher that browser-surface automation never reaches.
      "fsevents",
    ],
  });

  const pickPreload = path.join(root, "apps/desktop/out/preload/preview-pick-preload.cjs");
  const run = spawnSync(
    path.join(root, "node_modules/.bin/electron"),
    ["tests/browser/nativeBrowserAutomationAcceptance.cjs"],
    {
      cwd: root,
      stdio: "inherit",
      // A hard ceiling independent of the harness's own timer: if Electron is
      // stuck before that timer is armed, nothing else will ever end the run.
      timeout: 300_000,
      killSignal: "SIGKILL",
      env: {
        ...process.env,
        COZEA_T3_SERVICE_BUNDLE: bundle,
        COZEA_PICK_PRELOAD: fs.existsSync(pickPreload) ? pickPreload : "",
        COZEA_ACCEPTANCE_ARTIFACTS: path.join(outDir, "artifacts"),
        // Keep ws on its pure-JS paths so the externalised accelerators above
        // are never required.
        WS_NO_BUFFER_UTIL: "1",
        WS_NO_UTF_8_VALIDATE: "1",
      },
    },
  );
  if (run.error || run.signal) {
    console.error(
      `[acceptance-native-browser-automation] Electron did not finish: ${run.error?.code ?? run.signal}`,
    );
  } else {
    exitCode = run.status ?? 1;
  }
} catch (error) {
  console.error("[acceptance-native-browser-automation] bundling the service failed:", error);
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
process.exit(exitCode);
