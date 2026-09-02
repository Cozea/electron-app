import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createDevAppRuntimeSourceBundle } from "../../apps/desktop/electron/services/DevAppRuntimeSourceBundle"

const roots: string[] = []

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-runtime-source-test-"))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, "cozea-devapp.json"),
    JSON.stringify({
      manifestVersion: 2,
      name: "Contained worker",
      worker: {
        entry: "src/worker.ts",
        protocolVersion: 1,
        capabilities: ["project.read"],
        tools: [],
      },
      runtime: { location: "device", state: "device" },
    }),
  )
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "contained-worker", scripts: { build: "bun build src/worker.ts" } }),
  )
  fs.writeFileSync(path.join(root, "bun.lock"), "lockfileVersion = 1\n")
  fs.mkdirSync(path.join(root, "src"))
  fs.writeFileSync(path.join(root, "src/worker.ts"), "export const worker = true\n")
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DevApp central-build source bundle", () => {
  it("produces a stable, exact package identity while excluding local build state", () => {
    const root = project()
    fs.mkdirSync(path.join(root, "node_modules", "secret-package"), { recursive: true })
    fs.writeFileSync(path.join(root, "node_modules/secret-package/index.js"), "unstable\n")
    fs.mkdirSync(path.join(root, ".git"))
    fs.writeFileSync(path.join(root, ".git/config"), "private remote\n")

    const first = createDevAppRuntimeSourceBundle(root)
    const second = createDevAppRuntimeSourceBundle(root)

    expect(first.sourceDigest).toBe(second.sourceDigest)
    expect(first.packageManifestDigest).toBe(second.packageManifestDigest)
    expect(first.zip).toEqual(second.zip)
    expect(first.parts.runtime).toEqual({
      kind: "container",
      location: "device",
      state: "device",
    })
  })

  it("refuses secret files and symbolic links before uploading source", () => {
    const secretRoot = project()
    fs.writeFileSync(path.join(secretRoot, ".env.production"), "TOKEN=do-not-upload\n")
    expect(() => createDevAppRuntimeSourceBundle(secretRoot)).toThrow("prohibited secret file")

    const linkRoot = project()
    fs.symlinkSync(path.join(linkRoot, "src/worker.ts"), path.join(linkRoot, "worker-link.ts"))
    expect(() => createDevAppRuntimeSourceBundle(linkRoot)).toThrow("cannot contain symbolic links")
  })

  it("requires a Bun lockfile and deterministic build script", () => {
    const root = project()
    fs.rmSync(path.join(root, "bun.lock"))
    // The check tests for the lockfile on disk; it never consults git, so the message must
    // not claim a commit was verified.
    expect(() => createDevAppRuntimeSourceBundle(root)).toThrow("require package.json and bun.lock")
  })
})
