import { ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import { CollaborationProtocolError, parseRoomAuthority, protocolRecord, type RoomAuthority } from "../../../../shared/collaborationProtocol"
import type { Env } from "../types"

/** Revalidation is at the admission boundary, not just the WebSocket handshake. */
export async function currentRoomAuthority(env: Env, identityKey: string, sessionId: string): Promise<RoomAuthority> {
  const result: unknown = await new ConvexHttpClient(env.CONVEX_URL).query(makeFunctionReference<"query">("collaborationRoomAuthorization:authorizeSessionForServer"), {
    serverSecret: env.AI_GATEWAY_SECRET, identityKey, sessionId,
  })
  const authority = protocolRecord(result, "Session authorization")
  if (authority.allowed !== true) throw new CollaborationProtocolError("DEVICE_REVOKED", "Session membership is no longer active; local work remains recoverable", 403)
  return parseRoomAuthority({ ...authority, sessionId })
}
