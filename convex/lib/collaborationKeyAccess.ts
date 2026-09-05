import type { QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { canAccessProject } from "./projectAccess"
import { isRegisteredDevicePrincipal } from "./deviceAuth"

export async function roomKeyHasRemovedRecipient(ctx: QueryCtx, session: Doc<"collaborationSessions">, keyVersion: number): Promise<boolean> {
  const keys = await ctx.db.query("projectCollabWrappedKeys").withIndex("by_project_room_and_key_version", q => q.eq("projectId", session.projectId).eq("roomId", `session:${session.sessionId}`).eq("keyVersion", keyVersion)).take(101)
  if (keys.length > 100) throw new Error("Room key recipient limit exceeded")
  for (const key of keys) {
    if (key.revokedAt !== undefined || !await hasSessionKeyAccess(ctx, session, key.recipientUserId, key.recipientDeviceId)) return true
  }
  return false
}

export async function hasSessionKeyAccess(ctx: QueryCtx, session: Doc<"collaborationSessions">, userId: Id<"users">, deviceId: string): Promise<boolean> {
  const user = await ctx.db.get(userId)
  if (!isRegisteredDevicePrincipal(user) || user.identityKey !== deviceId || !await canAccessProject(ctx, session.projectId, userId)) return false
  const participant = await ctx.db.query("collaborationParticipants").withIndex("by_session_and_user", q => q.eq("sessionId", session._id).eq("userId", userId)).unique()
  return Boolean(participant && participant.leftAt === undefined)
}
