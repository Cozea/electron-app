import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { TargetBranchTracker } from "../../apps/projectd/src/autogit/TargetBranchTracker"
import { GitService } from "../../apps/projectd/src/git/GitService"

/**
 * P20: how far the target moved, and whether a rebase is worth it (Section 20.1 -
 * 20.3). The tracker recommends and explains; it never rebases (C25).
 */

const SESSION_BRANCH = "feat/live"

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Cozea Test", "-c", "user.email=test@cozea.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  ).trim()
}

describe("target tracking (P20)", () => {
  let repo: string
  let tracker: TargetBranchTracker

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-target-"))
    git(repo, "init", "-q", "-b", "main")
    fs.writeFileSync(path.join(repo, "shared.ts"), "export const x = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "base")
    git(repo, "branch", SESSION_BRANCH)
    tracker = new TargetBranchTracker(new GitService())
  })

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  const measure = (options: { isManualCheck?: boolean; sessionActiveSince?: number; now?: number } = {}) =>
    tracker.measure({
      repoPath: repo,
      sessionRef: `refs/heads/${SESSION_BRANCH}`,
      targetRef: "refs/heads/main",
      targetName: "main",
      ...options,
    })

  function commitsOnMain(count: number, file?: string): void {
    for (let index = 1; index <= count; index += 1) {
      if (file) {
        fs.writeFileSync(path.join(repo, file), `export const x = ${index + 100}\n`)
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", `main ${index}`)
      } else {
        git(repo, "commit", "-q", "--allow-empty", "-m", `main ${index}`)
      }
    }
  }

  function sessionEdits(file: string): void {
    git(repo, "checkout", "-q", SESSION_BRANCH)
    fs.writeFileSync(path.join(repo, file), "export const x = 2\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "session edit")
    git(repo, "checkout", "-q", "main")
  }

  it("says nothing while the session branch has everything the target has", async () => {
    sessionEdits("shared.ts")
    expect(await measure()).toMatchObject({ behind: 0, ahead: 1, recommended: false, reason: null })
  })

  it("recommends a rebase once the target is far ahead, and never rebases", async () => {
    commitsOnMain(20)
    const before = git(repo, "rev-parse", SESSION_BRANCH)

    const measured = await measure()
    expect(measured).toMatchObject({ behind: 20, ahead: 0, recommended: true })
    expect(measured.reason).toBe("main has 20 commits this session's branch doesn't have.")
    expect(git(repo, "rev-parse", SESSION_BRANCH)).toBe(before)
  })

  it("names the files both sides changed", async () => {
    sessionEdits("shared.ts")
    commitsOnMain(5, "shared.ts")

    const measured = await measure()
    expect(measured).toMatchObject({ behind: 5, ahead: 1, overlappingPaths: ["shared.ts"], recommended: true })
    expect(measured.reason).toBe("main changed shared.ts, which the session changed too.")
  })

  it("keeps quiet about a small move unless someone asks", async () => {
    commitsOnMain(3, "other.ts")

    expect(await measure()).toMatchObject({ behind: 3, recommended: false, reason: null })
    const asked = await measure({ isManualCheck: true })
    expect(asked).toMatchObject({ recommended: true })
    expect(asked.reason).toBe("main has 3 commits this session's branch doesn't have.")
  })

  it("hides a dismissed recommendation for a while, except from someone who asks", async () => {
    commitsOnMain(20)
    const now = Date.now()
    tracker.dismissRecommendation(now)

    expect(await measure({ now: now + 60_000 })).toMatchObject({ behind: 20, recommended: false, reason: null })
    expect(await measure({ now: now + 60_000, isManualCheck: true })).toMatchObject({ recommended: true })
    expect(await measure({ now: now + 2 * 60 * 60_000 })).toMatchObject({ recommended: true })
  })

  it("recommends a rebase to a session that has run for over a day once the target moved", async () => {
    commitsOnMain(1)
    const now = Date.now()

    const measured = await measure({ now, sessionActiveSince: now - 25 * 60 * 60_000 })
    expect(measured).toMatchObject({ behind: 1, recommended: true })
    expect(measured.reason).toBe("The session has run for over a day, and main has moved on by 1 commit.")
  })
})
