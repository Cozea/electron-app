import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AuthorizedRepositoryDownloader } from "../../apps/desktop/electron/collaboration/AuthorizedRepositoryDownloader"
import type { CollaborationRepositoryBindingDescriptor, CollaborationRepositoryCredentialResponse } from "../../shared/collaborationRepository"
import type { LocalWorkspaceDTO } from "../../shared/workspaceTypes"

const exec = promisify(execFile)
let root: string, source: string, target: string
const url = "https://github.com/cozea/download-test.git"
const binding = { enabled: true, repositoryId: "github:1", repositoryNumericId: "1", defaultBranch: "main", fullName: "cozea/download-test", cloneUrl: url } as CollaborationRepositoryBindingDescriptor
const credential = { ...binding, token: "test-credential", username: "x-access-token", operation: "read", expiresAt: Number.MAX_SAFE_INTEGER } as CollaborationRepositoryCredentialResponse
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-download-")); source = path.join(root, "source"); target = path.join(root, "target")
  await fs.mkdir(source); await fs.mkdir(target)
  await exec("git", ["init", "-b", "main"], { cwd: source })
  await fs.writeFile(path.join(source, "text.txt"), "base text\n"); await fs.writeFile(path.join(source, "binary.bin"), Buffer.from([0, 1, 255]))
  await exec("git", ["add", "."], { cwd: source })
  await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"], { cwd: source })
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
function fixture() {
  const activate = vi.fn(async () => {})
  const progress = vi.fn()
  const state = { interrupted: false, interruptOn: "", changedCredential: credential }
  const allocate = vi.fn(async (_project: string, _slug: string, prepare: (directory: string) => Promise<void>) => { await prepare(target); return { workspaceId: "w", projectId: "p", projectRootPath: target } as LocalWorkspaceDTO })
  const git = vi.fn(async (args: string[], options: { cwd: string; env?: Record<string, string>; signal: AbortSignal }) => {
    if (state.interruptOn && args.includes(state.interruptOn) && !state.interrupted) { state.interrupted = true; throw new Error("Interrupted process") }
    // Real Git and filesystem; substitute only the remote network boundary.
    const remote = args.includes("fetch")
    const actual = remote ? args.map(value => value === url ? source : value) : args
    if (remote) expect(options.env?.GIT_CONFIG_VALUE_0).toContain("Authorization: Basic")
    try { const result = await exec("git", actual, { cwd: options.cwd, signal: options.signal }); return { success: true, ...result } }
    catch { return { success: false, stdout: "", stderr: "test-credential must not escape" } }
  })
  const downloader = new AuthorizedRepositoryDownloader({ binding: async () => binding, credential: async () => state.changedCredential, allocate, git, activate, progress })
  return { downloader, state, git, allocate, activate, progress }
}
it.each(["repositoryId", "repositoryNumericId", "defaultBranch", "fullName", "cloneUrl"])("rejects changed %s before filesystem allocation", async field => {
  const f = fixture(); f.state.changedCredential = { ...credential, [field]: "changed" }
  await expect(f.downloader.download("p", "repo")).rejects.toThrow("binding changed")
  expect(f.allocate).not.toHaveBeenCalled()
})
it("downloads text and binaries with memory-only credentials and joins simultaneous requests", async () => {
  const f = fixture(); const first = f.downloader.download("p", "repo")
  expect(f.downloader.download("p", "repo")).toBe(first)
  await first
  expect(await fs.readFile(path.join(target, "text.txt"), "utf8")).toBe("base text\n")
  expect(await fs.readFile(path.join(target, "binary.bin"))).toEqual(Buffer.from([0, 1, 255]))
  expect(await fs.readFile(path.join(target, ".git/config"), "utf8")).not.toContain("test-credential")
  expect(f.activate).toHaveBeenCalledOnce()
  expect(f.progress.mock.calls.map(([event]) => event.phase)).toEqual(["authorizing", "fetching", "materializing", "complete"])
})
it("resumes after interruption before checkout and never overwrites a local edit", async () => {
  const f = fixture(); f.state.interruptOn = "checkout-index"
  await expect(f.downloader.download("p", "repo")).rejects.toThrow("Interrupted")
  expect(f.activate).not.toHaveBeenCalled()
  await fs.writeFile(path.join(target, "text.txt"), "unpublished local edit\n")
  await expect(f.downloader.download("p", "repo")).rejects.toThrow("local changes")
  expect(await fs.readFile(path.join(target, "text.txt"), "utf8")).toBe("unpublished local edit\n")
  await fs.rename(path.join(target, "text.txt"), path.join(root, "retained.txt"))
  await f.downloader.download("p", "repo")
  expect(await fs.readFile(path.join(target, "text.txt"), "utf8")).toBe("base text\n")
})
it("cancels before mutation and lets a subsequent request retry", async () => {
  const f = fixture(); const pending = f.downloader.download("p", "repo"); f.downloader.cancel("p")
  await expect(pending).rejects.toThrow("cancelled")
  expect(f.allocate).not.toHaveBeenCalled()
  await f.downloader.download("p", "repo")
  expect(f.activate).toHaveBeenCalledOnce()
})
it.each(["branch", "commit", "index"])("rejects replaced %s even when working files appear clean", async kind => {
  const f = fixture()
  await f.downloader.download("p", "repo")
  if (kind === "branch") await exec("git", ["checkout", "-b", "unrelated"], { cwd: target })
  else {
    await fs.writeFile(path.join(target, "text.txt"), "unrelated change\n")
    await exec("git", ["add", "text.txt"], { cwd: target })
    if (kind === "commit") await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "unrelated"], { cwd: target })
  }
  f.activate.mockClear()
  await expect(f.downloader.download("p", "repo")).rejects.toThrow("Git state changed")
  expect(f.activate).not.toHaveBeenCalled()
  expect(await fs.readFile(path.join(target, "text.txt"), "utf8")).toBe(kind === "branch" ? "base text\n" : "unrelated change\n")
})
