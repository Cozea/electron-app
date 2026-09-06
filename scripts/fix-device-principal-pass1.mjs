import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const file = (rel) => path.join(root, rel)
const read = (rel) => fs.readFileSync(file(rel), 'utf8')
const write = (rel, text) => fs.writeFileSync(file(rel), text)

function prependOnce(rel, marker, prefix) {
  let text = read(rel)
  if (!text.includes(marker)) text = prefix + text
  write(rel, text)
}

prependOnce(
  'convex/projects.ts',
  'import { ConvexError, v } from "convex/values"',
  `import { ConvexError, v } from "convex/values"\n\nimport { internal } from "./_generated/api"\nimport type { Doc, Id, TableNames } from "./_generated/dataModel"\nimport {\n  internalMutation,\n  query as baseQuery,\n  type MutationCtx,\n  type QueryCtx,\n} from "./_generated/server"\nimport { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"\nimport { requireAuthenticatedDevice } from "./lib/deviceAuth"\n`,
)

prependOnce(
  'convex/projectMembers.ts',
  'import { type MutationCtx } from "./_generated/server"',
  `import { type MutationCtx } from "./_generated/server"\nimport { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"\nimport { v } from "convex/values"\nimport type { Id } from "./_generated/dataModel"\nimport {\n  canAccessProjectByWorkspaceOrMembership,\n  canEditProjectByWorkspaceOrMembership,\n} from "./lib/workspaceProjectAccess"\n`,
)

{
  const rel = 'convex/lib/deviceAuth.ts'
  let text = read(rel)
  text = text.replace(/deviceLabel: string/g, 'displayName: string')
  text = text.replace(/user\.deviceLabel/g, 'user.displayName')
  write(rel, text)
}

{
  const rel = 'convex/projectPresence.ts'
  let text = read(rel)
  text = text
    .replace(/\n    userEmail: v\.optional\(v\.string\(\)\),/, '')
    .replace('const displayName = principal.deviceLabel?.trim() || "This device"', 'const displayName = principal.displayName.trim() || "This device"')
    .replace('const avatarUrl = principal.profileImageUrl ?? undefined', 'const avatarUrl = principal.avatarStorageId ? (await ctx.storage.getUrl(principal.avatarStorageId)) ?? undefined : undefined')
    .replace(/\n      \/\/ Transitional storage field[\s\S]*?userEmail: "",/, '')
    .replace(/\n        \/\/ Transitional output field; consumers should stop relying on email\.\n        userEmail: p\.userEmail,/, '')
  write(rel, text)
}

{
  const rel = 'convex/activity.ts'
  let text = read(rel)
  text = text.replace(
    'return [userKey, user?.profileImageUrl ?? undefined] as const',
    'return [userKey, user?.avatarStorageId ? (await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined : undefined] as const',
  )
  text = text.replace(
    'const userName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email',
    'const userName = user.displayName',
  )
  text = text.replace(
    'userImage: user.profileImageUrl,',
    'userImage: user.avatarStorageId ? (await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined : undefined,',
  )
  write(rel, text)
}

{
  const rel = 'convex/organizations.ts'
  let text = read(rel)
  text = text.replace(
`          identityKey: user?.identityKey ?? "",
          deviceLabel: user?.deviceLabel ?? "Unknown device",
          platform: user?.platform ?? "unknown",
          email: user?.email ?? "",
          firstName: user?.firstName ?? null,
          lastName: user?.lastName ?? null,
          profileImageUrl: user?.profileImageUrl ?? null,`,
`          identityKey: user?.identityKey ?? "",
          displayName: user?.displayName ?? "Unknown device",
          platform: user?.platform ?? "unknown",
          avatarUrl: user?.avatarStorageId ? await ctx.storage.getUrl(user.avatarStorageId) : null,`,
  )
  text = text.replace('return rows.sort((left, right) => left.deviceLabel.localeCompare(right.deviceLabel))', 'return rows.sort((left, right) => left.displayName.localeCompare(right.displayName))')
  write(rel, text)
}

{
  const rel = 'convex/projectJoinLinks.ts'
  let text = read(rel)
  text = text.replace(
`            identityKey: inviter.identityKey ?? null,
            displayName: inviter.deviceLabel ?? inviter.firstName ?? "Unknown device",
            avatarUrl: inviter.profileImageUrl ?? null,`,
`            identityKey: inviter.identityKey,
            displayName: inviter.displayName,
            avatarUrl: inviter.avatarStorageId ? await ctx.storage.getUrl(inviter.avatarStorageId) : null,`,
  )
  write(rel, text)
}

{
  const rel = 'convex/projectFileLocks.ts'
  let text = read(rel)
  text = text.replace(
    'profileImageUrl: lockedByDevice.profileImageUrl ?? null,',
    'profileImageUrl: lockedByDevice.avatarStorageId ? await ctx.storage.getUrl(lockedByDevice.avatarStorageId) : null,',
  )
  write(rel, text)
}

{
  const rel = 'convex/projectTasks.ts'
  let text = read(rel)
  text = text.replace(
`                id: actor._id,
                email: actor.email,
                firstName: actor.firstName,
                lastName: actor.lastName,
                profileImageUrl: actor.profileImageUrl,`,
`                id: actor._id,
                identityKey: actor.identityKey,
                displayName: actor.displayName,
                avatarUrl: actor.avatarStorageId ? await ctx.storage.getUrl(actor.avatarStorageId) : null,`,
  )
  write(rel, text)
}

console.log('Applied device-principal compiler repair pass 1.')
