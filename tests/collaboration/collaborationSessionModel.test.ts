import { describe, expect, it } from "vitest"

import {
  advancePublishedCollaborationBase,
  buildCollaborationSessionBranch,
  canAccessCollaborationProject,
  resolveCollaborationJoinPlan,
  validateCollaborationSession,
  type CollaborationSessionDescriptor,
} from "@shared/collaborationSession"

const BASE_SHA = "1111111111111111111111111111111111111111"
const PUBLISHED_SHA = "2222222222222222222222222222222222222222"

function createSession(
  overrides: Partial<CollaborationSessionDescriptor> = {},
): CollaborationSessionDescriptor {
  const id = overrides.id ?? "session_1"
  return {
    id,
    projectId: "project_1",
    repositoryId: "github:1234",
    targetBranch: "main",
    sessionBranch: buildCollaborationSessionBranch(id),
    baseCommitSha: BASE_SHA,
    publishedCommitSha: null,
    publishedThroughSequence: 0,
    roomHeadSequence: 12,
    createdByUserId: "user_1",
    commitLeaseUserId: null,
    commitLeaseExpiresAt: null,
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    closedAt: null,
    ...overrides,
  }
}

describe("collaboration session model", () => {
  it("derives one Git-safe collaboration branch from the session ID", () => {
    expect(buildCollaborationSessionBranch("  session / 01  ")).toBe(
      "cozea/collab/session-01",
    )
  })

  it("keeps organization visibility separate from restricted project membership", () => {
    expect(
      canAccessCollaborationProject({
        policy: "organization",
        isActiveOrganizationMember: true,
        isExplicitProjectMember: false,
      }),
    ).toBe(true)

    expect(
      canAccessCollaborationProject({
        policy: "restricted",
        isActiveOrganizationMember: true,
        isExplicitProjectMember: false,
      }),
    ).toBe(false)

    expect(
      canAccessCollaborationProject({
        policy: "restricted",
        isActiveOrganizationMember: true,
        isExplicitProjectMember: true,
      }),
    ).toBe(true)
  })

  it("checks out the original base before the session branch has been pushed", () => {
    expect(resolveCollaborationJoinPlan(createSession())).toEqual({
      repositoryId: "github:1234",
      sessionBranch: "cozea/collab/session_1",
      checkoutCommitSha: BASE_SHA,
      overlayAfterSequence: 0,
      requiresReadCredential: true,
    })
  })

  it("checks out the published base and requests only the later overlay", () => {
    const plan = resolveCollaborationJoinPlan(
      createSession({
        baseCommitSha: PUBLISHED_SHA,
        publishedCommitSha: PUBLISHED_SHA,
        publishedThroughSequence: 8,
      }),
    )

    expect(plan.checkoutCommitSha).toBe(PUBLISHED_SHA)
    expect(plan.overlayAfterSequence).toBe(8)
  })

  it("does not allow an unpublished local commit to advance the shared base", () => {
    const session = createSession({
      status: "local_commit_ready",
      commitLeaseUserId: "user_1",
      commitLeaseExpiresAt: Date.now() + 10_000,
    })

    expect(session.baseCommitSha).toBe(BASE_SHA)
    expect(session.publishedCommitSha).toBeNull()
    expect(session.publishedThroughSequence).toBe(0)
  })

  it("advances the base only after a verified publication boundary", () => {
    const result = advancePublishedCollaborationBase(
      createSession({
        status: "pushing",
        commitLeaseUserId: "user_1",
        commitLeaseExpiresAt: Date.now() + 10_000,
      }),
      {
        commitSha: PUBLISHED_SHA,
        coveredThroughSequence: 8,
        publishedAt: 50,
      },
    )

    expect(result.baseCommitSha).toBe(PUBLISHED_SHA)
    expect(result.publishedCommitSha).toBe(PUBLISHED_SHA)
    expect(result.publishedThroughSequence).toBe(8)
    expect(result.status).toBe("active")
    expect(result.commitLeaseUserId).toBeNull()
  })

  it("rejects publication beyond the room head", () => {
    expect(() =>
      advancePublishedCollaborationBase(
        createSession({ status: "pushing" }),
        {
          commitSha: PUBLISHED_SHA,
          coveredThroughSequence: 13,
          publishedAt: 50,
        },
      ),
    ).toThrow("cannot exceed the room head")
  })

  it("rejects a session branch that is not derived from its session ID", () => {
    expect(() =>
      validateCollaborationSession(
        createSession({ sessionBranch: "feature/not-a-collaboration-session" }),
      ),
    ).toThrow("must be derived")
  })

  it("requires an exact Git commit SHA as the collaboration basis", () => {
    expect(() =>
      validateCollaborationSession(createSession({ baseCommitSha: "main" })),
    ).toThrow("40-character hexadecimal Git commit SHA")
  })

  it("prevents one covered sequence from mapping to two published commits", () => {
    expect(() =>
      advancePublishedCollaborationBase(
        createSession({
          status: "pushing",
          baseCommitSha: PUBLISHED_SHA,
          publishedCommitSha: PUBLISHED_SHA,
          publishedThroughSequence: 8,
        }),
        {
          commitSha: "3333333333333333333333333333333333333333",
          coveredThroughSequence: 8,
          publishedAt: 60,
        },
      ),
    ).toThrow("cannot map to two commits")
  })
})
