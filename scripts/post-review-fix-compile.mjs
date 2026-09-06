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
  `type CommitAvatarUploadArgs = {\n  identityKey: string\n  keyVersion: number\n  issuedAtSeconds: number\n  storageId: string\n}\n\nconst commitAvatarUploadRef = makeFunctionReference<\n  "mutation",\n  CommitAvatarUploadArgs,\n  { avatarUrl: string | null }\n>("devicePrincipals:commitAvatarUpload") as FunctionReference<\n  "mutation",\n  "internal",\n  CommitAvatarUploadArgs,\n  { avatarUrl: string | null }\n>\n\nexport const uploadAvatar = action({`,
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

console.log('Resolved manual-review compile roots.')
