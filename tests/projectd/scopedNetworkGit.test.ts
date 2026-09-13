import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { GitProcess } from "../../apps/projectd/src/git/GitProcess"
import { executeScopedNetworkGit } from "../../apps/projectd/src/git/ScopedNetworkGit"

it("resolves fetch and push scopes independently without changing repository configuration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-scoped-git-"))
  const git = new GitProcess()
  try {
    await git.execute(["init", "-q"], { cwd: root })
    await git.execute(["remote", "add", "origin", "git@github.com:team/read.git"], { cwd: root })
    await git.execute(["config", "remote.origin.pushurl", "https://github.com/team/write.git"], { cwd: root })
    const execute = git.execute.bind(git)
    const network: string[][] = []
    const sockets: string[] = []
    vi.spyOn(git, "execute").mockImplementation(async (args, options) => {
      if (!["fetch", "push", "ls-remote"].includes(args[0]!)) return execute(args, options)
      network.push(args)
      expect(JSON.stringify(args) + JSON.stringify(options.env)).not.toContain("fixture-secret")
      sockets.push(options.env!.COZEA_GIT_CREDENTIAL_SOCKET!)
      expect((await fs.stat(sockets.at(-1)!)).isSocket()).toBe(true)
      return { success: true, exitCode: 0, stdout: "", stderr: "fixture-secret", stdoutBuffer: Buffer.alloc(0), stderrBuffer: Buffer.from("fixture-secret") }
    })
    const credentials = vi.fn(async () => "fixture-secret")
    const result = await executeScopedNetworkGit(git, ["fetch", "--no-tags", "origin", "main"], "origin", { cwd: root }, credentials)
    expect(result.stderr).toBe("[redacted]")
    expect(result.stderrBuffer.toString()).toBe("[redacted]")
    await expect(executeScopedNetworkGit(git, ["push", "--porcelain", "origin", "HEAD:refs/heads/session"], "origin", { cwd: root }, credentials)).rejects.toThrow("same repository")
    expect(credentials).toHaveBeenCalledTimes(1)
    await execute(["config", "remote.origin.pushurl", "https://github.com/team/read.git"], { cwd: root })
    await executeScopedNetworkGit(git, ["push", "--porcelain", "origin", "HEAD:refs/heads/session"], "origin", { cwd: root }, credentials)
    expect(credentials.mock.calls).toEqual([[{ owner: "team", repository: "read" }], [{ owner: "team", repository: "read" }]])
    expect(network[0]).toContain("https://github.com/team/read.git")
    expect(network[1]).toContain("https://github.com/team/read.git")
    expect((await execute(["remote", "get-url", "origin"], { cwd: root })).stdout.trim()).toBe("git@github.com:team/read.git")
    for (const socket of sockets) await expect(fs.stat(socket)).rejects.toMatchObject({ code: "ENOENT" })
    await execute(["config", "--add", "remote.origin.pushurl", "https://github.com/team/other.git"], { cwd: root })
    await expect(executeScopedNetworkGit(git, ["push", "origin", "HEAD:refs/heads/session"], "origin", { cwd: root }, credentials)).rejects.toThrow("unambiguous")
    expect(network).toHaveLength(2)
    await execute(["config", "url.git@elsewhere.test:.insteadOf", "https://github.com/"], { cwd: root })
    await expect(executeScopedNetworkGit(git, ["fetch", "origin", "main"], "origin", { cwd: root }, credentials)).rejects.toThrow("URL rewriting")
    expect(network).toHaveLength(2)
  } finally { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) }
})
