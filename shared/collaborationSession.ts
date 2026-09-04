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
  publishedAt: number
}

const GIT_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i
const GIT_REF_UNSAFE_PATTERN = /[^a-zA-Z0-9._-]+/g
const GIT_REF_EDGE_PATTERN = /^[._-]+|[._-]+$/g

function requiredTrimmed(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
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
  const normalized = requiredTrimmed(sessionId, "Collaboration session ID")
    .replace(GIT_REF_UNSAFE_PATTERN, "-")
    .replace(GIT_REF_EDGE_PATTERN, "")
    .slice(0, 96)

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
  return normalized.startsWith(COLLABORATION_BRANCH_PREFIX) &&
    normalized.length > COLLABORATION_BRANCH_PREFIX.length
}

export function canAccessCollaborationProject(input: CollaborationProjectAccessInput): boolean {
  if (!input.isActiveOrganizationMember) {
    return false
  }

  return input.policy === "organization" || input.isExplicitProjectMember
}

export function resolveCollaborationJoinPlan(
  session: CollaborationSessionDescriptor,
): CollaborationJoinPlan {
  if (session.status === "closed" || session.status === "failed") {
    throw new Error(`Cannot join a collaboration session in ${session.status} state`)
  }

  if (!isCollaborationSessionBranch(session.sessionBranch)) {
    throw new Error("Collaboration session branch is invalid")
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
  requiredTrimmed(session.id, "Collaboration session ID")
  requiredTrimmed(session.projectId, "Project ID")
  requiredTrimmed(session.repositoryId, "Repository ID")
  requiredTrimmed(session.targetBranch, "Target branch")
  assertGitCommitSha(session.baseCommitSha, "Base commit SHA")

  if (session.sessionBranch !== buildCollaborationSessionBranch(session.id)) {
    throw new Error("Session branch must be derived from the collaboration session ID")
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
    assertGitCommitSha(session.publishedCommitSha, "Published commit SHA")
  } else if (publishedThroughSequence !== 0) {
    throw new Error("A session without a published commit cannot have a published sequence")
  }

  if (session.commitLeaseUserId && !session.commitLeaseExpiresAt) {
    throw new Error("An active commit lease must have an expiry")
  }

  if (!session.commitLeaseUserId && session.commitLeaseExpiresAt) {
    throw new Error("A commit lease expiry requires a lease holder")
  }

  return session
}

export function hasActiveCommitLease(
  session: CollaborationSessionDescriptor,
  now = Date.now(),
): boolean {
  return Boolean(
    session.commitLeaseUserId &&
      session.commitLeaseExpiresAt &&
      session.commitLeaseExpiresAt > now,
  )
}

export function advancePublishedCollaborationBase(
  session: CollaborationSessionDescriptor,
  publication: CollaborationPublication,
): CollaborationSessionDescriptor {
  validateCollaborationSession(session)

  if (session.status !== "pushing" && session.status !== "local_commit_ready") {
    throw new Error("A collaboration base can advance only from a prepared or pushing state")
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
    updatedAt: publication.publishedAt,
  }
}
