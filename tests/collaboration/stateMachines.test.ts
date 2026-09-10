import { describe, expect, it } from "vitest"

import {
  assertValidAutoGitTransition,
  assertValidCheckpointStageTransition,
  assertValidParticipantTransition,
  assertValidRebaseTransition,
  assertValidSessionTransition,
  assertValidWorkbenchTransition,
  canTransitionAutoGitLifecycle,
  canTransitionCheckpointStage,
  canTransitionParticipantLifecycle,
  canTransitionRebaseLifecycle,
  canTransitionSessionLifecycle,
  canTransitionWorkbenchLifecycle,
  InvalidStateTransitionError,
} from "@shared/collaboration"

describe("P01 pure state-machine transition validators", () => {
  describe("4.1 SessionLifecycle", () => {
    it("permits valid transitions", () => {
      expect(canTransitionSessionLifecycle("CREATING", "ACTIVE")).toBe(true)
      expect(canTransitionSessionLifecycle("ACTIVE", "DORMANT")).toBe(true)
      expect(canTransitionSessionLifecycle("DORMANT", "ACTIVE")).toBe(true)
      expect(canTransitionSessionLifecycle("ACTIVE", "PAUSING")).toBe(true)
      expect(canTransitionSessionLifecycle("PAUSING", "PAUSED")).toBe(true)
      expect(canTransitionSessionLifecycle("PAUSED", "ACTIVE")).toBe(true)
      expect(canTransitionSessionLifecycle("ACTIVE", "CLOSING")).toBe(true)
      expect(canTransitionSessionLifecycle("PAUSED", "CLOSING")).toBe(true)
      expect(canTransitionSessionLifecycle("CLOSING", "CLOSED")).toBe(true)
      expect(canTransitionSessionLifecycle("ACTIVE", "BLOCKED")).toBe(true)
      expect(canTransitionSessionLifecycle("BLOCKED", "ACTIVE")).toBe(true)
    })

    it("rejects invalid transitions", () => {
      // Cannot jump from CREATING to PAUSED
      expect(canTransitionSessionLifecycle("CREATING", "PAUSED")).toBe(false)
      expect(() => assertValidSessionTransition("CREATING", "PAUSED")).toThrow(
        InvalidStateTransitionError,
      )

      // CLOSED is terminal
      expect(canTransitionSessionLifecycle("CLOSED", "ACTIVE")).toBe(false)
      expect(canTransitionSessionLifecycle("CLOSED", "CREATING")).toBe(false)
      expect(() => assertValidSessionTransition("CLOSED", "ACTIVE")).toThrow(
        InvalidStateTransitionError,
      )

      // Cannot pause directly from DORMANT
      expect(canTransitionSessionLifecycle("DORMANT", "PAUSED")).toBe(false)
    })
  })

  describe("4.2 ParticipantLifecycle", () => {
    it("permits valid transitions", () => {
      expect(canTransitionParticipantLifecycle("NOT_JOINED", "INVITED")).toBe(true)
      expect(canTransitionParticipantLifecycle("NOT_JOINED", "AVAILABLE")).toBe(true)
      expect(canTransitionParticipantLifecycle("INVITED", "JOINING")).toBe(true)
      expect(canTransitionParticipantLifecycle("AVAILABLE", "JOINING")).toBe(true)
      expect(canTransitionParticipantLifecycle("JOINING", "CONNECTED")).toBe(true)
      expect(canTransitionParticipantLifecycle("CONNECTED", "BACKGROUND")).toBe(true)
      expect(canTransitionParticipantLifecycle("BACKGROUND", "CONNECTED")).toBe(true)
      expect(canTransitionParticipantLifecycle("CONNECTED", "LEFT")).toBe(true)
      expect(canTransitionParticipantLifecycle("BACKGROUND", "LEFT")).toBe(true)
    })

    it("rejects invalid transitions", () => {
      expect(canTransitionParticipantLifecycle("NOT_JOINED", "CONNECTED")).toBe(false)
      expect(canTransitionParticipantLifecycle("LEFT", "CONNECTED")).toBe(false)
      expect(() => assertValidParticipantTransition("LEFT", "CONNECTED")).toThrow(
        InvalidStateTransitionError,
      )
    })
  })

  describe("4.3 LocalWorkbenchLifecycle", () => {
    it("permits valid transitions", () => {
      expect(canTransitionWorkbenchLifecycle("creating", "idle")).toBe(true)
      expect(canTransitionWorkbenchLifecycle("creating", "active")).toBe(true)
      expect(canTransitionWorkbenchLifecycle("idle", "active")).toBe(true)
      expect(canTransitionWorkbenchLifecycle("active", "idle")).toBe(true)
      expect(canTransitionWorkbenchLifecycle("idle", "closing")).toBe(true)
      expect(canTransitionWorkbenchLifecycle("active", "closing")).toBe(true)
      expect(canTransitionWorkbenchLifecycle("closing", "closed")).toBe(true)
    })

    it("rejects invalid transitions", () => {
      expect(canTransitionWorkbenchLifecycle("closed", "active")).toBe(false)
      expect(() => assertValidWorkbenchTransition("closed", "active")).toThrow(
        InvalidStateTransitionError,
      )
    })
  })

  describe("4.4 AutoGitLifecycle", () => {
    it("permits valid transitions", () => {
      expect(canTransitionAutoGitLifecycle("DISABLED", "NO_LEADER")).toBe(true)
      expect(canTransitionAutoGitLifecycle("NO_LEADER", "ELECTING")).toBe(true)
      expect(canTransitionAutoGitLifecycle("ELECTING", "LEADER_ACTIVE")).toBe(true)
      expect(canTransitionAutoGitLifecycle("LEADER_ACTIVE", "LEADER_DEGRADED")).toBe(true)
      expect(canTransitionAutoGitLifecycle("LEADER_DEGRADED", "LEADER_ACTIVE")).toBe(true)
      expect(canTransitionAutoGitLifecycle("LEADER_ACTIVE", "TRANSFERRING")).toBe(true)
      expect(canTransitionAutoGitLifecycle("TRANSFERRING", "NO_LEADER")).toBe(true)
      expect(canTransitionAutoGitLifecycle("LEADER_ACTIVE", "BLOCKED")).toBe(true)
      expect(canTransitionAutoGitLifecycle("BLOCKED", "NO_LEADER")).toBe(true)
    })

    it("rejects invalid transitions", () => {
      expect(canTransitionAutoGitLifecycle("DISABLED", "LEADER_ACTIVE")).toBe(false)
      expect(() => assertValidAutoGitTransition("DISABLED", "LEADER_ACTIVE")).toThrow(
        InvalidStateTransitionError,
      )
    })
  })

  describe("4.5 AutoGitCheckpointStage", () => {
    it("permits valid pipeline stages", () => {
      expect(canTransitionCheckpointStage("REQUESTED", "FLUSHING")).toBe(true)
      expect(canTransitionCheckpointStage("FLUSHING", "BARRIER_CREATED")).toBe(true)
      expect(canTransitionCheckpointStage("BARRIER_CREATED", "SNAPSHOT_CAPTURED")).toBe(true)
      expect(canTransitionCheckpointStage("SNAPSHOT_CAPTURED", "GIT_TREE_BUILT")).toBe(true)
      expect(canTransitionCheckpointStage("GIT_TREE_BUILT", "COMMIT_PREPARED")).toBe(true)
      expect(canTransitionCheckpointStage("COMMIT_PREPARED", "PUSHING")).toBe(true)
      expect(canTransitionCheckpointStage("PUSHING", "REMOTE_VERIFIED")).toBe(true)
      expect(canTransitionCheckpointStage("REMOTE_VERIFIED", "ADOPTED")).toBe(true)
      expect(canTransitionCheckpointStage("ADOPTED", "COMPLETE")).toBe(true)
      expect(canTransitionCheckpointStage("PUSHING", "FAILED")).toBe(true)
    })

    it("rejects out-of-order stages", () => {
      expect(canTransitionCheckpointStage("REQUESTED", "PUSHING")).toBe(false)
      expect(canTransitionCheckpointStage("COMPLETE", "REQUESTED")).toBe(false)
      expect(() => assertValidCheckpointStageTransition("REQUESTED", "PUSHING")).toThrow(
        InvalidStateTransitionError,
      )
    })
  })

  describe("4.6 RebaseLifecycle & Invariant C25", () => {
    it("permits explicit user-approved rebase transition", () => {
      expect(canTransitionRebaseLifecycle("IDLE", "SUGGESTED")).toBe(true)

      // Invariant C25: SUGGESTED -> REQUESTED is permitted when isUserAction is true
      expect(
        canTransitionRebaseLifecycle("SUGGESTED", "REQUESTED", { isUserAction: true }),
      ).toBe(true)
      expect(() =>
        assertValidRebaseTransition("SUGGESTED", "REQUESTED", { isUserAction: true }),
      ).not.toThrow()

      expect(canTransitionRebaseLifecycle("REQUESTED", "PREPARING_BARRIER")).toBe(true)
      expect(canTransitionRebaseLifecycle("PREPARING_BARRIER", "CHECKPOINTING")).toBe(true)
      expect(canTransitionRebaseLifecycle("CHECKPOINTING", "FETCHING_TARGET")).toBe(true)
      expect(canTransitionRebaseLifecycle("FETCHING_TARGET", "COMPUTING")).toBe(true)
      expect(canTransitionRebaseLifecycle("COMPUTING", "READY_TO_ADOPT")).toBe(true)
      expect(canTransitionRebaseLifecycle("READY_TO_ADOPT", "ADOPTING")).toBe(true)
      expect(canTransitionRebaseLifecycle("ADOPTING", "PUSHING_REWRITTEN_BRANCH")).toBe(true)
      expect(canTransitionRebaseLifecycle("PUSHING_REWRITTEN_BRANCH", "COMPLETE")).toBe(true)
    })

    it("strictly blocks automated SUGGESTED -> REQUESTED without explicit user action (Invariant C25)", () => {
      // Default / automated call
      expect(canTransitionRebaseLifecycle("SUGGESTED", "REQUESTED")).toBe(false)
      expect(
        canTransitionRebaseLifecycle("SUGGESTED", "REQUESTED", { isUserAction: false }),
      ).toBe(false)

      expect(() => assertValidRebaseTransition("SUGGESTED", "REQUESTED")).toThrow(
        InvalidStateTransitionError,
      )
      expect(() =>
        assertValidRebaseTransition("SUGGESTED", "REQUESTED", { isUserAction: false }),
      ).toThrow(/Invariant C25 violated/)
    })
  })
})
