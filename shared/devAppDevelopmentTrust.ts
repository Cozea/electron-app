import {
  grantFingerprint,
  normalizeGrant,
  type DevAppCapability,
  type DevAppGrant,
} from "./devAppCapabilities"

/**
 * Trust for a DevApp being developed on this machine.
 *
 * Development trust is provisional in three specific ways, each of which is a decision
 * rather than a limitation:
 *
 * It is never persisted. A grant lives in memory for one Cozea session, so a package
 * that was trusted while its author was iterating cannot silently hold that trust the
 * next time the app starts — or after the directory has become something else.
 *
 * It shares no namespace with published approvals. Approving a published release grants
 * that release; it does not grant a local directory claiming to be the same app, and the
 * reverse is equally true. There is no key either side can compute that collides.
 *
 * It is not weaker than published trust. "Provisional" means shorter-lived and clearly
 * labelled, not laxer: the same capabilities are asked for, and escalating ones are still
 * escalating.
 */

/** Prefix keeping development approvals out of the published `worker:` namespace. */
const DEVELOPMENT_APPROVAL_PREFIX = "devworker"

/** How long a development grant stands before it must be asked for again. */
export const DEVELOPMENT_GRANT_TTL_MS = 12 * 60 * 60 * 1000

export interface DevAppDevelopmentApproval {
  sourceId: string
  grant: DevAppGrant
  /** Epoch milliseconds. Past this, the grant is gone whether or not anything asked. */
  expiresAt: number
}

/**
 * The key a development approval binds to.
 *
 * Deliberately not the same shape as `devAppGrantApprovalKey`: that one binds a
 * publication and a content hash, neither of which a working tree has. Keying on the
 * source id plus what was asked for means editing the manifest to ask for more forces a
 * fresh prompt, while editing code does not.
 */
export function developmentApprovalKey(sourceId: string, grant: DevAppGrant): string {
  return `${DEVELOPMENT_APPROVAL_PREFIX}:${sourceId}:${grantFingerprint(grant)}`
}

export type DevAppDevelopmentTrustState =
  /** Nothing approved, or what was approved no longer covers what is asked for. */
  | { status: "unapproved"; requested: DevAppGrant; missing: DevAppCapability[]; needsAgentInvocable: boolean }
  /** Approved and in force. `effective` is what the app actually runs with. */
  | { status: "approved"; effective: DevAppGrant; expiresAt: number }
  | { status: "expired"; requested: DevAppGrant }

/**
 * Holds development approvals for the life of the process.
 *
 * The clock is injected so expiry is testable without waiting, and because a store whose
 * correctness depends on real time is a store nobody tests the boundary of.
 */
export class DevAppDevelopmentTrustStore {
  private readonly approvals = new Map<string, DevAppDevelopmentApproval>()
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(now: () => number, ttlMs: number = DEVELOPMENT_GRANT_TTL_MS) {
    this.now = now
    this.ttlMs = ttlMs
  }

  /** Records a person's approval of exactly what was shown to them. */
  approve(sourceId: string, grant: DevAppGrant): DevAppDevelopmentApproval {
    const approval: DevAppDevelopmentApproval = {
      sourceId,
      grant: normalizeGrant(grant),
      expiresAt: this.now() + this.ttlMs,
    }
    this.approvals.set(sourceId, approval)
    return approval
  }

  /**
   * Decides what a development package may run with right now.
   *
   * The effective grant is what the manifest currently asks for, never what was once
   * approved — so an app that narrows its request runs narrowed, without a new prompt and
   * without quietly retaining the wider grant.
   */
  resolve(sourceId: string, requestedInput: DevAppGrant): DevAppDevelopmentTrustState {
    const requested = normalizeGrant(requestedInput)
    const approval = this.approvals.get(sourceId)

    if (!approval) {
      return {
        status: "unapproved",
        requested,
        missing: [...requested.capabilities],
        needsAgentInvocable: requested.agentInvocable,
      }
    }

    if (approval.expiresAt <= this.now()) {
      this.approvals.delete(sourceId)
      return { status: "expired", requested }
    }

    const missing = requested.capabilities.filter(
      (capability) => !approval.grant.capabilities.includes(capability),
    )
    const needsAgentInvocable = requested.agentInvocable && !approval.grant.agentInvocable
    if (missing.length > 0 || needsAgentInvocable) {
      // Asking for more than was approved is a new question, not a partial answer.
      return { status: "unapproved", requested, missing, needsAgentInvocable }
    }

    return { status: "approved", effective: requested, expiresAt: approval.expiresAt }
  }

  revoke(sourceId: string): void {
    this.approvals.delete(sourceId)
  }

  /** Drops every approval — session end, sign-out, or a user asking to reset trust. */
  revokeAll(): void {
    this.approvals.clear()
  }

  /** Approvals still in force, for a settings surface that lists what is trusted. */
  list(): DevAppDevelopmentApproval[] {
    const now = this.now()
    for (const [sourceId, approval] of Array.from(this.approvals.entries())) {
      if (approval.expiresAt <= now) this.approvals.delete(sourceId)
    }
    return Array.from(this.approvals.values())
  }
}

/**
 * What the tile says about where its content came from.
 *
 * A development build is visually indistinguishable from a published one otherwise, and
 * the difference matters: unreviewed code, provisional trust, and a package that may not
 * even build. The badge is the only thing standing between those two states for a user,
 * so it is derived here rather than assembled per-renderer.
 */
export interface DevAppTrustBadge {
  tone: "development" | "published"
  label: string
  detail: string
}

export function developmentTrustBadge(state: DevAppDevelopmentTrustState): DevAppTrustBadge {
  if (state.status === "approved") {
    return {
      tone: "development",
      label: "Development",
      detail: state.effective.capabilities.length > 0
        ? "Unpublished code running with capabilities you granted for this session."
        : "Unpublished code. It has not been granted any capabilities.",
    }
  }
  if (state.status === "expired") {
    return {
      tone: "development",
      label: "Development",
      detail: "This session's approval has expired. It needs granting again to run.",
    }
  }
  return {
    tone: "development",
    label: "Development",
    detail: "Unpublished code awaiting approval for what it asks to do.",
  }
}
