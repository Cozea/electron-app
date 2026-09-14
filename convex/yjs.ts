import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { mutation as baseMutation, type MutationCtx, type QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { ConvexError, v } from "convex/values"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { canAccessProject, canManageProject } from "./lib/projectAccess"

interface ParsedCipherEnvelopeMetadata {
  kind: "yjs_update" | "yjs_snapshot" | "yjs_awareness"
  keyVersion: number
}

function parseCipherEnvelopeMetadata(bytes: ArrayBuffer): ParsedCipherEnvelopeMetadata | null {
  try {
    const text = new TextDecoder().decode(new Uint8Array(bytes))
    const parsed = JSON.parse(text) as {
      algo?: unknown
      iv?: unknown
      ciphertext?: unknown
      meta?: { kind?: unknown; keyVersion?: unknown }
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.algo === "A256GCM" &&
      typeof parsed.iv === "string" &&
      typeof parsed.ciphertext === "string" &&
      parsed.meta &&
      typeof parsed.meta === "object" &&
      (parsed.meta.kind === "yjs_update" ||
        parsed.meta.kind === "yjs_snapshot" ||
        parsed.meta.kind === "yjs_awareness") &&
      Number.isInteger(parsed.meta.keyVersion) &&
      (parsed.meta.keyVersion as number) >= 1
    ) {
      return {
        kind: parsed.meta.kind,
        keyVersion: parsed.meta.keyVersion as number,
      }
    }
  } catch {
    return null
  }
  return null
}

function assertEncryptedPayloadMatchesActiveKey(args: {
  payload: ArrayBuffer
  expectedKind: "yjs_update" | "yjs_snapshot" | "yjs_awareness"
  activeKeyVersion: number
}): void {
  const meta = parseCipherEnvelopeMetadata(args.payload)
  if (!meta || meta.kind !== args.expectedKind) {
    throw new ConvexError({
      code: "unencrypted_payload_rejected",
      message: "Payload rejected: end-to-end encryption is required.",
    })
  }
  if (meta.keyVersion !== args.activeKeyVersion) {
    throw new ConvexError({
      code: "encryption_key_stale",
      message: `Payload encrypted with stale or invalid key version ${meta.keyVersion} (active: ${args.activeKeyVersion}).`,
    })
  }
}

type YjsSyncCtx = QueryCtx | MutationCtx

interface ActiveRoomKeyRecord {
  _id: Id<"projectCollabRoomKeys">
  projectId: Id<"projects">
  roomId: string
  keyVersion: number
  status: "active" | "rotating" | "revoked"
  createdByPrincipalId: Id<"devicePrincipals">
  createdByIdentityKey: string
  createdAt: number
  rotatedAt?: number
}

interface WrappedRoomKeyRecord {
  _id: Id<"projectCollabWrappedKeys">
  projectId: Id<"projects">
  roomId: string
  keyVersion: number
  recipientPrincipalId: Id<"devicePrincipals">
  recipientIdentityKey: string
  senderIdentityKey: string
  senderPublicKeyJwk: string
  wrapAlgorithm: string
  wrappedKey: string
  createdAt: number
  revokedAt?: number
}

interface RecoveryKitRecord {
  _id: Id<"projectCollabRecoveryKits">
  projectId: Id<"projects">
  roomId: string
  keyVersion: number
  wrapAlgorithm: string
  wrappedKey: string
  salt: string
  iterations: number
  createdByPrincipalId: Id<"devicePrincipals">
  createdByIdentityKey: string
  createdAt: number
  revokedAt?: number
}

type EncryptionBootstrapStatus =
  | "room_not_initialized"
  | "ready"
  | "missing_for_device"
  | "device_revoked"

function assertGatewaySecret(secret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || secret !== expected) {
    throw new ConvexError("Unauthorized")
  }
}

function defaultRoomId(projectId: Id<"projects">): string {
  return `project:${projectId}`
}

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

async function assertCollaborationAccess(ctx: YjsSyncCtx, projectId: Id<"projects">) {
  await getProject(ctx, projectId)
}

async function assertCollaborationWriteAllowed(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  _additionalBytes: number
) {
  return await getProject(ctx, projectId)
}

async function hasAnyStoredCollabData(
  _ctx: YjsSyncCtx,
  _projectId: Id<"projects">,
): Promise<boolean> {
  return false
}

async function getActiveRoomKey(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">,
  roomId: string,
): Promise<ActiveRoomKeyRecord | null> {
  const roomKeys = await ctx.db
    .query("projectCollabRoomKeys")
    .withIndex("by_project_and_room", (q) => q.eq("projectId", projectId).eq("roomId", roomId))
    .collect()

  const active = roomKeys
    .filter((entry) => entry.status === "active" || entry.status === "rotating")
    .sort((a, b) => b.keyVersion - a.keyVersion)[0]

  return (active ?? null) as ActiveRoomKeyRecord | null
}

async function getWrappedRoomKeyForDevice(
  ctx: YjsSyncCtx,
  args: {
    projectId: Id<"projects">
    roomId: string
    identityKey: string
    keyVersion: number
  },
): Promise<WrappedRoomKeyRecord | null> {
  const candidates = await ctx.db
    .query("projectCollabWrappedKeys")
    .withIndex("by_project_room_and_recipient", (q) =>
      q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientIdentityKey", args.identityKey),
    )
    .collect()

  const match = candidates
    .filter((entry) => entry.keyVersion === args.keyVersion && typeof entry.revokedAt !== "number")
    .sort((a, b) => b.createdAt - a.createdAt)[0]

  return (match ?? null) as WrappedRoomKeyRecord | null
}

async function getActiveRecoveryKitRecord(
  ctx: YjsSyncCtx,
  args: {
    projectId: Id<"projects">
    roomId: string
    keyVersion?: number | null
  },
): Promise<RecoveryKitRecord | null> {
  const candidates = await ctx.db
    .query("projectCollabRecoveryKits")
    .withIndex("by_project_and_room", (q) =>
      q.eq("projectId", args.projectId).eq("roomId", args.roomId),
    )
    .collect()

  const match = candidates
    .filter((entry) =>
      typeof entry.revokedAt !== "number" &&
      (args.keyVersion == null || entry.keyVersion === args.keyVersion),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0]

  return (match ?? null) as RecoveryKitRecord | null
}

async function deleteAllProjectCollabPayloads(
  _ctx: MutationCtx,
  _projectId: Id<"projects">,
): Promise<{ removedUpdateBytes: number; removedSnapshotBytes: number }> {
  return {
    removedUpdateBytes: 0,
    removedSnapshotBytes: 0,
  }
}

async function deleteAllProjectAwarenessEntries(
  _ctx: MutationCtx,
  _projectId: Id<"projects">,
): Promise<number> {
  return 0
}

export const getEncryptionBootstrap = query({
  args: {
    serverSecret: v.string(),
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    principalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    await assertCollaborationAccess(ctx, args.projectId)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const principal = await ctx.db.get(args.principalId)
    if (!principal || principal.status === "revoked") {
      return {
        roomId,
        encryptionRequired: true,
        status: "device_revoked" as EncryptionBootstrapStatus,
        activeKeyVersion: null,
        wrappedRoomKey: null,
        wrapAlgorithm: null,
        senderPublicKeyJwk: null,
      }
    }

    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)

    if (!activeRoomKey) {
      return {
        roomId,
        encryptionRequired: true,
        status: "room_not_initialized" as EncryptionBootstrapStatus,
        activeKeyVersion: 1,
        wrappedRoomKey: null,
        wrapAlgorithm: null,
        senderPublicKeyJwk: null,
      }
    }

    const wrappedKey = await getWrappedRoomKeyForDevice(ctx, {
      projectId: args.projectId,
      roomId,
      identityKey: principal.identityKey,
      keyVersion: activeRoomKey.keyVersion,
    })

    if (!wrappedKey) {
      return {
        roomId,
        encryptionRequired: true,
        status: "missing_for_device" as EncryptionBootstrapStatus,
        activeKeyVersion: activeRoomKey.keyVersion,
        wrappedRoomKey: null,
        wrapAlgorithm: null,
        senderPublicKeyJwk: null,
      }
    }

    return {
      roomId,
      encryptionRequired: true,
      status: "ready" as EncryptionBootstrapStatus,
      activeKeyVersion: activeRoomKey.keyVersion,
      wrappedRoomKey: wrappedKey.wrappedKey,
      wrapAlgorithm: wrappedKey.wrapAlgorithm,
      senderPublicKeyJwk: wrappedKey.senderPublicKeyJwk,
    }
  },
})

export const initializeEncryptedRoom = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    keyVersion: v.number(),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const existingRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)
    if (existingRoomKey) return { roomId, created: false, keyVersion: existingRoomKey.keyVersion }

    const hasCollabData = await hasAnyStoredCollabData(ctx, args.projectId)
    let removedUpdateBytes = 0
    let removedSnapshotBytes = 0
    let removedAwarenessEntries = 0
    if (hasCollabData) {
      const payloadCleanup = await deleteAllProjectCollabPayloads(ctx, args.projectId)
      removedUpdateBytes = payloadCleanup.removedUpdateBytes
      removedSnapshotBytes = payloadCleanup.removedSnapshotBytes
      removedAwarenessEntries = await deleteAllProjectAwarenessEntries(ctx, args.projectId)
    }

    const keyVersion = Math.max(1, Math.floor(args.keyVersion))
    const now = Date.now()
    await ctx.db.insert("projectCollabRoomKeys", {
      projectId: args.projectId, roomId, keyVersion, status: "active",
      createdByPrincipalId: principal._id, createdByIdentityKey: principal.identityKey, createdAt: now,
    })
    await ctx.db.insert("projectCollabWrappedKeys", {
      projectId: args.projectId, roomId, keyVersion,
      recipientPrincipalId: principal._id, recipientIdentityKey: principal.identityKey,
      senderIdentityKey: principal.identityKey, senderPublicKeyJwk: principal.encryptionPublicKeyJwk,
      wrapAlgorithm: args.wrapAlgorithm, wrappedKey: args.wrappedKey, createdAt: now,
    })
    return { roomId, created: true, keyVersion, removedUpdateBytes, removedSnapshotBytes, removedAwarenessEntries }
  },
})

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

export const listPendingKeyRequests = query({
  args: {
    projectId: v.id("projects"),
    roomId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can review encryption key requests")
    }
    await assertCollaborationAccess(ctx, args.projectId)
    const requests = await ctx.db
      .query("projectCollabKeyRequests")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId),
      )
      .collect()

    return requests
      .filter((request) => typeof request.fulfilledAt !== "number")
      .sort((a, b) => a.requestedAt - b.requestedAt)
  },
})

export const getActiveRecoveryKit = query({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertCollaborationAccess(ctx, args.projectId)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)
    if (!activeRoomKey) {
      return null
    }

    const recoveryKit = await getActiveRecoveryKitRecord(ctx, {
      projectId: args.projectId,
      roomId,
      keyVersion: activeRoomKey.keyVersion,
    })

    if (!recoveryKit) {
      return null
    }

    return {
      roomId,
      keyVersion: recoveryKit.keyVersion,
      wrapAlgorithm: recoveryKit.wrapAlgorithm,
      wrappedKey: recoveryKit.wrappedKey,
      salt: recoveryKit.salt,
      iterations: recoveryKit.iterations,
      createdAt: recoveryKit.createdAt,
      createdByIdentityKey: recoveryKit.createdByIdentityKey,
    }
  },
})

export const listCollabRoomDevices = query({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can review collaboration devices")
    }
    await assertCollaborationAccess(ctx, args.projectId)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)
    const [wrappedKeys, pendingRequests] = await Promise.all([
      ctx.db
        .query("projectCollabWrappedKeys")
        .withIndex("by_project_room_and_key_version", (q) =>
          q.eq("projectId", args.projectId).eq("roomId", roomId).eq("keyVersion", activeRoomKey?.keyVersion ?? 1),
        )
        .collect(),
      ctx.db
        .query("projectCollabKeyRequests")
        .withIndex("by_project_and_room", (q) => q.eq("projectId", args.projectId).eq("roomId", roomId))
        .collect(),
    ])

    const identityKeys = new Set<string>()
    for (const entry of wrappedKeys) {
      identityKeys.add(entry.recipientIdentityKey)
    }
    for (const request of pendingRequests) {
      identityKeys.add(request.recipientIdentityKey)
    }

    const devices = await Promise.all(
      [...identityKeys].map(async (identityKey) => {
        const principal = await ctx.db
          .query("devicePrincipals")
          .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey))
          .unique()
        if (!principal) return null

        const deviceWrappedKeys = wrappedKeys
          .filter((entry) => entry.recipientIdentityKey === identityKey)
          .sort((a, b) => b.createdAt - a.createdAt)
        const pendingRequest = pendingRequests
          .filter((entry) => entry.recipientIdentityKey === identityKey && typeof entry.fulfilledAt !== "number")
          .sort((a, b) => b.requestedAt - a.requestedAt)[0]

        return {
          principalId: principal._id,
          identityKey: principal.identityKey,
          displayName: principal.displayName,
          platform: principal.platform,
          encryptionFingerprint: principal.encryptionFingerprint,
          encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
          encryptionPublicKeyAlgorithm: principal.encryptionPublicKeyAlgorithm,
          createdAt: principal.createdAt,
          lastSeenAt: principal.lastAuthenticatedAt,
          revokedAt: principal.revokedAt ?? null,
          hasWrappedKey: deviceWrappedKeys.some((entry) => typeof entry.revokedAt !== "number"),
          wrappedKeyVersion: deviceWrappedKeys[0]?.keyVersion ?? null,
          hasPendingRequest: Boolean(pendingRequest),
          pendingRequestedAt: pendingRequest?.requestedAt ?? null,
          activeKeyVersion: activeRoomKey?.keyVersion ?? null,
          rotationRequired: activeRoomKey?.status === "rotating",
        }
      }),
    )

    return devices
      .filter((device) => device !== null)
      .sort((a, b) => (b?.lastSeenAt ?? 0) - (a?.lastSeenAt ?? 0))
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

export const storeRecoveryKit = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.string(),
    keyVersion: v.number(),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
    salt: v.string(),
    iterations: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can create collaboration recovery kits")
    }
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, args.roomId)
    if (!activeRoomKey) {
      throw new ConvexError({
        code: "room_not_initialized",
        message: "Encrypted collaboration room is not initialized.",
      })
    }

    const normalizedKeyVersion = Math.max(1, Math.floor(args.keyVersion))
    if (activeRoomKey.keyVersion !== normalizedKeyVersion) {
      throw new ConvexError({
        code: "encryption_key_stale",
        message: "Recovery kit does not match the active encrypted room key.",
      })
    }

    const now = Date.now()
    const existing = await ctx.db
      .query("projectCollabRecoveryKits")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId),
      )
      .collect()

    for (const entry of existing) {
      if (typeof entry.revokedAt === "number") continue
      await ctx.db.patch(entry._id, {
        revokedAt: now,
      })
    }

    await ctx.db.insert("projectCollabRecoveryKits", {
      projectId: args.projectId,
      roomId: args.roomId,
      keyVersion: normalizedKeyVersion,
      wrapAlgorithm: args.wrapAlgorithm,
      wrappedKey: args.wrappedKey,
      salt: args.salt,
      iterations: Math.max(1, Math.floor(args.iterations)),
      createdByPrincipalId: user._id,
      createdByIdentityKey: user.identityKey,
      createdAt: now,
    })

    return { stored: true, keyVersion: normalizedKeyVersion }
  },
})

export const revokeCollabDevice = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    identityKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can revoke collaboration access")
    }
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const now = Date.now()

    const wrappedKeys = await ctx.db
      .query("projectCollabWrappedKeys")
      .withIndex("by_project_room_and_recipient", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId).eq("recipientIdentityKey", args.identityKey),
      )
      .collect()
    for (const entry of wrappedKeys) {
      if (typeof entry.revokedAt === "number") continue
      await ctx.db.patch(entry._id, {
        revokedAt: now,
      })
    }

    const pendingRequests = await ctx.db
      .query("projectCollabKeyRequests")
      .withIndex("by_project_room_and_device", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId).eq("recipientIdentityKey", args.identityKey),
      )
      .collect()
    for (const request of pendingRequests) {
      if (typeof request.fulfilledAt === "number") continue
      await ctx.db.patch(request._id, {
        fulfilledAt: now,
      })
    }

    return { revoked: true, revokedAt: now }
  },
})

export const rotateEncryptedRoomKey = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    encryptedSnapshot: v.optional(v.bytes()),
    createdByClientId: v.optional(v.string()),
    wrappedKeys: v.array(
      v.object({
        recipientPrincipalId: v.id("devicePrincipals"),
        wrapAlgorithm: v.string(),
        wrappedKey: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can rotate collaboration keys")
    }
    await assertCollaborationWriteAllowed(
      ctx,
      args.projectId,
      args.encryptedSnapshot?.byteLength ?? 0,
    )
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)
    if (!activeRoomKey) {
      throw new Error("Encrypted collaboration room is not initialized")
    }

    const nextKeyVersion = activeRoomKey.keyVersion + 1
    if (args.encryptedSnapshot) {
      assertEncryptedPayloadMatchesActiveKey({
        payload: args.encryptedSnapshot,
        expectedKind: "yjs_snapshot",
        activeKeyVersion: nextKeyVersion,
      })
    }
    const now = Date.now()
    const roomKeys = await ctx.db
      .query("projectCollabRoomKeys")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const roomKey of roomKeys) {
      if (roomKey.status === "revoked") continue
      await ctx.db.patch(roomKey._id, {
        status: "revoked",
        rotatedAt: now,
      })
    }

    for (const roomKey of roomKeys) {
      const wrappedKeys = await ctx.db
        .query("projectCollabWrappedKeys")
        .withIndex("by_project_room_and_key_version", (q) =>
          q.eq("projectId", args.projectId).eq("roomId", roomId).eq("keyVersion", roomKey.keyVersion),
        )
        .collect()

      for (const wrappedKey of wrappedKeys) {
        if (typeof wrappedKey.revokedAt === "number") continue
        await ctx.db.patch(wrappedKey._id, {
          revokedAt: now,
        })
      }
    }

    const recoveryKits = await ctx.db
      .query("projectCollabRecoveryKits")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const recoveryKit of recoveryKits) {
      if (typeof recoveryKit.revokedAt === "number") continue
      await ctx.db.patch(recoveryKit._id, {
        revokedAt: now,
      })
    }

    await ctx.db.insert("projectCollabRoomKeys", {
      projectId: args.projectId,
      roomId,
      keyVersion: nextKeyVersion,
      status: "active",
      createdByPrincipalId: user._id,
      createdByIdentityKey: user.identityKey,
      createdAt: now,
    })

    const inserted = new Set<string>()
    for (const wrappedKey of args.wrappedKeys) {
      const recipient = await ctx.db.get(wrappedKey.recipientPrincipalId)
      if (!recipient || recipient.status === "revoked" || !(await canAccessProject(ctx, args.projectId, recipient._id))) {
        throw new ConvexError("A key-rotation recipient is not an active project device")
      }
      if (inserted.has(String(recipient._id))) continue
      inserted.add(String(recipient._id))
      await ctx.db.insert("projectCollabWrappedKeys", {
        projectId: args.projectId,
        roomId,
        keyVersion: nextKeyVersion,
        recipientPrincipalId: recipient._id,
        recipientIdentityKey: recipient.identityKey,
        senderIdentityKey: user.identityKey,
        senderPublicKeyJwk: user.encryptionPublicKeyJwk,
        wrapAlgorithm: wrappedKey.wrapAlgorithm,
        wrappedKey: wrappedKey.wrappedKey,
        createdAt: now,
      })
    }

    return {
      rotated: true,
      roomId,
      keyVersion: nextKeyVersion,
      previousKeyVersion: activeRoomKey.keyVersion,
      removedUpdateBytes: 0,
      removedSnapshotBytes: 0,
      removedAwarenessEntries: 0,
    }
  },
})

export const resetEncryptedRoom = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can reset encrypted collaboration")
    }
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const now = Date.now()

    const roomKeys = await ctx.db
      .query("projectCollabRoomKeys")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const roomKey of roomKeys) {
      if (roomKey.status === "revoked") continue
      await ctx.db.patch(roomKey._id, {
        status: "revoked",
        rotatedAt: now,
      })
    }

    for (const roomKey of roomKeys) {
      const wrappedKeys = await ctx.db
        .query("projectCollabWrappedKeys")
        .withIndex("by_project_room_and_key_version", (q) =>
          q.eq("projectId", args.projectId).eq("roomId", roomId).eq("keyVersion", roomKey.keyVersion),
        )
        .collect()

      for (const wrappedKey of wrappedKeys) {
        if (typeof wrappedKey.revokedAt === "number") continue
        await ctx.db.patch(wrappedKey._id, {
          revokedAt: now,
        })
      }
    }

    const recoveryKits = await ctx.db
      .query("projectCollabRecoveryKits")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const recoveryKit of recoveryKits) {
      if (typeof recoveryKit.revokedAt === "number") continue
      await ctx.db.patch(recoveryKit._id, {
        revokedAt: now,
      })
    }

    const keyRequests = await ctx.db
      .query("projectCollabKeyRequests")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const request of keyRequests) {
      if (typeof request.fulfilledAt === "number") continue
      await ctx.db.patch(request._id, {
        fulfilledAt: now,
      })
    }

    return {
      reset: true,
      roomId,
      removedUpdateBytes: 0,
      removedSnapshotBytes: 0,
      removedAwarenessEntries: 0,
    }
  },
})
