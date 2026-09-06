import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function write(path, source) {
  fs.writeFileSync(path, source)
}

function replaceOnce(path, from, to) {
  const source = read(path)
  const index = source.indexOf(from)
  if (index < 0) throw new Error(`Missing expected text in ${path}: ${from.slice(0, 100)}`)
  if (source.indexOf(from, index + from.length) >= 0) {
    throw new Error(`Expected unique text in ${path}: ${from.slice(0, 100)}`)
  }
  write(path, source.slice(0, index) + to + source.slice(index + from.length))
}

function replaceRegex(path, pattern, replacement, expected = 1) {
  const source = read(path)
  const matches = source.match(pattern)
  if (!matches || matches.length !== expected) {
    throw new Error(`Expected ${expected} regex matches in ${path}, found ${matches?.length ?? 0}: ${pattern}`)
  }
  write(path, source.replace(pattern, replacement))
}

// Explicit presentation lifecycle; the display name itself is never a sentinel.
replaceOnce(
  'convex/schema.ts',
  '    displayName: v.string(),\n    avatarStorageId: v.optional(v.id("_storage")),',
  '    displayName: v.string(),\n    presentationConfiguredAt: v.optional(v.number()),\n    avatarStorageId: v.optional(v.id("_storage")),',
)

// Harden principal authentication and make avatar storage server-owned.
replaceOnce(
  'convex/devicePrincipals.ts',
  'import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"\nimport { ConvexError, v } from "convex/values"\nimport { isDeviceIdentityKey, normalizeDeviceIdentityKey } from "../shared/deviceIdentity"',
  'import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"\nimport { action, internalMutation } from "./_generated/server"\nimport { internal } from "./_generated/api"\nimport { ConvexError, v } from "convex/values"\nimport { isDeviceIdentityKey, isTokenIssuedAfterRevocationBoundary, normalizeDeviceIdentityKey } from "../shared/deviceIdentity"',
)
replaceOnce(
  'convex/devicePrincipals.ts',
  'const MAX_AVATAR_BYTES = 512 * 1024',
  'const MAX_AVATAR_BYTES = 512 * 1024\n\nfunction isWebp(bytes: Uint8Array): boolean {\n  return bytes.byteLength >= 12 &&\n    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&\n    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"\n}',
)
replaceOnce(
  'convex/devicePrincipals.ts',
  '      if (principal.signingFingerprint !== args.signingFingerprint || principal.signingPublicKeyJwk !== args.signingPublicKeyJwk) {\n        throw new ConvexError("This device ID is already bound to another signing key")\n      }\n      await ctx.db.patch(principal._id, {\n        platform: args.platform.trim() || "desktop",\n        encryptionPublicKeyJwk: args.encryptionPublicKeyJwk,\n        encryptionPublicKeyAlgorithm: args.encryptionPublicKeyAlgorithm,\n        encryptionFingerprint: args.encryptionFingerprint,\n        lastAuthenticatedAt: now,\n        updatedAt: now,\n      })',
  '      if (\n        principal.signingFingerprint !== args.signingFingerprint ||\n        principal.signingPublicKeyJwk !== args.signingPublicKeyJwk ||\n        principal.signingPublicKeyAlgorithm !== args.signingPublicKeyAlgorithm\n      ) {\n        throw new ConvexError("This device ID is already bound to another signing key")\n      }\n      if (\n        principal.encryptionFingerprint !== args.encryptionFingerprint ||\n        principal.encryptionPublicKeyJwk !== args.encryptionPublicKeyJwk ||\n        principal.encryptionPublicKeyAlgorithm !== args.encryptionPublicKeyAlgorithm\n      ) {\n        throw new ConvexError("This device ID is already bound to another encryption key")\n      }\n      await ctx.db.patch(principal._id, {\n        platform: args.platform.trim() || "desktop",\n        lastAuthenticatedAt: now,\n        updatedAt: now,\n      })',
)
replaceOnce(
  'convex/devicePrincipals.ts',
  '        displayName: principal.displayName,\n        avatarUrl,\n        platform: principal.platform,',
  '        displayName: principal.displayName,\n        presentationConfigured: typeof principal.presentationConfiguredAt === "number",\n        avatarUrl,\n        platform: principal.platform,',
)
replaceOnce(
  'convex/devicePrincipals.ts',
  '      displayName: principal.displayName,\n      avatarUrl,\n      platform: principal.platform,',
  '      displayName: principal.displayName,\n      presentationConfigured: typeof principal.presentationConfiguredAt === "number",\n      avatarUrl,\n      platform: principal.platform,',
)
replaceOnce(
  'convex/devicePrincipals.ts',
  '    const displayName = normalizeDisplayName(args.displayName)\n    await ctx.db.patch(principal._id, { displayName, updatedAt: Date.now() })',
  '    const displayName = normalizeDisplayName(args.displayName)\n    const now = Date.now()\n    await ctx.db.patch(principal._id, {\n      displayName,\n      presentationConfiguredAt: principal.presentationConfiguredAt ?? now,\n      updatedAt: now,\n    })',
)
replaceRegex(
  'convex/devicePrincipals.ts',
  /export const generateAvatarUploadUrl = mutation\(\{[\s\S]*?export const updatePreferences = mutation\(\{/g,
  `export const commitAvatarUpload = internalMutation({\n  args: {\n    identityKey: v.string(),\n    keyVersion: v.number(),\n    issuedAtSeconds: v.number(),\n    storageId: v.id("_storage"),\n  },\n  handler: async (ctx, args) => {\n    const identityKey = normalizeDeviceIdentityKey(args.identityKey)\n    const principal = await ctx.db.query("devicePrincipals")\n      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey)).unique()\n    if (!principal || principal.status !== "active") throw new ConvexError("Authenticated device is not registered")\n    if (principal.signingKeyVersion !== args.keyVersion) throw new ConvexError("Device session has been revoked")\n    if (!isTokenIssuedAfterRevocationBoundary(args.issuedAtSeconds, principal.tokenValidAfter)) {\n      throw new ConvexError("Device session is no longer valid")\n    }\n    const previous = principal.avatarStorageId\n    await ctx.db.patch(principal._id, { avatarStorageId: args.storageId, updatedAt: Date.now() })\n    if (previous && previous !== args.storageId) await ctx.storage.delete(previous)\n    return { avatarUrl: await ctx.storage.getUrl(args.storageId) }\n  },\n})\n\nexport const uploadAvatar = action({\n  args: { bytes: v.bytes() },\n  handler: async (ctx, args) => {\n    const identity = await ctx.auth.getUserIdentity()\n    if (!identity) throw new Error("Authentication required")\n    const identityKey = normalizeDeviceIdentityKey(identity.subject)\n    if (!isDeviceIdentityKey(identityKey)) throw new Error("Authenticated principal is not a Cozea device")\n    const claims = identity as unknown as Record<string, unknown>\n    const keyVersion = claims.key_version\n    const issuedAtSeconds = claims.token_issued_at\n    if (!Number.isInteger(keyVersion) || typeof issuedAtSeconds !== "number") {\n      throw new Error("Device session claims are invalid")\n    }\n    const bytes = new Uint8Array(args.bytes)\n    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_AVATAR_BYTES || !isWebp(bytes)) {\n      throw new Error("Avatar must be an optimized WebP image smaller than 512 KB")\n    }\n    const storageId = await ctx.storage.store(new Blob([args.bytes], { type: "image/webp" }))\n    try {\n      return await ctx.runMutation(internal.devicePrincipals.commitAvatarUpload, {\n        identityKey,\n        keyVersion: keyVersion as number,\n        issuedAtSeconds,\n        storageId,\n      })\n    } catch (error) {\n      await ctx.storage.delete(storageId)\n      throw error\n    }\n  },\n})\n\nexport const removeAvatar = mutation({\n  args: {},\n  handler: async (ctx) => {\n    const principal = await requireAuthenticatedDevice(ctx)\n    const previous = principal.avatarStorageId\n    await ctx.db.patch(principal._id, { avatarStorageId: undefined, updatedAt: Date.now() })\n    if (previous) await ctx.storage.delete(previous)\n    return { avatarUrl: null }\n  },\n})\n\nexport const updatePreferences = mutation({`,
)

// Session contracts carry explicit presentation configuration state.
replaceOnce(
  'shared/types.ts',
  '  displayName: string\n  avatarUrl: string | null',
  '  displayName: string\n  presentationConfigured: boolean\n  avatarUrl: string | null',
)
replaceOnce(
  'apps/desktop/electron/services/DesktopBootstrapStore.ts',
  '    typeof principal.displayName === \'string\' &&\n    typeof principal.platform === \'string\' &&',
  '    typeof principal.displayName === \'string\' &&\n    typeof principal.presentationConfigured === \'boolean\' &&\n    typeof principal.platform === \'string\' &&',
)
replaceOnce(
  'apps/desktop/src/contexts/AuthContext.tsx',
  "const AuthContext = createContext<AuthContextType | null>(null)\nconst UNCONFIGURED_DEVICE_NAME = 'This Device'",
  'const AuthContext = createContext<AuthContextType | null>(null)',
)
replaceRegex(
  'apps/desktop/src/contexts/AuthContext.tsx',
  /  const needsOnboarding = Boolean\(\n    user && \(user\.displayName\.trim\(\) \|\| UNCONFIGURED_DEVICE_NAME\) === UNCONFIGURED_DEVICE_NAME,\n  \)/g,
  '  const needsOnboarding = Boolean(user && !user.presentationConfigured)',
)

// Avatar upload is a Convex action that owns the storage object; clients never submit storage IDs.
replaceOnce(
  'apps/desktop/src/components/Onboarding.tsx',
  "import { useMutation } from 'convex/react'",
  "import { useAction, useMutation } from 'convex/react'",
)
replaceRegex(
  'apps/desktop/src/components/Onboarding.tsx',
  /\nasync function uploadAvatarDataUrl\([\s\S]*?\n}\n\nexport function Onboarding\(\) \{/g,
  '\nexport function Onboarding() {',
)
replaceOnce(
  'apps/desktop/src/components/Onboarding.tsx',
  '  const updateDevicePresentation = useMutation(api.devicePrincipals.updateDevicePresentation)\n  const generateAvatarUploadUrl = useMutation(api.devicePrincipals.generateAvatarUploadUrl)\n  const setAvatar = useMutation(api.devicePrincipals.setAvatar)',
  '  const updateDevicePresentation = useMutation(api.devicePrincipals.updateDevicePresentation)\n  const uploadAvatar = useAction(api.devicePrincipals.uploadAvatar)',
)
replaceOnce(
  'apps/desktop/src/components/Onboarding.tsx',
  '      if (avatarPreview) {\n        const uploadUrl = await generateAvatarUploadUrl({})\n        const storageId = await uploadAvatarDataUrl(uploadUrl, avatarPreview)\n        await setAvatar({ storageId: storageId as never })\n      }',
  '      if (avatarPreview) {\n        const bytes = await fetch(avatarPreview).then((response) => response.arrayBuffer())\n        await uploadAvatar({ bytes })\n      }',
)

replaceOnce(
  'apps/desktop/src/features/settings/Account.tsx',
  'import { useMutation, useQuery } from "convex/react";\nimport type { Id } from "../../../../../convex/_generated/dataModel";',
  'import { useAction, useMutation, useQuery } from "convex/react";',
)
replaceRegex(
  'apps/desktop/src/features/settings/Account.tsx',
  /\nasync function uploadAvatar\([\s\S]*?\n}\n\nexport function Account/g,
  '\nexport function Account',
)
replaceOnce(
  'apps/desktop/src/features/settings/Account.tsx',
  '  const updateDevicePresentation = useMutation(api.devicePrincipals.updateDevicePresentation);\n  const generateAvatarUploadUrl = useMutation(api.devicePrincipals.generateAvatarUploadUrl);\n  const setAvatarMutation = useMutation(api.devicePrincipals.setAvatar);',
  '  const updateDevicePresentation = useMutation(api.devicePrincipals.updateDevicePresentation);\n  const uploadAvatar = useAction(api.devicePrincipals.uploadAvatar);\n  const removeAvatarMutation = useMutation(api.devicePrincipals.removeAvatar);',
)
replaceOnce(
  'apps/desktop/src/features/settings/Account.tsx',
  '      if (removeAvatar) {\n        await setAvatarMutation({ storageId: null })\n      } else if (pendingAvatarDataUrl) {\n        const uploadUrl = await generateAvatarUploadUrl({})\n        const storageId = await uploadAvatar(uploadUrl, pendingAvatarDataUrl)\n        await setAvatarMutation({ storageId })\n      }',
  '      if (removeAvatar) {\n        await removeAvatarMutation({})\n      } else if (pendingAvatarDataUrl) {\n        const bytes = await fetch(pendingAvatarDataUrl).then((response) => response.arrayBuffer())\n        await uploadAvatar({ bytes })\n      }',
)

// Presence no longer accepts even ignored identity/presentation arguments.
replaceRegex(
  'convex/projectPresence.ts',
  /\/\*\*[\s\S]*?\*\/\nexport const heartbeat = mutation\(\{/,
  '/** Update presence heartbeat for the authenticated device principal. */\nexport const heartbeat = mutation({',
)
replaceOnce(
  'convex/projectPresence.ts',
  '    projectId: v.id("projects"),\n    userId: v.optional(v.id("devicePrincipals")),\n    userName: v.optional(v.string()),\n    userAvatarUrl: v.optional(v.string()),',
  '    projectId: v.id("projects"),',
)
replaceOnce(
  'convex/projectPresence.ts',
  '  args: {\n    projectId: v.id("projects"),\n    userId: v.optional(v.id("devicePrincipals")),\n  },',
  '  args: {\n    projectId: v.id("projects"),\n  },',
)

// All ordinary authenticated writes require edit access; the one read-like key request is explicit below.
replaceOnce(
  'convex/lib/authenticatedFunctions.ts',
  '        const isSelfKeyRequest = mode === "write" && typeof args.recipientDeviceId === "string"\n        const allowed = mode === "write" && !isSelfKeyRequest\n          ? await canEditProject(ctx, projectId as never, device._id)\n          : await canAccessProject(ctx, projectId as never, device._id)',
  '        const allowed = mode === "write"\n          ? await canEditProject(ctx, projectId as never, device._id)\n          : await canAccessProject(ctx, projectId as never, device._id)',
)

// Remove the direct membership bypass; device enrollment is the add path.
replaceRegex(
  'convex/projectMembers.ts',
  /\/\/ Add a member to a project\nexport const addMember = mutation\(\{[\s\S]*?\n\/\/ Update a member's role/g,
  "// Update a member's role",
)
replaceOnce(
  'convex/projectMembers.ts',
  '    userId: v.id("devicePrincipals"),\n    deviceId: v.optional(v.string()),\n    serverSecret: v.string(),',
  '    userId: v.id("devicePrincipals"),\n    serverSecret: v.string(),',
)

// Cloudflare passes only the canonical principal relationship into the encryption bootstrap.
replaceOnce(
  'cloudflare/worker/src/lib/convex.ts',
  '    displayName: string\n    avatarUrl: string | null\n    platform: string',
  '    displayName: string\n    presentationConfigured: boolean\n    avatarUrl: string | null\n    platform: string',
)
replaceOnce(
  'cloudflare/worker/src/lib/convex.ts',
  '    projectId: body.projectId,\n    roomId,\n    userId: principal.principalId,\n    deviceId: principal.identityKey,',
  '    projectId: body.projectId,\n    roomId,\n    principalId: principal.principalId,',
)

// Yjs encryption authority: derive identity and key metadata from canonical principals.
replaceOnce(
  'convex/yjs.ts',
  'import type { MutationCtx, QueryCtx } from "./_generated/server"',
  'import { mutation as baseMutation, type MutationCtx, type QueryCtx } from "./_generated/server"',
)
replaceRegex(
  'convex/yjs.ts',
  /(export const getEncryptionBootstrap = query\(\{[\s\S]*?roomId: v\.optional\(v\.string\(\)\),\n)    userId: v\.id\("devicePrincipals"\),\n    deviceId: v\.string\(\),/g,
  '$1    principalId: v.id("devicePrincipals"),',
)
replaceOnce(
  'convex/yjs.ts',
  '    const principal = await ctx.db.get(args.userId)\n    if (!principal || principal.identityKey !== args.deviceId || principal.status === "revoked") {',
  '    const principal = await ctx.db.get(args.principalId)\n    if (!principal || principal.status === "revoked") {',
)
replaceOnce(
  'convex/yjs.ts',
  '      deviceId: args.deviceId,\n      keyVersion: activeRoomKey.keyVersion,',
  '      deviceId: principal.identityKey,\n      keyVersion: activeRoomKey.keyVersion,',
)
replaceRegex(
  'convex/yjs.ts',
  /export const initializeEncryptedRoom = mutation\(\{[\s\S]*?\nexport const createKeyRequest = mutation\(\{[\s\S]*?\n}\)\n\nexport const listPendingKeyRequests/g,
  `export const initializeEncryptedRoom = mutation({\n  args: {\n    projectId: v.id("projects"),\n    roomId: v.optional(v.string()),\n    keyVersion: v.number(),\n    wrapAlgorithm: v.string(),\n    wrappedKey: v.string(),\n  },\n  handler: async (ctx, args) => {\n    const principal = await requireAuthenticatedDevice(ctx)\n    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)\n    const roomId = args.roomId || defaultRoomId(args.projectId)\n    const existingRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)\n    if (existingRoomKey) return { roomId, created: false, keyVersion: existingRoomKey.keyVersion }\n\n    const hasCollabData = await hasAnyStoredCollabData(ctx, args.projectId)\n    let removedUpdateBytes = 0\n    let removedSnapshotBytes = 0\n    let removedAwarenessEntries = 0\n    if (hasCollabData) {\n      const payloadCleanup = await deleteAllProjectCollabPayloads(ctx, args.projectId)\n      removedUpdateBytes = payloadCleanup.removedUpdateBytes\n      removedSnapshotBytes = payloadCleanup.removedSnapshotBytes\n      removedAwarenessEntries = await deleteAllProjectAwarenessEntries(ctx, args.projectId)\n    }\n\n    const keyVersion = Math.max(1, Math.floor(args.keyVersion))\n    const now = Date.now()\n    await ctx.db.insert("projectCollabRoomKeys", {\n      projectId: args.projectId, roomId, keyVersion, status: "active",\n      createdByUserId: principal._id, createdByDeviceId: principal.identityKey, createdAt: now,\n    })\n    await ctx.db.insert("projectCollabWrappedKeys", {\n      projectId: args.projectId, roomId, keyVersion,\n      recipientUserId: principal._id, recipientDeviceId: principal.identityKey,\n      senderDeviceId: principal.identityKey, senderPublicKeyJwk: principal.encryptionPublicKeyJwk,\n      wrapAlgorithm: args.wrapAlgorithm, wrappedKey: args.wrappedKey, createdAt: now,\n    })\n    if (removedUpdateBytes > 0 || removedSnapshotBytes > 0) {\n      await applyProjectStorageDeltas(ctx, args.projectId, {\n        collaborationData: -removedUpdateBytes, snapshots: -removedSnapshotBytes,\n      })\n    }\n    return { roomId, created: true, keyVersion, removedUpdateBytes, removedSnapshotBytes, removedAwarenessEntries }\n  },\n})\n\nexport const createKeyRequest = baseMutation({\n  args: { projectId: v.id("projects"), roomId: v.string() },\n  handler: async (ctx, args) => {\n    const principal = await requireAuthenticatedDevice(ctx)\n    if (!(await canAccessProject(ctx, args.projectId, principal._id))) {\n      throw new ConvexError("The authenticated device cannot access this project")\n    }\n    const existing = await ctx.db.query("projectCollabKeyRequests")\n      .withIndex("by_project_room_and_device", (q) =>\n        q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientDeviceId", principal.identityKey))\n      .first()\n    const now = Date.now()\n    const payload = {\n      recipientUserId: principal._id,\n      recipientDeviceId: principal.identityKey,\n      recipientPublicKeyJwk: principal.encryptionPublicKeyJwk,\n      recipientFingerprint: principal.encryptionFingerprint,\n      requestedAt: now,\n      fulfilledAt: undefined,\n    }\n    if (existing) {\n      await ctx.db.patch(existing._id, payload)\n      return { requestId: existing._id, created: false }\n    }\n    const requestId = await ctx.db.insert("projectCollabKeyRequests", {\n      projectId: args.projectId, roomId: args.roomId, ...payload,\n    })\n    return { requestId, created: true }\n  },\n})\n\nexport const listPendingKeyRequests`,
)
replaceRegex(
  'convex/yjs.ts',
  /export const storeWrappedRoomKey = mutation\(\{[\s\S]*?\n}\)\n\nexport const storeRecoveryKit/g,
  `export const storeWrappedRoomKey = mutation({\n  args: {\n    projectId: v.id("projects"),\n    roomId: v.string(),\n    keyVersion: v.number(),\n    keyRequestId: v.id("projectCollabKeyRequests"),\n    wrapAlgorithm: v.string(),\n    wrappedKey: v.string(),\n  },\n  handler: async (ctx, args) => {\n    const principal = await requireAuthenticatedDevice(ctx)\n    if (!(await canManageProject(ctx, args.projectId, principal._id))) {\n      throw new ConvexError("Only project managers can approve encryption key requests")\n    }\n    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)\n    const pendingRequest = await ctx.db.get(args.keyRequestId)\n    if (\n      !pendingRequest ||\n      pendingRequest.projectId !== args.projectId ||\n      pendingRequest.roomId !== args.roomId ||\n      typeof pendingRequest.fulfilledAt === "number"\n    ) {\n      throw new ConvexError("A matching pending key request is required before sharing access")\n    }\n    const recipient = await ctx.db.get(pendingRequest.recipientUserId)\n    if (\n      !recipient ||\n      recipient.status === "revoked" ||\n      recipient.identityKey !== pendingRequest.recipientDeviceId ||\n      recipient.encryptionPublicKeyJwk !== pendingRequest.recipientPublicKeyJwk ||\n      recipient.encryptionFingerprint !== pendingRequest.recipientFingerprint\n    ) {\n      throw new ConvexError("The pending request no longer matches the recipient device identity")\n    }\n    const existing = await ctx.db.query("projectCollabWrappedKeys")\n      .withIndex("by_project_room_and_recipient", (q) =>\n        q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientDeviceId", recipient.identityKey))\n      .collect()\n    const matching = existing.find((entry) => entry.keyVersion === args.keyVersion && typeof entry.revokedAt !== "number")\n    const now = Date.now()\n    const wrapped = {\n      senderDeviceId: principal.identityKey,\n      senderPublicKeyJwk: principal.encryptionPublicKeyJwk,\n      wrapAlgorithm: args.wrapAlgorithm,\n      wrappedKey: args.wrappedKey,\n      createdAt: now,\n    }\n    if (matching) await ctx.db.patch(matching._id, wrapped)\n    else await ctx.db.insert("projectCollabWrappedKeys", {\n      projectId: args.projectId, roomId: args.roomId, keyVersion: args.keyVersion,\n      recipientUserId: recipient._id, recipientDeviceId: recipient.identityKey, ...wrapped,\n    })\n    await ctx.db.patch(pendingRequest._id, { fulfilledAt: now })\n    return { stored: true }\n  },\n})\n\nexport const storeRecoveryKit`,
)
replaceOnce(
  'convex/yjs.ts',
  '    createdByUserId: v.id("devicePrincipals"),\n    createdByDeviceId: v.string(),\n  },\n  handler: async (ctx, args) => {\n    const user = await requireAuthenticatedDevice(ctx)',
  '  },\n  handler: async (ctx, args) => {\n    const user = await requireAuthenticatedDevice(ctx)',
)
replaceOnce(
  'convex/yjs.ts',
  '    if (args.createdByUserId !== user._id || args.createdByDeviceId !== user.identityKey) {\n      throw new ConvexError("Recovery-kit creator does not match the authenticated device")\n    }\n',
  '',
)
replaceOnce(
  'convex/yjs.ts',
  '      createdByUserId: args.createdByUserId,\n      createdByDeviceId: args.createdByDeviceId,',
  '      createdByUserId: user._id,\n      createdByDeviceId: user.identityKey,',
)
replaceRegex(
  'convex/yjs.ts',
  /    userId: v.id\("devicePrincipals"\),\n    initiatedByDeviceId: v.string\(\),\n    encryptedSnapshot:/g,
  '    encryptedSnapshot:',
)
replaceRegex(
  'convex/yjs.ts',
  /        recipientUserId: v.id\("devicePrincipals"\),\n        recipientDeviceId: v.string\(\),\n        senderPublicKeyJwk: v.string\(\),/g,
  '        recipientPrincipalId: v.id("devicePrincipals"),',
)
replaceOnce(
  'convex/yjs.ts',
  '    if (args.userId !== user._id || args.initiatedByDeviceId !== user.identityKey) {\n      throw new ConvexError("Key rotation initiator does not match the authenticated device")\n    }\n',
  '',
)
replaceOnce(
  'convex/yjs.ts',
  '      createdByUserId: args.userId,\n      createdByDeviceId: args.initiatedByDeviceId,',
  '      createdByUserId: user._id,\n      createdByDeviceId: user.identityKey,',
)
replaceRegex(
  'convex/yjs.ts',
  /    const inserted = new Set<string>\(\)\n    for \(const wrappedKey of args\.wrappedKeys\) \{[\s\S]*?\n    }\n\n    await ctx\.db\.insert\("yjsDocuments"/g,
  `    const inserted = new Set<string>()\n    for (const wrappedKey of args.wrappedKeys) {\n      const recipient = await ctx.db.get(wrappedKey.recipientPrincipalId)\n      if (!recipient || recipient.status === "revoked" || !(await canAccessProject(ctx, args.projectId, recipient._id))) {\n        throw new ConvexError("A key-rotation recipient is not an active project device")\n      }\n      if (inserted.has(String(recipient._id))) continue\n      inserted.add(String(recipient._id))\n      await ctx.db.insert("projectCollabWrappedKeys", {\n        projectId: args.projectId,\n        roomId,\n        keyVersion: nextKeyVersion,\n        recipientUserId: recipient._id,\n        recipientDeviceId: recipient.identityKey,\n        senderDeviceId: user.identityKey,\n        senderPublicKeyJwk: user.encryptionPublicKeyJwk,\n        wrapAlgorithm: wrappedKey.wrapAlgorithm,\n        wrappedKey: wrappedKey.wrappedKey,\n        createdAt: now,\n      })\n    }\n\n    await ctx.db.insert("yjsDocuments"`,
)
replaceOnce(
  'convex/yjs.ts',
  '    roomId: v.optional(v.string()),\n    userId: v.optional(v.id("devicePrincipals")),\n    retainDeviceId: v.optional(v.string()),',
  '    roomId: v.optional(v.string()),',
)
replaceRegex(
  'convex/yjs.ts',
  /    if \(\n      \(args\.userId !== undefined && args\.userId !== user\._id\) \|\|\n      \(args\.retainDeviceId !== undefined && args\.retainDeviceId !== user\.identityKey\)\n    \) \{\n      throw new ConvexError\("Retained recovery device does not match the authenticated device"\)\n    }\n/g,
  '',
)

// Client callers match the hardened encryption API.
replaceOnce(
  'apps/desktop/src/contexts/YjsProjectContext.tsx',
  '        userId,\n        deviceId: session.identityKey,\n        keyVersion: session.encryption.activeKeyVersion ?? 1,\n        wrapAlgorithm: wrapped.wrapAlgorithm,\n        wrappedKey: wrapped.wrappedKey,\n        senderPublicKeyJwk: wrapped.senderPublicKeyJwk,',
  '        keyVersion: session.encryption.activeKeyVersion ?? 1,\n        wrapAlgorithm: wrapped.wrapAlgorithm,\n        wrappedKey: wrapped.wrappedKey,',
)
replaceOnce(
  'apps/desktop/src/contexts/YjsProjectContext.tsx',
  '        await convex.mutation(api.yjs.createKeyRequest, {\n          projectId,\n          roomId: session.roomId,\n          recipientUserId: userId,\n          recipientDeviceId: session.identityKey,\n          recipientPublicKeyJwk: session.encryptionPublicKeyJwk,\n          recipientFingerprint: session.encryptionFingerprint ?? session.identityKey,\n        })',
  '        await convex.mutation(api.yjs.createKeyRequest, {\n          projectId,\n          roomId: session.roomId,\n        })',
)

replaceOnce(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  '      createdByUserId: principalId,\n      createdByDeviceId: collabSession.identityKey,\n      wrapAlgorithm:',
  '      wrapAlgorithm:',
)
replaceRegex(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  /    const wrappedKeys: Array<\{\n      recipientUserId: NonNullable<typeof devices>\[number\]\['principalId'\]\n      recipientDeviceId: string\n      senderPublicKeyJwk: string\n      wrapAlgorithm: string\n      wrappedKey: string\n    }> = \[\]/g,
  `    const wrappedKeys: Array<{\n      recipientPrincipalId: NonNullable<typeof devices>[number]['principalId']\n      wrapAlgorithm: string\n      wrappedKey: string\n    }> = []`,
)
replaceOnce(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  '      wrappedKeys.push({\n        recipientUserId: device.principalId,\n        recipientDeviceId: device.identityKey,\n        senderPublicKeyJwk: wrapped.senderPublicKeyJwk,\n        wrapAlgorithm: wrapped.wrapAlgorithm,\n        wrappedKey: wrapped.wrappedKey,\n      })',
  '      wrappedKeys.push({\n        recipientPrincipalId: device.principalId,\n        wrapAlgorithm: wrapped.wrapAlgorithm,\n        wrappedKey: wrapped.wrappedKey,\n      })',
)
replaceOnce(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  '      userId: principalId,\n      initiatedByDeviceId: collabSession.identityKey,\n      encryptedSnapshot:',
  '      encryptedSnapshot:',
)
replaceOnce(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  '          recipientUserId: request.recipientUserId,\n          recipientDeviceId: request.recipientDeviceId,\n          senderDeviceId: wrapped.senderDeviceId,\n          senderPublicKeyJwk: wrapped.senderPublicKeyJwk,\n          wrapAlgorithm:',
  '          keyRequestId: request._id,\n          wrapAlgorithm:',
)
replaceOnce(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  '        recipientUserId: principalId,\n        recipientDeviceId: collabSession.identityKey,\n        senderDeviceId: wrapped.senderDeviceId,\n        senderPublicKeyJwk: wrapped.senderPublicKeyJwk,\n        wrapAlgorithm:',
  '        keyRequestId: pendingKeyRequests.find((request) => request.recipientUserId === principalId && typeof request.fulfilledAt !== \'number\')?._id!,\n        wrapAlgorithm:',
)
replaceOnce(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  '        userId: principalId ?? undefined,\n        retainDeviceId: collabSession.identityKey,\n      })',
  '      })',
)

// Tests now enforce the reviewed invariants.
replaceOnce(
  'tests/identity/deviceOnboarding.test.ts',
  '    expect(section).toContain(\'displayName: "This Device"\')',
  '    expect(section).toContain(\'displayName: "This Device"\')\n    expect(section).not.toContain("presentationConfiguredAt:")',
)
replaceOnce(
  'tests/identity/deviceOnboarding.test.ts',
  '    expect(authContext).toContain("UNCONFIGURED_DEVICE_NAME = \'This Device\'")\n    expect(authContext).toContain("needsOnboarding")',
  '    expect(authContext).toContain("!user.presentationConfigured")\n    expect(authContext).toContain("needsOnboarding")',
)
replaceOnce(
  'tests/identity/devicePresentation.test.ts',
  '    expect(existingPrincipalBranch).toContain("encryptionPublicKeyJwk")\n    expect(existingPrincipalBranch).toContain("lastAuthenticatedAt")',
  '    expect(existingPrincipalBranch).toContain("already bound to another encryption key")\n    expect(existingPrincipalBranch).toContain("lastAuthenticatedAt")\n    expect(existingPrincipalBranch).not.toContain("encryptionPublicKeyJwk: args.encryptionPublicKeyJwk")',
)
replaceOnce(
  'tests/identity/devicePresentation.test.ts',
  '    const section = exportedSection("updateDevicePresentation", "generateAvatarUploadUrl")',
  '    const section = exportedSection("updateDevicePresentation", "commitAvatarUpload")',
)
replaceRegex(
  'tests/identity/devicePresentation.test.ts',
  /  it\("keeps avatar changes isolated from security state", \(\) => \{[\s\S]*?\n  }\)\n}\)/g,
  `  it("owns avatar storage server-side and keeps avatar changes isolated from security state", () => {\n    const upload = exportedSection("uploadAvatar", "removeAvatar")\n    const commit = exportedSection("commitAvatarUpload", "uploadAvatar")\n\n    expect(upload).toContain("ctx.storage.store")\n    expect(upload).not.toContain("storageId: v.id")\n    expect(commit).toContain("avatarStorageId: args.storageId")\n    expect(commit).not.toContain("signingPublicKeyJwk:")\n    expect(commit).not.toContain("encryptionPublicKeyJwk:")\n  })\n})`,
)
replaceOnce(
  'tests/identity/projectPrincipalAuthority.test.ts',
  '    expect(heartbeat).not.toContain("userName: args.userName")',
  '    expect(heartbeat).not.toContain("userId: v.optional")\n    expect(heartbeat).not.toContain("userName: v.optional")\n    expect(heartbeat).not.toContain("userAvatarUrl: v.optional")\n    expect(heartbeat).not.toContain("userName: args.userName")',
)
replaceOnce(
  'tests/identity/collaborationAuthority.test.ts',
  '    expect(section).toContain("pendingRequest.recipientUserId !== args.recipientUserId")',
  '    expect(section).toContain("keyRequestId")\n    expect(section).toContain("recipient.encryptionPublicKeyJwk !== pendingRequest.recipientPublicKeyJwk")\n    expect(section).toContain("principal.encryptionPublicKeyJwk")',
)

const manualReviewTest = `import { readFileSync } from "node:fs"\nimport { join } from "node:path"\nimport { describe, expect, it } from "vitest"\n\nconst read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")\n\ndescribe("manual identity review hardening", () => {\n  it("uses explicit presentation lifecycle state instead of a display-name sentinel", () => {\n    expect(read("convex/schema.ts")).toContain("presentationConfiguredAt")\n    const auth = read("apps/desktop/src/contexts/AuthContext.tsx")\n    expect(auth).toContain("!user.presentationConfigured")\n    expect(auth).not.toContain("UNCONFIGURED_DEVICE_NAME")\n  })\n\n  it("does not allow authentication to rotate the registered ECDH identity", () => {\n    const source = read("convex/devicePrincipals.ts")\n    expect(source).toContain("already bound to another encryption key")\n    expect(source).not.toContain("encryptionPublicKeyJwk: args.encryptionPublicKeyJwk,\\n        encryptionPublicKeyAlgorithm")\n  })\n\n  it("owns avatar storage inside an authenticated Convex action", () => {\n    const source = read("convex/devicePrincipals.ts")\n    expect(source).toContain("export const uploadAvatar = action")\n    expect(source).toContain("ctx.storage.store")\n    expect(source).toContain("internal.devicePrincipals.commitAvatarUpload")\n    expect(source).not.toContain("generateAvatarUploadUrl")\n    expect(source).not.toContain("export const setAvatar = mutation")\n  })\n\n  it("binds room-key requests to canonical principal encryption metadata", () => {\n    const source = read("convex/yjs.ts")\n    expect(source).toContain("export const createKeyRequest = baseMutation")\n    expect(source).toContain("recipientPublicKeyJwk: principal.encryptionPublicKeyJwk")\n    expect(source).toContain("recipientFingerprint: principal.encryptionFingerprint")\n    expect(source).toContain("keyRequestId: v.id(\\"projectCollabKeyRequests\\")")\n  })\n\n  it("has no direct project member add bypass", () => {\n    expect(read("convex/projectMembers.ts")).not.toContain("export const addMember")\n  })\n})\n`
fs.writeFileSync('tests/identity/manualReviewHardening.test.ts', manualReviewTest)

console.log('Manual device-principal review hardening applied.')
