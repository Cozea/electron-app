/**
 * The capability vocabulary a DevApp worker declares and a user approves.
 *
 * This vocabulary hardens permanently. Once org members and agents have authored against
 * it and approvals exist in the field, a capability cannot be renamed, split, or given a
 * narrower meaning without invalidating grants people already made. Getting a surface
 * wrong costs a resolver; getting this wrong costs every approval ever granted.
 *
 * It is therefore derived from the host API surface that already exists rather than
 * invented: each capability corresponds to operations Cozea genuinely exposes, and the
 * scope distinctions mirror the ones the IPC layer already enforces.
 *
 * Services are unaffected. A service holds no capabilities by construction — its
 * `{ network, persistentData }` permissions stay exactly as they are, so no published
 * release's `permissionSetHash` changes.
 */

export type DevAppCapability =
  // ── Project scope ────────────────────────────────────────────────────────────
  // Bounded to the workspace that granted the app. Mirrors the existing project.*
  // IPC surface, where every call carries a workspaceId and resolveRoot returns null
  // when the caller is not authorized for it.
  | "project.read"
  | "project.write"
  | "project.metadata"
  | "git.read"
  | "git.write"
  // ── Machine scope ────────────────────────────────────────────────────────────
  // Unbounded by any workspace. Mirrors the raw fs.* IPC surface, which takes absolute
  // paths and is deliberately a different capability from its project-scoped sibling.
  | "fs.read"
  | "fs.write"
  // ── Escalating ───────────────────────────────────────────────────────────────
  // Each of these confers the others transitively. See ESCALATING_CAPABILITIES.
  | "terminal.spawn"
  | "process.spawn"
  // ── Reach ────────────────────────────────────────────────────────────────────
  | "net.outbound"
  | "shell.open"
  | "shell.reveal"

export const ALL_DEV_APP_CAPABILITIES: ReadonlyArray<DevAppCapability> = [
  "project.read",
  "project.write",
  "project.metadata",
  "git.read",
  "git.write",
  "fs.read",
  "fs.write",
  "terminal.spawn",
  "process.spawn",
  "net.outbound",
  "shell.open",
  "shell.reveal",
]

/**
 * Capabilities that confer every other capability.
 *
 * A worker that can spawn a shell or a child process can already read any file, write
 * any file, and reach the network — nothing about the declared set constrains what the
 * spawned process does. Presenting these as one checkbox among many would misrepresent
 * the grant, so approval must describe them as full access to the machine rather than
 * itemizing them alongside `project.read`.
 *
 * This is why the tiers below are not a lattice. `terminal.spawn` is not "one step above"
 * `fs.write`; it is the top, regardless of what else is declared.
 */
export const ESCALATING_CAPABILITIES: ReadonlyArray<DevAppCapability> = [
  "terminal.spawn",
  "process.spawn",
]

export type DevAppTrustTier = "sandboxed" | "scoped" | "privileged"

const TIER_BY_CAPABILITY: Readonly<Record<DevAppCapability, DevAppTrustTier>> = {
  "project.metadata": "scoped",
  "project.read": "scoped",
  "git.read": "scoped",
  "project.write": "scoped",
  "git.write": "scoped",
  "net.outbound": "scoped",
  "shell.open": "scoped",
  "shell.reveal": "scoped",
  "fs.read": "privileged",
  "fs.write": "privileged",
  "terminal.spawn": "privileged",
  "process.spawn": "privileged",
}

export function isEscalatingCapability(capability: DevAppCapability): boolean {
  return ESCALATING_CAPABILITIES.includes(capability)
}

export function isDevAppCapability(value: unknown): value is DevAppCapability {
  return typeof value === "string" && (ALL_DEV_APP_CAPABILITIES as ReadonlyArray<string>).includes(value)
}

/**
 * The tier an approval dialog should present.
 *
 * `sandboxed` means the app cannot touch anything — a view, or a service. `scoped` means
 * it acts only within the project that granted it. `privileged` means it can act on the
 * machine, and must say so plainly.
 */
export function trustTierFor(capabilities: ReadonlyArray<DevAppCapability>): DevAppTrustTier {
  if (capabilities.length === 0) return "sandboxed"
  return capabilities.some((capability) => TIER_BY_CAPABILITY[capability] === "privileged")
    ? "privileged"
    : "scoped"
}

/**
 * Whether a grant amounts to unrestricted access, regardless of what it itemizes.
 *
 * Used to drive the approval copy: a set containing `terminal.spawn` must not be
 * described as "read your project files and run a terminal" when it is, in truth,
 * everything the signed-in user can do.
 */
export function grantsUnrestrictedAccess(capabilities: ReadonlyArray<DevAppCapability>): boolean {
  return capabilities.some(isEscalatingCapability)
}

/**
 * Normalizes a declared set: valid capabilities only, deduplicated, stably ordered.
 *
 * Ordering matters because the normalized set is hashed into the approval, and two
 * manifests declaring the same capabilities in different orders must produce the same
 * hash — otherwise reordering a list would silently revoke a user's grant.
 */
export function normalizeCapabilities(values: ReadonlyArray<unknown>): DevAppCapability[] {
  const valid = values.filter(isDevAppCapability)
  return [...new Set(valid)].sort()
}

/**
 * Whether agents may invoke this app with no person watching.
 *
 * Deliberately not a capability. It is an independent axis that multiplies the risk of
 * whatever capabilities are held: `project.write` invoked by a person who is looking at
 * the result is a different proposition from the same grant driven autonomously in a
 * loop. Modelling it as one more entry in the list would let it be approved as if it
 * were comparable to `git.read`.
 */
export interface DevAppGrant {
  capabilities: DevAppCapability[]
  agentInvocable: boolean
}

export function normalizeGrant(input: {
  capabilities?: ReadonlyArray<unknown>
  agentInvocable?: unknown
}): DevAppGrant {
  return {
    capabilities: normalizeCapabilities(input.capabilities ?? []),
    agentInvocable: input.agentInvocable === true,
  }
}

/**
 * The stable string an approval binds to.
 *
 * Hashed alongside the release content hash, so changing what an app asks for forces
 * re-approval while republishing identical capabilities does not.
 */
export function grantFingerprint(grant: DevAppGrant): string {
  const normalized = normalizeGrant(grant)
  return `v1;${normalized.capabilities.join(",")};agent=${normalized.agentInvocable ? "1" : "0"}`
}

/** Short, non-technical descriptions for approval copy. */
export const CAPABILITY_DESCRIPTIONS: Readonly<Record<DevAppCapability, string>> = {
  "project.metadata": "See this project's name, branch, and lane",
  "project.read": "Read files in this project",
  "project.write": "Change files in this project",
  "git.read": "See this project's branches and history",
  "git.write": "Switch branches and create worktrees in this project",
  "fs.read": "Read any file you can read",
  "fs.write": "Change any file you can change",
  "terminal.spawn": "Run commands on your Mac",
  "process.spawn": "Start programs on your Mac",
  "net.outbound": "Connect to the internet",
  "shell.open": "Open web links in your browser",
  "shell.reveal": "Show this project's files in Finder",
}

/**
 * Schemes `shell.open` may hand to the OS.
 *
 * `shell.openExternal` dispatches through LaunchServices, so an unrestricted URL is not
 * a web link — `file:` browses the disk and any installed app's custom scheme becomes
 * reachable, several of which have argument-injection histories. That would make a
 * capability sitting in the scoped tier a route to the whole machine.
 *
 * This mirrors the allowlist main.ts already applies to window-open and will-navigate,
 * rather than introducing a new rule.
 */
export const SHELL_OPEN_ALLOWED_SCHEMES: ReadonlyArray<string> = ["https:", "http:", "mailto:"]

export function isAllowedShellOpenUrl(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return SHELL_OPEN_ALLOWED_SCHEMES.includes(url.protocol.toLowerCase())
}

/** Which of an app's two permitted areas a reveal targets. */
export type DevAppRevealRoot = "workspace" | "data"

/**
 * Resolves a location `shell.reveal` may open, or null when it escapes its bounds.
 *
 * Follows the `project:openFolder` precedent: the worker names a *relative* location and
 * the host resolves it, so the worker never supplies an absolute path there is something
 * to escape from.
 *
 * The root is named explicitly rather than inferred. Trying the workspace first and
 * falling back to the data directory would make `logs` mean different places depending
 * on what happens to exist — resolution must not be ambiguous when it is the thing
 * enforcing a boundary.
 */
export function resolveRevealTarget(
  root: DevAppRevealRoot,
  relativePath: string,
  roots: { workspaceRoot: string; dataDir?: string },
  join: (root: string, relative: string) => string,
  normalize: (value: string) => string,
): string | null {
  if (typeof relativePath !== "string" || relativePath.length > 1024) return null
  if (relativePath.includes("\0")) return null
  // An absolute path is not a relative location; refuse rather than reinterpret it.
  if (relativePath.startsWith("/")) return null

  const base = root === "workspace" ? roots.workspaceRoot : roots.dataDir
  if (!base) return null

  const normalizedRoot = normalize(base)
  const resolved = normalize(join(normalizedRoot, relativePath))
  return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}/`) ? resolved : null
}

/**
 * The approval key a worker grant is recorded under.
 *
 * Deliberately a different shape from the service approval key
 * (`publicationId:contentHash:permissionSetHash`). Worker grants and service permissions
 * are separate propositions approved separately, and folding capabilities into the
 * service `permissionSetHash` would rewrite the hash of every release already published
 * — silently invalidating approvals users have already given.
 *
 * The `worker:` prefix keeps the two namespaces from ever colliding in the shared
 * approval list.
 */
export function devAppGrantApprovalKey(
  publicationId: string,
  contentHash: string,
  grant: DevAppGrant,
): string {
  const normalizedPublication = publicationId.trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedPublication)) {
    throw new Error("The DevApp publication ID is invalid.")
  }
  const normalizedHash = contentHash.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
    throw new Error("The DevApp content hash is invalid.")
  }
  return `worker:${normalizedPublication}:${normalizedHash}:${grantFingerprint(grant)}`
}
