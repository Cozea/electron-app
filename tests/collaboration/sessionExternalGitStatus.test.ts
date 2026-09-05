import { expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SessionWorkspaceCoordinator } from "../../apps/desktop/electron/collaboration/SessionWorkspaceCoordinator"
it("preserves NUL-delimited Git rename evidence and paths containing spaces and tabs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-external-status-"))
  const oldPath = "original name\t.txt", newPath = "new name\t.txt"
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root }).toString()
  try {
    git("init", "-q"); await fs.writeFile(path.join(root, oldPath), "base\n"); git("add", ".")
    git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "base")
    await fs.rename(path.join(root, oldPath), path.join(root, newPath)); git("add", "-A")
    await fs.writeFile(path.join(root, "untracked path.txt"), "local")
    const changes = await SessionWorkspaceCoordinator.prototype.externalChanges.call({
      workspaceForSession: async () => ({ projectRootPath: root }),
      git: async (_cwd: string, args: string[]) => git(...args),
    } as unknown as SessionWorkspaceCoordinator, "s")
    expect(changes.renames).toEqual([{ from: oldPath, to: newPath, score: 100 }])
    expect(changes.paths).toEqual(expect.arrayContaining([oldPath, newPath, "untracked path.txt"]))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
