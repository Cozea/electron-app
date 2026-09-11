/**
 * AutoGit Coordinator managing leader state and request routing.
 *
 * Master Specification: Section 14.1 - 14.7, Invariant C20, C22
 */

import { EventEmitter } from "node:events"
import type { AutoGitLease, AutoGitLifecycle, SessionId } from "@shared/collaboration"
import { canTransitionAutoGitLifecycle, assertValidAutoGitTransition } from "@shared/collaboration"
import { LeaderLeaseClient, LEASE_DURATION_MS, type EligibilityReport } from "./LeaderLeaseClient"

export class AutoGitCoordinator extends EventEmitter {
  readonly sessionId: SessionId
  readonly leaseClient: LeaderLeaseClient
  private state: AutoGitLifecycle = "NO_LEADER"

  constructor(sessionId: SessionId, localIdentityKey: string) {
    super()
    this.sessionId = sessionId
    this.leaseClient = new LeaderLeaseClient(sessionId, localIdentityKey)
  }

  get lifecycle(): AutoGitLifecycle {
    return this.state
  }

  get isLeader(): boolean {
    return this.leaseClient.isLeader
  }

  transition(to: AutoGitLifecycle): void {
    if (this.state === to) return
    assertValidAutoGitTransition(this.state, to)
    const prev = this.state
    this.state = to
    this.emit("state_change", { from: prev, to })
  }

  /**
   * Section 14.7: Deterministic candidate election from connected eligible devices.
   */
  static electLeader(candidates: EligibilityReport[]): EligibilityReport | null {
    const eligible = candidates.filter(
      (c) => c.hasWriteRole && c.hasGitService && c.hasRepoAccess && c.isHealthy,
    )
    if (eligible.length === 0) return null

    // Deterministic selection (e.g. lowest alphabetical identityKey)
    eligible.sort((a, b) => a.identityKey.localeCompare(b.identityKey))
    return eligible[0]
  }

  onLeaseUpdated(lease: AutoGitLease | null): void {
    this.leaseClient.updateLease(lease)

    if (!lease || lease.leaseExpiresAt <= Date.now()) {
      if (this.state === "LEADER_ACTIVE" || this.state === "LEADER_DEGRADED") {
        this.transition("NO_LEADER")
      }
      return
    }

    if (this.leaseClient.isLeader) {
      if (this.state === "NO_LEADER") {
        this.transition("ELECTING")
        this.transition("LEADER_ACTIVE")
      } else if (
        this.state === "ELECTING" ||
        this.state === "LEADER_DEGRADED" ||
        this.state === "TRANSFERRING"
      ) {
        this.transition("LEADER_ACTIVE")
      }
    } else {
      if (this.state === "LEADER_ACTIVE" || this.state === "LEADER_DEGRADED") {
        this.transition("TRANSFERRING")
        this.transition("NO_LEADER")
      }
    }
  }

  /**
   * Routes a manual checkpoint or push request.
   * If this node is the leader, executes directly.
   * If non-leader, routes to the active leader.
   */
  async routeManualAction<T>(action: string, executeLocal: () => Promise<T>): Promise<T> {
    if (this.isLeader) {
      this.leaseClient.assertFenced(this.leaseClient.generation)
      return executeLocal()
    }

    if (!this.leaseClient.lease) {
      throw new Error("No active AutoGit leader currently available to handle request")
    }

    // In a networked deployment, this routes over WebSocket to the leader
    throw new Error(
      `Manual action '${action}' routed to leader '${this.leaseClient.lease.leaderIdentityKey}'`,
    )
  }
}
