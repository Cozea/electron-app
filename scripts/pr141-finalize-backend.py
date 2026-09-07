#!/usr/bin/env python3
from pathlib import Path
import subprocess


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def source(path: str) -> str:
    return subprocess.check_output([
        "git", "show", f"origin/codex/collaboration-v2-complete:{path}"
    ], text=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"{label}: anchor missing")
    return text.replace(old, new, 1)


# Principal-native room key membership checks.
write("convex/lib/collaborationKeyAccess.ts", '''import type { QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { canAccessProject } from "./projectAccess"
import { isRegisteredDevicePrincipal } from "./deviceAuth"

export async function hasSessionKeyAccess(
  ctx: QueryCtx,
  session: Doc<"collaborationSessions">,
  principalId: Id<"devicePrincipals">,
  identityKey: string,
): Promise<boolean> {
  const principal = await ctx.db.get(principalId)
  if (!isRegisteredDevicePrincipal(principal) || principal.identityKey !== identityKey ||
    !(await canAccessProject(ctx, session.projectId, principalId))) return false
  const participant = await ctx.db.query("collaborationParticipants")
    .withIndex("by_session_and_principal", q => q.eq("sessionId", session._id).eq("principalId", principalId))
    .unique()
  return Boolean(participant && participant.leftAt === undefined)
}

export async function roomKeyHasRemovedRecipient(
  ctx: QueryCtx,
  session: Doc<"collaborationSessions">,
  keyVersion: number,
): Promise<boolean> {
  const keys = await ctx.db.query("projectCollabWrappedKeys")
    .withIndex("by_project_room_and_key_version", q => q.eq("projectId", session.projectId)
      .eq("roomId", `session:${session.sessionId}`).eq("keyVersion", keyVersion))
    .take(101)
  if (keys.length > 100) throw new Error("Room key recipient limit exceeded")
  for (const key of keys) {
    if (key.revokedAt !== undefined || !(await hasSessionKeyAccess(
      ctx, session, key.recipientPrincipalId, key.recipientIdentityKey,
    ))) return true
  }
  return false
}
''')

# Rebuild room authority around current principal IDs and explicit sessions.
write("convex/collaborationRoomAuthorization.ts", '''import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import { authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { canAccessProject } from "./lib/projectAccess"
import { roomKeyHasRemovedRecipient } from "./lib/collaborationKeyAccess"

function assertGatewaySecret(secret: string): void {
  if (!process.env.AI_GATEWAY_SECRET || secret !== process.env.AI_GATEWAY_SECRET) throw new Error("Unauthorized")
}

export async function authorizeCollaborationParticipant(
  ctx: QueryCtx,
  principalId: Id<"devicePrincipals">,
  sessionId: string,
) {
  const session = await ctx.db.query("collaborationSessions")
    .withIndex("by_session_id", q => q.eq("sessionId", sessionId.trim())).unique()
  if (!session || ["closed", "failed"].includes(session.status) ||
    !(await canAccessProject(ctx, session.projectId, principalId))) return { allowed: false as const }
  const participant = await ctx.db.query("collaborationParticipants")
    .withIndex("by_session_and_principal", q => q.eq("sessionId", session._id).eq("principalId", principalId)).unique()
  if (!participant || participant.leftAt !== undefined) return { allowed: false as const }
  const roomId = `session:${session.sessionId}`
  const keys = await ctx.db.query("projectCollabRoomKeys")
    .withIndex("by_project_and_room", q => q.eq("projectId", session.projectId).eq("roomId", roomId)).collect()
  const active = keys.find(key => key.status === "active")
  const pending = keys.find(key => key.status === "rotating")
  const rotationRequired = active ? await roomKeyHasRemovedRecipient(ctx, session, active.keyVersion) : false
  return {
    allowed: true as const,
    principalId,
    projectId: session.projectId,
    sessionDocumentId: session._id,
    sessionId: session.sessionId,
    roomId,
    role: participant.role,
    capabilities: participant.capabilities,
    keyVersion: active?.keyVersion ?? null,
    pendingKeyVersion: pending?.keyVersion ?? null,
    rotationRequired,
    session,
  }
}

export const authorizeSessionForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const principal = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", q => q.eq("identityKey", args.identityKey.trim())).unique()
    if (!principal || principal.status === "revoked") return { allowed: false as const }
    const authority = await authorizeCollaborationParticipant(ctx, principal._id, args.sessionId)
    if (!authority.allowed) return authority
    return {
      allowed: true as const,
      principalId: principal._id,
      projectId: authority.projectId,
      sessionDocumentId: authority.sessionDocumentId,
      sessionId: authority.sessionId,
      roomId: authority.roomId,
      role: authority.role,
      capabilities: authority.capabilities,
      keyVersion: authority.keyVersion,
      pendingKeyVersion: authority.pendingKeyVersion,
      rotationRequired: authority.rotationRequired,
    }
  },
})

export const workspaceContextForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const principal = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", q => q.eq("identityKey", args.identityKey.trim())).unique()
    if (!principal || principal.status === "revoked") throw new Error("Device principal unavailable")
    const authority = await authorizeCollaborationParticipant(ctx, principal._id, args.sessionId)
    if (!authority.allowed) throw new Error("Session membership unavailable")
    const session = authority.session
    return {
      principalId: String(principal._id),
      session: {
        id: session.sessionId,
        projectId: String(session.projectId), repositoryId: session.repositoryId,
        targetBranch: session.targetBranch, sessionBranch: session.sessionBranch,
        baseCommitSha: session.baseCommitSha, publishedCommitSha: session.publishedCommitSha ?? null,
        publishedThroughSequence: session.publishedThroughSequence, roomHeadSequence: session.roomHeadSequence,
        createdByPrincipalId: String(session.createdByPrincipalId),
        commitLeasePrincipalId: session.commitLeasePrincipalId ? String(session.commitLeasePrincipalId) : null,
        commitLeaseExpiresAt: session.commitLeaseExpiresAt ?? null,
        pendingCommitSha: session.pendingCommitSha ?? null,
        pendingCommitThroughSequence: session.pendingCommitThroughSequence ?? null,
        pendingCommitCreatedAt: session.pendingCommitCreatedAt ?? null,
        status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt,
        closedAt: session.closedAt ?? null,
      },
      role: authority.role,
      expiresAt: Date.now() + 60_000,
    }
  },
})
''')

# Port the mature encryption implementation, then principalize every storage/index field.
encryption = source("convex/collaborationEncryption.ts")
encryption = encryption.replace(
    'import { mutation, query, type QueryCtx } from "./_generated/server"',
    'import type { QueryCtx } from "./_generated/server"\nimport { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"',
)
for old, new in [
    ('Id<"users">', 'Id<"devicePrincipals">'),
    ('createdByUserId', 'createdByPrincipalId'),
    ('createdByDeviceId', 'createdByIdentityKey'),
    ('recipientUserId', 'recipientPrincipalId'),
    ('recipientDeviceId', 'recipientIdentityKey'),
    ('senderDeviceId', 'senderIdentityKey'),
    ('by_session_and_user', 'by_session_and_principal'),
    ('participant.userId', 'participant.principalId'),
    ('waitingDevices', 'waitingPrincipals'),
    ('deviceId', 'identityKey'),
    ('userId', 'principalId'),
]:
    encryption = encryption.replace(old, new)
encryption = encryption.replace('session.generation !== 3 || ', '')
write("convex/collaborationEncryption.ts", encryption)

# Crash/restart of a prepared commit renews the exact principal-owned lease; Push retry gets a durable receipt.
sessions_path = "convex/collaborationSessions.ts"
sessions = read(sessions_path)
if "export const recoverPreparedLease" not in sessions:
    anchor = "export const markLocalCommitReady = mutation({\n"
    addition = '''/** Explicit restart recovery retains the exact pending publication identity. */
export const recoverPreparedLease = mutation({
  args: { sessionId: v.string(), commitSha: v.string(), coveredThroughSequence: v.number() },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const session = await requireSessionByPublicId(ctx, args.sessionId)
    await requireActiveEditorParticipant(ctx, session, principal._id)
    const now = Date.now()
    if (session.commitLeasePrincipalId !== principal._id || !["local_commit_ready", "pushing"].includes(session.status) ||
      session.pendingCommitSha !== assertGitCommitSha(args.commitSha) ||
      session.pendingCommitThroughSequence !== normalizeSequence(args.coveredThroughSequence, "Prepared sequence")) {
      throw new ConvexError("This prepared publication was replaced or belongs to another editor")
    }
    const commitLeaseExpiresAt = now + DEFAULT_COMMIT_LEASE_MS
    await ctx.db.patch(session._id, { commitLeaseExpiresAt, revision: session.revision + 1, updatedAt: now })
    const updated = { ...session, commitLeaseExpiresAt, revision: session.revision + 1, updatedAt: now }
    await recordEvent(ctx, updated, "lease_renewed", {
      actorPrincipalId: principal._id, metadata: { recoveredPreparedCommit: true }, createdAt: now,
    })
    return toSessionDescriptor(updated)
  },
})

'''
    sessions = replace_once(sessions, anchor, addition + anchor, "recoverPreparedLease")
if "export const publicationReceiptForServer" not in sessions:
    sessions += '''
export const publicationReceiptForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string(), commitSha: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const principal = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", q => q.eq("identityKey", args.identityKey.trim())).unique()
    const session = await getSessionByPublicId(ctx, args.sessionId)
    if (!principal || principal.status === "revoked" || !session ||
      !(await canAccessProject(ctx, session.projectId, principal._id)) ||
      session.publishedCommitSha?.toLowerCase() !== args.commitSha.toLowerCase()) return null
    return { verified: true as const, sessionId: session.sessionId, sessionBranch: session.sessionBranch,
      commitSha: session.publishedCommitSha, coveredThroughSequence: session.publishedThroughSequence,
      baseAdvanced: true as const }
  },
})
'''
write(sessions_path, sessions)

# Narrow worker bridge; session creation resolves repository + branch server-side.
write("cloudflare/worker/src/routes/collaborationControl.ts", '''import { ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import { verifyDeviceAccessToken } from "../lib/jwt"
import { requireActiveDeviceAccessInConvex } from "../lib/convex"
import { jsonResponse } from "../lib/protocol"
import { parseJsonRequest } from "../lib/validation"
import { authorizeRepositoryOperation } from "../lib/collaborationRepositoryConvex"
import { resolveGitHubBranch } from "../lib/githubApp"
import type { Env } from "../types"

const queries = new Set(["getSession", "listForProject", "listParticipants"])
const mutations = new Set(["activateSession", "joinSession", "heartbeatParticipant", "leaveSession", "closeSession",
  "acquireCommitLease", "renewCommitLease", "recoverPreparedLease", "markLocalCommitReady", "beginPush", "releaseCommitLease"])

export async function handleCollaborationControl(request: Request, env: Env): Promise<Response> {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) throw new Error("Device authentication required")
  const token = header.slice(7).trim()
  const auth = await verifyDeviceAccessToken(env, token)
  await requireActiveDeviceAccessInConvex(env, auth)
  const body = await parseJsonRequest(request) as { operation?: unknown; args?: unknown }
  if (typeof body.operation !== "string" || !body.args || typeof body.args !== "object" || Array.isArray(body.args)) {
    throw new Error("Invalid collaboration control operation")
  }
  const args = body.args as Record<string, unknown>
  const client = new ConvexHttpClient(env.CONVEX_URL); client.setAuth(token)
  if (body.operation === "startSession") {
    if (typeof args.projectId !== "string" || typeof args.creationToken !== "string") throw new Error("Project and creation token required")
    const authorization = await authorizeRepositoryOperation(env, { identityKey: auth.sub, projectId: args.projectId, operation: "write" })
    if (!authorization) throw new Error("Repository write access required")
    const branch = typeof args.targetBranch === "string" && args.targetBranch.trim() ? args.targetBranch.trim() : authorization.repository.defaultBranch
    const resolved = await resolveGitHubBranch(env, { installationId: authorization.repository.installationId,
      repositoryNumericId: authorization.repository.repositoryNumericId, owner: authorization.repository.owner,
      name: authorization.repository.name, branch })
    const result = await client.mutation(makeFunctionReference<"mutation">("collaborationSessions:createSession"), {
      projectId: args.projectId, repositoryId: authorization.repository.repositoryId,
      targetBranch: resolved.branch, baseCommitSha: resolved.commitSha, creationToken: args.creationToken,
    })
    return jsonResponse(result, { headers: { "cache-control": "no-store" } })
  }
  if (!queries.has(body.operation) && !mutations.has(body.operation)) throw new Error("Unknown collaboration control operation")
  const name = `collaborationSessions:${body.operation}`
  const result = queries.has(body.operation)
    ? await client.query(makeFunctionReference<"query">(name), args)
    : await client.mutation(makeFunctionReference<"mutation">(name), args)
  return jsonResponse(result, { headers: { "cache-control": "no-store" } })
}
''')

keys = source("cloudflare/worker/src/routes/collaborationKeys.ts")
keys = keys.replace("waitingDevices", "waitingPrincipals")
write("cloudflare/worker/src/routes/collaborationKeys.ts", keys)

# Branch resolution is a current project.repo operation, never a duplicate binding.
github_path = "cloudflare/worker/src/lib/githubApp.ts"
github = read(github_path)
if "export async function resolveGitHubBranch" not in github:
    github += source("cloudflare/worker/src/lib/githubApp.ts").split("export async function resolveGitHubBranch", 1)[1]
    github = github.replace("\n(env: Env, args:", "\nexport async function resolveGitHubBranch(env: Env, args:", 1)
write(github_path, github)

# Extend current repository routes rather than copying the stale duplicate repository model.
repo_path = "cloudflare/worker/src/routes/collaborationRepositories.ts"
repo = read(repo_path)
if "ConvexHttpClient" not in repo:
    repo = 'import { ConvexHttpClient } from "convex/browser"\nimport { makeFunctionReference } from "convex/server"\n' + repo
repo = repo.replace("  mintGitHubInstallationCredential,\n  verifyGitHubBranchHead,", "  mintGitHubInstallationCredential,\n  resolveGitHubBranch,\n  verifyGitHubBranchHead,", 1)
if "handleCollaborationWorkspaceContext" not in repo:
    repo += '''

export async function handleCollaborationWorkspaceContext(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const sessionId = requiredString(body.sessionId, "sessionId", 128)
  const client = new ConvexHttpClient(env.CONVEX_URL)
  const context = await client.query(makeFunctionReference<"query">("collaborationRoomAuthorization:workspaceContextForServer"),
    { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId }) as any
  const authorization = await authorizeRepositoryOperation(env, { identityKey: auth.sub, projectId: context.session.projectId, operation: "read" })
  if (!authorization || authorization.repository.repositoryId !== context.session.repositoryId) throw new Error("Session repository authorization changed")
  return jsonResponse({ ...context, cloneUrl: authorization.repository.cloneUrl }, { headers: { "cache-control": "no-store" } })
}

export async function handleResolveCollaborationBranch(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const projectId = requiredString(body.projectId, "projectId", 128)
  const authorization = await authorizeRepositoryOperation(env, { identityKey: auth.sub, projectId, operation: "read" })
  if (!authorization) throw new Error("Repository access denied")
  const branch = body.branch === undefined ? authorization.repository.defaultBranch : requiredString(body.branch, "branch", 255)
  const resolved = await resolveGitHubBranch(env, { installationId: authorization.repository.installationId,
    repositoryNumericId: authorization.repository.repositoryNumericId, owner: authorization.repository.owner,
    name: authorization.repository.name, branch })
  return jsonResponse({ ...resolved, resolutionId: crypto.randomUUID(), repositoryId: authorization.repository.repositoryId,
    fullName: authorization.repository.fullName }, { headers: { "cache-control": "no-store" } })
}

export async function handleCollaborationCheckpoint(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const sessionId = requiredString(body.sessionId, "sessionId", 128)
  const client = new ConvexHttpClient(env.CONVEX_URL)
  let authority = await client.query(makeFunctionReference<"query">("collaborationRoomAuthorization:authorizeSessionForServer"),
    { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId }) as any
  if (!authority.allowed || authority.role !== "editor") throw new Error("Session checkpoint access denied")
  if (body.rotation === true && authority.pendingKeyVersion) {
    authority = await client.query(makeFunctionReference<"query">("collaborationEncryption:rotationCheckpointAuthorityForServer"),
      { serverSecret: env.AI_GATEWAY_SECRET, principalId: authority.principalId, sessionId }) as any
  }
  const response = await env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(authority.roomId)).fetch(new Request("https://internal/internal/checkpoint", {
    method: "POST", headers: { authorization: `Bearer ${env.AI_GATEWAY_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ authority: { ...authority, sessionId }, request: body }),
  }))
  if (!response.ok) return response
  const result = await response.json() as { checkpoint?: { keyVersion: number; sequence: number } }
  if (body.rotation === true && authority.previousKeyVersion && result.checkpoint?.keyVersion === authority.keyVersion) {
    await client.mutation(makeFunctionReference<"mutation">("collaborationEncryption:activateRotationFromServer"),
      { serverSecret: env.AI_GATEWAY_SECRET, sessionId, keyVersion: authority.keyVersion, sequence: result.checkpoint.sequence })
  }
  return jsonResponse(result, { headers: { "cache-control": "no-store" } })
}
'''
# Retry-safe Push publication: if Convex advanced but the response/room notification was lost, re-notify the room.
if "publicationReceiptForServer" not in repo:
    repo = repo.replace(
        "  const authorization = await authorizePushVerification(env, { identityKey: auth.sub, sessionId })\n",
        '''  const client = new ConvexHttpClient(env.CONVEX_URL)
  const existing = await client.query(makeFunctionReference<"query">("collaborationSessions:publicationReceiptForServer"),
    { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId, commitSha }) as CollaborationPushVerificationResponse | null
  if (existing) {
    await env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(`session:${sessionId}`)).fetch(new Request("https://internal/internal/base-advanced", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitSha: existing.commitSha, coveredThroughSequence: existing.coveredThroughSequence }),
    }))
    return jsonResponse(existing, { headers: { "cache-control": "no-store" } })
  }
  const authorization = await authorizePushVerification(env, { identityKey: auth.sub, sessionId })
''',
        1,
    )
    repo = repo.replace(
        '''  await advancePublishedBase(env, {
    sessionId,
    publishedByPrincipalId: authorization.principalId,
    commitSha,
    coveredThroughSequence: authorization.session.pendingCommitThroughSequence,
  })
''',
        '''  await advancePublishedBase(env, {
    sessionId,
    publishedByPrincipalId: authorization.principalId,
    commitSha,
    coveredThroughSequence: authorization.session.pendingCommitThroughSequence,
  })
  const roomAck = await env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(`session:${sessionId}`)).fetch(new Request("https://internal/internal/base-advanced", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ commitSha, coveredThroughSequence: authorization.session.pendingCommitThroughSequence }),
  }))
  if (!roomAck.ok) throw new Error("Published base was verified but live-room acknowledgement failed; retry Push")
''',
        1,
    )
write(repo_path, repo)

# Durable room owns encrypted checkpoints alongside bounded update retention.
room_path = "cloudflare/worker/src/durableObjects/CollabRoom.ts"
room = read(room_path)
if "url.pathname === '/internal/checkpoint'" not in room:
    checkpoint = '''    if (url.pathname === '/internal/checkpoint' && request.method === 'POST') {
      if (!this.env.AI_GATEWAY_SECRET || request.headers.get('authorization') !== `Bearer ${this.env.AI_GATEWAY_SECRET}`) {
        return new Response('Unauthorized', { status: 401 })
      }
      const body = await request.json() as { authority?: { role?: string; keyVersion?: number | null }; request?: { operation?: string; keyVersion?: number; sequence?: number; updateBinary?: string } }
      const authority = body.authority; const checkpoint = body.request
      if (!authority || authority.role !== 'editor' || !checkpoint) return new Response('Invalid checkpoint authority', { status: 403 })
      if (checkpoint.operation === 'inspect') return Response.json({ headSequence: await this.getSessionHeadSequence() })
      if (!Number.isSafeInteger(checkpoint.keyVersion) || (checkpoint.keyVersion ?? 0) < 1) return new Response('Invalid key version', { status: 400 })
      if (checkpoint.operation === 'bootstrap') {
        return Response.json({ checkpoint: await this.state.storage.get(`checkpoint:${checkpoint.keyVersion}`) ?? null })
      }
      if (checkpoint.operation !== 'save' || !Number.isSafeInteger(checkpoint.sequence) || (checkpoint.sequence ?? -1) < 0 ||
        typeof checkpoint.updateBinary !== 'string' || checkpoint.updateBinary.length > 96 * 1024 * 1024) return new Response('Invalid checkpoint', { status: 400 })
      await this.updateQueue
      if ((checkpoint.sequence ?? 0) > await this.getSessionHeadSequence()) return new Response('Checkpoint exceeds room head', { status: 409 })
      const value = { keyVersion: checkpoint.keyVersion!, sequence: checkpoint.sequence!, updateBinary: checkpoint.updateBinary }
      await this.state.storage.put(`checkpoint:${checkpoint.keyVersion}`, value)
      return Response.json({ checkpoint: value })
    }

'''
    room = replace_once(room, "    if (url.pathname === '/internal/base-advanced' && request.method === 'POST') {\n", checkpoint + "    if (url.pathname === '/internal/base-advanced' && request.method === 'POST') {\n", "DO checkpoint")
write(room_path, room)

# Register every route the main-owned generation-3 host invokes.
index_path = "cloudflare/worker/src/index.ts"
index = read(index_path)
if "handleCollaborationControl" not in index:
    index = index.replace("import { handleCollabV2Session } from './routes/collabV2Session'\n",
      "import { handleCollabV2Session } from './routes/collabV2Session'\nimport { handleCollaborationControl } from './routes/collaborationControl'\nimport { handleCollaborationKeys } from './routes/collaborationKeys'\n", 1)
index = index.replace("  handleCollaborationRepositoryCredential,\n  handleVerifyCollaborationPush,",
  "  handleCollaborationRepositoryCredential,\n  handleCollaborationWorkspaceContext,\n  handleResolveCollaborationBranch,\n  handleCollaborationCheckpoint,\n  handleVerifyCollaborationPush,", 1)
if "url.pathname === '/collab/v2/control'" not in index:
    anchor = '''      if (request.method === 'POST' && url.pathname === '/collab/v2/session') {
        try {
          return await handleCollabV2Session(request, env)
        } catch (error) {
          return protocolError(
            'COLLAB_SESSION_REJECTED',
            error instanceof Error ? error.message : 'Invalid explicit collaboration session request',
            { status: 403 },
            false,
            origin,
          )
        }
      }

'''
    routes = anchor + '''      if (request.method === 'POST' && url.pathname === '/collab/v2/control') {
        try { return await handleCollaborationControl(request, env) } catch (error) {
          return protocolError('COLLABORATION_CONTROL_REJECTED', error instanceof Error ? error.message : 'Session action failed', { status: 400 }, false, origin)
        }
      }
      if (request.method === 'POST' && url.pathname === '/collab/v2/keys') {
        try { return await handleCollaborationKeys(request, env) } catch (error) {
          return protocolError('SESSION_KEY_ACCESS_REJECTED', error instanceof Error ? error.message : 'Session key access failed', { status: 403 }, false, origin)
        }
      }
      if (request.method === 'POST' && url.pathname === '/collab/v2/checkpoint') {
        try { return await handleCollaborationCheckpoint(request, env) } catch (error) {
          return protocolError('CHECKPOINT_ACCESS_REJECTED', error instanceof Error ? error.message : 'Checkpoint access failed', { status: 403 }, false, origin)
        }
      }
      if (request.method === 'POST' && url.pathname === '/collab/v2/workspace-context') {
        try { return await handleCollaborationWorkspaceContext(request, env) } catch (error) {
          return protocolError('SESSION_ACCESS_REJECTED', error instanceof Error ? error.message : 'Session access failed', { status: 403 }, false, origin)
        }
      }
      if (request.method === 'POST' && url.pathname === '/collab/repository/resolve') {
        try { return await handleResolveCollaborationBranch(request, env) } catch (error) {
          return protocolError('REPOSITORY_ACCESS_REJECTED', error instanceof Error ? error.message : 'Branch resolution failed', { status: 403 }, false, origin)
        }
      }

'''
    index = replace_once(index, anchor, routes, "worker generation3 routes")
write(index_path, index)

print("PR141 backend finalization transform applied")
