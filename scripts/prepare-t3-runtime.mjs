#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyCozeaWorkspaceSourcePatches } from "./patch-t3-workspace-authority.mjs";

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

function applyCozeaT3RuntimePatches({ checkOnly }) {
  const source = fs.readFileSync(serverBundle, "utf8");
  const providerDefaults = patchT3ServerBundleProviderDefaults(source);
  const providerUpdates = patchT3ServerBundleProviderUpdates(providerDefaults.source);
  const changed = providerDefaults.changed || providerUpdates.changed;
  if (checkOnly && changed) {
    fail("T3 server bundle is missing a Cozea runtime patch.");
  }
  if (!checkOnly && changed) {
    fs.writeFileSync(serverBundle, providerUpdates.source);
    console.log("[prepare-t3-runtime] Applied Cozea policies to the T3 bundle.");
  }
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
  applyCozeaWorkspaceSourcePatches({ vendorRoot, checkOnly: options.checkOnly });
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
