import type { QueryCtx } from "../_generated/server"
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
