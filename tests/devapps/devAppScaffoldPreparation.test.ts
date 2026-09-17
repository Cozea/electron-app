import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  prepareScaffoldedDevAppProject,
  runScaffoldCommand,
  type ScaffoldCommandResult,
} from "../../apps/desktop/electron/services/devAppScaffoldPreparation"

const roots: string[] = []
const CREATED = ["package.json", "cozea-devapp.json"]

function packageRoot(withLockfile = false, dependencies = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-scaffold-"))
  roots.push(root)
  const manifest = dependencies ? { dependencies: { "@cozea/devapp-api": "^0.1.0" } } : {}
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest))
  fs.writeFileSync(path.join(root, "cozea-devapp.json"), "{}")
  if (withLockfile) fs.writeFileSync(path.join(root, "bun.lock"), "")
  return root
}

const ok: ScaffoldCommandResult = { status: 0, stdout: "", output: "" }

/** Answers like a repository in which every named scaffold path is still untracked. */
function runner(override?: (command: string, args: string[]) => ScaffoldCommandResult | undefined) {
  return vi.fn(async (command: string, args: string[]) => {
    const custom = override?.(command, args)
    if (custom) return custom
    if (command === "git" && args[0] === "ls-files" && args.includes("--others")) {
      return { ...ok, stdout: `${args.slice(args.indexOf("--") + 1).join("\0")}\0` }
    }
    return ok
  })
}

function commandLines(run: ReturnType<typeof runner>): string[] {
  return run.mock.calls.map(([command, args]) => `${command} ${args.join(" ")}`)
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("prepareScaffoldedDevAppProject", () => {
  it("installs and commits so a new package can reach the contained build", async () => {
    const root = packageRoot(true)
    const run = runner()
    const result = await prepareScaffoldedDevAppProject(root, CREATED, run)

    expect(result).toEqual({ lockfile: true, committed: true, warnings: [] })
    const commands = commandLines(run)
    expect(commands[0]).toBe("bun install")
    expect(commands).toContain("git add -- package.json cozea-devapp.json bun.lock")
    expect(commands).toContain(
      "git commit --only -m feat: scaffold Cozea DevApp -- package.json cozea-devapp.json bun.lock",
    )
  })

  it("never stages or commits beyond the files the scaffold wrote", async () => {
    const root = packageRoot(true)
    const run = runner()
    await prepareScaffoldedDevAppProject(root, CREATED, run)

    for (const [command, args] of run.mock.calls) {
      if (command !== "git" || (args[0] !== "add" && args[0] !== "commit")) continue
      expect(args).not.toContain("-A")
      expect(args).not.toContain("--all")
      expect(args).not.toContain(".")
      expect(args).toContain("--")
    }
  })

  it("reports an install failure instead of destroying a previewable package", async () => {
    // The exact failure that blocks publication today: the SDK is not on the registry.
    const root = packageRoot()
    const run = runner((command) =>
      command === "bun"
        ? {
            status: 1,
            stdout: "",
            // Real bun output: a version banner first, then the failure.
            output:
              "bun install v1.4.0 (34cbb9a4)\nResolving dependencies\nerror: GET https://registry.npmjs.org/@cozea%2fdevapp-api - 404\n",
          }
        : undefined,
    )
    const result = await prepareScaffoldedDevAppProject(root, CREATED, run)

    expect(result.lockfile).toBe(false)
    expect(result.warnings.join(" ")).toContain("cannot be published yet")
    expect(result.warnings.join(" ")).toContain("404")
    // Recording still ran: a package that cannot install is still worth recording.
    expect(result.committed).toBe(true)
  })

  it("warns when an install reports success but leaves no lockfile", async () => {
    const root = packageRoot()
    const result = await prepareScaffoldedDevAppProject(root, CREATED, runner())

    expect(result.lockfile).toBe(false)
    expect(result.warnings.join(" ")).toContain("no bun.lock")
  })

  it("does not demand a lockfile from a package that declares no dependencies", async () => {
    // A dependency-free view publishes as a static artifact and never reaches the contained
    // build, so bun writing no lockfile is correct, not a problem to report.
    const root = packageRoot(false, false)
    const result = await prepareScaffoldedDevAppProject(root, CREATED, runner())

    expect(result.lockfile).toBe(false)
    expect(result.warnings).toEqual([])
  })

  it("treats an already-recorded tree as committed", async () => {
    const root = packageRoot(true)
    const run = runner((command, args) => {
      if (command !== "git" || args[0] !== "ls-files") return undefined
      return args.includes("--others") ? ok : { ...ok, stdout: "package.json\0" }
    })

    expect((await prepareScaffoldedDevAppProject(root, CREATED, run)).committed).toBe(true)
    expect(commandLines(run).some((line) => line.startsWith("git commit"))).toBe(false)
  })

  it("warns instead of forcing in files .gitignore excludes", async () => {
    const root = packageRoot(true)
    const run = runner((command, args) => (command === "git" && args[0] === "ls-files" ? ok : undefined))
    const result = await prepareScaffoldedDevAppProject(root, CREATED, run)

    expect(result.committed).toBe(false)
    expect(result.warnings.join(" ")).toContain("ignored by .gitignore")
    expect(commandLines(run).some((line) => line.startsWith("git add"))).toBe(false)
  })

  it("skips git entirely outside a repository", async () => {
    const root = packageRoot(true)
    const run = runner((command, args) =>
      command === "git" && args[0] === "rev-parse"
        ? { status: 128, stdout: "", output: "not a git repository" }
        : undefined,
    )
    const result = await prepareScaffoldedDevAppProject(root, CREATED, run)

    expect(result.committed).toBe(false)
    expect(result.warnings).toEqual([])
    expect(run.mock.calls.some(([command, args]) => command === "git" && args[0] === "add")).toBe(false)
  })

  it("surfaces a commit failure rather than claiming the scaffold is recorded", async () => {
    const root = packageRoot(true)
    const run = runner((command, args) =>
      command === "git" && args[0] === "commit"
        ? { status: 1, stdout: "", output: "Author identity unknown\n" }
        : undefined,
    )
    const result = await prepareScaffoldedDevAppProject(root, CREATED, run)

    expect(result.committed).toBe(false)
    expect(result.warnings.join(" ")).toContain("Author identity unknown")
  })
})

describe("prepareScaffoldedDevAppProject against a real repository", () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } })
  }

  it("leaves the author's other work, staged or not, out of the scaffold commit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-scaffold-repo-"))
    roots.push(root)
    git(root, "init", "-q")
    git(root, "config", "user.email", "scaffold@test.invalid")
    git(root, "config", "user.name", "Scaffold Test")
    git(root, "commit", "-q", "--allow-empty", "-m", "init")
    fs.writeFileSync(path.join(root, ".gitignore"), "ignored-by-author.txt\n")
    fs.writeFileSync(path.join(root, "staged-by-author.txt"), "in progress\n")
    git(root, "add", ".gitignore", "staged-by-author.txt")
    fs.writeFileSync(path.join(root, "untracked-by-author.txt"), "also in progress\n")

    fs.mkdirSync(path.join(root, "apps", "tool"), { recursive: true })
    const pkg = path.join(root, "apps", "tool")
    fs.writeFileSync(path.join(pkg, "package.json"), "{}")
    fs.writeFileSync(path.join(pkg, "cozea-devapp.json"), "{}")

    const run = vi.fn(async (command: string, args: string[], cwd: string) =>
      command === "bun" ? ok : runScaffoldCommand(command, args, cwd),
    )
    const result = await prepareScaffoldedDevAppProject(pkg, CREATED, run)

    expect(result).toEqual({ lockfile: false, committed: true, warnings: [] })
    expect(git(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort()).toEqual([
      "apps/tool/cozea-devapp.json",
      "apps/tool/package.json",
    ])
    const status = git(root, "status", "--porcelain")
    expect(status).toContain("A  .gitignore")
    expect(status).toContain("A  staged-by-author.txt")
    expect(status).toContain("?? untracked-by-author.txt")
  })
})
