import { mutation as baseMutation, type MutationCtx, type QueryCtx } from "./_generated/server"
import { authenticatedMutation as mutation } from "./lib/authenticatedFunctions"
import type { Id } from "./_generated/dataModel"
import { ConvexError, v } from "convex/values"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { canAccessProject, canManageProject } from "./lib/projectAccess"

// The Yjs-era room/key endpoints are gone (see collaborationArchitectureCutover).
// Only the device key-request round-trip survives: its exact shape is pinned by
// tests/identity/manualReviewHardening.test.ts, which binds room-key requests
// to canonical principal encryption metadata.
type YjsSyncCtx = QueryCtx | MutationCtx

async function getProject(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">
) {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    throw new Error("Project not found")
  }

  return project
}

async function assertCollaborationWriteAllowed(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  _additionalBytes: number
) {
  return await getProject(ctx, projectId)
}
export const createKeyRequest = baseMutation({
  args: { projectId: v.id("projects"), roomId: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    if (!(await canAccessProject(ctx, args.projectId, principal._id))) {
      throw new ConvexError("The authenticated device cannot access this project")
    }
    const existing = await ctx.db.query("projectCollabKeyRequests")
      .withIndex("by_project_room_and_device", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientIdentityKey", principal.identityKey))
      .first()
    const now = Date.now()
    const payload = {
      recipientPrincipalId: principal._id,
      recipientIdentityKey: principal.identityKey,
      recipientPublicKeyJwk: principal.encryptionPublicKeyJwk,
      recipientFingerprint: principal.encryptionFingerprint,
      requestedAt: now,
      fulfilledAt: undefined,
    }
    if (existing) {
      await ctx.db.patch(existing._id, payload)
      return { requestId: existing._id, created: false }
    }
    const requestId = await ctx.db.insert("projectCollabKeyRequests", {
      projectId: args.projectId, roomId: args.roomId, ...payload,
    })
    return { requestId, created: true }
  },
})

export const storeWrappedRoomKey = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.string(),
    keyVersion: v.number(),
    keyRequestId: v.id("projectCollabKeyRequests"),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, principal._id))) {
      throw new ConvexError("Only project managers can approve encryption key requests")
    }
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const pendingRequest = await ctx.db.get(args.keyRequestId)
    if (
      !pendingRequest ||
      pendingRequest.projectId !== args.projectId ||
      pendingRequest.roomId !== args.roomId ||
      typeof pendingRequest.fulfilledAt === "number"
    ) {
      throw new ConvexError("A matching pending key request is required before sharing access")
    }
    const recipient = await ctx.db.get(pendingRequest.recipientPrincipalId)
    if (
      !recipient ||
      recipient.status === "revoked" ||
      recipient.identityKey !== pendingRequest.recipientIdentityKey ||
      recipient.encryptionPublicKeyJwk !== pendingRequest.recipientPublicKeyJwk ||
      recipient.encryptionFingerprint !== pendingRequest.recipientFingerprint
    ) {
      throw new ConvexError("The pending request no longer matches the recipient device identity")
    }
    const existing = await ctx.db.query("projectCollabWrappedKeys")
      .withIndex("by_project_room_and_recipient", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientIdentityKey", recipient.identityKey))
      .collect()
    const matching = existing.find((entry) => entry.keyVersion === args.keyVersion && typeof entry.revokedAt !== "number")
    const now = Date.now()
    const wrapped = {
      senderIdentityKey: principal.identityKey,
      senderPublicKeyJwk: principal.encryptionPublicKeyJwk,
      wrapAlgorithm: args.wrapAlgorithm,
      wrappedKey: args.wrappedKey,
      createdAt: now,
    }
    if (matching) await ctx.db.patch(matching._id, wrapped)
    else await ctx.db.insert("projectCollabWrappedKeys", {
      projectId: args.projectId, roomId: args.roomId, keyVersion: args.keyVersion,
      recipientPrincipalId: recipient._id, recipientIdentityKey: recipient.identityKey, ...wrapped,
    })
    await ctx.db.patch(pendingRequest._id, { fulfilledAt: now })
    return { stored: true }
  },
})
