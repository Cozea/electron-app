import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { detectFramework, preflightProject } from "../../apps/desktop/electron/services/orgDevAppPreflight"
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

function containedServiceManifest(entry = ".next/standalone/server.js"): string {
  return JSON.stringify({
    manifestVersion: 2,
    name: "Contained service",
    service: { runtimeKind: "node", entry },
    runtime: { location: "device", state: "device" },
  })
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

  it("reports every actionable Next.js problem in one pass without building", () => {
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
      expect.arrayContaining(["next-missing-standalone", "contained-runtime-manifest-missing", "public-env-inlined"]),
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
      "cozea-devapp.json": containedServiceManifest(),
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
    expect(report.expectedRuntimeKind).toBe("service")
  })

  it("blocks an inferred service until placement and state are explicit", () => {
    const root = writeProject({
      "package.json": JSON.stringify({
        scripts: { build: "next build" },
        dependencies: { next: "16.2.10" },
      }),
      "next.config.ts": `export default { output: "standalone" };`,
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(false)
    expect(codes(report.diagnostics)).toContain("contained-runtime-manifest-missing")
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

  it("allows native packages because the central builder targets both Linux architectures", () => {
    const root = writeProject({
      "package.json": JSON.stringify({
        scripts: { build: "next build" },
        dependencies: { next: "16.2.10", sharp: "^0.34.5" },
      }),
      "next.config.ts": `export default { output: "standalone" };`,
      "cozea-devapp.json": containedServiceManifest(),
      ".next/standalone/node_modules/@img/sharp-darwin-arm64/lib/sharp.node": "native",
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
  })

  it("does not treat publisher-host trace files as contained-runtime authority", () => {
    const root = writeProject({
      "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "16.2.10" } }),
      "next.config.ts": `export default { output: "standalone", outputFileTracingExcludes: { "*": ["**/@img/**"] } };`,
      "cozea-devapp.json": containedServiceManifest(),
      ".next/next-server.js.nft.json": JSON.stringify({
        files: ["../node_modules/@img/sharp-darwin-arm64/lib/sharp.node"],
      }),
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
  })

  it("accepts native runtime dependencies before a publisher-host build exists", () => {
    const root = writeProject({
      "package.json": JSON.stringify({
        scripts: { build: "next build" },
        dependencies: { next: "16.2.10", sharp: "^0.34.5" },
      }),
      "next.config.ts": `export default { output: "standalone", outputFileTracingExcludes: { "*": ["**/@img/**"] } };`,
      "cozea-devapp.json": containedServiceManifest(),
      ".next/standalone/server.js": "",
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
  })

  it("does not flag native build tooling that never reaches the artifact", () => {
    const root = writeProject({
      "package.json": JSON.stringify({
        scripts: { build: "next build" },
        dependencies: { next: "16.2.10" },
        devDependencies: { "@swc/core": "^1", lightningcss: "^1", "@tailwindcss/oxide": "^4" },
      }),
      "next.config.ts": `export default { output: "standalone" };`,
      "cozea-devapp.json": containedServiceManifest(),
    })
    const report = preflightProject(root)
    expect(report.ok).toBe(true)
  })

  it("detects frameworks that have no automatic service adapter", () => {
    const sveltekit = writeProject({
      "package.json": JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { "@sveltejs/kit": "^2" } }),
    })
    expect(detectFramework(sveltekit)).toBe("sveltekit")
  })
})
