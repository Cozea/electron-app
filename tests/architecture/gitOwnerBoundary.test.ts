import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Architecture boundary test (P05 / P26):
 * Ensures all Git operations route through the canonical GitService / GitProcess.
 * Direct invocation of git CLI outside allowed git implementation files is forbidden,
 * and legacy desktop Git services are retired.
 */
describe("Git owner consolidation boundary", () => {
  const repoRoot = process.cwd()

  it("forbids raw git process execution in projectd outside apps/projectd/src/git", () => {
    const projectdSrc = path.join(repoRoot, "apps/projectd/src")
    if (!fs.existsSync(projectdSrc)) return

    const files = fs.readdirSync(projectdSrc, { recursive: true }) as string[]
    const violations: string[] = []

    for (const rel of files) {
      if (!rel.endsWith(".ts")) continue
      if (rel.startsWith("git/") || rel.startsWith("git\\")) continue // Allowed git layer

      const fullPath = path.join(projectdSrc, rel)
      const content = fs.readFileSync(fullPath, "utf8")

      // Look for direct child_process spawns of "git"
      if (
        (content.includes('spawn("git"') ||
          content.includes("spawn('git'") ||
          content.includes('execFile("git"') ||
          content.includes("execFile('git'") ||
          content.includes('execSync("git') ||
          content.includes("execSync('git")) &&
        !content.includes("GitProcess")
      ) {
        violations.push(rel)
      }
    }

    expect(violations).toEqual([])
  })

  it("confirms legacy desktop Git services are deleted", () => {
    const forbiddenFiles = [
      "apps/desktop/electron/services/projectGitDesktopService.ts",
      "apps/desktop/electron/services/gitSyncService.ts",
      "apps/desktop/electron/services/gitReplayWorkspaceState.ts",
      "apps/desktop/electron/services/syncJournalStore.ts",
      "apps/desktop/electron/substrate/vcs/collabPush.ts",
    ]

    for (const file of forbiddenFiles) {
      const fullPath = path.join(repoRoot, file)
      expect(fs.existsSync(fullPath), `Expected ${file} to be deleted`).toBe(false)
    }
  })

  it("asserts IPC handlers route Git operations via ProjectdClient and never invoke legacy services", () => {
    const registerProjectHandlers = fs.readFileSync(
      path.join(repoRoot, "apps/desktop/electron/ipc/registerProjectHandlers.ts"),
      "utf8",
    )
    const registerWorkspaceSyncHandlers = fs.readFileSync(
      path.join(repoRoot, "apps/desktop/electron/ipc/registerWorkspaceSyncHandlers.ts"),
      "utf8",
    )

    expect(registerProjectHandlers).not.toContain("projectGitDesktopService")
    expect(registerProjectHandlers).toContain("getSharedProjectdClient")
    expect(registerProjectHandlers).toContain("gitProjectBranches")
    expect(registerProjectHandlers).toContain("gitCheckout")
    expect(registerProjectHandlers).toContain("gitCreateWorktree")

    expect(registerWorkspaceSyncHandlers).not.toContain("gitSyncService")
    expect(registerWorkspaceSyncHandlers).not.toContain("syncJournalStore")
    expect(registerWorkspaceSyncHandlers).toContain("gitStatus")
  })
})
