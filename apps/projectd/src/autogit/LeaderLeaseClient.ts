/**
 * AutoGit leader lease client and fencing validator.
 *
 * Master Specification: Section 14.3 - 14.6
 * Invariants:
 * - C20: Exactly one AutoGit leader holding fenced lease.
 * - C22: AutoGit failover is reproducible.
 */

import type { AutoGitLease, SessionId } from "@shared/collaboration"

export const LEASE_DURATION_MS = 20_000 // 20 seconds
export const LEASE_RENEWAL_INTERVAL_MS = 5_000 // 5 seconds

export class StaleLeaderLeaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StaleLeaderLeaseError"
  }
}

export interface EligibilityReport {
  identityKey: string
  hasWriteRole: boolean
  hasGitService: boolean
  hasRepoAccess: boolean
  isHealthy: boolean
}

export class LeaderLeaseClient {
  readonly sessionId: SessionId
  readonly localIdentityKey: string

  private currentLease: AutoGitLease | null = null
  private renewalTimer: NodeJS.Timeout | null = null
  private isRenewing = false

  constructor(sessionId: SessionId, localIdentityKey: string) {
    this.sessionId = sessionId
    this.localIdentityKey = localIdentityKey
  }

  get lease(): AutoGitLease | null {
    return this.currentLease
  }

  get isLeader(): boolean {
    if (!this.currentLease) return false
    const now = Date.now()
    return (
      this.currentLease.leaderIdentityKey === this.localIdentityKey &&
      this.currentLease.leaseExpiresAt > now
    )
  }

  get generation(): number {
    return this.currentLease?.leaseGeneration ?? 0
  }

  updateLease(lease: AutoGitLease | null): void {
    this.currentLease = lease
  }

  /**
   * Section 14.6: Fencing check.
   * Throws StaleLeaderLeaseError if the current lease is expired or generation doesn't match.
   */
  assertFenced(expectedGeneration: number): void {
    const now = Date.now()
    if (!this.currentLease) {
      throw new StaleLeaderLeaseError("No active AutoGit leader lease held")
    }

    if (this.currentLease.leaderIdentityKey !== this.localIdentityKey) {
      throw new StaleLeaderLeaseError(
        `Device '${this.localIdentityKey}' is not the active leader (leader: '${this.currentLease.leaderIdentityKey}')`,
      )
    }

    if (this.currentLease.leaseExpiresAt <= now) {
      throw new StaleLeaderLeaseError(
        `AutoGit leader lease expired at ${this.currentLease.leaseExpiresAt} (now: ${now})`,
      )
    }

    if (this.currentLease.leaseGeneration !== expectedGeneration) {
      throw new StaleLeaderLeaseError(
        `Fencing token mismatch: expected generation ${expectedGeneration}, but active generation is ${this.currentLease.leaseGeneration}`,
      )
    }
  }

  startRenewalLoop(onRenew: () => Promise<AutoGitLease>): void {
    if (this.renewalTimer) return

    this.renewalTimer = setInterval(async () => {
      if (!this.isLeader || this.isRenewing) return

      this.isRenewing = true
      try {
        const renewed = await onRenew()
        this.updateLease(renewed)
      } catch (err) {
        console.warn("[LeaderLeaseClient] Lease renewal failed:", err)
      } finally {
        this.isRenewing = false
      }
    }, LEASE_RENEWAL_INTERVAL_MS)
  }

  stopRenewalLoop(): void {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer)
      this.renewalTimer = null
    }
  }
}
