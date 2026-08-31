import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  detectFramework,
  preflightProject,
  scanOutputTree,
} from "../../apps/desktop/electron/services/orgDevAppPreflight"
import type { OrgDevAppDiagnosticCode } from "../../shared/orgDevAppDiagnostics"

const temporaryRoots: string[] = []

function temporaryRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label))
  temporaryRoots.push(root)
  return root
}

function writeProject(files: Record<string, string>): string {
  const root = temporaryRoot("cozea-preflight-")
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents)
  }
  return root
}

function codes(diagnostics: ReadonlyArray<{ code: OrgDevAppDiagnosticCode }>): OrgDevAppDiagnosticCode[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Org DevApp preflight — project analysis", () => {
  it("reports a folder that is not a Node project and stops there", () => {
    const root = temporaryRoot("cozea-empty-")
    const report = preflightProject(root)
    expect(report.ok).toBe(false)
    expect(codes(report.diagnostics)).toEqual(["not-node-project"])
  })

  it("reports a missing build script", () => {
    const root = writeProject({ "package.json": JSON.stringify({ scripts: { dev: "vite" } }) })
    const report = preflightProject(root)
    expect(report.ok).toBe(false)
    expect(codes(report.diagnostics)).toContain("no-build-script")
  })

  it("accepts a plain static project with a build script", () => {
    const root = writeProject({
      "package.json": JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "^7" } }),
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
    expect(report.framework).toBe("vite-react")
    expect(report.expectedRuntimeKind).toBe("static")
  })

  // The exact failure a real Next.js project hit: three problems, three builds to find them.
  it("reports every Next.js problem in one pass without building", () => {
    const root = writeProject({
      "package.json": JSON.stringify({
        scripts: { build: "next build" },
        dependencies: { next: "16.2.10", sharp: "^0.34.5" },
      }),
      "pnpm-lock.yaml": "",
      "next.config.ts": `const nextConfig = { serverExternalPackages: ["postgres"] };\nexport default nextConfig;`,
      ".env.local": "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SERVICE_ROLE_KEY=secret\n",
    })

    const report = preflightProject(root)
    expect(report.ok).toBe(false)
    expect(report.framework).toBe("nextjs")
    expect(codes(report.diagnostics)).toEqual(
      expect.arrayContaining(["next-missing-standalone", "native-runtime-dependency", "public-env-inlined"]),
    )

    // Only the public key is named; the service-role secret must never be echoed back.
    const envDiagnostic = report.diagnostics.find((d) => d.code === "public-env-inlined")
    expect(envDiagnostic?.detail).toContain("NEXT_PUBLIC_SUPABASE_URL")
    expect(envDiagnostic?.detail).not.toContain("SUPABASE_SERVICE_ROLE_KEY")
  })

  it("accepts a Next.js app that declares standalone output", () => {
    const root = writeProject({
      "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "16.2.10" } }),
      "next.config.ts": `export default { output: "standalone" };`,
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
    expect(report.expectedRuntimeKind).toBe("service")
  })

  it("treats a static export as a static DevApp", () => {
    const root = writeProject({
      "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "16.2.10" } }),
      "next.config.js": `module.exports = { output: "export" };`,
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
    expect(report.expectedRuntimeKind).toBe("static")
  })

  it("warns rather than blocks when the output mode is computed", () => {
    const root = writeProject({
      "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "16.2.10" } }),
      "next.config.ts": `export default { output: process.env.MODE };`,
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
    expect(report.diagnostics.find((d) => d.code === "next-missing-standalone")?.severity).toBe("warning")
  })

  it("blocks when a built standalone output actually contains native code", () => {
    const root = writeProject({
      "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "16.2.10" } }),
      "next.config.ts": `export default { output: "standalone" };`,
      ".next/standalone/node_modules/@img/sharp-darwin-arm64/lib/sharp.node": "native",
    })
    const report = preflightProject(root)
    const native = report.diagnostics.find((d) => d.code === "native-runtime-dependency")
    expect(native?.severity).toBe("blocker")
    expect(native?.message).toContain("sharp")
    expect(report.ok).toBe(false)
  })

  // Regression: the trace lists what tracing found, not what it keeps. A project whose
  // config excludes sharp still names it in nft.json, and blocking on that would refuse
  // to publish a project that builds a perfectly clean artifact.
  it("does not block on a trace entry that outputFileTracingExcludes removes", () => {
    const root = writeProject({
      "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "16.2.10" } }),
      "next.config.ts": `export default { output: "standalone", outputFileTracingExcludes: { "*": ["**/@img/**"] } };`,
      ".next/next-server.js.nft.json": JSON.stringify({
        files: ["../node_modules/@img/sharp-darwin-arm64/lib/sharp.node"],
      }),
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
    const native = report.diagnostics.find((d) => d.code === "native-runtime-dependency")
    expect(native?.severity).toBe("warning")
    expect(native?.detail).toContain("outputFileTracingExcludes")
  })

  // The built tree is authoritative in both directions.
  it("clears a suspected native dependency when the built output does not contain it", () => {
    const root = writeProject({
      "package.json": JSON.stringify({
        scripts: { build: "next build" },
        dependencies: { next: "16.2.10", sharp: "^0.34.5" },
      }),
      "next.config.ts": `export default { output: "standalone", outputFileTracingExcludes: { "*": ["**/@img/**"] } };`,
      ".next/standalone/server.js": "",
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
    expect(codes(report.diagnostics)).not.toContain("native-runtime-dependency")
  })

  it("does not flag native build tooling that never reaches the artifact", () => {
    const root = writeProject({
      "package.json": JSON.stringify({
        scripts: { build: "next build" },
        dependencies: { next: "16.2.10" },
        devDependencies: { "@swc/core": "^1", lightningcss: "^1", "@tailwindcss/oxide": "^4" },
      }),
      "next.config.ts": `export default { output: "standalone" };`,
    })
    const report = preflightProject(root)
    expect(codes(report.diagnostics)).not.toContain("native-runtime-dependency")
    expect(report.ok).toBe(true)
  })

  it("detects frameworks that have no automatic service adapter", () => {
    const sveltekit = writeProject({
      "package.json": JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { "@sveltejs/kit": "^2" } }),
    })
    expect(detectFramework(sveltekit)).toBe("sveltekit")
  })
})

describe("Org DevApp preflight — output scan", () => {
  it("reports a dangling symlink instead of throwing ENOENT", () => {
    const root = temporaryRoot("cozea-output-")
    fs.writeFileSync(path.join(root, "server.js"), "")
    fs.symlinkSync(path.join(root, "missing-package"), path.join(root, "sharp"))

    // The shipped packer calls realpathSync unguarded here and escapes as a bare ENOENT.
    expect(() => scanOutputTree(root, { runtimeKind: "service" })).not.toThrow()
    const diagnostics = scanOutputTree(root, { runtimeKind: "service" })
    expect(codes(diagnostics)).toContain("dangling-symlink")
    expect(diagnostics.find((d) => d.code === "dangling-symlink")?.paths).toContain("sharp")
  })

  it("reports native code and Mach-O binaries in a service output", () => {
    const root = temporaryRoot("cozea-output-native-")
    fs.writeFileSync(path.join(root, "server.js"), "")
    fs.writeFileSync(path.join(root, "binding.node"), "native")
    const machO = Buffer.alloc(8)
    machO.writeUInt32BE(0xfeedfacf, 0)
    fs.writeFileSync(path.join(root, "helper"), machO)

    const diagnostics = scanOutputTree(root, { runtimeKind: "service" })
    const native = diagnostics.find((d) => d.code === "native-code-in-output")
    expect(native?.severity).toBe("blocker")
    expect(native?.paths).toEqual(expect.arrayContaining(["binding.node", "helper"]))
  })

  it("ignores native files in a static output, which never executes", () => {
    const root = temporaryRoot("cozea-output-static-")
    fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>")
    fs.writeFileSync(path.join(root, "binding.node"), "native")

    expect(scanOutputTree(root, { runtimeKind: "static" })).toEqual([])
  })

  it("reports a symlink that escapes the output tree", () => {
    const outside = temporaryRoot("cozea-outside-")
    fs.writeFileSync(path.join(outside, "secret.txt"), "")
    const root = temporaryRoot("cozea-output-escape-")
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "linked.txt"))

    expect(codes(scanOutputTree(root, { runtimeKind: "service" }))).toContain("symlink-escapes-output")
  })

  it("collects every fault in one pass rather than stopping at the first", () => {
    const root = temporaryRoot("cozea-output-many-")
    fs.writeFileSync(path.join(root, "binding.node"), "native")
    fs.symlinkSync(path.join(root, "gone"), path.join(root, "broken"))

    const diagnostics = scanOutputTree(root, { runtimeKind: "service" })
    expect(codes(diagnostics)).toEqual(expect.arrayContaining(["dangling-symlink", "native-code-in-output"]))
  })

  it("reports a missing output directory", () => {
    const root = path.join(temporaryRoot("cozea-output-absent-"), "never-built")
    expect(codes(scanOutputTree(root, { runtimeKind: "static" }))).toEqual(["no-publishable-output"])
  })
})
