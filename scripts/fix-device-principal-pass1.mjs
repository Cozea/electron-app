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

function edit(rel, transform) {
  if (!fs.existsSync(file(rel))) return
  const before = read(rel)
  const after = transform(before)
  if (after !== before) write(rel, after)
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

edit('convex/lib/deviceAuth.ts', (text) =>
  text.replace(/deviceLabel: string/g, 'displayName: string').replace(/user\.deviceLabel/g, 'user.displayName'),
)

edit('convex/projectPresence.ts', (text) =>
  text
    .replace(/\n    userEmail: v\.optional\(v\.string\(\)\),/, '')
    .replace('const displayName = principal.deviceLabel?.trim() || "This device"', 'const displayName = principal.displayName.trim() || "This device"')
    .replace('const avatarUrl = principal.profileImageUrl ?? undefined', 'const avatarUrl = principal.avatarStorageId ? (await ctx.storage.getUrl(principal.avatarStorageId)) ?? undefined : undefined')
    .replace(/\n      \/\/ Transitional storage field[\s\S]*?userEmail: "",/, '')
    .replace(/\n        \/\/ Transitional output field; consumers should stop relying on email\.\n        userEmail: p\.userEmail,/, ''),
)

edit('convex/activity.ts', (text) =>
  text
    .replace(
      'return [userKey, user?.profileImageUrl ?? undefined] as const',
      'return [userKey, user?.avatarStorageId ? (await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined : undefined] as const',
    )
    .replace(
      'const userName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email',
      'const userName = user.displayName',
    )
    .replace(
      'userImage: user.profileImageUrl,',
      'userImage: user.avatarStorageId ? (await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined : undefined,',
    ),
)

edit('convex/organizations.ts', (text) =>
  text
    .replace(
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
    .replace('return rows.sort((left, right) => left.deviceLabel.localeCompare(right.deviceLabel))', 'return rows.sort((left, right) => left.displayName.localeCompare(right.displayName))'),
)

edit('convex/projectJoinLinks.ts', (text) =>
  text.replace(
`            identityKey: inviter.identityKey ?? null,
            displayName: inviter.deviceLabel ?? inviter.firstName ?? "Unknown device",
            avatarUrl: inviter.profileImageUrl ?? null,`,
`            identityKey: inviter.identityKey,
            displayName: inviter.displayName,
            avatarUrl: inviter.avatarStorageId ? await ctx.storage.getUrl(inviter.avatarStorageId) : null,`,
  ),
)

edit('convex/projectFileLocks.ts', (text) =>
  text.replace(
    'profileImageUrl: lockedByDevice.profileImageUrl ?? null,',
    'profileImageUrl: lockedByDevice.avatarStorageId ? await ctx.storage.getUrl(lockedByDevice.avatarStorageId) : null,',
  ),
)

edit('convex/projectTasks.ts', (text) =>
  text.replace(
`                id: actor._id,
                email: actor.email,
                firstName: actor.firstName,
                lastName: actor.lastName,
                profileImageUrl: actor.profileImageUrl,`,
`                id: actor._id,
                identityKey: actor.identityKey,
                displayName: actor.displayName,
                avatarUrl: actor.avatarStorageId ? await ctx.storage.getUrl(actor.avatarStorageId) : null,`,
  ),
)

// Renderer identity is device-principal presentation only.
edit('apps/desktop/src/components/layouts/UnifiedHeader.tsx', (text) =>
  text
    .replace('import { useAuth } from "@/contexts/AuthContext";\n', '')
    .replace('  const { user } = useAuth();\n', '')
    .replace(
      /  const hasLocalDeviceProfile = Boolean\([\s\S]*?\n  \);\n  const shouldShowInbox = !hideInbox && !hasLocalDeviceProfile;/,
      '  const shouldShowInbox = !hideInbox;',
    ),
)

edit('apps/desktop/src/hooks/useProjectPresence.ts', (text) =>
  text
    .replace(/\n  \/\/ Transitional caller shape\.[\s\S]*?  userAvatarUrl\?: string \| null/, '')
    .replace('\n  userEmail: string', '')
    .replace(/\n  userName: string \| null \| undefined\n  userEmail: string \| null \| undefined\n  userAvatarUrl\?: string \| null/, ''),
)

edit('apps/desktop/src/features/projects/layouts/ProjectLayout.tsx', (text) =>
  text
    .replace('import { formatActorDisplayName } from "@/lib/userDisplay";\n', '')
    .replace(/\n  userName,\n  userEmail,\n  userAvatarUrl,/, '')
    .replace(/\n  userName: string \| null;\n  userEmail: string \| null;\n  userAvatarUrl: string \| null;/, '')
    .replace(/\n    userName,\n    userEmail,\n    userAvatarUrl,/, '')
    .replace(/\n  const displayUserName = user[\s\S]*?\n    : null;\n/, '\n')
    .replace(/\n        userName=\{presenceGateOpen \? displayUserName : null\}\n        userEmail=\{presenceGateOpen \? user\?\.email \|\| null : null\}\n        userAvatarUrl=\{shouldEnableProjectRuntime \? user\?\.profileImageUrl \|\| null : null\}/, '')
    .replace(/\n      displayUserName,\n      user\?\.email,\n      user\?\.profileImageUrl,/, ''),
)

edit('apps/desktop/src/features/projects/pages/AgentSkillsPage.tsx', (text) =>
  text.replace(
    /  const displayName =\n    \[user\?\.firstName, user\?\.lastName\]\.filter\(Boolean\)\.join\(" "\) \|\| user\?\.email \|\| "Cozea user";/,
    '  const displayName = user?.displayName || "This device";',
  ),
)

edit('apps/desktop/src/features/projects/pages/ProjectWorkbenchSurface.tsx', (text) =>
  text.replace('const workspaceSelectionId = user?.id ?? "local-device";', 'const workspaceSelectionId = user?.identityKey ?? "local-device";'),
)
edit('apps/desktop/src/features/projects/pages/ProjectsLaunchPage.tsx', (text) =>
  text.replace('const workspaceSelectionId = user?.id ?? "local-device"', 'const workspaceSelectionId = user?.identityKey ?? "local-device"'),
)

edit('apps/desktop/src/features/projects/ui/ProjectSidebar.tsx', (text) =>
  text.replace(
/  user\?: \{\n    email: string;\n    firstName\?: string \| null;\n    lastName\?: string \| null;\n    profileImageUrl\?: string \| null;\n  \} \| null;/,
`  user?: {
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;`,
  ),
)

edit('apps/desktop/src/features/settings/ui/SettingsSidebar.tsx', (text) =>
  text.replace(
/  user\?: \{\n    email: string\n    firstName\?: string \| null\n    lastName\?: string \| null\n    profileImageUrl\?: string \| null\n  \} \| null/,
`  user?: {
    displayName?: string | null
    avatarUrl?: string | null
  } | null`,
  ),
)

edit('apps/desktop/src/features/settings/Account.tsx', (text) =>
  text
    .replace('  const [savedAvatarUrl, setSavedAvatarUrl] = useState<string | null>(null)\n', '')
    .replace(/\n    setSavedAvatarUrl\(profile\.avatarUrl\)/g, ''),
)

edit('apps/desktop/src/features/settings/Organizations.tsx', (text) =>
  text.replace(/member\.deviceLabel/g, 'member.displayName'),
)

edit('apps/desktop/src/features/source-control/pages/ChangesPage.tsx', (text) =>
  text
    .replace("import { formatActorDisplayName } from '@/lib/userDisplay'\n", '')
    .replace('const displayUserName = formatActorDisplayName(group.userName);', 'const displayUserName = group.userName || "This device";'),
)

// Removed email-invite route has no renderer entrypoint.
edit('apps/desktop/src/router/routes.tsx', (text) =>
  text
    .replace(/const ProjectInvitePage = createLazyRouteComponent\([\s\S]*?\n\);\n(?=const LegacyProjectRedirectPage)/, '')
    .replace(/\nconst projectInviteRoute = createRoute\(\{[\s\S]*?\n\}\);\n(?=\nconst joinProjectRoute)/, '\n')
    .replace('    projectInviteRoute,\n', ''),
)

// Tombstone conflict reads stay project-scoped; no general principal directory.
edit('convex/fileTombstones.ts', (text) =>
  text.replace(
`    return tombstones.filter((t) => t.expiresAt > now)`,
`    const active = tombstones.filter((t) => t.expiresAt > now)
    return await Promise.all(active.map(async (tombstone) => {
      let deletedByName: string | null = null
      if (tombstone.deletedBy) {
        const principal = await ctx.db.get(tombstone.deletedBy)
        if (principal) deletedByName = deviceDisplayName(principal)
      } else if (tombstone.deletedByAgent) {
        deletedByName = tombstone.deletedByAgent
      }
      return { ...tombstone, deletedByName }
    }))`,
  ),
)

edit('apps/desktop/src/lib/yjs/ReconnectionProtocol.ts', (text) =>
  text.replace(
/            \/\/ Get who deleted it\n            let deletedBy: string \| null = null\n            if \(tombstone\.deletedBy\) \{[\s\S]*?\n            \} else if \(tombstone\.deletedByAgent\) \{\n              deletedBy = tombstone\.deletedByAgent\n            \}/,
'            const deletedBy = tombstone.deletedByName ?? tombstone.deletedByAgent ?? null',
  ),
)

// Project creation and cleanup no longer touch account-era contact/invite state.
edit('convex/projects.ts', (text) =>
  text
    .replace(/\n      contactEmail: user\.email,/, '')
    .replace(/\n    case 12: \{\n      const rows = await ctx\.db\n        \.query\("projectInvites"\)[\s\S]*?\n      return rows\.length\n    \}/, ''),
)

edit('convex/devApps.ts', (text) =>
  text.replace(
    '...(user.deviceLabel ? { publisherDeviceLabel: user.deviceLabel } : {}),',
    '...(user.displayName ? { publisherDeviceLabel: user.displayName } : {}),',
  ),
)

// Task ownership/assignment uses device identity, never email identity.
edit('convex/projectTasks.ts', (text) =>
  text
    .replace(/\n  email: v\.optional\(v\.string\(\)\),/, '')
    .replace(/\n  email\?: string/, '')
    .replace(/\nfunction normalizeEmail\([\s\S]*?\n\}\n(?=\nfunction normalizeText)/, '\n')
    .replace(/\n  const email = normalizeEmail\(assignee\.email\)\n  if \(email\) \{\n    sanitized\.email = email\n  \}\n/, '\n'),
)

edit('apps/desktop/src/features/tasks/pages/TasksPage.tsx', (text) =>
  text
    .replace(/\n  email\?: string/g, '\n  identityKey?: string')
    .replace(/\n  email: string/g, '\n  identityKey: string')
    .replace(
/\ninterface ClaimantUserSummary \{[\s\S]*?\n\}\n\ninterface ClaimantMemberSourceRecord \{[\s\S]*?\n\}/,
`\ninterface ClaimantMemberSourceRecord {
  userId: string
  identityKey: string
  displayName: string
  avatarUrl?: string | null
}`,
    )
    .replace(
/function getClaimantIdentityKey\(claimant: \{[\s\S]*?\n\}\n\nfunction formatClaimantName[\s\S]*?\n\}\n(?=\nfunction getDisplayFirstName)/,
`function getClaimantIdentityKey(claimant: {
  id?: string
  identityKey?: string | null
  name?: string | null
}): string {
  const identityKey = claimant.identityKey?.trim().toLowerCase()
  if (identityKey) return \`device:\${identityKey}\`

  const id = claimant.id?.trim()
  if (id) return \`id:\${id}\`

  const name = claimant.name?.trim().toLowerCase()
  return \`name:\${name || '?'}\`
}\n`,
    )
    .replace(/\n  const emailPrefix = normalized\.split\('@'\)\[0\]\?\.trim\(\)\n  if \(normalized\.includes\('@'\) && emailPrefix\) return emailPrefix\n/, '')
    .replace(
/    const email =\n      typeof candidate\.email[\s\S]*?\n    const key = getClaimantIdentityKey\(\{\n      id: candidate\.id,\n      email,\n      name,\n    \}\)/,
`    const identityKey =
      typeof candidate.identityKey === 'string' && candidate.identityKey.trim().length > 0
        ? candidate.identityKey.trim().toLowerCase()
        : undefined
    const key = getClaimantIdentityKey({
      id: candidate.id,
      identityKey,
      name,
    })`,
    )
    .replace(/\n        email,\n        avatarUrl:/g, '\n        identityKey,\n        avatarUrl:')
    .replace(/\n    email: primary\.email,/, '\n    identityKey: primary.identityKey,')
    .replace(
/    const sourceMembers = \(projectMembers \?\? \[\]\) as ClaimantMemberSourceRecord\[\]\n    const byIdentity = new Map<string, TaskClaimantCandidate>\(\)\n\n    for \(const member of sourceMembers\) \{[\s\S]*?\n    return Array\.from\(byIdentity\.values\(\)\)\.sort\(\(left, right\) => \{\n      const nameCompare = left\.name\.localeCompare\(right\.name\)\n      if \(nameCompare !== 0\) return nameCompare\n      return left\.email\.localeCompare\(right\.email\)\n    \}\)/,
`    const sourceMembers = (projectMembers ?? []) as ClaimantMemberSourceRecord[]
    const byIdentity = new Map<string, TaskClaimantCandidate>()

    for (const member of sourceMembers) {
      const identityKey = member.identityKey.trim().toLowerCase()
      if (!identityKey) continue
      const name = member.displayName.trim() || identityKey
      const candidate: TaskClaimantCandidate = {
        id: String(member.userId),
        name,
        identityKey,
        avatarUrl: member.avatarUrl ?? null,
        searchText: normalizeSearchValue(\`\${name} \${identityKey}\`),
      }
      byIdentity.set(getClaimantIdentityKey(candidate), candidate)
    }

    return Array.from(byIdentity.values()).sort((left, right) => {
      const nameCompare = left.name.localeCompare(right.name)
      if (nameCompare !== 0) return nameCompare
      return left.identityKey.localeCompare(right.identityKey)
    })`,
    )
    .replace(/\n                    email: assignee\.email,/g, '\n                    identityKey: assignee.identityKey,')
    .replace(/\n              email: assignee\.email,/g, '\n              identityKey: assignee.identityKey,')
    .replace('{candidate.email}', '{candidate.identityKey}'),
)

// Cloudflare adapter speaks canonical principal fields. Collaboration response
// can keep protocol-facing deviceLabel until that wire contract is renamed.
edit('cloudflare/worker/src/lib/convex.ts', (text) =>
  text
    .replace('  userId: string\n  identityKey: string\n  deviceLabel: string', '  principalId: string\n  identityKey: string\n  displayName: string')
    .replace(/userId: principal\.userId/g, 'userId: principal.principalId')
    .replace(/principal\.userId/g, 'principal.principalId')
    .replace(/principal\.deviceLabel/g, 'principal.displayName')
    .replace(/\n  \/\/ collabDevices remains temporarily[\s\S]*?\n  \}\)\n(?=\n  const roomId)/, ''),
)

// `collabDevices` duplicated the canonical principal. Resolve all room-key
// metadata/revocation from devicePrincipals instead.
edit('convex/yjs.ts', (text) => {
  text = text.replace(/export const registerCollabDevice = mutation\(\{[\s\S]*?\n\}\)\n\n(?=export const getEncryptionBootstrap)/, '')

  text = text.replace(
/    const registeredDevice = await ctx\.db[\s\S]*?\n    if \(registeredDevice && typeof registeredDevice\.revokedAt === "number"\) \{/,
`    const principal = await ctx.db.get(args.userId)
    if (!principal || principal.identityKey !== args.deviceId || principal.status === "revoked") {`,
  )

  text = text.replace(
/    const device = await ctx\.db\n      \.query\("collabDevices"\)[\s\S]*?\n    if \(device && typeof device\.revokedAt === "number"\) \{\n      throw new Error\("This device has been revoked from encrypted collaboration"\)\n    \}\n/,
'',
  )

  text = text.replace(
/    const devices = await Promise\.all\(\n      \[\.\.\.deviceIds\]\.map\(async \(deviceId\) => \{[\s\S]*?\n    return devices\n      \.filter\(\(device\) => device !== null\)\n      \.sort\(\(a, b\) => \(b\?\.lastSeenAt \?\? 0\) - \(a\?\.lastSeenAt \?\? 0\)\)/,
`    const devices = await Promise.all(
      [...deviceIds].map(async (deviceId) => {
        const principal = await ctx.db
          .query("devicePrincipals")
          .withIndex("by_identity_key", (q) => q.eq("identityKey", deviceId))
          .unique()
        if (!principal) return null

        const deviceWrappedKeys = wrappedKeys
          .filter((entry) => entry.recipientDeviceId === deviceId)
          .sort((a, b) => b.createdAt - a.createdAt)
        const pendingRequest = pendingRequests
          .filter((entry) => entry.recipientDeviceId === deviceId && typeof entry.fulfilledAt !== "number")
          .sort((a, b) => b.requestedAt - a.requestedAt)[0]

        return {
          userId: principal._id,
          deviceId: principal.identityKey,
          deviceLabel: principal.displayName,
          platform: principal.platform,
          fingerprint: principal.encryptionFingerprint,
          publicKeyJwk: principal.encryptionPublicKeyJwk,
          publicKeyAlgorithm: principal.encryptionPublicKeyAlgorithm,
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
      .sort((a, b) => (b?.lastSeenAt ?? 0) - (a?.lastSeenAt ?? 0))`,
  )

  text = text.replace(
/\n    if \(args\.userId && args\.retainDeviceId\) \{\n      const retainedDevice = await ctx\.db[\s\S]*?\n    \}\n(?=\n    const \{ removedUpdateBytes)/,
'\n',
  )

  return text
})

console.log('Applied device-principal compiler repair pass 2.')
