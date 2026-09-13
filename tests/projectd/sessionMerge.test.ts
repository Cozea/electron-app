import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SessionMerger, pullRequestUrl } from "../../apps/projectd/src/autogit/SessionMerger"
import { GitService } from "../../apps/projectd/src/git/GitService"
import { GitHubSessionPullRequest } from "../../apps/projectd/src/autogit/GitHubSessionPullRequest"
import { TargetWatcher } from "../../apps/projectd/src/autogit/TargetWatcher"

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
      reviewedCheckpointOid: checkpoint, reviewedTargetOid: base,
      strategy: "merge",
      unsavedChanges: 0,
    })
    expect(result).toMatchObject({ outcome: "merged" })
    expect(git(remote, "rev-parse", "main")).toBe(result.mergeCommitOid)
    expect(git(remote, "log", "-1", "--format=%P", "main").split(" ")).toEqual([base, checkpoint])
    expect(git(remote, "log", "-1", "--format=%an", "main")).toBe("Merge Tester")
    expect(git(remote, "show", "main:notes.md")).toBe("one\ntwo\nthree")
  })

  it("routes target checks and merges through scoped credentials", async () => {
    const service = new GitService()
    const execute = service.process.execute.bind(service.process)
    git(folder, "remote", "set-url", "origin", "https://github.com/team/app.git")
    const credentials = vi.fn(async () => "fixture-secret")
    vi.spyOn(service.process, "execute").mockImplementation((args, options) => {
      if (["fetch", "push"].includes(args[0]!)) {
        expect(options.env?.COZEA_GIT_CREDENTIAL_SOCKET).toBeTruthy()
        expect(JSON.stringify(options.env)).not.toContain("fixture-secret")
        expect(args).toContain("https://github.com/team/app.git")
        return execute(args.map((arg) => arg === "https://github.com/team/app.git" ? remote : arg), options)
      }
      return execute(args, options)
    })
    const watcher = new TargetWatcher({ workspaceRoot: folder, branchName: BRANCH, targetBranch: "main", gitService: service,
      repositoryCredentials: credentials, onChange: () => {} })
    await watcher.checkNow(true)
    expect(credentials).toHaveBeenCalledWith({ owner: "team", repository: "app" })
    const session = new SessionMerger({ workspaceRoot: folder, branchName: BRANCH, targetBranch: "main", gitService: service, repositoryCredentials: credentials })
    const result = await session.merge({ checkpointOid: checkpoint, reviewedCheckpointOid: checkpoint, reviewedTargetOid: base, strategy: "merge", unsavedChanges: 0 })
    expect(result.outcome).toBe("merged")
    expect(git(remote, "rev-parse", "main")).toBe(result.mergeCommitOid)
    expect(credentials).toHaveBeenCalledTimes(3)
  })

  it("refuses review and merge when an external push moves the published session branch", async () => {
    const outside = path.join(dir, "outside-session")
    git(dir, "clone", "-q", "-b", BRANCH, remote, outside)
    fs.writeFileSync(path.join(outside, "external.txt"), "external session change")
    git(outside, "add", "-A")
    git(outside, "commit", "-qm", "outside session edit")
    git(outside, "push", "-q", "origin", BRANCH)
    const advanced = git(outside, "rev-parse", "HEAD")
    await expect(merger().preview({ checkpointOid: checkpoint, unsavedChanges: 0 })).rejects.toMatchObject({ code: "REMOTE_SESSION_CHANGED" })
    await expect(merger().merge({ checkpointOid: checkpoint, reviewedCheckpointOid: checkpoint, reviewedTargetOid: base,
      strategy: "merge", unsavedChanges: 0 })).rejects.toMatchObject({ code: "REMOTE_SESSION_CHANGED" })
    expect(git(remote, "rev-parse", "main")).toBe(base)
    expect(git(folder, "rev-parse", "HEAD")).toBe(checkpoint)
    expect(git(folder, "status", "--porcelain")).toBe("")
    expect(await merger().preview({ checkpointOid: advanced, unsavedChanges: 0 })).toMatchObject({ checkpointOid: advanced, ahead: 2 })
    // A rewritten/rewound remote is also a mismatch, even though the old commit exists locally.
    git(remote, "update-ref", `refs/heads/${BRANCH}`, base)
    await expect(merger().preview({ checkpointOid: advanced, unsavedChanges: 0 })).rejects.toMatchObject({ code: "REMOTE_SESSION_CHANGED" })
  })

  it("squashes into one commit on top of the target", async () => {
    const outside = pushToMainFromOutside("zero\none\ntwo\n")
    const stale = await merger().merge({ checkpointOid: checkpoint, reviewedCheckpointOid: checkpoint,
      reviewedTargetOid: base, strategy: "squash", unsavedChanges: 0 })
    expect(stale.outcome).toBe("moved")
    expect(git(remote, "rev-parse", "main")).toBe(outside)
    const result = await merger().merge({
      checkpointOid: checkpoint,
      reviewedCheckpointOid: checkpoint, reviewedTargetOid: outside,
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
      reviewedCheckpointOid: "0".repeat(40), reviewedTargetOid: base,
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
      reviewedCheckpointOid: latest, reviewedTargetOid: preview.targetOid,
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
      reviewedCheckpointOid: checkpoint, reviewedTargetOid: base,
      strategy: "merge",
      unsavedChanges: 0,
    })
    expect(result).toMatchObject({ outcome: "needs_pull_request" })
    expect(result.message).toContain("Open a pull request instead")
    expect(git(remote, "rev-parse", "main")).toBe(base)
  })

  it("calls the PR provider only for the exact reviewed and fully saved commits", async () => {
    const provider = new GitHubSessionPullRequest({ getRepositoryToken: async () => { throw new Error("fixture must not authenticate") } })
    const ensure = vi.spyOn(provider, "ensure").mockResolvedValue({ number: 1, url: "https://github.com/team/app/pull/1", state: "open", created: true })
    const session = new SessionMerger({ workspaceRoot: folder, branchName: BRANCH, targetBranch: "main", gitService: new GitService(), pullRequests: provider })
    const request = { checkpointOid: checkpoint, reviewedCheckpointOid: checkpoint, reviewedTargetOid: base, unsavedChanges: 0 }
    await expect(session.createPullRequest({ ...request, unsavedChanges: 1 })).rejects.toMatchObject({ code: "REVIEW_CHANGED" })
    await expect(session.createPullRequest({ ...request, reviewedTargetOid: "0".repeat(40) })).rejects.toMatchObject({ code: "REVIEW_CHANGED" })
    expect(ensure).not.toHaveBeenCalled()
    expect(await session.createPullRequest(request)).toMatchObject({ number: 1, created: true })
    expect(ensure).toHaveBeenCalledWith({ remoteUrl: remote, branch: BRANCH, targetBranch: "main", checkpointOid: checkpoint, targetOid: base })
    expect(git(remote, "rev-parse", "main")).toBe(base)
  })

  it("creates or finds a PR after a protected push and retains retry information on authorization failure", async () => {
    fs.writeFileSync(path.join(remote, "hooks/pre-receive"), '#!/bin/sh\necho "GH013: Repository rule violations found" >&2\nexit 1\n', { mode: 0o755 })
    const provider = new GitHubSessionPullRequest({ getRepositoryToken: async () => { throw new Error("fixture") } })
    const ensure = vi.spyOn(provider, "ensure").mockResolvedValue({ number: 9, url: "https://github.com/team/app/pull/9", state: "open", created: false })
    const session = new SessionMerger({ workspaceRoot: folder, branchName: BRANCH, targetBranch: "main", gitService: new GitService(), pullRequests: provider })
    const request = { checkpointOid: checkpoint, reviewedCheckpointOid: checkpoint, reviewedTargetOid: base, strategy: "merge" as const, unsavedChanges: 0 }
    expect(await session.merge(request)).toMatchObject({ outcome: "needs_pull_request", pullRequestUrl: "https://github.com/team/app/pull/9", pullRequest: { number: 9, created: false } })
    expect(ensure).toHaveBeenCalledWith({ remoteUrl: remote, branch: BRANCH, targetBranch: "main", checkpointOid: checkpoint, targetOid: base })
    expect(git(remote, "rev-parse", "main")).toBe(base)
    expect(git(remote, "rev-parse", BRANCH)).toBe(checkpoint)
    ensure.mockRejectedValue(new Error("credential secret"))
    const failed = await session.merge(request)
    expect(failed.outcome).toBe("needs_pull_request")
    expect(failed.message).toContain("could not create or verify")
    expect(JSON.stringify(failed)).not.toContain("credential secret")
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
