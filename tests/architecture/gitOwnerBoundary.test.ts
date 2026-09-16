import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Architecture boundary for Git ownership (P05 / P26).
 *
 * The previous version of this file passed while the boundary it names was
 * being crossed: it scanned only `apps/projectd/src`, its matcher had no
 * `spawnSync` case, and it asserted ownership by checking that the string
 * "getSharedProjectdClient" appeared *somewhere* in a file that also ran
 * `git checkout` and `git merge` directly.
 *
 * The rule here is a ratchet rather than a clean invariant: the repository has
 * more Git execution engines than it wants, so the known set is pinned and may
 * only shrink. A new one fails the build; removing one is a one-line edit.
 *
 * See `docs/git-subsystem-fragmentation.md` for the survey behind this.
 */
describe("Git owner consolidation boundary", () => {
  const repoRoot = process.cwd()

  /**
   * Every place that executes `git` (or `gh`) itself, outside the canonical
   * owner `apps/projectd/src/git`. Each entry is a debt, not a licence.
   * Do not add to this list -- route the work through the owner instead.
   */
  const KNOWN_GIT_ENGINES: readonly string[] = [
    // Spawns a resolved executable path. Hardened 2026-09-16 with an output
    // ceiling, a default deadline and a pinned locale.
    "apps/desktop/electron/gitRuntime.ts",
    // Wraps gitRuntime, and separately spawns the `gh` CLI.
    "apps/desktop/electron/ipc/registerProjectHandlers.ts",
    // spawnSync behind a `run(cmd, args)` indirection -- and it commits.
    "apps/desktop/electron/services/devAppScaffoldPreparation.ts",
    // promisify(execFile) under an `exec` alias, 11 call sites.
    "apps/desktop/electron/services/threadWorktreeService.ts",
    // Synchronous git on the Electron main thread.
    "apps/desktop/electron/substrate/vcs/bootstrap.ts",
    "apps/desktop/electron/substrate/vcs/checkpointRefs.ts",
    // The Changes/checkpoint reader.
    "apps/desktop/electron/substrate/vcs/checkpointOps.ts",
  ]

  /** Roots that must not grow a new Git engine. */
  const SCAN_ROOTS: readonly string[] = [
    "apps/projectd/src",
    "apps/desktop/electron",
    "apps/desktop/src",
    "packages",
    "shared",
    "convex",
    "cloudflare",
  ]

  /** `spawn("git", …)` and friends, written literally. */
  const LITERAL_SPAWN: readonly string[] = [
    'spawn("git"',
    "spawn('git'",
    'spawnSync("git"',
    "spawnSync('git'",
    'execFile("git"',
    "execFile('git'",
    'execFileSync("git"',
    "execFileSync('git'",
    'execSync("git',
    "execSync('git",
  ]

  /**
   * The executable as a first argument, which catches indirection: a local
   * `run("git", [...])` helper spawns Git just as surely as `spawn` does, and
   * that shape is exactly how one engine escaped the survey that produced this
   * test.
   */
  const COMMAND_ARGUMENT: readonly string[] = ['("git",', "('git',", '("gh",', "('gh',"]

  /**
   * Resolving the Git binary by path. Only counted where something actually
   * spawns, because the i18n catalogues name `COZEA_GIT_EXECUTABLE` in the
   * sentence shown when Git is missing.
   */
  const RESOLVED_EXECUTABLE: readonly string[] = [
    "COZEA_GIT_EXECUTABLE",
    "resolveGitExecutablePath",
  ]

  function listSourceFiles(directory: string): string[] {
    if (!fs.existsSync(directory)) return []
    return (fs.readdirSync(directory, { recursive: true }) as string[])
      .filter((rel) => rel.endsWith(".ts") || rel.endsWith(".tsx"))
      .map((rel) => path.join(directory, rel))
      .filter((full) => {
        try {
          return fs.statSync(full).isFile()
        } catch {
          return false
        }
      })
  }

  function executesGit(content: string): boolean {
    if (LITERAL_SPAWN.some((pattern) => content.includes(pattern))) return true
    if (COMMAND_ARGUMENT.some((pattern) => content.includes(pattern))) return true
    return (
      RESOLVED_EXECUTABLE.some((pattern) => content.includes(pattern)) &&
      content.includes("spawn(")
    )
  }

  function findGitEngines(): string[] {
    const found: string[] = []

    for (const root of SCAN_ROOTS) {
      for (const fullPath of listSourceFiles(path.join(repoRoot, root))) {
        const rel = path.relative(repoRoot, fullPath).split(path.sep).join("/")
        // The canonical owner is allowed to spawn Git; that is its job.
        if (rel.startsWith("apps/projectd/src/git/")) continue
        if (rel.includes("/node_modules/") || rel.includes("/vendor/")) continue

        if (executesGit(fs.readFileSync(fullPath, "utf8"))) found.push(rel)
      }
    }

    return found.sort()
  }

  it("grows no new Git execution engine outside the canonical owner", () => {
    const unexpected = findGitEngines().filter((rel) => !KNOWN_GIT_ENGINES.includes(rel))

    expect(
      unexpected,
      "New raw Git execution found. Route it through projectd's GitService/GitProcess, " +
        "or, if it genuinely belongs here, add it to KNOWN_GIT_ENGINES with a reason.",
    ).toEqual([])
  })

  it("detects every engine it pins, so the ratchet cannot go hollow", () => {
    // Without this, rewriting an engine into a shape the patterns above do not
    // recognise would leave the suite green and the rule meaningless -- which
    // is how the version this replaced managed to pass.
    const detected = new Set(findGitEngines())
    const invisible = KNOWN_GIT_ENGINES.filter((rel) => !detected.has(rel))

    expect(
      invisible,
      "A pinned engine is no longer detected. Either it is gone -- remove it from " +
        "KNOWN_GIT_ENGINES -- or it now spawns Git in a shape the patterns miss, " +
        "in which case teach them that shape.",
    ).toEqual([])
  })

  it("confirms legacy desktop Git services are deleted", () => {
    const forbiddenFiles = [
      "apps/desktop/electron/services/projectGitDesktopService.ts",
      "apps/desktop/electron/services/gitSyncService.ts",
      "apps/desktop/electron/services/gitReplayWorkspaceState.ts",
      "apps/desktop/electron/services/syncJournalStore.ts",
      "apps/desktop/electron/substrate/vcs/collabPush.ts",
      // A third `git status` parser, orphaned when the sync service went. It
      // split output on newlines without `-z`, so any path containing one
      // corrupted the result.
      "apps/desktop/electron/services/gitSyncShared.ts",
      // A window CustomEvent bus with no dispatchers and no listeners.
      "apps/desktop/src/lib/git/gitStatusEvents.ts",
    ]

    for (const file of forbiddenFiles) {
      expect(fs.existsSync(path.join(repoRoot, file)), `Expected ${file} to be deleted`).toBe(
        false,
      )
    }
  })

  it("keeps the retired Git IPC channels retired", () => {
    // Removed 2026-09-16: declared on the preload bridge with no renderer
    // caller. Re-exposing one means someone needs it -- wire the caller in the
    // same change, and take it off this list deliberately.
    const retiredChannels = [
      "gitCaptureCheckpoint",
      "gitDeleteCheckpointRefs",
      "gitGetHeadDiffStats",
      "gitListChanges",
      "gitReadChanges'",
      "gitReadChangesPatch",
      "gitReadCheckpointFilePair",
      "gitReadConflictFile",
      "gitResolveConflictFile",
    ]

    const preload = fs.readFileSync(
      path.join(repoRoot, "apps/desktop/electron/preload.ts"),
      "utf8",
    )
    const handlers = fs.readFileSync(
      path.join(repoRoot, "apps/desktop/electron/ipc/registerWorkspaceSyncHandlers.ts"),
      "utf8",
    )

    const resurrected = retiredChannels.filter(
      (channel) => preload.includes(channel) || handlers.includes(channel),
    )

    expect(resurrected, "A retired Git IPC channel is back without a caller.").toEqual([])
  })

  it("routes mutating Git IPC through projectd rather than a local spawn", () => {
    const rel = "apps/desktop/electron/ipc/registerProjectHandlers.ts"
    const content = fs.readFileSync(path.join(repoRoot, rel), "utf8")

    expect(content).not.toContain("projectGitDesktopService")
    expect(content).toContain("getSharedProjectdClient")

    /**
     * Mutating verbs this file still runs locally instead of asking projectd.
     *
     * `project:mergeLaneIntoCollab` checks out a branch and merges into it
     * through gitRuntime, because projectd exposes no generic merge RPC --
     * only `sessions.merge`, which is session-scoped. Closing this needs a new
     * daemon method, so it is recorded here rather than left invisible.
     */
    const ACCEPTED_LOCAL_MUTATIONS = ["'checkout'", "'merge'"]

    const localMutations = [
      "'checkout'",
      "'merge'",
      "'reset'",
      "'rebase'",
      "'cherry-pick'",
      "'revert'",
    ]
      .filter((verb) => content.includes(`[${verb}`))
      .filter((verb) => !ACCEPTED_LOCAL_MUTATIONS.includes(verb))

    expect(
      localMutations,
      "A mutating Git verb runs locally here. Add a projectd RPC and call it instead.",
    ).toEqual([])
  })

  it("keeps the workspace-sync handlers off the retired sync stack", () => {
    const content = fs.readFileSync(
      path.join(repoRoot, "apps/desktop/electron/ipc/registerWorkspaceSyncHandlers.ts"),
      "utf8",
    )

    expect(content).not.toContain("gitSyncService")
    expect(content).not.toContain("syncJournalStore")
    expect(content).toContain("gitStatus")
  })
})
