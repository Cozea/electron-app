import { v } from "convex/values"
import { mutation, query, type QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { requireAuthenticatedDevice, isRegisteredDevicePrincipal, type DevicePrincipal } from "./lib/deviceAuth"
import { authorizeCollaborationParticipant } from "./collaborationRoomAuthorization"
import { roomKeyHasRemovedRecipient } from "./lib/collaborationKeyAccess"

async function requireParticipant(ctx: QueryCtx, userId: Id<"users">, sessionId: string) {
  const authority = await authorizeCollaborationParticipant(ctx, userId, sessionId)
  if (!authority.allowed) throw new Error("Active session membership is required")
  return authority
}
async function wrappedFor(ctx: QueryCtx, projectId: Id<"projects">, roomId: string, deviceId: string, keyVersion: number) {
  const keys = await ctx.db.query("projectCollabWrappedKeys").withIndex("by_project_room_and_recipient", q => q.eq("projectId", projectId).eq("roomId", roomId).eq("recipientDeviceId", deviceId)).collect()
  return keys.find(key => key.keyVersion === keyVersion && key.revokedAt === undefined) ?? null
}
function validateWrap(user: DevicePrincipal, args: { wrappedKey: string; wrapAlgorithm: string; senderPublicKeyJwk: string }) {
  if (args.wrapAlgorithm !== "ECDH-P256+A256GCM" || args.senderPublicKeyJwk !== user.encryptionPublicKeyJwk || args.wrappedKey.length > 8192) throw new Error("Invalid device-bound key wrap")
  const value = JSON.parse(args.wrappedKey) as { v?: unknown; alg?: unknown; iv?: unknown; ciphertext?: unknown; aad?: unknown }
  if (value.v !== 1 || value.alg !== args.wrapAlgorithm || typeof value.iv !== "string" || typeof value.ciphertext !== "string" || typeof value.aad !== "string") throw new Error("Invalid encrypted key envelope")
  const aad = JSON.parse(atob(value.aad)) as { senderDeviceId?: unknown }
  if (atob(value.iv).length !== 12 || atob(value.ciphertext).length !== 48 || aad.senderDeviceId !== user.identityKey) throw new Error("Key envelope does not belong to the authenticated sender")
}
const wrapArgs = { wrappedKey: v.string(), wrapAlgorithm: v.string(), senderPublicKeyJwk: v.string() }

export const initialize = mutation({
  args: { sessionId: v.string(), ...wrapArgs },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const authority = await requireParticipant(ctx, user._id, args.sessionId)
    if (authority.role !== "editor") throw new Error("An editor must initialize encryption")
    validateWrap(user, args)
    if (authority.keyVersion) return { created: false, keyVersion: authority.keyVersion }
    const now = Date.now()
    await ctx.db.insert("projectCollabRoomKeys", { projectId: authority.projectId, roomId: authority.roomId, keyVersion: 1, status: "active", createdByUserId: user._id, createdByDeviceId: user.identityKey, createdAt: now })
    await ctx.db.insert("projectCollabWrappedKeys", { projectId: authority.projectId, roomId: authority.roomId, keyVersion: 1, recipientUserId: user._id, recipientDeviceId: user.identityKey, senderDeviceId: user.identityKey, senderPublicKeyJwk: args.senderPublicKeyJwk, wrapAlgorithm: args.wrapAlgorithm, wrappedKey: args.wrappedKey, createdAt: now })
    return { created: true, keyVersion: 1 }
  },
})

export const bootstrapForServer = query({
  args: { serverSecret: v.string(), sessionId: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    if (!process.env.AI_GATEWAY_SECRET || args.serverSecret !== process.env.AI_GATEWAY_SECRET) throw new Error("Unauthorized")
    const authority = await requireParticipant(ctx, args.userId, args.sessionId)
    const user = await ctx.db.get(args.userId)
    if (!isRegisteredDevicePrincipal(user)) throw new Error("Device revoked")
    const key = authority.keyVersion ? await wrappedFor(ctx, authority.projectId, authority.roomId, user.identityKey, authority.keyVersion) : null
    return { roomId: authority.roomId, encryptionRequired: true, status: !authority.keyVersion ? "room_not_initialized" : key ? "ready" : "missing_for_device", activeKeyVersion: authority.keyVersion ?? 1, wrappedRoomKey: key?.wrappedKey ?? null, wrapAlgorithm: key?.wrapAlgorithm ?? null, senderPublicKeyJwk: key?.senderPublicKeyJwk ?? null }
  },
})

export const waitingDevices = query({
  args: { sessionId: v.string(), keyVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const authority = await requireParticipant(ctx, user._id, args.sessionId)
    if (args.keyVersion !== undefined) {
      if (args.keyVersion !== authority.keyVersion && args.keyVersion !== authority.pendingKeyVersion) throw new Error("Requested key is not current")
      authority.keyVersion = args.keyVersion
    }
    if (authority.role !== "editor" || !authority.keyVersion || !await wrappedFor(ctx, authority.projectId, authority.roomId, user.identityKey, authority.keyVersion)) return []
    const participants = await ctx.db.query("collaborationParticipants").withIndex("by_session_and_user", q => q.eq("sessionId", authority.sessionDocumentId)).take(101)
    if (participants.length > 100) throw new Error("Session participant limit reached")
    const waiting: Array<{ userId: Id<"users">; deviceId: string; publicKeyJwk: string; keyVersion: number }> = []
    for (const participant of participants) {
      if (participant.leftAt !== undefined) continue
      const recipient = await ctx.db.get(participant.userId)
      if (!isRegisteredDevicePrincipal(recipient)) continue
      const recipientAuthority = await authorizeCollaborationParticipant(ctx, recipient._id, args.sessionId)
      if (!recipientAuthority.allowed || await wrappedFor(ctx, authority.projectId, authority.roomId, recipient.identityKey, authority.keyVersion)) continue
      waiting.push({ userId: recipient._id, deviceId: recipient.identityKey, publicKeyJwk: recipient.encryptionPublicKeyJwk, keyVersion: authority.keyVersion })
    }
    return waiting
  },
})

export const share = mutation({
  args: { sessionId: v.string(), recipientUserId: v.id("users"), keyVersion: v.number(), ...wrapArgs },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const authority = await requireParticipant(ctx, user._id, args.sessionId)
    if (authority.role !== "editor" || (authority.keyVersion !== args.keyVersion && authority.pendingKeyVersion !== args.keyVersion) || !await wrappedFor(ctx, authority.projectId, authority.roomId, user.identityKey, args.keyVersion)) throw new Error("An editor holding the current room key must authorize this device")
    if (authority.rotationRequired && args.keyVersion === authority.keyVersion) throw new Error("Rotate the room key before granting new device access")
    validateWrap(user, args)
    await requireParticipant(ctx, args.recipientUserId, args.sessionId)
    const recipient = await ctx.db.get(args.recipientUserId)
    if (!isRegisteredDevicePrincipal(recipient)) throw new Error("Recipient device unavailable")
    if (await wrappedFor(ctx, authority.projectId, authority.roomId, recipient.identityKey, args.keyVersion)) return { stored: false }
    await ctx.db.insert("projectCollabWrappedKeys", { projectId: authority.projectId, roomId: authority.roomId, keyVersion: args.keyVersion, recipientUserId: recipient._id, recipientDeviceId: recipient.identityKey, senderDeviceId: user.identityKey, senderPublicKeyJwk: args.senderPublicKeyJwk, wrapAlgorithm: args.wrapAlgorithm, wrappedKey: args.wrappedKey, createdAt: Date.now() })
    return { stored: true }
  },
})

export const rotationStatus = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const authority = await requireParticipant(ctx, user._id, args.sessionId)
    const pending = authority.pendingKeyVersion ? await wrappedFor(ctx, authority.projectId, authority.roomId, user.identityKey, authority.pendingKeyVersion) : null
    return { required: authority.rotationRequired, currentKeyVersion: authority.keyVersion, pendingKeyVersion: authority.pendingKeyVersion,
      wrappedRoomKey: pending?.wrappedKey ?? null, senderPublicKeyJwk: pending?.senderPublicKeyJwk ?? null, wrapAlgorithm: pending?.wrapAlgorithm ?? null }
  },
})

export const beginRotation = mutation({
  args: { sessionId: v.string(), ...wrapArgs },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const authority = await requireParticipant(ctx, user._id, args.sessionId)
    if (authority.role !== "editor" || !authority.keyVersion || !await wrappedFor(ctx, authority.projectId, authority.roomId, user.identityKey, authority.keyVersion)) throw new Error("An editor holding the previous room key must rotate it")
    if (!authority.rotationRequired) return { created: false, keyVersion: authority.keyVersion }
    validateWrap(user, args)
    const session = await ctx.db.get(authority.sessionDocumentId)
    if (!session) throw new Error("Session unavailable")
    const keys = await ctx.db.query("projectCollabRoomKeys").withIndex("by_project_and_room", q => q.eq("projectId", authority.projectId).eq("roomId", authority.roomId)).collect()
    const pending = keys.find(key => key.status === "rotating")
    if (pending && !await roomKeyHasRemovedRecipient(ctx, session, pending.keyVersion)) return { created: false, keyVersion: pending.keyVersion }
    // A further removal during rotation invalidates that unpublished key. Its
    // encrypted checkpoint remains recoverable; it can never authorize writes.
    if (pending) await ctx.db.patch(pending._id, { status: "revoked", rotatedAt: Date.now() })
    const keyVersion = Math.max(...keys.map(key => key.keyVersion)) + 1
    await ctx.db.insert("projectCollabRoomKeys", { projectId: authority.projectId, roomId: authority.roomId, keyVersion, status: "rotating", createdByUserId: user._id, createdByDeviceId: user.identityKey, createdAt: Date.now() })
    await ctx.db.insert("projectCollabWrappedKeys", { projectId: authority.projectId, roomId: authority.roomId, keyVersion, recipientUserId: user._id, recipientDeviceId: user.identityKey, senderDeviceId: user.identityKey, senderPublicKeyJwk: args.senderPublicKeyJwk, wrapAlgorithm: args.wrapAlgorithm, wrappedKey: args.wrappedKey, createdAt: Date.now() })
    return { created: true, keyVersion }
  },
})

export const rotationCheckpointAuthorityForServer = query({
  args: { serverSecret: v.string(), sessionId: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    if (!process.env.AI_GATEWAY_SECRET || args.serverSecret !== process.env.AI_GATEWAY_SECRET) throw new Error("Unauthorized")
    const authority = await requireParticipant(ctx, args.userId, args.sessionId)
    const user = await ctx.db.get(args.userId)
    const session = await ctx.db.get(authority.sessionDocumentId)
    const pendingVersion = authority.pendingKeyVersion
    if (!isRegisteredDevicePrincipal(user) || !session || authority.role !== "editor" || !authority.keyVersion || !pendingVersion ||
      !await wrappedFor(ctx, authority.projectId, authority.roomId, user.identityKey, pendingVersion) || await roomKeyHasRemovedRecipient(ctx, session, pendingVersion)) throw new Error("Rotation requires an authorized editor holding the pending key")
    return { ...authority, previousKeyVersion: authority.keyVersion, keyVersion: pendingVersion }
  },
})

export const activateRotationFromServer = mutation({
  args: { serverSecret: v.string(), sessionId: v.string(), keyVersion: v.number(), sequence: v.number() },
  handler: async (ctx, args) => {
    if (!process.env.AI_GATEWAY_SECRET || args.serverSecret !== process.env.AI_GATEWAY_SECRET) throw new Error("Unauthorized")
    const session = await ctx.db.query("collaborationSessions").withIndex("by_session_id", q => q.eq("sessionId", args.sessionId)).unique()
    if (!session || session.generation !== 3 || ["closing", "closed", "failed"].includes(session.status) || !Number.isSafeInteger(args.sequence) || args.sequence < 0) throw new Error("Session rotation is no longer available")
    const keys = await ctx.db.query("projectCollabRoomKeys").withIndex("by_project_and_room", q => q.eq("projectId", session.projectId).eq("roomId", `session:${args.sessionId}`)).collect()
    const target = keys.find(key => key.keyVersion === args.keyVersion)
    if (!target || target.status === "revoked" || await roomKeyHasRemovedRecipient(ctx, session, target.keyVersion)) throw new Error("Pending key recipients changed; rotate again before resuming")
    if (target.status === "active") return { activated: true }
    for (const key of keys) if (key.status === "active") await ctx.db.patch(key._id, { status: "revoked", rotatedAt: Date.now() })
    await ctx.db.patch(target._id, { status: "active", rotatedAt: Date.now() })
    await ctx.db.patch(session._id, { revision: session.revision + 1, updatedAt: Date.now() })
    return { activated: true }
  },
})
