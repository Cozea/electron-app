import fs from 'node:fs'

function patch(path, from, to) {
  const source = fs.readFileSync(path, 'utf8')
  if (!source.includes(from)) throw new Error(`Missing compile-fix target in ${path}`)
  fs.writeFileSync(path, source.replace(from, to))
}

patch(
  'convex/devicePrincipals.ts',
  'import { action, internalMutation } from "./_generated/server"\nimport { internal } from "./_generated/api"',
  'import { action, internalMutation } from "./_generated/server"\nimport { makeFunctionReference, type FunctionReference } from "convex/server"',
)

patch(
  'convex/devicePrincipals.ts',
  'export const uploadAvatar = action({',
  `type CommitAvatarUploadArgs = {\n  identityKey: string\n  keyVersion: number\n  issuedAtSeconds: number\n  storageId: string\n}\n\nconst commitAvatarUploadRef = makeFunctionReference<\n  "mutation",\n  CommitAvatarUploadArgs,\n  { avatarUrl: string | null }\n>("devicePrincipals:commitAvatarUpload") as unknown as FunctionReference<\n  "mutation",\n  "internal",\n  CommitAvatarUploadArgs,\n  { avatarUrl: string | null }\n>\n\nexport const uploadAvatar = action({`,
)

patch(
  'convex/devicePrincipals.ts',
  'ctx.runMutation(internal.devicePrincipals.commitAvatarUpload, {',
  'ctx.runMutation(commitAvatarUploadRef, {',
)

patch(
  'convex/yjs.ts',
  'import { canManageProject } from "./lib/projectAccess"',
  'import { canAccessProject, canManageProject } from "./lib/projectAccess"',
)

patch(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  "      !activeRecoveryKit ||\n      !recoveryCodeInput.trim()",
  "      !activeRecoveryKit ||\n      !pendingKeyRequests ||\n      !recoveryCodeInput.trim()",
)

patch(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  "        wrapAlgorithm: activeRecoveryKit.wrapAlgorithm,\n      })\n\n      const wrapped = await window.electronAPI.collab.wrapRoomKey({",
  "        wrapAlgorithm: activeRecoveryKit.wrapAlgorithm,\n      })\n\n      const ownKeyRequest = pendingKeyRequests.find(\n        (request) =>\n          request.recipientUserId === principalId &&\n          typeof request.fulfilledAt !== 'number',\n      )\n      if (!ownKeyRequest) {\n        throw new Error('No pending encryption key request exists for this device.')\n      }\n\n      const wrapped = await window.electronAPI.collab.wrapRoomKey({",
)

patch(
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
  "        keyRequestId: pendingKeyRequests.find((request) => request.recipientUserId === principalId && typeof request.fulfilledAt !== 'number')?._id!,",
  "        keyRequestId: ownKeyRequest._id,",
)

patch(
  'tests/electron/desktopBootstrapStore.test.ts',
  "      displayName: 'Test device',\n      avatarUrl: null,",
  "      displayName: 'Test device',\n      presentationConfigured: true,\n      avatarUrl: null,",
)

patch(
  'tests/identity/manualReviewHardening.test.ts',
  `    const source = read("convex/devicePrincipals.ts")\n    expect(source).toContain("already bound to another encryption key")\n    expect(source).not.toContain("encryptionPublicKeyJwk: args.encryptionPublicKeyJwk,\\n        encryptionPublicKeyAlgorithm")`,
  `    const source = read("convex/devicePrincipals.ts")\n    const existingStart = source.indexOf("if (principal) {")\n    const existingEnd = source.indexOf("} else {", existingStart)\n    const existingPrincipalAuth = source.slice(existingStart, existingEnd)\n    expect(existingPrincipalAuth).toContain("already bound to another encryption key")\n    expect(existingPrincipalAuth).not.toContain("encryptionPublicKeyJwk: args.encryptionPublicKeyJwk")`,
)

patch(
  'tests/identity/manualReviewHardening.test.ts',
  '    expect(source).toContain("internal.devicePrincipals.commitAvatarUpload")',
  '    expect(source).toContain("ctx.runMutation(commitAvatarUploadRef")',
)

console.log('Resolved manual-review compile roots.')
