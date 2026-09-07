#!/usr/bin/env python3
from pathlib import Path
import subprocess

ARCHIVE = "origin/archive/pr141-pre-main-port"

def old(path: str) -> str:
    return subprocess.check_output(["git", "show", f"{ARCHIVE}:{path}"], text=True)

def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)

# The reviewed wire protocol is identity-neutral.
write("cloudflare/worker/src/lib/protocol.ts", old("cloudflare/worker/src/lib/protocol.ts"))

# Port the reviewed Durable Object but replace obsolete user/device aliases with the
# canonical principal claim already issued by current main.
room = old("cloudflare/worker/src/durableObjects/CollabRoom.ts")
room = room.replace("  userId: string\n", "  principalId: string\n")
room = room.replace("if (!claims.userId || !claims.deviceId) throw new Error('Session principal is missing')", "if (!claims.principalId) throw new Error('Session principal is missing')")
room = room.replace("userId: claims.userId,", "principalId: claims.principalId,")
room = room.replace("`${claims.userId}:${crypto.randomUUID()}`", "`${claims.principalId}:${crypto.randomUUID()}`")
room = room.replace("`rate:${connection.userId}`", "`rate:${connection.principalId}`")
write("cloudflare/worker/src/durableObjects/CollabRoom.ts", room)

# Keep the Cloudflare hibernation/storage declarations that the reviewed room requires.
write("cloudflare/worker/src/cloudflare-runtime.d.ts", old("cloudflare/worker/src/cloudflare-runtime.d.ts"))

write("convex/collaborationRoomAuthorization.ts", r'''import { v } from "convex/values"

import { query } from "./_generated/server"
import { canAccessProject } from "./lib/projectAccess"

function assertGatewaySecret(secret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || secret !== expected) throw new Error("Unauthorized")
}

export const authorizeSessionForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const principal = await ctx.db
      .query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", args.identityKey.trim()))
      .unique()
    if (!principal || principal.status === "revoked") return { allowed: false as const }

    const session = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId.trim()))
      .unique()
    if (!session || session.status === "closed" || session.status === "failed") {
      return { allowed: false as const }
    }
    if (!(await canAccessProject(ctx, session.projectId, principal._id))) {
      return { allowed: false as const }
    }

    const participant = await ctx.db
      .query("collaborationParticipants")
      .withIndex("by_session_and_principal", (q) =>
        q.eq("sessionId", session._id).eq("principalId", principal._id),
      )
      .unique()
    if (!participant || participant.leftAt !== undefined) return { allowed: false as const }

    return {
      allowed: true as const,
      principalId: principal._id,
      projectId: session.projectId,
      sessionDocumentId: session._id,
      sessionId: session.sessionId,
      roomId: `session:${session.sessionId}`,
      role: participant.role,
      capabilities: participant.capabilities,
    }
  },
})
''')

write("cloudflare/worker/src/lib/collaborationV2Convex.ts", r'''import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReference } from 'convex/server'

import type { DeviceAccessClaims, EncryptionBootstrap, Env } from '../types'
import { requireActiveDeviceAccessInConvex } from './convex'

type QueryReference = FunctionReference<'query', 'public', Record<string, unknown>, unknown>
type MutationReference = FunctionReference<'mutation', 'public', Record<string, unknown>, unknown>

function queryReference(name: string): QueryReference { return name as unknown as QueryReference }
function mutationReference(name: string): MutationReference { return name as unknown as MutationReference }
function client(env: Env): ConvexHttpClient { return new ConvexHttpClient(env.CONVEX_URL) }

export async function createExplicitCollaborationContext(
  env: Env,
  args: { projectId: string; sessionId: string },
  auth: DeviceAccessClaims,
): Promise<{
  principalId: string
  identityKey: string
  displayName: string
  projectId: string
  sessionId: string
  roomId: string
  encryptionFingerprint: string
  encryptionPublicKeyJwk: string
  encryption: EncryptionBootstrap
}> {
  const principal = await requireActiveDeviceAccessInConvex(env, auth)
  const authorization = await client(env).query(
    queryReference('collaborationRoomAuthorization:authorizeSessionForServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId: args.sessionId },
  ) as {
    allowed: boolean
    principalId?: string
    projectId?: string
    sessionId?: string
    roomId?: string
  }
  if (
    !authorization.allowed || !authorization.principalId || !authorization.projectId ||
    !authorization.sessionId || !authorization.roomId
  ) throw new Error('The authenticated device cannot join this collaboration session')
  if (authorization.principalId !== principal.principalId || authorization.projectId !== args.projectId) {
    throw new Error('Collaboration session authority does not match the authenticated principal/project')
  }

  const encryption = await client(env).query(queryReference('yjs:getEncryptionBootstrap'), {
    serverSecret: env.AI_GATEWAY_SECRET,
    projectId: authorization.projectId,
    roomId: authorization.roomId,
    principalId: principal.principalId,
  }) as EncryptionBootstrap

  return {
    principalId: principal.principalId,
    identityKey: principal.identityKey,
    displayName: principal.displayName,
    projectId: authorization.projectId,
    sessionId: authorization.sessionId,
    roomId: authorization.roomId,
    encryptionFingerprint: principal.encryptionFingerprint,
    encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
    encryption,
  }
}

export async function updateAuthoritativeRoomHead(
  env: Env,
  sessionId: string,
  roomHeadSequence: number,
): Promise<void> {
  await client(env).mutation(
    mutationReference('collaborationSessions:updateRoomHeadFromServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, sessionId, roomHeadSequence },
  )
}
''')

write("cloudflare/worker/src/routes/collabV2Session.ts", r'''import type { Env, SessionDescriptor } from '../types'
import { signSessionToken, verifyDeviceAccessToken } from '../lib/jwt'
import { COLLAB_PROTOCOL_VERSION, jsonResponse } from '../lib/protocol'
import { parseJsonRequest } from '../lib/validation'
import { createExplicitCollaborationContext } from '../lib/collaborationV2Convex'
import { getCollabCapabilities } from './collabCapabilities'

function requiredString(value: unknown, label: string, maxLength = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`${label} is invalid`)
  return value.trim()
}

function toWsUrl(request: Request, roomId: string): string {
  const url = new URL(request.url)
  url.pathname = '/collab/ws'
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = new URLSearchParams({ roomId }).toString()
  return url.toString()
}

export async function handleCollabV2Session(request: Request, env: Env): Promise<Response> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw new Error('Device authentication is required')
  const auth = await verifyDeviceAccessToken(env, authorization.slice('Bearer '.length).trim())
  const raw = await parseJsonRequest(request)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Collaboration request must be an object')
  const body = raw as Record<string, unknown>
  const clientType = body.clientType === 'web' ? 'web' : body.clientType === 'electron' ? 'electron' : null
  if (!clientType) throw new Error('clientType is invalid')
  const projectId = requiredString(body.projectId, 'projectId', 128)
  const sessionId = requiredString(body.sessionId, 'sessionId', 128)

  const context = await createExplicitCollaborationContext(env, { projectId, sessionId }, auth)
  const protocolVersion = env.COLLAB_PROTOCOL_VERSION ?? COLLAB_PROTOCOL_VERSION
  const token = await signSessionToken(env, {
    sub: context.identityKey,
    principalId: context.principalId,
    projectId: context.projectId,
    sessionId: context.sessionId,
    roomId: context.roomId,
    clientType,
    protocolVersion,
  })

  const response: SessionDescriptor = {
    projectId: context.projectId,
    sessionId: context.sessionId,
    roomId: context.roomId,
    collabWsUrl: toWsUrl(request, context.roomId),
    token,
    protocolVersion,
    principalId: context.principalId,
    identityKey: context.identityKey,
    displayName: context.displayName,
    encryptionFingerprint: context.encryptionFingerprint,
    encryptionPublicKeyJwk: context.encryptionPublicKeyJwk,
    capabilities: getCollabCapabilities(env),
    encryption: context.encryption,
  }
  return jsonResponse(response, { headers: { 'cache-control': 'no-store' } })
}
''')

# Current principal-native token/response contracts get an optional explicit session id.
types_path = Path("cloudflare/worker/src/types.ts")
types = types_path.read_text()
if "  sessionId?: string\n  roomId: string\n" not in types:
    types = types.replace("  projectId: string\n  roomId: string\n  collabWsUrl:", "  projectId: string\n  sessionId?: string\n  roomId: string\n  collabWsUrl:", 1)
if "  sessionId?: string\n  roomId: string\n  principalId:" not in types:
    types = types.replace("  projectId: string\n  roomId: string\n  principalId: string\n  clientType:", "  projectId: string\n  sessionId?: string\n  roomId: string\n  principalId: string\n  clientType:", 1)
types_path.write_text(types)

# Register the server-only room authorization module in the checked-in Convex API.
api_path = Path("convex/_generated/api.d.ts")
api = api_path.read_text()
imp = 'import type * as collaborationRoomAuthorization from "../collaborationRoomAuthorization.js";\n'
if imp not in api:
    api = api.replace('import type * as collaborationSessions from "../collaborationSessions.js";\n', 'import type * as collaborationSessions from "../collaborationSessions.js";\n' + imp, 1)
line = "  collaborationRoomAuthorization: typeof collaborationRoomAuthorization;\n"
if line not in api:
    api = api.replace("  collaborationSessions: typeof collaborationSessions;\n", "  collaborationSessions: typeof collaborationSessions;\n" + line, 1)
api_path.write_text(api)

# Wire explicit-session issuance without changing the legacy project room endpoint yet.
index_path = Path("cloudflare/worker/src/index.ts")
index = index_path.read_text()
imp = "import { handleCollabV2Session } from './routes/collabV2Session'\n"
if imp not in index:
    anchor = "import { handleCollabSession } from './routes/collabSession'\n"
    if anchor not in index: raise SystemExit("collab session import anchor missing")
    index = index.replace(anchor, anchor + imp, 1)
route = """      if (request.method === 'POST' && url.pathname === '/collab/v2/session') {\n        try {\n          return await handleCollabV2Session(request, env)\n        } catch (error) {\n          return protocolError(\n            'COLLAB_SESSION_REJECTED',\n            error instanceof Error ? error.message : 'Invalid explicit collaboration session request',\n            { status: 403 },\n            false,\n            origin,\n          )\n        }\n      }\n\n"""
anchor = "      if (request.method === 'POST' && url.pathname === '/devapps/runtime-builds') {\n"
if "/collab/v2/session" not in index:
    if anchor not in index: raise SystemExit("explicit session route anchor missing")
    index = index.replace(anchor, route + anchor, 1)
index_path.write_text(index)

print("PR141 phase 5 explicit principal-native session transport port applied")
