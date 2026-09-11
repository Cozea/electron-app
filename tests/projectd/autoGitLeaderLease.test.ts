import { describe, expect, it } from "vitest"

import { asSessionId, type AutoGitLease } from "@shared/collaboration"
import { AutoGitCoordinator } from "../../apps/projectd/src/autogit/AutoGitCoordinator"
import {
  StaleLeaderLeaseError,
  type EligibilityReport,
} from "../../apps/projectd/src/autogit/LeaderLeaseClient"

describe("P16 AutoGit leader lease & fencing", () => {
  const sessionId = asSessionId("sess_autogit_1")

  it("deterministically elects leader from eligible candidates", () => {
    const candidates: EligibilityReport[] = [
      {
        identityKey: "czd_mac_charlie",
        hasWriteRole: true,
        hasGitService: true,
        hasRepoAccess: true,
        isHealthy: true,
      },
      {
        identityKey: "czd_mac_alice",
        hasWriteRole: true,
        hasGitService: true,
        hasRepoAccess: true,
        isHealthy: true,
      },
      {
        identityKey: "czd_mac_bob",
        hasWriteRole: false, // Ineligible (read-only role)
        hasGitService: true,
        hasRepoAccess: true,
        isHealthy: true,
      },
    ]

    const winner = AutoGitCoordinator.electLeader(candidates)
    expect(winner).not.toBeNull()
    // Alice wins deterministically (alphabetically first eligible)
    expect(winner?.identityKey).toBe("czd_mac_alice")
  })

  it("handles leader failover, generation increment, and fencing rejection for stale leader", () => {
    // 1. Initial election: Node A is leader at generation 1
    const coordinatorA = new AutoGitCoordinator(sessionId, "czd_mac_a")
    const coordinatorB = new AutoGitCoordinator(sessionId, "czd_mac_b")

    const leaseGen1: AutoGitLease = {
      sessionId,
      leaderIdentityKey: "czd_mac_a",
      leaseGeneration: 1,
      leaseExpiresAt: Date.now() + 20_000,
      lastRenewedAt: Date.now(),
    }

    coordinatorA.onLeaseUpdated(leaseGen1)
    coordinatorB.onLeaseUpdated(leaseGen1)

    expect(coordinatorA.isLeader).toBe(true)
    expect(coordinatorB.isLeader).toBe(false)
    expect(coordinatorA.lifecycle).toBe("LEADER_ACTIVE")

    // Node A can perform fenced actions with generation 1
    expect(() => coordinatorA.leaseClient.assertFenced(1)).not.toThrow()

    // 2. Node A dies / network partition occurs.
    // Lease expires -> Generation increments to 2, Node B elected!
    const leaseGen2: AutoGitLease = {
      sessionId,
      leaderIdentityKey: "czd_mac_b",
      leaseGeneration: 2,
      leaseExpiresAt: Date.now() + 20_000,
      lastRenewedAt: Date.now(),
    }

    coordinatorB.onLeaseUpdated(leaseGen2)
    expect(coordinatorB.isLeader).toBe(true)
    expect(coordinatorB.leaseClient.generation).toBe(2)

    // Node B can perform fenced actions with generation 2
    expect(() => coordinatorB.leaseClient.assertFenced(2)).not.toThrow()

    // 3. Stale leader Node A wakes up and attempts to act with generation 1
    // Network fencing prevents stale leader from acting!
    coordinatorA.onLeaseUpdated(leaseGen2) // Informed of new lease
    expect(coordinatorA.isLeader).toBe(false)
    expect(() => coordinatorA.leaseClient.assertFenced(1)).toThrow(StaleLeaderLeaseError)
    expect(() => coordinatorA.leaseClient.assertFenced(2)).toThrow(StaleLeaderLeaseError)
  })

  it("routes manual checkpoint/push requests to active leader when called on non-leader", async () => {
    const coordinatorB = new AutoGitCoordinator(sessionId, "czd_mac_b")
    const lease: AutoGitLease = {
      sessionId,
      leaderIdentityKey: "czd_mac_a",
      leaseGeneration: 1,
      leaseExpiresAt: Date.now() + 20_000,
      lastRenewedAt: Date.now(),
    }
    coordinatorB.onLeaseUpdated(lease)

    // Non-leader B attempts manual action -> routes to leader A
    await expect(
      coordinatorB.routeManualAction("checkpoint_now", async () => "local_result"),
    ).rejects.toThrow(/routed to leader 'czd_mac_a'/)
  })

  it("transitions to LEADER_DEGRADED when leader loses credentials or health", () => {
    const coordinatorA = new AutoGitCoordinator(sessionId, "czd_mac_a")
    const lease: AutoGitLease = {
      sessionId,
      leaderIdentityKey: "czd_mac_a",
      leaseGeneration: 1,
      leaseExpiresAt: Date.now() + 20_000,
      lastRenewedAt: Date.now(),
    }
    coordinatorA.onLeaseUpdated(lease)
    expect(coordinatorA.lifecycle).toBe("LEADER_ACTIVE")

    // Leader encounters error (e.g. credential revoked)
    coordinatorA.transition("LEADER_DEGRADED")
    expect(coordinatorA.lifecycle).toBe("LEADER_DEGRADED")
  })
})
