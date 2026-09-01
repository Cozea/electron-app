import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveT3RuntimeRoot } from "../../apps/server/src/t3/paths";
import {
  buildVendorSourceStamp,
  sanitizePortableRuntimeSymlinks,
} from "../../scripts/prepare-t3-runtime.mjs";

const repositoryRoot = path.resolve(__dirname, "../..");

describe("T3 runtime preparation", () => {
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
});
