import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveT3RuntimeRoot } from "../../apps/server/src/t3/paths";
import {
  buildVendorSourceStamp,
  patchT3ServerBundleProviderDefaults,
  isCurrentT3Bundle,
  patchT3ServerBundleProviderUpdates,
  sanitizePortableRuntimeSymlinks,
} from "../../scripts/prepare-t3-runtime.mjs";

const repositoryRoot = path.resolve(__dirname, "../..");

describe("T3 runtime preparation", () => {
  const unpatchedProviderDefaults = `const CursorSettings = makeProviderSettingsSchema({
\tenabled: Boolean$1.pipe(withDecodingDefault(succeed$1(false)), annotateKey({ providerSettingsForm: { hidden: true } })),
const OpenCodeSettings = makeProviderSettingsSchema({
\tenabled: Boolean$1.pipe(withDecodingDefault(succeed$1(false)), annotateKey({ providerSettingsForm: { hidden: true } })),
enabled: persisted.providers?.cursor?.enabled ?? usedProviders.has("cursor")
enabled: persisted.providers?.opencode?.enabled ?? usedProviders.has("opencode")`;
  const unpatchedProviderUpdates = `function makeNpmGlobalProviderMaintenanceCapabilities(definition) {
\t\t\t"-g",
\t\t\t\`--allow-scripts=\${definition.npmPackageName}\`,
function normalizeCommandPath(commandPath) {
\treturn commandPath.replaceAll("\\\\", "/").toLowerCase();
}
function isBunGlobalCommandPath(commandPath) {
\t\tconst commandPaths = [resolvedCommandPath, ...options?.realCommandPath ? [options.realCommandPath] : []];
\t\tconst nativeUpdate = definition.nativeUpdate;
message: couldNotVerify ? "Update command completed, but T3 Code could not verify the provider version." : stillOutdated ? "Update command completed, but T3 Code still detects an outdated provider version." : "Provider updated.",`;

  it("rebuilds a runtime when tracked or untracked vendor source changes", () => {
    const pin = "a".repeat(40);
    expect(buildVendorSourceStamp(pin, "", [])).toBe(pin);
    expect(buildVendorSourceStamp(pin, "diff-a", [])).not.toBe(
      buildVendorSourceStamp(pin, "diff-b", []),
    );
    expect(buildVendorSourceStamp(pin, "", [{ path: "tool.ts", contents: "one" }])).not.toBe(
      buildVendorSourceStamp(pin, "", [{ path: "tool.ts", contents: "two" }]),
    );
  });

  it("prefers an explicit runtime root", () => {
    expect(
      resolveT3RuntimeRoot({
        explicitRoot: "/tmp/cozea-explicit-t3",
        resourcesPath: "/Applications/Cozea.app/Contents/Resources",
        exists: () => false,
      }),
    ).toBe("/tmp/cozea-explicit-t3");
  });

  it("uses the packaged resource only when its server bundle exists", () => {
    const resourcesPath = "/Applications/Cozea.app/Contents/Resources";
    const expectedRoot = path.join(resourcesPath, "t3-runtime");

    expect(
      resolveT3RuntimeRoot({
        resourcesPath,
        exists: (candidate) => candidate === path.join(expectedRoot, "dist/bin.mjs"),
      }),
    ).toBe(expectedRoot);
    expect(resolveT3RuntimeRoot({ resourcesPath, exists: () => false })).toBeNull();
  });

  it("wires preparation into development and distribution without recursive submodules", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
    };
    const prepareScript = fs.readFileSync(
      path.join(repositoryRoot, "scripts/prepare-t3-runtime.mjs"),
      "utf8",
    );
    const builderConfig = fs.readFileSync(
      path.join(repositoryRoot, "apps/desktop/electron-builder.config.cjs"),
      "utf8",
    );

    expect(packageJson.scripts.dev).toContain("prepare:t3-runtime");
    expect(packageJson.scripts.predist).toContain("prepare:t3-runtime:package");
    expect(prepareScript).toContain(
      '"submodule", "update", "--init", "--depth", "1", "vendor/t3code"',
    );
    expect(prepareScript).not.toContain('"--recursive"');
    expect(builderConfig).toContain('from: "../../build/t3-runtime"');
    expect(builderConfig).toContain('from: "../../build/t3-runtime/node_modules"');
    expect(prepareScript).toContain('"pnpm-store"');
  });

  it("removes pnpm deploy self-links that escape the packaged runtime", () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(repositoryRoot, ".agent", "t3-runtime-link-test-"),
    );
    const runtimeRoot = path.join(temporaryRoot, "runtime");
    const linkDirectory = path.join(runtimeRoot, "node_modules", "pnpm-store", "node_modules");
    const externalServer = path.join(temporaryRoot, "vendor", "apps", "server");
    fs.mkdirSync(linkDirectory, { recursive: true });
    fs.mkdirSync(externalServer, { recursive: true });
    fs.symlinkSync(externalServer, path.join(linkDirectory, "t3"));

    try {
      expect(sanitizePortableRuntimeSymlinks(runtimeRoot)).toEqual([
        path.join("node_modules", "pnpm-store", "node_modules", "t3"),
      ]);
      expect(fs.existsSync(path.join(linkDirectory, "t3"))).toBe(false);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects unexpected symlinks that escape the packaged runtime", () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(repositoryRoot, ".agent", "t3-runtime-link-test-"),
    );
    const runtimeRoot = path.join(temporaryRoot, "runtime");
    const linkDirectory = path.join(runtimeRoot, "node_modules");
    const externalPackage = path.join(temporaryRoot, "external-package");
    fs.mkdirSync(linkDirectory, { recursive: true });
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.symlinkSync(externalPackage, path.join(linkDirectory, "unexpected"));

    try {
      expect(() => sanitizePortableRuntimeSymlinks(runtimeRoot)).toThrow(
        "Portable T3 deployment contains an external symlink",
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
  it("enables Cursor and OpenCode in the built runtime while preserving explicit disables", () => {
    const patched = patchT3ServerBundleProviderDefaults(unpatchedProviderDefaults);

    expect(patched.changed).toBe(true);
    expect(patched.source).toContain(
      "const CursorSettings = makeProviderSettingsSchema({\n\tenabled: Boolean$1.pipe(withDecodingDefault(succeed$1(true))",
    );
    expect(patched.source).toContain(
      "const OpenCodeSettings = makeProviderSettingsSchema({\n\tenabled: Boolean$1.pipe(withDecodingDefault(succeed$1(true))",
    );
    expect(patched.source).toContain(
      "persisted.providers?.cursor?.enabled ?? settings.providers.cursor.enabled",
    );
    expect(patched.source).toContain(
      "persisted.providers?.opencode?.enabled ?? settings.providers.opencode.enabled",
    );

    const secondPass = patchT3ServerBundleProviderDefaults(patched.source);
    expect(secondPass.changed).toBe(false);
    expect(secondPass.source).toBe(patched.source);
  });

  it("fails loudly when an upstream T3 bundle changes the provider-default anchors", () => {
    expect(() => patchT3ServerBundleProviderDefaults("const changedUpstreamBundle = true")).toThrow(
      "Cursor default enablement patch anchor is missing",
    );
  });

  it("targets the npm prefix that owns the selected provider executable", () => {
    const patched = patchT3ServerBundleProviderUpdates(unpatchedProviderUpdates);

    expect(patched.changed).toBe(true);
    expect(patched.source).toContain(
      "function makeNpmGlobalProviderMaintenanceCapabilities(definition, prefix = null)",
    );
    expect(patched.source).toContain('...prefix ? [`--prefix=${prefix}`] : []');
    expect(patched.source).toContain('const posixMarker = "/lib/node_modules/"');
    expect(patched.source).toContain(
      "[options?.realCommandPath, resolvedCommandPath].filter(Boolean).find(isNpmGlobalCommandPath)",
    );
    expect(patched.source).toContain(
      "Update completed, but the selected installation is still out of date.",
    );
    expect(patched.source).not.toContain("T3 Code still detects");

    const secondPass = patchT3ServerBundleProviderUpdates(patched.source);
    expect(secondPass.changed).toBe(false);
    expect(secondPass.source).toBe(patched.source);
  });

  it("fails loudly when an upstream bundle changes the provider-update anchors", () => {
    expect(() => patchT3ServerBundleProviderUpdates("const changedUpstreamBundle = true")).toThrow(
      "npm updater accepts the selected installation prefix patch anchor is missing",
    );
  });
});

it("never attests an unstamped bundle just because it can load", () => {
  expect(isCurrentT3Bundle(true, null, "reviewed-revision")).toBe(false);
  expect(isCurrentT3Bundle(true, "old-revision", "reviewed-revision")).toBe(false);
  expect(isCurrentT3Bundle(false, "reviewed-revision", "reviewed-revision")).toBe(false);
  expect(isCurrentT3Bundle(true, "reviewed-revision", "reviewed-revision")).toBe(true);
});
