import { ConvexHttpClient } from "convex/browser"
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
