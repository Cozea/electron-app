import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { SessionFileDocument } from "../../shared/SessionFileDocument"
import { SessionFileProjection } from "../../apps/desktop/electron/collaboration/SessionFileProjection"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture(role: "editor" | "observer" = "editor") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-projection-")); roots.push(root)
  const workspace = path.join(root, "workspace"); await fs.mkdir(workspace)
  execFileSync("git", ["init", "-q", workspace])
  await fs.writeFile(path.join(workspace, "a.txt"), "base\n")
  execFileSync("git", ["add", "a.txt"], { cwd: workspace })
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "base"], { cwd: workspace })
  const files = new SessionFileDocument("s")
  files.initializeFile({ id: "a", path: "a.txt", originalPath: "a.txt", content: "base\n" })
  const store = new DurableSessionStore(path.join(root, "encrypted"), "session:s")
  const persistEdits = vi.fn(async () => {})
  const options = { sessionId: "s", root: workspace, recoveryRoot: path.join(root, "retained"), files, role,
    roomKeyBase64: Buffer.alloc(32, 7).toString("base64"), keyVersion: 1, store, persistEdits,
    readBase: async (name: string) => name === "a.txt" ? { content: "base\n", executable: false } : null,
  }
  return { root, workspace, files, store, options, persistEdits, projector: new SessionFileProjection(options), read: (name = "a.txt") => fs.readFile(path.join(workspace, name), "utf8") }
}

describe("durable session file projection", () => {
  it("merges formatter writes against the last projected CRDT and does not feed projection back", async () => {
    const f = await fixture()
    const externalUpdates = vi.fn()
    f.files.doc.on("update", (_update, origin) => { if (origin === "external-write") externalUpdates() })
    await f.projector.reconcile()
    f.files.text("a").insert(0, "remote\n")
    await fs.writeFile(path.join(f.workspace, "a.txt"), "base\nformatted\n")
    await f.projector.reconcile()
    expect(await f.read()).toBe("remote\nbase\nformatted\n")
    expect(f.files.file("a")?.content).toBe(await f.read())
    expect(externalUpdates).toHaveBeenCalledTimes(1)
    await f.projector.reconcile()
    expect(externalUpdates).toHaveBeenCalledTimes(1)
    const encrypted = await f.store.readProjection()
    expect(encrypted).not.toContain("formatted")
  })

  it("restarts with pending disk edits and preserves both shared and external history", async () => {
    const f = await fixture(); await f.projector.reconcile()
    await fs.writeFile(path.join(f.workspace, "a.txt"), "base\nfirst\n")
    await f.projector.reconcile()
    f.files.text("a").insert(0, "remote\n")
    await fs.writeFile(path.join(f.workspace, "a.txt"), "base\nfirst\nsecond\n")
    await new SessionFileProjection(f.options).reconcile()
    expect(await f.read()).toBe("remote\nbase\nfirst\nsecond\n")
  })

  it("retains a renamed file inode for late writes and projects its newer text", async () => {
    const f = await fixture(); await f.projector.reconcile()
    const old = await fs.open(path.join(f.workspace, "a.txt"), "r+")
    f.files.renameFile("a", "nested/b.txt"); f.files.text("a").insert(0, "renamed\n")
    await f.projector.reconcile()
    await old.writeFile("late writer\n"); await old.close()
    expect(await f.read("nested/b.txt")).toBe("renamed\nbase\n")
    await expect(f.read()).rejects.toMatchObject({ code: "ENOENT" })
    const retained = await fs.readdir(f.options.recoveryRoot)
    expect(await fs.readFile(path.join(f.options.recoveryRoot, retained[0]!), "utf8")).toBe("late writer\n")
  })

  it("pauses on a rename collision without overwriting the unrelated target", async () => {
    const f = await fixture(); await f.projector.reconcile()
    await fs.writeFile(path.join(f.workspace, "b.txt"), "unrelated work")
    f.files.renameFile("a", "b.txt")
    await expect(f.projector.reconcile()).rejects.toThrow("both versions")
    expect(await f.read("b.txt")).toBe("unrelated work")
    expect((await fs.readdir(f.options.recoveryRoot)).length).toBe(1)
    await fs.rename(path.join(f.workspace, "b.txt"), path.join(f.workspace, "recovered.txt"))
    await new SessionFileProjection(f.options).reconcile()
    expect(await f.read("b.txt")).toBe("base\n")
  })

  it("does not change disk if persisting the intent fails", async () => {
    const f = await fixture(); await f.projector.reconcile()
    f.files.replaceText("a", "next")
    vi.spyOn(f.store, "saveProjection").mockRejectedValueOnce(new Error("storage full"))
    await expect(f.projector.reconcile()).rejects.toThrow("storage full")
    expect(await f.read()).toBe("base\n")
    await new SessionFileProjection(f.options).reconcile()
    expect(await f.read()).toBe("next")
  })

  it("keeps delete/edit text recoverable and rejects observer writes and symlinks", async () => {
    const f = await fixture(); await f.projector.reconcile()
    f.files.text("a").insert(0, "remote\n")
    await fs.unlink(path.join(f.workspace, "a.txt"))
    await f.projector.reconcile()
    expect(f.files.file("a")).toMatchObject({ deleted: true, content: "remote\nbase\n" })
    const observer = await fixture("observer"); await observer.projector.reconcile()
    await fs.writeFile(path.join(observer.workspace, "a.txt"), "local observer work")
    await expect(observer.projector.reconcile()).rejects.toThrow("Observer")
    expect(await observer.read()).toBe("local observer work")
    const symlink = await fixture(); await symlink.projector.reconcile()
    await fs.symlink(os.tmpdir(), path.join(symlink.workspace, "outside"))
    symlink.files.renameFile("a", "outside/escape.txt")
    await expect(symlink.projector.reconcile()).rejects.toThrow("symlink")
  })
})
