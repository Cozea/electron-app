import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { LocalWorkspaceDTO } from "../../../../shared/workspaceTypes"
import {
  COLLABORATION_DATA_GENERATION,
  type CollaborationImportCandidate,
  type CollaborationTextChange,
  type CollaborationWorkspaceAuthority,
  type PreparedCollaborationCommit,
  type PrepareCollaborationCommitInput,
  type SessionWorkspaceBinding,
} from "../../../../shared/collaborationDesktop"
import { assertGitCommitSha, buildCollaborationSessionBranch } from "../../../../shared/collaborationSession"
import { assertSharedFilePath } from "../../../../shared/collaborationPaths"

export interface CollaborationGitResult {
  success: boolean
  stdout: string
  stdoutBytes?: Uint8Array
  stderr: string
}

export interface CollaborationCoordinatorDependencies {
  git(args: string[], options: { cwd: string; env?: Record<string, string>; stdin?: string; captureStdoutBytes?: boolean; maxOutputBytes?: number }): Promise<CollaborationGitResult>
  getWorkspace(id: string): Promise<LocalWorkspaceDTO | null>
  allocate(projectId: string, sessionId: string, prepare: (directory: string) => Promise<void>): Promise<LocalWorkspaceDTO>
  setActive(workspaceId: string, projectId: string): Promise<void>
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  authorize(sessionId: string, accessToken: string): Promise<CollaborationWorkspaceAuthority>
  credential(projectId: string, sessionId: string, operation: "read" | "write", accessToken: string): Promise<{ cloneUrl: string; token: string; expiresAt: number; repositoryId: string }>
  verifyPush(sessionId: string, commitSha: string, accessToken: string): Promise<void>
  scratchRoot: string
  now?: () => number
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
const MAX_FILES = 10_000
const bindingKey = (id: string) => `collaboration:g3:session:${id}`
export const collaborationWorkspacePolicyKey = (id: string) => `collaboration:g3:workspace:${id}`
const preparedKey = (id: string) => `collaboration:g3:prepared:${id}`

interface AdoptionFile {
  path: string
  oldOid: string
  newOid: string
  newMode: string
  state: "pending" | "retained" | "done"
  backup?: string
}
interface AdoptionJournal {
  generation: 3
  sessionId: string
  workspaceId: string
  previousSha: string
  commitSha: string
  sequence: number
  scratch: string
  files: AdoptionFile[]
  completed: boolean
}

export function assertCollaborationPath(value: string): string {
  return assertSharedFilePath(value)
}

function canonicalRepository(url: string): string {
  // Credentials, non-GitHub hosts and user-selected remote schemes never reach Git.
  const match = /^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\.git$/.exec(url)
  if (!match) throw new Error("Expected a canonical GitHub repository URL")
  return `${match[1]}/${match[2]}`.toLowerCase()
}

function reviewHash(content: string | null): string {
  return createHash("sha256").update(content === null ? "deleted\0" : `text\0${content}`).digest("hex")
}

/** Main-process owner of session Git state. No credentials or renderer paths are persisted. */
export class SessionWorkspaceCoordinator {
  private readonly operations = new Map<string, Promise<unknown>>()
  private readonly now: () => number
  private readonly deps: CollaborationCoordinatorDependencies
  constructor(deps: CollaborationCoordinatorDependencies) {
    this.deps = deps
    this.now = deps.now ?? Date.now
  }

  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(id)
    const next = (previous ?? Promise.resolve()).catch(() => {}).then(operation)
    this.operations.set(id, next)
    try { return await next } finally { if (this.operations.get(id) === next) this.operations.delete(id) }
  }

  private async git(cwd: string, args: string[], env?: Record<string, string>, stdin?: string): Promise<string> {
    const result = await this.deps.git(["-c", "core.hooksPath=/dev/null", ...args], { cwd, env, stdin })
    // Git diagnostics may contain credentials from a hostile server or local config.
    if (!result.success) throw new Error(`Collaboration Git operation failed (${args[0]})`)
    return result.stdout
  }

  private async remoteEnv(authority: CollaborationWorkspaceAuthority, token: string, operation: "read" | "write") {
    const credential = await this.deps.credential(authority.session.projectId, authority.session.id, operation, token)
    if (credential.expiresAt <= this.now() || credential.repositoryId !== authority.session.repositoryId ||
      canonicalRepository(credential.cloneUrl) !== canonicalRepository(authority.cloneUrl)) {
      throw new Error("Repository credentials expired or repository identity changed")
    }
    return {
      GIT_CONFIG_COUNT: "4",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${credential.token}`).toString("base64")}`,
      GIT_CONFIG_KEY_1: "credential.helper", GIT_CONFIG_VALUE_1: "",
      GIT_CONFIG_KEY_2: "http.followRedirects", GIT_CONFIG_VALUE_2: "false",
      GIT_CONFIG_KEY_3: "protocol.allow", GIT_CONFIG_VALUE_3: "never",
      GIT_TRACE: "0", GIT_TRACE_PACKET: "0", GIT_TRACE_CURL: "0", GIT_CURL_VERBOSE: "0",
      GIT_TRACE2: "0", GIT_TRACE2_EVENT: "0", GIT_TRACE2_PERF: "0",
      GIT_TERMINAL_PROMPT: "0",
    }
  }

  private async authority(sessionId: string, token: string, write = false) {
    const authority = await this.deps.authorize(sessionId, token)
    const { session } = authority
    if (session.id !== sessionId || authority.expiresAt <= this.now() ||
      ["closed", "closing", "failed"].includes(session.status) ||
      session.sessionBranch !== buildCollaborationSessionBranch(sessionId)) throw new Error("Session authority is no longer valid")
    if (write && authority.role !== "editor") throw new Error("Observers cannot change this session workspace")
    canonicalRepository(authority.cloneUrl)
    assertGitCommitSha(session.baseCommitSha)
    return authority
  }

  async getBinding(sessionId: string): Promise<SessionWorkspaceBinding | null> {
    const raw = await this.deps.read(bindingKey(sessionId))
    if (!raw) return null
    const binding = JSON.parse(raw) as SessionWorkspaceBinding
    if (binding.generation !== COLLABORATION_DATA_GENERATION || binding.sessionId !== sessionId) throw new Error("Collaboration recovery generation is incompatible")
    return binding
  }

  async workspaceForSession(sessionId: string): Promise<LocalWorkspaceDTO> {
    const binding = await this.getBinding(sessionId)
    if (!binding || !["active", "joining"].includes(binding.state)) throw new Error("Session workspace is not active")
    return this.workspace(binding)
  }

  async bindingForWorkspace(workspaceId: string): Promise<SessionWorkspaceBinding | null> {
    const raw = await this.deps.read(collaborationWorkspacePolicyKey(workspaceId))
    if (!raw) return null
    const binding = JSON.parse(raw) as SessionWorkspaceBinding
    if (binding.generation !== 3 || binding.workspaceId !== workspaceId) throw new Error("Invalid local session workspace association")
    return binding
  }

  async readBaseFile(sessionId: string, relative: string): Promise<{ content: string; executable: boolean } | null> {
    assertCollaborationPath(relative)
    const binding = await this.getBinding(sessionId)
    if (!binding) throw new Error("Session workspace is unavailable")
    const workspace = await this.workspace(binding)
    const tree = await this.git(workspace.projectRootPath, ["ls-tree", "-z", binding.baseCommitSha, "--", relative])
    if (!tree) return null
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t/.exec(tree)
    if (!match) throw new Error("This Git entry is not a supported shared text file")
    const result = await this.deps.git(["-c", "core.hooksPath=/dev/null", "cat-file", "blob", match[2]!], { cwd: workspace.projectRootPath, captureStdoutBytes: true, maxOutputBytes: MAX_TEXT_BYTES })
    if (!result.success || !result.stdoutBytes) throw new Error("Git text could not be read within the shared file limit")
    const content = new TextDecoder("utf-8", { fatal: true }).decode(result.stdoutBytes)
    if (content.includes("\0")) throw new Error("This binary file is Git-only")
    return { content, executable: match[1] === "100755" }
  }

  async shouldTrackExternal(sessionId: string, relative: string): Promise<boolean> {
    assertCollaborationPath(relative)
    const workspace = await this.workspaceForSession(sessionId)
    const result = await this.deps.git(["check-ignore", "-q", "--", relative], { cwd: workspace.projectRootPath })
    if (result.success) return false
    const stat = await fs.lstat(path.join(workspace.projectRootPath, relative)).catch(error => { if (error.code === "ENOENT") return null; throw error })
    return Boolean(stat?.isFile() && !stat.isSymbolicLink())
  }

  async changedPaths(sessionId: string): Promise<string[]> {
    const workspace = await this.workspaceForSession(sessionId)
    const tracked = await this.git(workspace.projectRootPath, ["diff", "--name-only", "-z", "HEAD", "--"])
    const untracked = await this.git(workspace.projectRootPath, ["ls-files", "--others", "--exclude-standard", "-z"])
    const names = [...new Set(`${tracked}${untracked}`.split("\0").filter(Boolean))]
    if (names.length > MAX_FILES) throw new Error("Too many external changes; local files were retained")
    return names
  }

  async getPrepared(sessionId: string): Promise<PreparedCollaborationCommit | null> {
    const raw = await this.deps.read(preparedKey(sessionId))
    if (!raw) return null
    const prepared = JSON.parse(raw) as PreparedCollaborationCommit
    if (prepared.generation !== 3 || prepared.sessionId !== sessionId) throw new Error("Prepared commit recovery identity is invalid")
    return prepared
  }

  private async saveBinding(binding: SessionWorkspaceBinding): Promise<void> {
    await this.deps.write(bindingKey(binding.sessionId), JSON.stringify(binding))
    await this.deps.write(collaborationWorkspacePolicyKey(binding.workspaceId), JSON.stringify(binding))
  }

  private async workspace(binding: SessionWorkspaceBinding): Promise<LocalWorkspaceDTO> {
    const workspace = await this.deps.getWorkspace(binding.workspaceId)
    if (!workspace || workspace.projectId !== binding.projectId || workspace.storageOwnership !== "managed" ||
      workspace.verificationStatus !== "verified") throw new Error("Session workspace is missing or no longer catalog-owned")
    const branch = (await this.git(workspace.projectRootPath, ["symbolic-ref", "--short", "HEAD"])).trim()
    if (branch !== binding.sessionBranch) throw new Error("Session workspace branch changed; local work was retained")
    return workspace
  }

  async prepare(sessionId: string, sourceWorkspaceId: string, accessToken: string, activate = true): Promise<SessionWorkspaceBinding> {
    return this.serial(sessionId, async () => {
      const authority = await this.authority(sessionId, accessToken)
      const { session } = authority
      const previous = await this.getBinding(sessionId)
      if (previous) {
        if (previous.projectId !== session.projectId || previous.repositoryId !== session.repositoryId ||
          previous.sourceWorkspaceId !== sourceWorkspaceId) throw new Error("Existing session workspace belongs to a different source")
        await this.workspace(previous)
        const resumed = { ...previous, state: activate ? "active" as const : "joining" as const, role: authority.role }
        await this.saveBinding(resumed)
        if (activate) await this.deps.setActive(resumed.workspaceId, resumed.projectId)
        return resumed
      }
      const reservationKey = `collaboration:g3:creation:${sessionId}`
      const reservation = await this.deps.read(reservationKey)
      const identity = JSON.stringify({ sourceWorkspaceId, projectId: session.projectId, repositoryId: session.repositoryId, baseCommitSha: session.baseCommitSha })
      if (reservation && reservation !== identity) throw new Error("Interrupted session creation belongs to a different source workspace or base")
      if (!reservation) await this.deps.write(reservationKey, identity)
      const source = await this.deps.getWorkspace(sourceWorkspaceId)
      if (!source || source.projectId !== session.projectId || source.verificationStatus !== "verified") throw new Error("Source workspace is not verified for this project")
      if (await this.deps.read(collaborationWorkspacePolicyKey(sourceWorkspaceId))) throw new Error("A session must start from an ordinary workspace")
      const remote = (await this.git(source.projectRootPath, ["remote", "get-url", "origin"])).trim()
      if (canonicalRepository(remote) !== canonicalRepository(authority.cloneUrl)) throw new Error("Source workspace is attached to a different repository")
      const env = await this.remoteEnv(authority, accessToken, "read")
      // Use the verified URL, never an origin that local configuration can redirect.
      await this.git(source.projectRootPath, ["-c", "protocol.https.allow=always", "fetch", "--no-tags", "--no-recurse-submodules", authority.cloneUrl, session.baseCommitSha], env)
      const workspace = await this.deps.allocate(session.projectId, session.id, async target => {
        // Resume only a catalog reservation and exact branch. A dirty directory is
        // never reset, even after a crash between worktree creation and binding.
        const present = await fs.readdir(target)
        if (present.length) {
          const head = (await this.git(target, ["rev-parse", "HEAD"])).trim()
          const branch = (await this.git(target, ["symbolic-ref", "--short", "HEAD"])).trim()
          const origin = (await this.git(target, ["remote", "get-url", "origin"])).trim()
          if (head !== session.baseCommitSha || branch !== session.sessionBranch || canonicalRepository(origin) !== canonicalRepository(authority.cloneUrl)) {
            throw new Error("Interrupted workspace does not match this session; retained for recovery")
          }
          return
        }
        // Fail on branch collisions. Unsupported worktree support is the only
        // reason to use a separate clone; ordinary Git failures are recoverable.
        const help = await this.deps.git(["worktree", "list", "--porcelain"], { cwd: source.projectRootPath })
        if (help.success) {
          await this.git(source.projectRootPath, ["worktree", "add", "-b", session.sessionBranch, target, session.baseCommitSha])
        } else if (/not a git command|unknown subcommand/.test(help.stderr)) {
          await this.git(target, ["-c", "protocol.https.allow=always", "clone", "--no-checkout", "--no-recurse-submodules", authority.cloneUrl, target], env)
          await this.git(target, ["checkout", "-b", session.sessionBranch, session.baseCommitSha])
        } else throw new Error("Unable to inspect Git worktrees")
      })
      const binding: SessionWorkspaceBinding = {
        generation: COLLABORATION_DATA_GENERATION, sessionId, projectId: session.projectId,
        repositoryId: session.repositoryId, workspaceId: workspace.workspaceId, sourceWorkspaceId,
        sessionBranch: session.sessionBranch, baseCommitSha: session.baseCommitSha,
        role: authority.role, state: activate ? "active" : "joining", joinedAt: this.now(),
      }
      await this.saveBinding(binding)
      if (activate) await this.deps.setActive(binding.workspaceId, binding.projectId)
      return binding
    })
  }

  async activate(sessionId: string, accessToken: string): Promise<void> {
    const authority = await this.authority(sessionId, accessToken)
    const binding = await this.getBinding(sessionId)
    if (!binding || !["joining", "active"].includes(binding.state)) throw new Error("Session workspace is not ready to activate")
    await this.workspace(binding)
    await this.saveBinding({ ...binding, role: authority.role, state: "active" })
    await this.deps.setActive(binding.workspaceId, binding.projectId)
  }

  async recordRecoveryKey(sessionId: string, keyVersion: number): Promise<void> {
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new Error("Invalid recovery key")
    await this.serial(sessionId, async () => {
      const binding = await this.getBinding(sessionId)
      if (!binding || binding.state !== "active") throw new Error("Session must be active before recording offline recovery")
      await this.saveBinding({ ...binding, recoveryKeyVersion: keyVersion })
    })
  }

  async resumeOffline(sessionId: string, sourceWorkspaceId: string, activate = false): Promise<SessionWorkspaceBinding> {
    const binding = await this.getBinding(sessionId)
    if (!binding || binding.state === "ended" || binding.sourceWorkspaceId !== sourceWorkspaceId) throw new Error("Only this device's previously joined workspace can resume offline")
    await this.workspace(binding)
    const next = { ...binding, state: activate ? "active" as const : "joining" as const }
    await this.saveBinding(next)
    if (activate) await this.deps.setActive(next.workspaceId, next.projectId)
    return next
  }

  async leave(sessionId: string, ended = false): Promise<SessionWorkspaceBinding> {
    return this.serial(sessionId, async () => {
      const binding = await this.getBinding(sessionId)
      if (!binding) throw new Error("No local session workspace exists")
      // Leave is intentionally offline-capable. No file, branch, worktree or
      // recovery object is deleted; cleanup is a separate explicit operation.
      const next = { ...binding, state: ended ? "ended" as const : "left" as const }
      await this.saveBinding(next)
      const source = await this.deps.getWorkspace(binding.sourceWorkspaceId)
      if (!source || source.projectId !== binding.projectId) throw new Error("Original workspace is unavailable; session files were retained")
      await this.deps.setActive(source.workspaceId, binding.projectId)
      return next
    })
  }

  async suspendActions(sessionId: string): Promise<string> {
    return this.serial(sessionId, async () => {
      const binding = await this.getBinding(sessionId)
      if (!binding) throw new Error("No local session workspace exists")
      if (binding.state === "active") await this.saveBinding({ ...binding, state: "joining" })
      return binding.workspaceId
    })
  }

  private async readRegularFile(root: string, relative: string): Promise<Buffer | null> {
    const parts = assertCollaborationPath(relative).split("/")
    let current = root
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part)
      const stat = await fs.lstat(current).catch(error => {
        if (error.code === "ENOENT") return null
        throw error
      })
      if (!stat) return null
      if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error("Only regular workspace files can be shared")
      if (index === parts.length - 1 && stat.size > MAX_SNAPSHOT_BYTES) throw new Error("File exceeds the collaboration snapshot limit")
    }
    return fs.readFile(current)
  }

  async inspectImportableChanges(sourceWorkspaceId: string): Promise<CollaborationImportCandidate[]> {
    const source = await this.deps.getWorkspace(sourceWorkspaceId)
    if (!source || source.verificationStatus !== "verified") throw new Error("Source workspace is not verified")
    const tracked = await this.git(source.projectRootPath, ["diff", "--name-only", "-z", "HEAD", "--"])
    const untracked = await this.git(source.projectRootPath, ["ls-files", "--others", "--exclude-standard", "-z"])
    const names = [...new Set(`${tracked}${untracked}`.split("\0").filter(Boolean))]
    if (names.length > MAX_FILES) throw new Error("Too many local changes to review")
    const result: CollaborationImportCandidate[] = []
    let bytes = 0
    for (const name of names) {
      const buffer = await this.readRegularFile(source.projectRootPath, name)
      if (buffer && (buffer.length > MAX_TEXT_BYTES || buffer.includes(0))) continue
      let content: string | null = null
      try { content = buffer ? new TextDecoder("utf-8", { fatal: true }).decode(buffer) : null } catch { continue }
      bytes += buffer?.length ?? 0
      if (bytes > MAX_SNAPSHOT_BYTES) throw new Error("Local text changes exceed the review limit")
      const stat = buffer ? await fs.stat(path.join(source.projectRootPath, name)) : null
      result.push({ path: name, content, executable: stat ? Boolean(stat.mode & 0o111) : undefined, reviewHash: reviewHash(content) })
    }
    return result
  }

  async readReviewedImport(sessionId: string, selected: Array<{ path: string; reviewHash: string }>, accessToken: string): Promise<CollaborationTextChange[]> {
    const authority = await this.authority(sessionId, accessToken, true)
    const binding = await this.getBinding(sessionId)
    if (!binding || authority.session.createdByUserId !== authority.userId || authority.session.publishedThroughSequence !== 0) throw new Error("Local import is available only while starting the session")
    const candidates = await this.inspectImportableChanges(binding.sourceWorkspaceId)
    return selected.map(selection => {
      const candidate = candidates.find(file => file.path === selection.path)
      if (!candidate || candidate.reviewHash !== selection.reviewHash) throw new Error("Local changes changed after review; review them again")
      return candidate
    })
  }

  async prepareCommit(input: PrepareCollaborationCommitInput): Promise<PreparedCollaborationCommit> {
    return this.serial(input.sessionId, async () => {
      const authority = await this.authority(input.sessionId, input.accessToken, true)
      const { session } = authority
      if (session.commitLeaseUserId !== authority.userId || session.status !== "commit_preparing" || !session.commitLeaseExpiresAt || session.commitLeaseExpiresAt <= this.now() ||
        !Number.isSafeInteger(input.throughSequence) || input.throughSequence < session.publishedThroughSequence || input.throughSequence > session.roomHeadSequence) throw new Error("Commit requires an active lease and acknowledged barrier")
      const binding = await this.getBinding(input.sessionId)
      if (!binding || binding.baseCommitSha !== session.baseCommitSha) throw new Error("Adopt the published base before preparing a commit")
      const workspace = await this.workspace(binding)
      const previousRaw = await this.deps.read(preparedKey(input.sessionId))
      if (previousRaw) {
        const previous = JSON.parse(previousRaw) as PreparedCollaborationCommit
        if (previous.state !== "published" && previous.state !== "discarded") throw new Error("A prepared commit already exists; publish or explicitly discard it")
      }
      if (!input.message.trim() || input.message.length > 16_384 || [input.authorName, input.authorEmail].some(value => !value || /[\r\n<>\0]/.test(value))) throw new Error("Commit message or author is invalid")
      const paths = [...input.textChanges.map(change => change.path), ...input.binaryPaths]
      if (paths.length > MAX_FILES) throw new Error("Snapshot file limit reached")
      const normalized = new Set<string>()
      for (const name of paths) {
        const key = assertCollaborationPath(name).normalize("NFC").toLowerCase()
        if (normalized.has(key)) throw new Error("Snapshot contains colliding file paths")
        normalized.add(key)
      }
      await fs.mkdir(this.deps.scratchRoot, { recursive: true, mode: 0o700 })
      const scratch = await fs.mkdtemp(path.join(this.deps.scratchRoot, "commit-"))
      const env = { GIT_INDEX_FILE: path.join(scratch, "index") }
      try {
        await this.git(workspace.projectRootPath, ["read-tree", session.baseCommitSha], env)
        let bytes = 0
        for (const change of input.textChanges) {
          bytes += change.content === null ? 0 : Buffer.byteLength(change.content)
          if (bytes > MAX_SNAPSHOT_BYTES) throw new Error("Snapshot byte limit reached")
          if (change.content === null) {
            await this.git(workspace.projectRootPath, ["update-index", "--force-remove", "--", change.path], env)
          } else {
            if (Buffer.byteLength(change.content) > MAX_TEXT_BYTES || change.content.includes("\0")) throw new Error("Shared text file exceeds its limit")
            const oid = (await this.git(workspace.projectRootPath, ["hash-object", "-w", "--stdin"], env, change.content)).trim()
            await this.git(workspace.projectRootPath, ["update-index", "--add", "--cacheinfo", change.executable ? "100755" : "100644", oid, change.path], env)
          }
        }
        for (const relative of input.binaryPaths) {
          const buffer = await this.readRegularFile(workspace.projectRootPath, relative)
          if (!buffer) {
            await this.git(workspace.projectRootPath, ["update-index", "--force-remove", "--", relative], env)
            continue
          }
          bytes += buffer.length
          if (bytes > MAX_SNAPSHOT_BYTES) throw new Error("Snapshot byte limit reached")
          const frozen = path.join(scratch, "binary")
          await fs.writeFile(frozen, buffer, { mode: 0o600 })
          const oid = (await this.git(workspace.projectRootPath, ["hash-object", "-w", "--", frozen], env)).trim()
          await this.git(workspace.projectRootPath, ["update-index", "--add", "--cacheinfo", "100644", oid, relative], env)
        }
        const tree = (await this.git(workspace.projectRootPath, ["write-tree"], env)).trim()
        const commitEnv = { ...env, GIT_AUTHOR_NAME: input.authorName, GIT_AUTHOR_EMAIL: input.authorEmail, GIT_COMMITTER_NAME: input.authorName, GIT_COMMITTER_EMAIL: input.authorEmail }
        const sha = (await this.git(workspace.projectRootPath, ["commit-tree", tree, "-p", session.baseCommitSha], commitEnv, input.message)).trim()
        assertGitCommitSha(sha)
        // Pin the prepared object before recording it. The live branch/index and
        // working files remain untouched while newer shared edits continue.
        await this.git(workspace.projectRootPath, ["update-ref", `refs/cozea/prepared/${session.id}`, sha])
        const prepared: PreparedCollaborationCommit = {
          generation: COLLABORATION_DATA_GENERATION, sessionId: session.id, parentCommitSha: session.baseCommitSha,
          commitSha: sha, throughSequence: input.throughSequence, leaseExpiresAt: session.commitLeaseExpiresAt,
          preparedAt: this.now(), state: "prepared",
        }
        await this.deps.write(preparedKey(session.id), JSON.stringify(prepared))
        return prepared
      } finally { await fs.rm(scratch, { recursive: true, force: true }) }
    })
  }

  /** Invoked only by the explicit Push action; never by Commit or reconnect. */
  async pushPrepared(sessionId: string, accessToken: string): Promise<PreparedCollaborationCommit> {
    return this.serial(sessionId, async () => {
      const raw = await this.deps.read(preparedKey(sessionId))
      if (!raw) throw new Error("No reviewed commit is prepared")
      const prepared = JSON.parse(raw) as PreparedCollaborationCommit
      if (prepared.state === "discarded") throw new Error("This prepared commit was discarded")
      if (prepared.generation !== COLLABORATION_DATA_GENERATION || prepared.sessionId !== sessionId) throw new Error("Prepared commit identity changed")
      assertGitCommitSha(prepared.commitSha)
      const binding = await this.getBinding(sessionId)
      if (!binding || binding.state !== "active") throw new Error("Resume the session before pushing its prepared commit")
      const workspace = await this.workspace(binding)
      const markPublished = async () => {
        const published = { ...prepared, state: "published" as const }
        await this.deps.write(preparedKey(sessionId), JSON.stringify(published))
        return published
      }
      // Recover an accepted push or a lost verification response before asking
      // Git to write again. The server checks the durable publication receipt.
      try { await this.deps.verifyPush(sessionId, prepared.commitSha, accessToken); return await markPublished() }
      catch { /* No confirmed publication yet; live authority is mandatory below. */ }
      const authority = await this.authority(sessionId, accessToken, true)
      const session = authority.session
      if (session.status !== "pushing" || session.commitLeaseUserId !== authority.userId || !session.commitLeaseExpiresAt || session.commitLeaseExpiresAt <= this.now() ||
        session.pendingCommitSha !== prepared.commitSha || session.pendingCommitThroughSequence !== prepared.throughSequence || session.baseCommitSha !== prepared.parentCommitSha) throw new Error("Push requires a current lease for this exact prepared commit")
      const env = await this.remoteEnv(authority, accessToken, "write")
      try {
        await this.git(workspace.projectRootPath, ["-c", "protocol.https.allow=always", "push", "--porcelain", authority.cloneUrl, `${prepared.commitSha}:refs/heads/${binding.sessionBranch}`], env)
        await this.deps.write(preparedKey(sessionId), JSON.stringify({ ...prepared, state: "pushed", leaseExpiresAt: session.commitLeaseExpiresAt }))
      } catch {
        // A connection failure can occur after GitHub accepted the update.
        // Verification decides success; neither retry path uses force push.
        await this.deps.verifyPush(sessionId, prepared.commitSha, accessToken)
        return markPublished()
      }
      await this.deps.verifyPush(sessionId, prepared.commitSha, accessToken)
      return markPublished()
    })
  }

  async discardPrepared(sessionId: string, accessToken: string): Promise<void> {
    await this.serial(sessionId, async () => {
      const authority = await this.authority(sessionId, accessToken, true)
      if (authority.session.status === "pushing") throw new Error("Recover Push verification before discarding a commit")
      const prepared = await this.getPrepared(sessionId)
      if (!prepared || prepared.state === "published") return
      await this.deps.write(preparedKey(sessionId), JSON.stringify({ ...prepared, state: "discarded" }))
    })
  }

  /** Adopt only a server-verified publication; newer shared files remain live. */
  async adoptPublished(sessionId: string, accessToken: string, sharedPaths: string[]): Promise<SessionWorkspaceBinding> {
    return this.serial(sessionId, async () => {
      const authority = await this.authority(sessionId, accessToken)
      let binding = await this.getBinding(sessionId)
      if (!binding || binding.state !== "active" || binding.repositoryId !== authority.session.repositoryId) throw new Error("Resume the matching session workspace before adoption")
      const workspace = await this.workspace(binding)
      const journalKey = `collaboration:g3:adoption:${sessionId}`
      const pending = await this.deps.read(journalKey)
      let journal = pending ? JSON.parse(pending) as AdoptionJournal : null
      if (journal && !journal.completed) {
        await this.finishAdoption(binding, workspace, journal, journalKey)
        binding = (await this.getBinding(sessionId))!
      }
      const commitSha = authority.session.baseCommitSha
      if (binding.baseCommitSha === commitSha) return binding
      if (authority.session.publishedCommitSha !== commitSha) throw new Error("The session base has no verified publication")
      const head = (await this.git(workspace.projectRootPath, ["rev-parse", "HEAD"])).trim()
      if (head !== binding.baseCommitSha) throw new Error("Local branch advanced outside collaboration; adoption paused with work retained")
      const env = await this.remoteEnv(authority, accessToken, "read")
      await this.git(workspace.projectRootPath, ["-c", "protocol.https.allow=always", "fetch", "--no-tags", "--no-recurse-submodules", authority.cloneUrl, commitSha], env)
      await this.git(workspace.projectRootPath, ["merge-base", "--is-ancestor", binding.baseCommitSha, commitSha])
      const shared = new Set(sharedPaths.map(value => assertCollaborationPath(value).normalize("NFC").toLowerCase()))
      const raw = (await this.git(workspace.projectRootPath, ["diff-tree", "--no-commit-id", "--no-renames", "-r", "--raw", "-z", binding.baseCommitSha, commitSha])).split("\0")
      const files: AdoptionFile[] = []
      for (let index = 0; index < raw.length && raw[index]; index += 2) {
        const match = /^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) [AMDT]$/.exec(raw[index]!)
        if (!match || !raw[index + 1]) throw new Error("Unsupported published tree delta")
        const relative = assertCollaborationPath(raw[index + 1]!)
        const protectedPath = shared.has(relative.normalize("NFC").toLowerCase()) || !["000000", "100644", "100755"].includes(match[1]!) || !["000000", "100644", "100755"].includes(match[2]!)
        files.push({ path: relative, oldOid: match[3]!, newOid: match[4]!, newMode: match[2]!, state: protectedPath ? "retained" : "pending" })
      }
      if (files.length > MAX_FILES) throw new Error("Published file count exceeds the adoption limit")
      await fs.mkdir(this.deps.scratchRoot, { recursive: true, mode: 0o700 })
      const scratch = await fs.mkdtemp(path.join(this.deps.scratchRoot, "adopt-"))
      const indexEnv = { GIT_INDEX_FILE: path.join(scratch, "index") }
      await this.git(workspace.projectRootPath, ["read-tree", commitSha], indexEnv)
      const newFiles = files.filter(file => file.state === "pending" && file.newMode !== "000000")
      if (newFiles.length) await this.git(workspace.projectRootPath, ["checkout-index", "--prefix", `${scratch}/tree/`, "-z", "--stdin"], indexEnv, newFiles.map(file => file.path).join("\0") + "\0")
      const indexPath = (await this.git(workspace.projectRootPath, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim()
      await fs.copyFile(indexPath, path.join(scratch, "previous-index"))
      journal = { generation: 3, sessionId, workspaceId: binding.workspaceId, previousSha: binding.baseCommitSha, commitSha,
        sequence: authority.session.publishedThroughSequence, scratch, files, completed: false }
      await this.deps.write(journalKey, JSON.stringify(journal))
      await this.finishAdoption(binding, workspace, journal, journalKey)
      return (await this.getBinding(sessionId))!
    })
  }

  private async finishAdoption(binding: SessionWorkspaceBinding, workspace: LocalWorkspaceDTO, journal: AdoptionJournal, key: string): Promise<void> {
    if (journal.generation !== 3 || journal.sessionId !== binding.sessionId || journal.workspaceId !== binding.workspaceId ||
      path.dirname(journal.scratch) !== this.deps.scratchRoot || !path.basename(journal.scratch).startsWith("adopt-")) throw new Error("Invalid adoption recovery ownership")
    assertGitCommitSha(journal.previousSha); assertGitCommitSha(journal.commitSha)
    const head = (await this.git(workspace.projectRootPath, ["rev-parse", "HEAD"])).trim()
    if (head !== journal.previousSha && head !== journal.commitSha) throw new Error("Local Git history changed during adoption; recovery retained")
    const zero = "0".repeat(40)
    let total = 0
    const save = () => this.deps.write(key, JSON.stringify(journal))
    for (const [index, file] of journal.files.entries()) {
      if (file.state !== "pending") continue
      const relative = assertCollaborationPath(file.path)
      const bytes = await this.readRegularFile(workspace.projectRootPath, relative)
      const localSnapshot = path.join(journal.scratch, "local-bytes")
      if (bytes) await fs.writeFile(localSnapshot, bytes, { mode: 0o600 })
      const localOid = bytes ? (await this.git(workspace.projectRootPath, ["hash-object", "--", localSnapshot])).trim() : zero
      if (!file.backup && localOid !== file.oldOid) { file.state = "retained"; await save(); continue }
      const target = path.join(workspace.projectRootPath, relative)
      if (bytes && !file.backup) {
        file.backup = `retained-${index}`
        await save()
      }
      if (file.backup) {
        if (file.backup !== `retained-${index}`) throw new Error("Invalid adoption backup identity")
        const backup = path.join(journal.scratch, file.backup)
        const exists = await fs.lstat(backup).catch(error => { if (error.code === "ENOENT") return null; throw error })
        if (!exists) {
          if (localOid !== file.oldOid) throw new Error("External write changed a file during adoption; recovery retained")
          await fs.rename(target, backup)
        }
      }
      if (file.newMode !== "000000") {
        const extracted = path.join(journal.scratch, "tree", relative)
        total += (await fs.stat(extracted)).size
        if (total > MAX_SNAPSHOT_BYTES) throw new Error("Published bytes exceed the adoption limit; recovery retained")
        // Parents must not redirect a publication into another workspace.
        let parent = workspace.projectRootPath
        for (const part of relative.split("/").slice(0, -1)) {
          parent = path.join(parent, part)
          await fs.mkdir(parent).catch(error => { if (error.code !== "EEXIST") throw error })
          const stat = await fs.lstat(parent)
          if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Published path crosses a non-directory")
        }
        try { await fs.link(extracted, target) }
        catch (error) {
          if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error
          const current = await this.readRegularFile(workspace.projectRootPath, relative)
          if (!current || !current.equals(await fs.readFile(extracted))) { file.state = "retained"; await save(); continue }
        }
      }
      file.state = "done"; await save()
    }
    // No checkout/reset runs against the evolving working directory. The old
    // index and displaced inodes remain in catalog-owned recovery storage.
    if (head !== journal.commitSha) await this.git(workspace.projectRootPath, ["update-ref", `refs/heads/${binding.sessionBranch}`, journal.commitSha, journal.previousSha])
    await this.git(workspace.projectRootPath, ["read-tree", journal.commitSha])
    await this.saveBinding({ ...binding, baseCommitSha: journal.commitSha, adoptedThroughSequence: journal.sequence })
    journal.completed = true; await save()
  }
}
