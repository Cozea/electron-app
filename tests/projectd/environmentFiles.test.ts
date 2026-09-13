import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { isSharedEnvironmentFile } from "../../apps/projectd/src/filesystem/environmentFiles"
import { ScopePolicy } from "../../apps/projectd/src/filesystem/ScopePolicy"
import { GitService } from "../../apps/projectd/src/git/GitService"

/**
 * Env files join a session that shares them even though Git ignores them; every other
 * ignored file still stays on its machine.
 */

const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

function repositoryIgnoring(rules: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-env-scope-"))
  folders.push(root)
  execFileSync("git", ["init", "-q"], { cwd: root })
  fs.writeFileSync(path.join(root, ".gitignore"), rules)
  return root
}

describe("shared env files", () => {
  it("recognises env files in any folder, but not templates or kept copies", () => {
    for (const relativePath of [".env", ".env.local", "apps/web/.env.production.local", ".dev.vars", "worker/.dev.vars.staging"]) {
      expect(isSharedEnvironmentFile(relativePath), relativePath).toBe(true)
    }
    for (const relativePath of [
      ".env.example",
      ".env.local.example",
      ".env.sample",
      ".env.template",
      ".envrc",
      "env",
      "src/env.ts",
      "config/.environment",
      ".env.conflict.1726000000000",
    ]) {
      expect(isSharedEnvironmentFile(relativePath), relativePath).toBe(false)
    }
  })

  it("admits ignored env files only when the session shares them", async () => {
    const root = repositoryIgnoring(".env*\n*.log\n")
    const paths = [".env", "apps/web/.env.local", "debug.log", "src/app.ts", ".env.conflict.1"]
    const sharing = new ScopePolicy(root, new GitService(), { shareEnvironmentFiles: true })
    const notSharing = new ScopePolicy(root, new GitService())

    expect((await sharing.filterInScopePaths(paths)).sort()).toEqual([".env", "apps/web/.env.local", "src/app.ts"])
    expect(await notSharing.filterInScopePaths(paths)).toEqual(["src/app.ts"])
    expect(await sharing.isInScope("apps/web/.env.local")).toBe(true)
    expect(await sharing.isInScope("debug.log")).toBe(false)
    expect(await notSharing.isInScope(".env")).toBe(false)
  })
})
