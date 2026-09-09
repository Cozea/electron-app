import { afterEach, describe, expect, it } from "vitest"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { SessionFileDocument } from "../../shared/SessionFileDocument"
import { validatePublishedManifest, type SessionPublishedManifest } from "../../shared/collaborationPublication"
import { buildCollaborationSessionBranch } from "../../shared/collaborationSession"
import { encodePublicationBasis, manifestFromPublicationBasis, gitTextBlobOid } from "../../apps/desktop/electron/collaboration/PublicationBasis"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
import { SessionWorkspaceCoordinator, type CollaborationGitResult } from "../../apps/desktop/electron/collaboration/SessionWorkspaceCoordinator"
import type { CollaborationWorkspaceAuthority, SessionWorkspaceBinding } from "../../shared/collaborationDesktop"
import type { LocalWorkspaceDTO } from "../../shared/workspaceTypes"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
const context = { sessionId: "czs_publication_fixture", projectId: "project_publication", roomId: "session:czs_publication_fixture", keyVersion: 1, roomKeyBase64: Buffer.alloc(32, 9).toString("base64") }

async function git(cwd: string, args: string[], env: Record<string, string> = {}, stdin?: string): Promise<CollaborationGitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", ...env }, stdio: ["pipe", "pipe", "pipe"] })
    const out: Buffer[] = [], errors: Buffer[] = []
    child.stdout.on("data", bytes => out.push(Buffer.from(bytes))); child.stderr.on("data", bytes => errors.push(Buffer.from(bytes)))
    child.on("error", reject)
    child.on("close", code => resolve({ success: code === 0, stdout: Buffer.concat(out).toString("utf8"), stdoutBytes: Buffer.concat(out), stderr: Buffer.concat(errors).toString("utf8") }))
    child.stdin.end(stdin)
  })
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-publication-")); roots.push(root)
  const run = async (...args: string[]) => { const result = await git(root, args); if (!result.success) throw new Error(result.stderr); return result.stdout.trim() }
  await run("init", "-b", "main")
  await run("config", "user.name", "Collaboration Fixture"); await run("config", "user.email", "fixture@example.invalid")
  await fs.writeFile(path.join(root, "a.ts"), "export const value = 1\n")
  await fs.writeFile(path.join(root, "unopened.bin"), Buffer.from([0, 1, 255]))
  await run("add", "."); await run("commit", "-m", "initial")
  const initial = await run("rev-parse", "HEAD")
  const branch = buildCollaborationSessionBranch(context.sessionId)
  await run("checkout", "-b", branch)
  const workspace = { workspaceId: "workspace_fixture", projectId: context.projectId, storageOwnership: "managed", verificationStatus: "verified", projectRootPath: root, gitRootPath: root } as LocalWorkspaceDTO
  let binding: SessionWorkspaceBinding = { generation: 3, sessionId: context.sessionId, projectId: context.projectId, repositoryId: "fixture/repository", workspaceId: workspace.workspaceId, sourceWorkspaceId: "source_fixture", sessionBranch: branch, baseCommitSha: initial, role: "editor", state: "active", joinedAt: Date.now() }
  const session: CollaborationWorkspaceAuthority["session"] = { id: context.sessionId, projectId: context.projectId, repositoryId: binding.repositoryId, targetBranch: "main", sessionBranch: branch,
    baseCommitSha: initial, publishedCommitSha: null, publishedThroughSequence: 0, roomHeadSequence: 0, createdByPrincipalId: "writer_fixture", commitLeasePrincipalId: "writer_fixture", commitLeaseExpiresAt: Date.now() + 300_000,
    pendingCommitSha: null, pendingCommitThroughSequence: null, pendingCommitCreatedAt: null, status: "commit_preparing", createdAt: Date.now(), updatedAt: Date.now(), closedAt: null }
  const values = new Map<string, string>([[`collaboration:g3:session:${context.sessionId}`, JSON.stringify(binding)]])
  const coordinator = new SessionWorkspaceCoordinator({ git: (args, options) => git(options.cwd, args, options.env, options.stdin), getWorkspace: async () => workspace,
    allocate: async () => { throw new Error("No allocation occurs in this commit fixture") }, setActive: async () => {}, read: async key => values.get(key) ?? null, write: async (key, value) => { values.set(key, value) },
    authorize: async () => ({ principalId: "writer_fixture", role: "editor", session: { ...session }, cloneUrl: "https://github.com/fixture/repository.git", expiresAt: Date.now() + 60_000 }),
    credential: async () => { throw new Error("No remote credential is needed to prepare a local commit") }, verifyPush: async () => { throw new Error("This fixture does not claim GitHub publication verification") }, scratchRoot: path.join(root, ".scratch") })
  const document = new SessionFileDocument(context.sessionId)
  document.initializeFile({ id: "file_original", path: "a.ts", originalPath: "a.ts", content: "export const value = 1\n" })
  const store = new DurableSessionStore(path.join(root, ".recovery"), context.roomId, 1)
  let sequence = 0
  const prepare = async () => {
    session.roomHeadSequence = ++sequence
    session.status = "commit_preparing"; session.commitLeasePrincipalId = "writer_fixture"; session.commitLeaseExpiresAt = Date.now() + 300_000
    const published = document.publicationManifest(session.baseCommitSha)
    const basis = await encodePublicationBasis(context, session.baseCommitSha, sequence, document.checkpoint())
    await store.savePublicationBasis(basis.id, basis.encoded)
    const prepared = await coordinator.prepareCommit({ sessionId: context.sessionId, accessToken: "fixture", throughSequence: sequence,
      publicationBasisId: basis.id, publicationBasisKeyVersion: 1, textChanges: document.snapshotChanges(published ?? undefined), binaryPaths: [], binaryReviews: [], message: `snapshot ${sequence}`, authorName: "Fixture", authorEmail: "fixture@example.invalid" })
    return { prepared, basis }
  }
  const adoptFixturePublication = async (prepared: Awaited<ReturnType<typeof prepare>>["prepared"], manifest: SessionPublishedManifest) => {
    // This models the verified publication receipt; GitHub verification itself
    // has a separate integration boundary. Local tree construction is real Git.
    document.recordPublicationManifest(manifest)
    await run("reset", "--hard", prepared.commitSha)
    binding = { ...binding, baseCommitSha: prepared.commitSha, adoptedThroughSequence: prepared.throughSequence }
    values.set(`collaboration:g3:session:${context.sessionId}`, JSON.stringify(binding))
    values.set(`collaboration:g3:prepared:${context.sessionId}`, JSON.stringify({ ...prepared, state: "published" }))
    session.baseCommitSha = prepared.commitSha; session.publishedCommitSha = prepared.commitSha; session.publishedThroughSequence = prepared.throughSequence
  }
  const cycle = async () => {
    const { prepared, basis } = await prepare()
    const manifest = await manifestFromPublicationBasis(context, basis, prepared.commitSha, basis.encoded)
    await adoptFixturePublication(prepared, manifest)
    return { prepared, manifest }
  }
  return { root, document, store, coordinator, prepare, cycle, run, adoptFixturePublication }
}

describe("real Git commit construction with immutable published file baselines", () => {
  it("T07 removes the intermediate path across a -> b -> c publication cycles", async () => {
    const f = await fixture()
    try {
      f.document.renameFile("file_original", "b.ts")
      const first = await f.cycle()
      expect((await f.run("ls-tree", "--name-only", first.prepared.commitSha)).split("\n")).toEqual(["b.ts", "unopened.bin"])
      f.document.renameFile("file_original", "c.ts")
      const second = await f.cycle()
      expect((await f.run("ls-tree", "--name-only", second.prepared.commitSha)).split("\n")).toEqual(["c.ts", "unopened.bin"])
      expect(await f.run("show", `${second.prepared.commitSha}:c.ts`)).toBe("export const value = 1")
      expect(second.manifest.files[0]?.path).toBe("c.ts")
    } finally { f.document.destroy() }
  })

  it("T08 handles publish/delete/recreate at a reused path with a new identity", async () => {
    const f = await fixture()
    try {
      await f.cycle()
      f.document.deleteFile("file_original")
      await f.cycle()
      expect(await f.run("ls-tree", "--name-only", "HEAD")).toBe("unopened.bin")
      f.document.initializeFile({ id: "replacement_file", path: "a.ts", content: "new identity\n" })
      const replacement = await f.cycle()
      expect(await f.run("show", "HEAD:a.ts")).toBe("new identity")
      expect(replacement.manifest.files.find(file => file.id === "file_original")?.path).toBeNull()
      expect(replacement.manifest.files.find(file => file.id === "replacement_file")?.path).toBe("a.ts")
      f.document.deleteFile("replacement_file")
      await f.cycle()
      expect(await f.run("ls-tree", "--name-only", "HEAD")).toBe("unopened.bin")
    } finally { f.document.destroy() }
  })

  it("T09 derives the baseline from the frozen basis, preserving post-barrier edits for the next commit", async () => {
    const f = await fixture()
    try {
      f.document.renameFile("file_original", "b.ts")
      const { prepared, basis } = await f.prepare()
      f.document.replaceText("file_original", "export const value = 2\n")
      const manifest = await manifestFromPublicationBasis(context, basis, prepared.commitSha, basis.encoded)
      expect(manifest.files[0]?.blobOid).toBe(gitTextBlobOid("export const value = 1\n"))
      await f.adoptFixturePublication(prepared, manifest)
      expect(f.document.file("file_original")?.content).toBe("export const value = 2\n")
      expect(await f.run("show", "HEAD:b.ts")).toBe("export const value = 1")
      await f.cycle()
      expect(await f.run("show", "HEAD:b.ts")).toBe("export const value = 2")
    } finally { f.document.destroy() }
  })

  it("preserves executable mode and unopened Git objects", async () => {
    const f = await fixture()
    try {
      const originalBinary = await f.run("rev-parse", "HEAD:unopened.bin")
      f.document.setExecutable("file_original", true)
      const result = await f.cycle()
      expect(await f.run("ls-tree", "HEAD", "a.ts")).toMatch(/^100755 blob /)
      expect(await f.run("rev-parse", "HEAD:unopened.bin")).toBe(originalBinary)
      expect(result.manifest.files[0]?.executable).toBe(true)
    } finally { f.document.destroy() }
  })

  it("recovers a prepared immutable basis from a reopened store without reading the evolving workspace", async () => {
    const f = await fixture()
    try {
      const { prepared, basis } = await f.prepare()
      const reopened = new DurableSessionStore(path.join(f.root, ".recovery"), context.roomId, 1)
      const encoded = await reopened.readPublicationBasis(prepared.publicationBasisId!)
      expect(encoded).toBe(basis.encoded)
      f.document.replaceText("file_original", "later local contents")
      const recovered = await manifestFromPublicationBasis(context, basis, prepared.commitSha, encoded!)
      expect(recovered.files[0]?.blobOid).toBe(gitTextBlobOid("export const value = 1\n"))
      await expect(manifestFromPublicationBasis(context, { ...basis, parentCommitSha: "a".repeat(40) }, prepared.commitSha, encoded!)).rejects.toThrow("capture identity changed")
      await expect(reopened.savePublicationBasis(basis.id, "replaced")).rejects.toThrow("cannot be replaced")
    } finally { f.document.destroy() }
  })

  it("replicates publication identity through Yjs and rejects mutation of an existing commit mapping", async () => {
    const f = await fixture(); const replica = new SessionFileDocument(context.sessionId)
    try {
      const { prepared, manifest } = await f.cycle()
      Y.applyUpdate(replica.doc, f.document.checkpoint())
      expect(replica.publicationManifest(prepared.commitSha)).toEqual(manifest)
      expect(() => replica.recordPublicationManifest({ ...manifest, files: manifest.files.map(file => ({ ...file, path: "different.ts" })) })).toThrow("conflicting file identities")
      expect(() => validatePublishedManifest({ ...manifest, files: [...manifest.files, ...manifest.files] })).toThrow("identity")
    } finally { replica.destroy(); f.document.destroy() }
  })

  it("does not silently delete a published file whose CRDT identity has disappeared", async () => {
    const f = await fixture(); const empty = new SessionFileDocument(context.sessionId)
    try { const { manifest } = await f.cycle(); expect(() => empty.snapshotChanges(manifest)).toThrow("absent from the live snapshot") }
    finally { empty.destroy(); f.document.destroy() }
  })
})
