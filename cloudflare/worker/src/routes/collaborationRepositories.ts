import { ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import type { Env } from "../types"
import { verifyJwt } from "../lib/jwt"
import { jsonResponse, parseJsonRequest } from "../lib/protocol"
import { resolveProjectRepositoryAuthorizationForServer } from "../lib/collaborationRepositoryConvex"
import { createGitHubInstallationToken, getGitHubRepositoryHead } from "../lib/githubApp"
import { buildCollaborationRepositoryId } from "../../../../shared/collaborationRepository"

function requiredString(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error(`${label} is required`)
  return value.trim()
}

async function authenticate(request: Request, env: Env): Promise<{ sub: string }> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!bearer) throw new Error("Device authentication is required")
  return verifyJwt(bearer, env.JWT_SECRET, "device")
}

async function credentialResponse(request: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const auth = await authenticate(request, env)
  const projectId = requiredString(body.projectId, "projectId", 128)
  const operation = body.operation === "write" ? "write" : "read"
  const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : undefined
  const authorization = await resolveProjectRepositoryAuthorizationForServer(env, {
    identityKey: auth.sub,
    projectId,
    operation,
    sessionId,
  })
  const installation = await createGitHubInstallationToken(env, {
    installationId: authorization.repository.installationId,
    repositoryNumericId: authorization.repository.repositoryNumericId,
    permission: operation === "write" ? "write" : "read",
  })
  return jsonResponse({
    repository: authorization.repository,
    operation,
    username: "x-access-token",
    token: installation.token,
    expiresAt: installation.expiresAt,
  }, { headers: { "cache-control": "no-store, private", pragma: "no-cache" } })
}

export async function handleCollaborationRepositoryCredential(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonRequest(request) as Record<string, unknown>
  return credentialResponse(request, env, body)
}

export async function handleCollaborationVerifyPush(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const sessionId = requiredString(body.sessionId, "sessionId", 128)
  const commitSha = requiredString(body.commitSha, "commitSha", 64).toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error("commitSha must be a full Git commit SHA")
  const client = new ConvexHttpClient(env.CONVEX_URL)
  const authority = await client.query(makeFunctionReference<"query">("collaborationRoomAuthorization:authorizeSessionForServer"), {
    serverSecret: env.AI_GATEWAY_SECRET,
    identityKey: auth.sub,
    sessionId,
  }) as any
  if (!authority.allowed || authority.role !== "editor") throw new Error("Session push access denied")
  const repository = await resolveProjectRepositoryAuthorizationForServer(env, {
    identityKey: auth.sub,
    projectId: authority.projectId,
    operation: "write",
    sessionId,
  })
  const installation = await createGitHubInstallationToken(env, {
    installationId: repository.repository.installationId,
    repositoryNumericId: repository.repository.repositoryNumericId,
    permission: "read",
  })
  const remoteHead = await getGitHubRepositoryHead(env, {
    repositoryNumericId: repository.repository.repositoryNumericId,
    branch: authority.sessionBranch,
    token: installation.token,
  })
  if (remoteHead.toLowerCase() !== commitSha) throw new Error("The collaboration branch does not point at the prepared commit")
  const result = await client.mutation(makeFunctionReference<"mutation">("collaborationSessions:publishBaseAdvanceFromServer"), {
    serverSecret: env.AI_GATEWAY_SECRET,
    sessionId,
    actorPrincipalId: authority.principalId,
    commitSha,
    coveredThroughSequence: authority.pendingCommitThroughSequence,
  }) as any
  return jsonResponse({ verified: true, sessionId, sessionBranch: authority.sessionBranch, commitSha,
    coveredThroughSequence: result.publishedThroughSequence, baseAdvanced: true }, { headers: { "cache-control": "no-store" } })
}

export async function handleCollaborationGitHubSetup(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const organizationId = requiredString(body.organizationId, "organizationId", 128)
  const clientId = requiredString(env.GITHUB_APP_CLIENT_ID, "GITHUB_APP_CLIENT_ID", 256)
  const state = await clientId // keep response construction deterministic below
  const authorizationUrl = new URL("https://github.com/apps/cozea/installations/new")
  authorizationUrl.searchParams.set("state", `${organizationId}:${auth.sub}:${String(state).slice(0, 0)}`)
  return jsonResponse({ authorizationUrl: authorizationUrl.toString() }, { headers: { "cache-control": "no-store" } })
}

export async function handleCollaborationRepositoryResolve(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const projectId = requiredString(body.projectId, "projectId", 128)
  const authorization = await resolveProjectRepositoryAuthorizationForServer(env, { identityKey: auth.sub, projectId, operation: "read" })
  const installation = await createGitHubInstallationToken(env, {
    installationId: authorization.repository.installationId,
    repositoryNumericId: authorization.repository.repositoryNumericId,
    permission: "read",
  })
  const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : authorization.repository.defaultBranch
  const commitSha = await getGitHubRepositoryHead(env, { repositoryNumericId: authorization.repository.repositoryNumericId, branch, token: installation.token })
  const resolved = await resolveProjectRepositoryAuthorizationForServer(env, { identityKey: auth.sub, projectId, operation: "read" })
  const repositoryId = buildCollaborationRepositoryId(authorization.repository.repositoryNumericId)
  return jsonResponse({ branch, commitSha, branches: [branch], repositoryId,
    fullName: resolved.repository.fullName, resolutionId: crypto.randomUUID() }, { headers: { "cache-control": "no-store" } })
}

export async function handleCollaborationWorkspaceContext(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const sessionId = requiredString(body.sessionId, "sessionId", 128)
  const client = new ConvexHttpClient(env.CONVEX_URL)
  const authority = await client.query(makeFunctionReference<"query">("collaborationRoomAuthorization:authorizeSessionForServer"),
    { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId }) as any
  if (!authority.allowed) throw new Error("Session workspace access denied")
  const authorization = await resolveProjectRepositoryAuthorizationForServer(env, {
    identityKey: auth.sub, projectId: authority.projectId, operation: "read", sessionId,
  })
  return jsonResponse({ principalId: authority.principalId, session: authority.session, role: authority.role,
    cloneUrl: authorization.repository.cloneUrl, expiresAt: Date.now() + 30_000 }, { headers: { "cache-control": "no-store" } })
}

export async function handleCollaborationControl(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const operation = requiredString(body.operation, "operation", 128)
  const args = body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : {}
  const client = new ConvexHttpClient(env.CONVEX_URL)
  const result = await client.mutation(makeFunctionReference<"mutation">(`collaborationSessions:${operation}`), {
    ...args,
    serverSecret: env.AI_GATEWAY_SECRET,
    identityKey: auth.sub,
  })
  return jsonResponse(result, { headers: { "cache-control": "no-store" } })
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
  const checkpoint = result.checkpoint
  if (checkpoint && body.rotation === true && authority.previousKeyVersion && checkpoint.keyVersion === authority.keyVersion) {
    await client.mutation(makeFunctionReference<"mutation">("collaborationEncryption:activateRotationFromServer"),
      { serverSecret: env.AI_GATEWAY_SECRET, sessionId, keyVersion: authority.keyVersion, sequence: checkpoint.sequence })
  }
  return jsonResponse(result, { headers: { "cache-control": "no-store" } })
}
