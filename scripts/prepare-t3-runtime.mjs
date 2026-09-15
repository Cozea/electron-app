#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchComputerUseContract } from "./patch-computer-use-contract.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
export const vendorRoot = path.join(repositoryRoot, "vendor", "t3code");
export const serverRoot = path.join(vendorRoot, "apps", "server");
export const serverBundle = path.join(serverRoot, "dist", "bin.mjs");
export const bundlePinStamp = path.join(serverRoot, "dist", ".cozea-runtime-pin");
export const packagedRuntimeRoot = path.join(repositoryRoot, "build", "t3-runtime");

const COZEA_PROVIDER_DEFAULT_PATCHES = [
  {
    label: "Cursor default enablement",
    original:
      'const CursorSettings = makeProviderSettingsSchema({\n\tenabled: Boolean$1.pipe(withDecodingDefault(succeed$1(false)), annotateKey({ providerSettingsForm: { hidden: true } })),',
    patched:
      'const CursorSettings = makeProviderSettingsSchema({\n\tenabled: Boolean$1.pipe(withDecodingDefault(succeed$1(true)), annotateKey({ providerSettingsForm: { hidden: true } })),',
  },
  {
    label: "OpenCode default enablement",
    original:
      'const OpenCodeSettings = makeProviderSettingsSchema({\n\tenabled: Boolean$1.pipe(withDecodingDefault(succeed$1(false)), annotateKey({ providerSettingsForm: { hidden: true } })),',
    patched:
      'const OpenCodeSettings = makeProviderSettingsSchema({\n\tenabled: Boolean$1.pipe(withDecodingDefault(succeed$1(true)), annotateKey({ providerSettingsForm: { hidden: true } })),',
  },
  {
    label: "Cursor sparse-settings default",
    original: 'enabled: persisted.providers?.cursor?.enabled ?? usedProviders.has("cursor")',
    patched: 'enabled: persisted.providers?.cursor?.enabled ?? settings.providers.cursor.enabled',
  },
  {
    label: "OpenCode sparse-settings default",
    original: 'enabled: persisted.providers?.opencode?.enabled ?? usedProviders.has("opencode")',
    patched:
      'enabled: persisted.providers?.opencode?.enabled ?? settings.providers.opencode.enabled',
  },
];

const COZEA_PROVIDER_UPDATE_PATCHES = [
  {
    label: "npm updater accepts the selected installation prefix",
    original: "function makeNpmGlobalProviderMaintenanceCapabilities(definition) {",
    patched: "function makeNpmGlobalProviderMaintenanceCapabilities(definition, prefix = null) {",
  },
  {
    label: "npm updater targets the selected installation prefix",
    original:
      '\t\t\t"-g",\n\t\t\t`--allow-scripts=${definition.npmPackageName}`,',
    patched:
      '\t\t\t"-g",\n\t\t\t...prefix ? [`--prefix=${prefix}`] : [],\n\t\t\t`--allow-scripts=${definition.npmPackageName}`,',
  },
  {
    label: "npm global-prefix inference",
    original: `function normalizeCommandPath(commandPath) {
\treturn commandPath.replaceAll("\\\\", "/").toLowerCase();
}
function isBunGlobalCommandPath(commandPath) {`,
    patched: `function normalizeCommandPath(commandPath) {
\treturn commandPath.replaceAll("\\\\", "/").toLowerCase();
}
function npmGlobalPrefixFromCommandPath(commandPath) {
\tconst normalized = normalizeCommandPath(commandPath);
\tconst posixMarker = "/lib/node_modules/";
\tconst posixIndex = normalized.indexOf(posixMarker);
\tif (posixIndex > 0) return commandPath.slice(0, posixIndex);
\tconst windowsMarker = "/npm/node_modules/";
\tconst windowsIndex = normalized.indexOf(windowsMarker);
\tif (windowsIndex > 0) return commandPath.slice(0, windowsIndex + "/npm".length);
\treturn null;
}
function isBunGlobalCommandPath(commandPath) {`,
  },
  {
    label: "resolved npm installation takes precedence over launcher shape",
    original: `\t\tconst commandPaths = [resolvedCommandPath, ...options?.realCommandPath ? [options.realCommandPath] : []];
\t\tconst nativeUpdate = definition.nativeUpdate;`,
    patched: `\t\tconst commandPaths = [resolvedCommandPath, ...options?.realCommandPath ? [options.realCommandPath] : []];
\t\tconst npmCommandPath = [options?.realCommandPath, resolvedCommandPath].filter(Boolean).find(isNpmGlobalCommandPath);
\t\tif (npmCommandPath) return makeNpmGlobalProviderMaintenanceCapabilities(definition, npmGlobalPrefixFromCommandPath(npmCommandPath));
\t\tconst nativeUpdate = definition.nativeUpdate;`,
  },
  {
    label: "provider update result uses Cozea-neutral copy",
    original:
      'message: couldNotVerify ? "Update command completed, but T3 Code could not verify the provider version." : stillOutdated ? "Update command completed, but T3 Code still detects an outdated provider version." : "Provider updated.",',
    patched:
      'message: couldNotVerify ? "Update completed, but the installed version could not be verified." : stillOutdated ? "Update completed, but the selected installation is still out of date." : "Provider updated.",',
  },
];

function fail(message) {
  throw new Error(`[prepare-t3-runtime] ${message}`);
}

export function patchT3ServerBundleProviderDefaults(source) {
  let patchedSource = source;
  let changed = false;

  for (const patch of COZEA_PROVIDER_DEFAULT_PATCHES) {
    if (patchedSource.includes(patch.patched)) {
      continue;
    }
    if (!patchedSource.includes(patch.original)) {
      fail(`${patch.label} patch anchor is missing; refresh the Cozea T3 runtime patch.`);
    }
    patchedSource = patchedSource.replace(patch.original, patch.patched);
    changed = true;
  }

  return { source: patchedSource, changed };
}

export function patchT3ServerBundleProviderUpdates(source) {
  let patchedSource = source;
  let changed = false;

  for (const patch of COZEA_PROVIDER_UPDATE_PATCHES) {
    if (patchedSource.includes(patch.patched)) {
      continue;
    }
    if (!patchedSource.includes(patch.original)) {
      fail(`${patch.label} patch anchor is missing; refresh the Cozea T3 runtime patch.`);
    }
    patchedSource = patchedSource.replace(patch.original, patch.patched);
    changed = true;
  }

  return { source: patchedSource, changed };
}

export function patchT3ComputerUseSource({
  checkOnly = false,
  sourcePath = path.join(serverRoot, "src", "mcp", "toolkits", "computerUse.ts"),
} = {}) {
  if (!fs.existsSync(sourcePath)) {
    if (checkOnly) fail("Computer Use source is missing; prepare the pinned T3 checkout first.");
    return false;
  }
  const originalCode = fs.readFileSync(sourcePath, "utf8");
  let code = patchComputerUseContract(originalCode).source;

  if (!code.includes('import * as Cause')) {
    code = 'import * as Cause from "effect/Cause";\n' + code;
  }
  code = code.replace(
    /Effect\.catchAll\(\(error\)\s*=>\s*Effect\.logWarning\("Computer Use turn-end notification failed",\s*\{\s*threadId,\s*error:\s*error\.message,\s*\}\),\s*\)/g,
    'Effect.catchCause((cause) =>\n      Effect.logWarning("Computer Use turn-end notification failed", {\n        threadId,\n        error: Cause.pretty(cause),\n      }),\n    )',
  );
  code = code.replace(
    /Effect\.catchAll\(\(error\)\s*=>\s*Effect\.succeed\(backendFailure\(error\.message\s*\|\|\s*"Computer Use failed\."\)\),\s*\)/g,
    'Effect.catchCause((cause) => {\n                const error = Cause.squash(cause);\n                const message = error instanceof Error ? error.message : String(error);\n                return Effect.succeed(backendFailure(message || "Computer Use failed."));\n              })',
  );

  // The T3 backend call must outlive the Electron broker's 35s action budget
  // (CALL_TIMEOUT_MS) so the broker's authoritative timeout wins over a
  // client-side fetch abort. The turn-ended call keeps its own shorter budget.
  const timeoutMatches = code.match(/AbortSignal\.timeout\(30_000\)/g) ?? [];
  if (timeoutMatches.length > 1) fail('Computer Use backend timeout anchor is ambiguous; review the T3 pin.');
  if (timeoutMatches.length === 1) {
    code = code.replace('AbortSignal.timeout(30_000)', 'AbortSignal.timeout(40_000)');
  }

  if (code === originalCode) return false;
  if (checkOnly) fail("Computer Use source is stale; run preparation without --check to apply the v2 contract.");
  fs.writeFileSync(sourcePath, code);
  console.log("[prepare-t3-runtime] Patched Cozea Computer Use v2 contract and Effect compatibility.");
  return true;
}

const COZEA_COMPUTER_USE_TEST_PATCHES = [
  {
    label: "vendor test names the canonical contract",
    original: 'it("mirrors the pinned open-computer-use v0.3.3 tool surface", () => {',
    patched: 'it("mirrors the canonical Cozea computer-use tool surface", () => {',
  },
  {
    label: "vendor test tolerates catalogue ordering",
    original:
      "  expect(COMPUTER_USE_TOOLS.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);",
    patched:
      "  expect(COMPUTER_USE_TOOLS.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);",
  },
  {
    label: "vendor test matches v2 mutation annotations",
    original: 'it("keeps state discovery read-only and actions non-open-world", () => {',
    patched: 'it("keeps state discovery read-only and marks actions destructive", () => {',
  },
  {
    label: "vendor test asserts v2 annotation values",
    original: `  for (const name of EXPECTED_TOOLS) {
    expect(byName.get(name)?.annotations.openWorldHint).toBe(false);
    expect(byName.get(name)?.annotations.destructiveHint).toBe(false);
  }`,
    patched: `  for (const name of EXPECTED_TOOLS) {
    const annotations = byName.get(name)?.annotations;
    if (name === "list_apps" || name === "get_app_state") {
      expect(annotations?.readOnlyHint).toBe(true);
      expect(annotations?.destructiveHint).toBe(false);
      expect(annotations?.openWorldHint).toBe(false);
    } else {
      expect(annotations?.readOnlyHint).toBe(false);
      expect(annotations?.destructiveHint).toBe(true);
      expect(annotations?.openWorldHint).toBe(true);
    }
  }`,
  },
  {
    label: "vendor test matches the v2 click_method enum",
    original: `  expect(properties?.click_method?.enum).toEqual([
    "auto",
    "accessibility",
    "app_post",
    "sky_click",
    "global",
  ]);`,
    patched: `  expect(properties?.click_method?.enum).toEqual(["auto", "global"]);`,
  },
];

export function patchT3ComputerUseTest({
  checkOnly = false,
  sourcePath = path.join(serverRoot, "src", "mcp", "toolkits", "computerUse.test.ts"),
} = {}) {
  if (!fs.existsSync(sourcePath)) {
    if (checkOnly) fail("Computer Use test source is missing; prepare the pinned T3 checkout first.");
    return false;
  }
  let code = fs.readFileSync(sourcePath, "utf8");
  const originalCode = code;
  for (const patch of COZEA_COMPUTER_USE_TEST_PATCHES) {
    if (code.includes(patch.patched)) continue;
    if (!code.includes(patch.original)) {
      fail(`${patch.label} patch anchor is missing; refresh the Cozea T3 runtime patch.`);
    }
    code = code.replace(patch.original, patch.patched);
  }
  if (code === originalCode) return false;
  if (checkOnly) fail("Computer Use test source is stale; run preparation without --check to apply the v2 contract.");
  fs.writeFileSync(sourcePath, code);
  console.log("[prepare-t3-runtime] Patched Cozea Computer Use v2 test expectations.");
  return true;
}

export function patchT3ServerBundleComputerUse(source) {
  let patchedSource = source;
  let changed = false;

  const patterns = [
    {
      target: ".pipe(map$5(toMcpResult), (void 0)((error) =>",
      replacement: ".pipe(map$5(toMcpResult), catchCause((cause) => { const error = squash(cause); const message = error instanceof Error ? error.message : String(error); return succeed$1(backendFailure(message || 'Computer Use failed.')); })",
    },
    {
      target: ".pipe(map$5(toMcpResult), (void 0)((error =>",
      replacement: ".pipe(map$5(toMcpResult), catchCause((cause) => { const error = squash(cause); const message = error instanceof Error ? error.message : String(error); return succeed$1(backendFailure(message || 'Computer Use failed.')); })",
    },
    {
      target: ".pipe((void 0)((error) => logWarning$1(",
      replacement: ".pipe(catchCause((cause) => logWarning$1(",
    },
    {
      target: ".pipe((void 0)((error => logWarning$1(",
      replacement: ".pipe(catchCause((cause) => logWarning$1(",
    },
  ];

  for (const { target, replacement } of patterns) {
    if (patchedSource.includes(target)) {
      patchedSource = patchedSource.replaceAll(target, replacement);
      changed = true;
    }
  }

  return { source: patchedSource, changed };
}

export function patchT3ServerBundleUpstreamBug(source) {
  const target = "\tprojectQuestionToolInput(data, payload.title);\n";
  if (!source.includes(target)) {
    return { source, changed: false };
  }
  return {
    source: source.replace(target, ""),
    changed: true,
  };
}

function applyCozeaT3RuntimePatches({ checkOnly }) {
  const source = fs.readFileSync(serverBundle, "utf8");
  const providerDefaults = patchT3ServerBundleProviderDefaults(source);
  const providerUpdates = patchT3ServerBundleProviderUpdates(providerDefaults.source);
  const mediaContainment = patchT3ServerBundleMediaContainment(providerUpdates.source);
  const compatibility = patchT3ServerBundleComputerUse(mediaContainment.source);
  const contract = patchComputerUseContract(compatibility.source);
  const upstreamBug = patchT3ServerBundleUpstreamBug(contract.source);
  const computerUse = {
    source: upstreamBug.source,
    changed: compatibility.changed || contract.changed || upstreamBug.changed,
  };
  const changed =
    providerDefaults.changed ||
    providerUpdates.changed ||
    mediaContainment.changed ||
    computerUse.changed;
  if (checkOnly && changed) {
    fail("T3 server bundle is missing a Cozea runtime patch.");
  }
  if (!checkOnly && changed) {
    fs.writeFileSync(serverBundle, computerUse.source);
    console.log("[prepare-t3-runtime] Applied Cozea policies to the T3 bundle.");
  }
}

export function patchT3ServerBundleMediaContainment(source) {
  const original = `\t\tcase "media-file": {
\t\t\tlet requestedPath = input.resource.path;
\t\t\tif (!path.isAbsolute(requestedPath)) {
\t\t\t\tif (!input.workspaceRoot) return yield* new AssetWorkspaceContextNotFoundError({ resource: input.resource });
\t\t\t\tconst workspaceRoot = yield* workspacePaths.normalizeWorkspaceRoot(input.workspaceRoot).pipe(mapError((cause) => new AssetWorkspaceRootNormalizationError({
\t\t\t\t\tresource: input.resource,
\t\t\t\t\tcause
\t\t\t\t})));
\t\t\t\trequestedPath = path.resolve(workspaceRoot, requestedPath);
\t\t\t}
\t\t\tconst canonicalFile = yield* resolveCanonicalFile(requestedPath).pipe(mapError((cause) => new AssetWorkspaceAssetInspectionError({`;
  const patched = `\t\tcase "media-file": {
\t\t\t// Cozea: generic media stays inside its bound workspace.
\t\t\tif (!input.workspaceRoot) return yield* new AssetWorkspaceContextNotFoundError({ resource: input.resource });
\t\t\tconst workspaceRoot = yield* workspacePaths.normalizeWorkspaceRoot(input.workspaceRoot).pipe(mapError((cause) => new AssetWorkspaceRootNormalizationError({
\t\t\t\tresource: input.resource,
\t\t\t\tcause
\t\t\t})));
\t\t\tconst relativePath = path.isAbsolute(input.resource.path) ? path.relative(workspaceRoot, input.resource.path) : input.resource.path;
\t\t\tconst canonicalFile = yield* resolveCanonicalWorkspaceFile({ workspaceRoot, relativePath }).pipe(mapError((cause) => new AssetWorkspaceAssetInspectionError({`;
  const originalCount = source.split(original).length - 1;
  const patchedCount = source.split(patched).length - 1;
  if (originalCount === 0 && patchedCount === 1) return { source, changed: false };
  if (originalCount !== 1 || patchedCount !== 0) {
    fail("Media containment patch anchor is missing or ambiguous; refresh the Cozea T3 runtime patch.");
  }
  return { source: source.replace(original, patched), changed: true };
}

const removableDeploySelfLink = path.join("node_modules", "pnpm-store", "node_modules", "t3");

export function sanitizePortableRuntimeSymlinks(runtimeRoot) {
  const resolvedRoot = path.resolve(runtimeRoot);
  const removed = [];

  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = path.resolve(path.dirname(entryPath), fs.readlinkSync(entryPath));
        const targetIsInternal =
          target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`);
        if (targetIsInternal) continue;

        const relativePath = path.relative(resolvedRoot, entryPath);
        if (relativePath === removableDeploySelfLink) {
          fs.unlinkSync(entryPath);
          removed.push(relativePath);
          continue;
        }
        fail(`Portable T3 deployment contains an external symlink: ${relativePath} -> ${target}`);
      }
      if (entry.isDirectory()) visit(entryPath);
    }
  };

  visit(resolvedRoot);
  return removed;
}

export function prunePackagedRuntimeArtifacts(runtimeRoot, options = {}) {
  const targetPlatform = options.platform ?? process.platform;
  const targetArch = options.arch ?? process.arch;
  const removed = [];

  const nodeModulesRoot = path.join(runtimeRoot, "node_modules");
  const pnpmStoreRoot = path.join(nodeModulesRoot, "pnpm-store");
  if (!fs.existsSync(pnpmStoreRoot)) {
    return removed;
  }

  const pruneDirectory = (dirPath) => {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      removed.push(path.relative(runtimeRoot, dirPath));
    }
  };

  // 1. Prune unused native prebuilds in node-pty.
  // On darwin, win32-arm64 and win32-x64 prebuilds account for ~58 MB of unused Windows binaries.
  const removeUnusedPrebuilds = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "prebuilds" && entryPath.includes("node-pty")) {
          if (targetPlatform === "darwin") {
            pruneDirectory(path.join(entryPath, "win32-arm64"));
            pruneDirectory(path.join(entryPath, "win32-x64"));
          } else if (targetPlatform === "win32") {
            pruneDirectory(path.join(entryPath, "darwin-arm64"));
            pruneDirectory(path.join(entryPath, "darwin-x64"));
          }
        } else {
          removeUnusedPrebuilds(entryPath);
        }
      }
    }
  };
  removeUnusedPrebuilds(nodeModulesRoot);

  // 2. Prune unused foreign OS packages in pnpm-store:
  // e.g. @ff-labs+fff-bin-*, @yuuang+ffi-rs-*, @msgpackr-extract+msgpackr-extract-*
  const isForeignPackage = (name) => {
    if (targetPlatform === "darwin") {
      if (name.includes("linux-") || name.includes("win32-")) return true;
      if (targetArch === "arm64" && options.dropOtherArch && name.includes("darwin-x64")) {
        return true;
      }
    } else if (targetPlatform === "linux") {
      if (name.includes("darwin-") || name.includes("win32-")) return true;
    } else if (targetPlatform === "win32") {
      if (name.includes("darwin-") || name.includes("linux-")) return true;
    }
    return false;
  };

  for (const entry of fs.readdirSync(pnpmStoreRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(pnpmStoreRoot, entry.name);
    if (isForeignPackage(entry.name)) {
      pruneDirectory(pkgDir);
    }
  }

  // 3. Clean up broken symlinks resulting from removed optional foreign packages
  const removeBrokenSymlinks = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          fs.statSync(entryPath);
        } catch {
          fs.unlinkSync(entryPath);
          removed.push(path.relative(runtimeRoot, entryPath));
        }
        continue;
      }
      if (entry.isDirectory()) {
        removeBrokenSymlinks(entryPath);
      }
    }
  };
  removeBrokenSymlinks(nodeModulesRoot);

  return removed;
}

export function parseGitlink(output) {
  const match = /^160000 commit ([0-9a-f]{40})\tvendor\/t3code\s*$/m.exec(output);
  if (!match) fail("Unable to resolve the vendor/t3code gitlink from HEAD.");
  return match[1];
}

export function parsePnpmVersion(packageManager) {
  const match = /^pnpm@([^\s]+)$/.exec(packageManager?.trim() ?? "");
  if (!match)
    fail(
      `Expected vendor/t3code packageManager to be pnpm@<version>, received ${packageManager || "nothing"}.`,
    );
  return match[1];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? `\n${(result.stderr || result.stdout || "").trim()}` : "";
    fail(`${command} ${args.join(" ")} exited with status ${result.status}.${detail}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function expectedVendorPin() {
  const staged = run("git", ["ls-files", "--stage", "--", "vendor/t3code"], { capture: true });
  const stagedPin = staged ? staged.split(/\s+/)[1] : null;
  if (stagedPin) return stagedPin;
  return parseGitlink(run("git", ["ls-tree", "HEAD", "--", "vendor/t3code"], { capture: true }));
}

function currentVendorPin() {
  if (
    !fs.existsSync(path.join(vendorRoot, ".git")) &&
    !fs.existsSync(path.join(vendorRoot, "package.json"))
  ) {
    return null;
  }
  try {
    return run("git", ["-C", vendorRoot, "rev-parse", "HEAD"], { capture: true });
  } catch {
    return null;
  }
}

function assertVendorCleanBeforeCheckout() {
  const statusOutput = run("git", ["-C", vendorRoot, "status", "--porcelain", "--untracked-files=no"], {
    capture: true,
  });
  if (statusOutput.trim() === "M apps/server/src/mcp/toolkits/computerUse.ts") {
    run("git", ["-C", vendorRoot, "checkout", "--", "apps/server/src/mcp/toolkits/computerUse.ts"]);
    return;
  }
  const changes = run("git", ["-C", vendorRoot, "status", "--porcelain", "--untracked-files=no"], {
    capture: true,
  });
  if (changes) {
    fail(
      "vendor/t3code has tracked local changes; refusing to replace its checkout. Commit or stash them first.",
    );
  }
}

function ensureVendorCheckout(expectedPin, checkOnly) {
  let currentPin = currentVendorPin();
  if (currentPin === expectedPin) return;

  if (checkOnly) {
    fail(
      currentPin
        ? `vendor/t3code is at ${currentPin}, expected ${expectedPin}.`
        : "vendor/t3code is not initialized.",
    );
  }

  if (currentPin) assertVendorCleanBeforeCheckout();
  console.log(
    `[prepare-t3-runtime] Initializing vendor/t3code at ${expectedPin.slice(0, 8)} (non-recursive)…`,
  );
  run("git", ["submodule", "update", "--init", "--depth", "1", "vendor/t3code"]);
  currentPin = currentVendorPin();
  if (currentPin !== expectedPin) {
    fail(`vendor/t3code resolved to ${currentPin || "nothing"}, expected ${expectedPin}.`);
  }
}

function readPnpmVersion() {
  const packageJsonPath = path.join(vendorRoot, "package.json");
  if (!fs.existsSync(packageJsonPath))
    fail("vendor/t3code/package.json is missing after submodule initialization.");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return parsePnpmVersion(packageJson.packageManager);
}

function runPnpm(version, args) {
  run("bun", ["x", `pnpm@${version}`, "--dir", vendorRoot, ...args]);
}

function bundleLoads() {
  if (!fs.existsSync(serverBundle)) return false;
  const result = spawnSync(process.execPath, [serverBundle, "--version"], {
    cwd: serverRoot,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0;
}

function readBundleStamp() {
  try {
    return fs.readFileSync(bundlePinStamp, "utf8").trim();
  } catch {
    return null;
  }
}

export function buildVendorSourceStamp(expectedPin, trackedDiff, untrackedFiles = []) {
  if (!trackedDiff && untrackedFiles.length === 0) return expectedPin;
  const hash = createHash("sha256");
  hash.update(expectedPin);
  hash.update("\0tracked\0");
  hash.update(trackedDiff);
  for (const entry of [...untrackedFiles].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    hash.update("\0untracked\0");
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.contents);
  }
  return `${expectedPin}:dirty:${hash.digest("hex")}`;
}

function currentVendorSourceStamp(expectedPin) {
  const trackedDiff = run("git", ["-C", vendorRoot, "diff", "--binary", "HEAD", "--"], {
    capture: true,
  });
  const untrackedOutput = run(
    "git",
    ["-C", vendorRoot, "ls-files", "--others", "--exclude-standard", "-z"],
    { capture: true },
  );
  const untrackedFiles = untrackedOutput
    .split("\0")
    .filter(Boolean)
    .map((relativePath) => ({
      path: relativePath,
      contents: fs.readFileSync(path.join(vendorRoot, relativePath)),
    }));
  return buildVendorSourceStamp(expectedPin, trackedDiff, untrackedFiles);
}

export function isCurrentT3Bundle(validBundle, stamp, sourceStamp) {
  return validBundle && stamp !== null && stamp === sourceStamp;
}

function prepareSourceRuntime(expectedPin, sourceStamp, pnpmVersion, { checkOnly, force }) {
  const validBundle = bundleLoads();
  const stamp = readBundleStamp();
  // A loadable but unstamped bundle may have been built before a fork commit.
  // Only a completed preparation can attest its source revision.
  const current = isCurrentT3Bundle(validBundle, stamp, sourceStamp);

  if (checkOnly) {
    if (!current)
      fail(`T3 server bundle is missing, unloadable, or stale for ${expectedPin.slice(0, 8)}.`);
    applyCozeaT3RuntimePatches({ checkOnly: true });
    return;
  }

  if (!force && current) {
    applyCozeaT3RuntimePatches({ checkOnly: false });
    console.log(`[prepare-t3-runtime] T3 server bundle is ready at ${expectedPin.slice(0, 8)}.`);
    return;
  }

  console.log(`[prepare-t3-runtime] Installing T3 dependencies with pnpm ${pnpmVersion}…`);
  runPnpm(pnpmVersion, ["install", "--frozen-lockfile"]);
  console.log("[prepare-t3-runtime] Building the T3 server bundle…");
  runPnpm(pnpmVersion, ["--filter", "t3", "build:bundle"]);
  if (!bundleLoads()) fail("The T3 server bundle was built but cannot be loaded by Node.");
  applyCozeaT3RuntimePatches({ checkOnly: false });
  fs.writeFileSync(bundlePinStamp, `${sourceStamp}\n`);
}

function preparePackagedRuntime(expectedPin, pnpmVersion) {
  fs.rmSync(packagedRuntimeRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(packagedRuntimeRoot), { recursive: true });
  console.log("[prepare-t3-runtime] Creating portable production T3 runtime…");
  runPnpm(pnpmVersion, ["--filter", "t3", "deploy", "--prod", "--legacy", packagedRuntimeRoot]);

  // electron-builder excludes dot-directories from extraResources, including
  // pnpm's `.pnpm` virtual store. Rename that store and retarget the direct
  // package links so the packaged resource is both complete and portable.
  const nodeModulesRoot = path.join(packagedRuntimeRoot, "node_modules");
  const hiddenStore = path.join(nodeModulesRoot, ".pnpm");
  const visibleStore = path.join(nodeModulesRoot, "pnpm-store");
  if (!fs.existsSync(hiddenStore))
    fail("Portable T3 deployment did not create node_modules/.pnpm.");
  fs.renameSync(hiddenStore, visibleStore);

  const rewriteStoreLinks = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(entryPath);
        if (target.includes(".pnpm")) {
          fs.unlinkSync(entryPath);
          fs.symlinkSync(target.replace(".pnpm", "pnpm-store"), entryPath);
        }
        continue;
      }
      if (entry.isDirectory() && entryPath !== visibleStore) rewriteStoreLinks(entryPath);
    }
  };
  rewriteStoreLinks(nodeModulesRoot);
  sanitizePortableRuntimeSymlinks(packagedRuntimeRoot);
  prunePackagedRuntimeArtifacts(packagedRuntimeRoot, {
    platform: process.platform,
    arch: process.arch,
  });
  sanitizePortableRuntimeSymlinks(packagedRuntimeRoot);

  const packagedBin = path.join(packagedRuntimeRoot, "dist", "bin.mjs");
  const result = spawnSync(process.execPath, [packagedBin, "--version"], {
    cwd: packagedRuntimeRoot,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    fail(
      `Portable T3 runtime failed its launch check.\n${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  fs.writeFileSync(
    path.join(packagedRuntimeRoot, "cozea-runtime.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        t3Pin: expectedPin,
        packageManager: `pnpm@${pnpmVersion}`,
      },
      null,
      2,
    )}\n`,
  );
}

export function parseArguments(argv) {
  const known = new Set(["--check", "--force", "--package"]);
  for (const argument of argv) {
    if (!known.has(argument)) fail(`Unknown argument: ${argument}`);
  }
  return {
    checkOnly: argv.includes("--check"),
    force: argv.includes("--force"),
    packageRuntime: argv.includes("--package"),
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.checkOnly && options.packageRuntime)
    fail("--check and --package cannot be combined.");

  const expectedPin = expectedVendorPin();
  ensureVendorCheckout(expectedPin, options.checkOnly);
  patchT3ComputerUseSource({ checkOnly: options.checkOnly });
  patchT3ComputerUseTest({ checkOnly: options.checkOnly });
  const sourceStamp = currentVendorSourceStamp(expectedPin);
  const pnpmVersion = readPnpmVersion();
  prepareSourceRuntime(expectedPin, sourceStamp, pnpmVersion, options);
  if (options.packageRuntime) preparePackagedRuntime(expectedPin, pnpmVersion);
  console.log(
    `[prepare-t3-runtime] Complete (T3 ${expectedPin.slice(0, 8)}, pnpm ${pnpmVersion}).`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
