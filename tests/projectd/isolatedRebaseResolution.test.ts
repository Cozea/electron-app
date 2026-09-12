import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { GitService } from "../../apps/projectd/src/git/GitService"
import { RebaseJournal } from "../../apps/projectd/src/autogit/RebaseJournal"
import { IsolatedRebaseResolution } from "../../apps/projectd/src/autogit/IsolatedRebaseResolution"
import { useTestGitIdentity } from "../helpers/gitIdentity"

useTestGitIdentity()

it("resolves successive Git conflict steps without reapplying the prior step's choice", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-resolution-steps-"))
  const git = new GitService()
  const run = async (...args: string[]) => (await git.process.execute(args, { cwd: root })).stdout.trim()
  const commit = async (text: string, message: string) => {
    await fs.writeFile(path.join(root, "file.txt"), text)
    await run("add", "file.txt")
    await run("commit", "-m", message)
  }
  try {
    await run("init", "-b", "main")
    await commit("base\n", "base")
    await run("checkout", "-b", "session")
    await commit("first session\n", "first manual commit")
    await commit("second session\n", "second manual commit")
    const from = await run("rev-parse", "HEAD")
    await run("checkout", "main")
    await commit("target\n", "target")
    const onto = await run("rev-parse", "HEAD")
    const journal = await RebaseJournal.create(path.join(root, ".git"), "test-session", from, onto, 7)
    await run("worktree", "add", "--detach", journal.worktree, from)
    const initial = await git.process.execute(["rebase", "--merge", onto], { cwd: journal.worktree, allowNonZeroExit: true })
    expect(initial.success).toBe(false)
    const resolver = new IsolatedRebaseResolution(journal, git)
    const first = await resolver.review()
    const lostReply = vi.spyOn(journal, "finishResolutionStep").mockRejectedValueOnce(new Error("crash after Git advanced"))
    await expect(resolver.resolve(first.fingerprint, [{ path: "file.txt", kind: "content", content: Buffer.from("first resolved\n"), executable: true }])).rejects.toThrow(/crash after Git advanced/)
    lostReply.mockRestore()
    const interrupted = await RebaseJournal.open(path.join(root, ".git"), "test-session", journal.record.id)
    expect(interrupted.record.pendingResolution).toBeDefined()
    const next = await new IsolatedRebaseResolution(interrupted, git).continue()
    expect(next.state).toBe("conflicted")
    if (next.state !== "conflicted") throw new Error("Expected a second conflict step")
    expect(next.review.fingerprint).not.toBe(first.fingerprint)
    const restored = await RebaseJournal.open(path.join(root, ".git"), "test-session", journal.record.id)
    expect(restored.record.pendingResolution).toBeUndefined()
    const restarted = new IsolatedRebaseResolution(restored, git)
    await expect(restarted.resolve(first.fingerprint, [{ path: "file.txt", kind: "delete" }])).rejects.toThrow(/changed/)
    const final = await restarted.resolve(next.review.fingerprint, [{ path: "file.txt", kind: "variant", stage: 3 }])
    expect(final.state).toBe("computed")
    if (final.state !== "computed") throw new Error("Expected resolved rebase")
    expect(await run("log", "--format=%s", `${onto}..${final.commitOid}`)).toBe("second manual commit\nfirst manual commit")
    expect(await run("show", `${final.commitOid}:file.txt`)).toBe("second session")
    expect(await run("rev-parse", "session")).toBe(from)
    expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("target\n")
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
