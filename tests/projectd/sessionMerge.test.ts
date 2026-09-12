import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { SessionMerger, pullRequestUrl } from "../../apps/projectd/src/autogit/SessionMerger"
import { GitService } from "../../apps/projectd/src/git/GitService"

/**
 * P22: merging a session takes its last save to Git, an immutable commit, into the
 * target branch, and never forces. A remote that refuses direct pushes gets a pull
 * request instead (Section 22).
 */

const BRANCH = "feat/live"

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

describe("merging a session into its target (P22)", () => {
  let dir: string
  let remote: string
  let folder: string
  let savedGlobalConfig: string | undefined
  let checkpoint: string
  let base: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-merge-"))
    // The person's own Git setup, kept apart from the Mac running the tests.
    savedGlobalConfig = process.env.GIT_CONFIG_GLOBAL
    process.env.GIT_CONFIG_GLOBAL = path.join(dir, "gitconfig")
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, "[user]\n\tname = Merge Tester\n\temail = merge@cozea.invalid\n")

    remote = path.join(dir, "remote.git")
    git(dir, "init", "-q", "--bare", "-b", "main", remote)
    folder = path.join(dir, "folder")
    git(dir, "clone", "-q", remote, folder)
    fs.writeFileSync(path.join(folder, "notes.md"), "one\ntwo\n")
    git(folder, "add", "-A")
    git(folder, "commit", "-q", "-m", "base")
    git(folder, "push", "-q", "origin", "main")
    base = git(folder, "rev-parse", "HEAD")
    git(folder, "checkout", "-q", "-b", BRANCH)
    fs.writeFileSync(path.join(folder, "notes.md"), "one\ntwo\nthree\n")
    git(folder, "commit", "-qam", "session work")
    git(folder, "push", "-q", "-u", "origin", BRANCH)
    checkpoint = git(folder, "rev-parse", "HEAD")
  })

  afterEach(() => {
    if (savedGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = savedGlobalConfig
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const merger = () =>
    new SessionMerger({ workspaceRoot: folder, branchName: BRANCH, targetBranch: "main", gitService: new GitService() })

  function pushToMainFromOutside(content: string): string {
    const outside = path.join(dir, `outside-${Date.now()}`)
    git(dir, "clone", "-q", "-b", "main", remote, outside)
    fs.writeFileSync(path.join(outside, "notes.md"), content)
    git(outside, "commit", "-qam", "outside")
    git(outside, "push", "-q", "origin", "main")
    return git(outside, "rev-parse", "HEAD")
  }

  it("previews the saved commit against the target without touching the folder", async () => {
    const preview = await merger().preview({ checkpointOid: checkpoint, unsavedChanges: 2 })
    expect(preview).toMatchObject({
      branch: BRANCH,
      targetBranch: "main",
      checkpointOid: checkpoint,
      targetOid: base,
      ahead: 1,
      behind: 0,
      clean: true,
      conflictingPaths: [],
      unsavedChanges: 2,
      pullRequestUrl: null,
    })
    expect(git(folder, "rev-parse", "HEAD")).toBe(checkpoint)
    expect(git(folder, "status", "--porcelain")).toBe("")
    await expect(merger().preview({ checkpointOid: null, unsavedChanges: 0 })).rejects.toMatchObject({ code: "NOT_SAVED" })
  })

  it("merges the reviewed save with a merge commit, as the person", async () => {
    const result = await merger().merge({
      checkpointOid: checkpoint,
      reviewedCheckpointOid: checkpoint,
      strategy: "merge",
      unsavedChanges: 0,
    })
    expect(result).toMatchObject({ outcome: "merged" })
    expect(git(remote, "rev-parse", "main")).toBe(result.mergeCommitOid)
    expect(git(remote, "log", "-1", "--format=%P", "main").split(" ")).toEqual([base, checkpoint])
    expect(git(remote, "log", "-1", "--format=%an", "main")).toBe("Merge Tester")
    expect(git(remote, "show", "main:notes.md")).toBe("one\ntwo\nthree")
  })

  it("squashes into one commit on top of the target", async () => {
    const outside = pushToMainFromOutside("zero\none\ntwo\n")
    const result = await merger().merge({
      checkpointOid: checkpoint,
      reviewedCheckpointOid: checkpoint,
      strategy: "squash",
      unsavedChanges: 0,
    })
    expect(result).toMatchObject({ outcome: "merged" })
    expect(git(remote, "log", "-1", "--format=%P", "main")).toBe(outside)
    expect(git(remote, "show", "main:notes.md")).toBe("zero\none\ntwo\nthree")
  })

  it("asks for another review when the save moved, and stops at conflicts", async () => {
    const moved = await merger().merge({
      checkpointOid: checkpoint,
      reviewedCheckpointOid: "0".repeat(40),
      strategy: "merge",
      unsavedChanges: 0,
    })
    expect(moved).toMatchObject({ outcome: "moved" })
    expect(git(remote, "rev-parse", "main")).toBe(base)

    pushToMainFromOutside("one\nTWO\n")
    fs.writeFileSync(path.join(folder, "notes.md"), "one\ntwo, from the session\nthree\n")
    git(folder, "commit", "-qam", "session edits line two")
    git(folder, "push", "-q", "origin", BRANCH)
    const latest = git(folder, "rev-parse", "HEAD")
    const preview = await merger().preview({ checkpointOid: latest, unsavedChanges: 0 })
    expect(preview).toMatchObject({ clean: false, conflictingPaths: ["notes.md"], behind: 1 })
    const conflicted = await merger().merge({
      checkpointOid: latest,
      reviewedCheckpointOid: latest,
      strategy: "merge",
      unsavedChanges: 0,
    })
    expect(conflicted.outcome).toBe("conflicts")
    expect(conflicted.message).toContain("notes.md changed on both sides")
  })

  it("offers a pull request when the remote refuses direct pushes to the target", async () => {
    fs.writeFileSync(
      path.join(remote, "hooks", "pre-receive"),
      '#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = refs/heads/main ]; then\n    echo "GH006: Protected branch update failed for refs/heads/main." >&2\n    exit 1\n  fi\ndone\nexit 0\n',
      { mode: 0o755 },
    )
    const result = await merger().merge({
      checkpointOid: checkpoint,
      reviewedCheckpointOid: checkpoint,
      strategy: "merge",
      unsavedChanges: 0,
    })
    expect(result).toMatchObject({ outcome: "needs_pull_request" })
    expect(result.message).toContain("Open a pull request instead")
    expect(git(remote, "rev-parse", "main")).toBe(base)
  })

  it("links to the host's pull request page, never with sign-in details", () => {
    expect(pullRequestUrl("https://ghp_secret@github.com/team/app.git", BRANCH, "main")).toBe(
      "https://github.com/team/app/compare/main...feat/live?expand=1",
    )
    expect(pullRequestUrl("git@github.com:team/app.git", BRANCH, "main")).toBe(
      "https://github.com/team/app/compare/main...feat/live?expand=1",
    )
    expect(pullRequestUrl("https://gitlab.com/team/app.git", BRANCH, "main")).toBe(
      "https://gitlab.com/team/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat%2Flive&merge_request%5Btarget_branch%5D=main",
    )
    expect(pullRequestUrl("/Users/someone/remote.git", BRANCH, "main")).toBeNull()
  })
})
