import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  prepareScaffoldedDevAppProject,
  type ScaffoldCommandResult,
} from "../../apps/desktop/electron/services/devAppScaffoldPreparation"

const roots: string[] = []

function packageRoot(withLockfile = false, dependencies = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-scaffold-"))
  roots.push(root)
  const manifest = dependencies ? { dependencies: { "@cozea/devapp-api": "^0.1.0" } } : {}
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest))
  if (withLockfile) fs.writeFileSync(path.join(root, "bun.lock"), "")
  return root
}

function runner(handler: (command: string, args: string[]) => ScaffoldCommandResult) {
  return vi.fn((command: string, args: string[]) => handler(command, args))
}

const ok: ScaffoldCommandResult = { status: 0, output: "" }

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("prepareScaffoldedDevAppProject", () => {
  it("installs and commits so a new package can reach the contained build", () => {
    const root = packageRoot(true)
    const run = runner(() => ok)
    const result = prepareScaffoldedDevAppProject(root, run)

    expect(result).toEqual({ lockfile: true, committed: true, warnings: [] })
    const commands = run.mock.calls.map(([command, args]) => `${command} ${args.join(" ")}`)
    expect(commands[0]).toBe("bun install")
    expect(commands).toContain("git add -A")
    expect(commands.some((command) => command.startsWith("git commit"))).toBe(true)
  })

  it("reports an install failure instead of destroying a previewable package", () => {
    // The exact failure that blocks publication today: the SDK is not on the registry.
    const root = packageRoot()
    const run = runner((command) =>
      command === "bun"
        ? {
            status: 1,
            // Real bun output: a version banner first, then the failure.
            output:
              "bun install v1.4.0 (34cbb9a4)\nResolving dependencies\nerror: GET https://registry.npmjs.org/@cozea%2fdevapp-api - 404\n",
          }
        : ok,
    )
    const result = prepareScaffoldedDevAppProject(root, run)

    expect(result.lockfile).toBe(false)
    expect(result.warnings.join(" ")).toContain("cannot be published yet")
    expect(result.warnings.join(" ")).toContain("404")
    // Staging still ran: a package that cannot install is still worth recording.
    expect(run.mock.calls.some(([command]) => command === "git")).toBe(true)
  })

  it("warns when an install reports success but leaves no lockfile", () => {
    const root = packageRoot()
    const result = prepareScaffoldedDevAppProject(root, runner(() => ok))

    expect(result.lockfile).toBe(false)
    expect(result.warnings.join(" ")).toContain("no bun.lock")
  })

  it("does not demand a lockfile from a package that declares no dependencies", () => {
    // A dependency-free view publishes as a static artifact and never reaches the contained
    // build, so bun writing no lockfile is correct, not a problem to report.
    const root = packageRoot(false, false)
    const result = prepareScaffoldedDevAppProject(root, runner(() => ok))

    expect(result.lockfile).toBe(false)
    expect(result.warnings).toEqual([])
  })

  it("treats an already-recorded tree as committed", () => {
    const root = packageRoot(true)
    const run = runner((command, args) =>
      command === "git" && args[0] === "commit"
        ? { status: 1, output: "nothing to commit, working tree clean\n" }
        : ok,
    )

    expect(prepareScaffoldedDevAppProject(root, run).committed).toBe(true)
  })

  it("skips git entirely outside a repository", () => {
    const root = packageRoot(true)
    const run = runner((command, args) =>
      command === "git" && args[0] === "rev-parse" ? { status: 128, output: "not a git repository" } : ok,
    )
    const result = prepareScaffoldedDevAppProject(root, run)

    expect(result.committed).toBe(false)
    expect(result.warnings).toEqual([])
    expect(run.mock.calls.some(([command, args]) => command === "git" && args[0] === "add")).toBe(false)
  })

  it("surfaces a commit failure rather than claiming the scaffold is recorded", () => {
    const root = packageRoot(true)
    const run = runner((command, args) =>
      command === "git" && args[0] === "commit"
        ? { status: 1, output: "Author identity unknown\n" }
        : ok,
    )
    const result = prepareScaffoldedDevAppProject(root, run)

    expect(result.committed).toBe(false)
    expect(result.warnings.join(" ")).toContain("Author identity unknown")
  })
})
