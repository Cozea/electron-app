export const COLLABORATION_BRANCH_PREFIX = "cozea/collab/" as const

export type CollaborationProjectAccessPolicy = "organization" | "restricted"

export type CollaborationSessionStatus =
  | "opening"
  | "active"
  | "commit_preparing"
  | "local_commit_ready"
  | "pushing"
  | "closing"
  | "closed"
  | "failed"

export type CollaborationParticipantRole = "editor" | "observer"

export interface CollaborationSessionCapabilities {
  codeSync: boolean
  audio: boolean
  screenShare: boolean
}

export interface CollaborationSessionDescriptor {
  id: string
  projectId: string
  repositoryId: string
  targetBranch: string
  sessionBranch: string
  baseCommitSha: string
  publishedCommitSha: string | null
  publishedThroughSequence: number
  roomHeadSequence: number
  createdByUserId: string
  commitLeaseUserId: string | null
  commitLeaseExpiresAt: number | null
  status: CollaborationSessionStatus
  createdAt: number
  updatedAt: number
  closedAt: number | null
}

export interface CollaborationParticipantDescriptor {
  sessionId: string
  userId: string
  role: CollaborationParticipantRole
  joinedAt: number
  lastSeenAt: number
  leftAt: number | null
  capabilities: CollaborationSessionCapabilities
}

export interface CollaborationProjectAccessInput {
  policy: CollaborationProjectAccessPolicy
  isActiveOrganizationMember: boolean
  isExplicitProjectMember: boolean
}

export interface CollaborationJoinPlan {
  repositoryId: string
  sessionBranch: string
  checkoutCommitSha: string
  overlayAfterSequence: number
  requiresReadCredential: true
}

export interface CollaborationPublication {
  commitSha: string
  coveredThroughSequence: number
  publishedByUserId: string
  publishedAt: number
}

const GIT_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i
const GIT_REF_UNSAFE_PATTERN = /[^a-zA-Z0-9._-]+/g
const GIT_REF_EDGE_PATTERN = /^[._-]+|[._-]+$/g
const GIT_REF_REPEATED_DOT_PATTERN = /\.{2,}/g

function requiredTrimmed(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

function requireCanonicalTrimmed(value: string, label: string): string {
  const normalized = requiredTrimmed(value, label)
  if (normalized !== value) {
    throw new Error(`${label} must not contain surrounding whitespace`)
  }
  return normalized
}

function normalizeTimestamp(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite timestamp`)
  }
  return Math.floor(value)
}

export function isGitCommitSha(value: string): boolean {
  return GIT_COMMIT_SHA_PATTERN.test(value.trim())
}

export function assertGitCommitSha(value: string, label = "Git commit SHA"): string {
  const normalized = value.trim().toLowerCase()
  if (!isGitCommitSha(normalized)) {
    throw new Error(`${label} must be a 40-character hexadecimal Git commit SHA`)
  }
  return normalized
}

export function normalizeCollaborationSessionId(sessionId: string): string {
  let normalized = requiredTrimmed(sessionId, "Collaboration session ID")
    .replace(GIT_REF_UNSAFE_PATTERN, "-")
    .replace(GIT_REF_REPEATED_DOT_PATTERN, "-")
    .replace(GIT_REF_EDGE_PATTERN, "")
    .slice(0, 96)
    .replace(GIT_REF_EDGE_PATTERN, "")

  if (/\.lock$/i.test(normalized)) {
    normalized = `${normalized.slice(0, -5)}-session`
  }

  if (!normalized) {
    throw new Error("Collaboration session ID does not contain a Git-safe character")
  }

  return normalized
}

export function buildCollaborationSessionBranch(sessionId: string): string {
  return `${COLLABORATION_BRANCH_PREFIX}${normalizeCollaborationSessionId(sessionId)}`
}

export function isCollaborationSessionBranch(branch: string): boolean {
  const normalized = branch.trim()
  if (!normalized.startsWith(COLLABORATION_BRANCH_PREFIX)) return false

  const suffix = normalized.slice(COLLABORATION_BRANCH_PREFIX.length)
  if (!suffix) return false

  try {
    return buildCollaborationSessionBranch(suffix) === normalized
  } catch {
    return false
  }
}

export function canAccessCollaborationProject(input: CollaborationProjectAccessInput): boolean {
  return input.policy === "organization"
    ? input.isActiveOrganizationMember
    : input.isExplicitProjectMember
}

export function resolveCollaborationJoinPlan(
  session: CollaborationSessionDescriptor,
): CollaborationJoinPlan {
  validateCollaborationSession(session)

  if (session.status === "closed" || session.status === "failed") {
    throw new Error(`Cannot join a collaboration session in ${session.status} state`)
  }

  const publishedCommitSha = session.publishedCommitSha
    ? assertGitCommitSha(session.publishedCommitSha, "Published commit SHA")
    : null

  return {
    repositoryId: requiredTrimmed(session.repositoryId, "Repository ID"),
    sessionBranch: session.sessionBranch,
    checkoutCommitSha: publishedCommitSha ?? assertGitCommitSha(session.baseCommitSha, "Base commit SHA"),
    overlayAfterSequence: publishedCommitSha
      ? normalizeSequence(session.publishedThroughSequence, "Published sequence")
      : 0,
    requiresReadCredential: true,
  }
}

export function normalizeSequence(value: number, label = "Sequence"): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`)
  }
  return Math.floor(value)
}

export function validateCollaborationSession(
  session: CollaborationSessionDescriptor,
): CollaborationSessionDescriptor {
  requireCanonicalTrimmed(session.id, "Collaboration session ID")
  requireCanonicalTrimmed(session.projectId, "Project ID")
  requireCanonicalTrimmed(session.repositoryId, "Repository ID")
  const targetBranch = requireCanonicalTrimmed(session.targetBranch, "Target branch")
  requireCanonicalTrimmed(session.createdByUserId, "Creating user ID")
  const baseCommitSha = assertGitCommitSha(session.baseCommitSha, "Base commit SHA")

  if (session.sessionBranch !== buildCollaborationSessionBranch(session.id)) {
    throw new Error("Session branch must be derived from the collaboration session ID")
  }

  if (targetBranch === session.sessionBranch) {
    throw new Error("Target branch and collaboration session branch must be different")
  }

  const publishedThroughSequence = normalizeSequence(
    session.publishedThroughSequence,
    "Published sequence",
  )
  const roomHeadSequence = normalizeSequence(session.roomHeadSequence, "Room head sequence")

  if (publishedThroughSequence > roomHeadSequence) {
    throw new Error("Published sequence cannot be ahead of the room head sequence")
  }

  if (session.publishedCommitSha) {
    const publishedCommitSha = assertGitCommitSha(
      session.publishedCommitSha,
      "Published commit SHA",
    )
    if (publishedCommitSha !== baseCommitSha) {
      throw new Error("The shared base must equal the latest published commit")
    }
  } else if (publishedThroughSequence !== 0) {
    throw new Error("A session without a published commit cannot have a published sequence")
  }

  const createdAt = normalizeTimestamp(session.createdAt, "Session creation time")
  const updatedAt = normalizeTimestamp(session.updatedAt, "Session update time")
  if (updatedAt < createdAt) {
    throw new Error("Session update time cannot precede creation time")
  }

  if (session.commitLeaseUserId !== null) {
    requireCanonicalTrimmed(session.commitLeaseUserId, "Commit lease user ID")
    if (session.commitLeaseExpiresAt === null) {
      throw new Error("An active commit lease must have an expiry")
    }
    normalizeTimestamp(session.commitLeaseExpiresAt, "Commit lease expiry")
  } else if (session.commitLeaseExpiresAt !== null) {
    throw new Error("A commit lease expiry requires a lease holder")
  }

  if (session.closedAt !== null) {
    const closedAt = normalizeTimestamp(session.closedAt, "Session close time")
    if (closedAt < createdAt) {
      throw new Error("Session close time cannot precede creation time")
    }
    if (session.status !== "closed" && session.status !== "failed") {
      throw new Error("Only closed or failed sessions may have a close time")
    }
  } else if (session.status === "closed") {
    throw new Error("A closed session must record its close time")
  }

  return session
}

export function hasActiveCommitLease(
  session: CollaborationSessionDescriptor,
  now = Date.now(),
): boolean {
  return Boolean(
    session.commitLeaseUserId &&
      session.commitLeaseExpiresAt !== null &&
      Number.isFinite(session.commitLeaseExpiresAt) &&
      session.commitLeaseExpiresAt > now,
  )
}

export function advancePublishedCollaborationBase(
  session: CollaborationSessionDescriptor,
  publication: CollaborationPublication,
): CollaborationSessionDescriptor {
  validateCollaborationSession(session)

  if (session.status !== "pushing") {
    throw new Error("A collaboration base can advance only after an explicit push")
  }

  const publishedByUserId = requiredTrimmed(
    publication.publishedByUserId,
    "Publishing user ID",
  )
  const publishedAt = normalizeTimestamp(publication.publishedAt, "Publication time")

  if (
    session.commitLeaseUserId !== publishedByUserId ||
    !hasActiveCommitLease(session, publishedAt)
  ) {
    throw new Error("Only the active commit lease holder may publish the collaboration base")
  }

  if (publishedAt < session.updatedAt) {
    throw new Error("Publication time cannot precede the current session state")
  }

  const commitSha = assertGitCommitSha(publication.commitSha, "Published commit SHA")
  const coveredThroughSequence = normalizeSequence(
    publication.coveredThroughSequence,
    "Published sequence",
  )

  if (coveredThroughSequence < session.publishedThroughSequence) {
    throw new Error("Published sequence cannot move backwards")
  }

  if (coveredThroughSequence > session.roomHeadSequence) {
    throw new Error("Published sequence cannot exceed the room head sequence")
  }

  if (
    coveredThroughSequence === session.publishedThroughSequence &&
    session.publishedCommitSha &&
    session.publishedCommitSha !== commitSha
  ) {
    throw new Error("One collaboration sequence boundary cannot map to two commits")
  }

  return {
    ...session,
    baseCommitSha: commitSha,
    publishedCommitSha: commitSha,
    publishedThroughSequence: coveredThroughSequence,
    commitLeaseUserId: null,
    commitLeaseExpiresAt: null,
    status: "active",
    updatedAt: publishedAt,
  }
}
