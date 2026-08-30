import { describe, expect, it } from "vitest"

import {
  ALL_DEV_APP_CAPABILITIES,
  CAPABILITY_DESCRIPTIONS,
  ESCALATING_CAPABILITIES,
  grantFingerprint,
  grantsUnrestrictedAccess,
  isDevAppCapability,
  normalizeCapabilities,
  normalizeGrant,
  trustTierFor,
  type DevAppCapability,
} from "../../shared/devAppCapabilities"

describe("Capability vocabulary — completeness", () => {
  // The stress cases named in the plan: if the two hardest built-ins cannot be described
  // without a catch-all capability, the vocabulary is wrong.
  it("expresses what a Terminal needs", () => {
    const capabilities: DevAppCapability[] = ["terminal.spawn", "project.read"]
    expect(normalizeCapabilities(capabilities)).toHaveLength(2)
    expect(trustTierFor(capabilities)).toBe("privileged")
  })

  it("expresses what a Dev Server needs", () => {
    const capabilities: DevAppCapability[] = ["process.spawn", "project.read", "project.metadata"]
    expect(normalizeCapabilities(capabilities)).toHaveLength(3)
    expect(trustTierFor(capabilities)).toBe("privileged")
  })

  it("describes every capability in the vocabulary", () => {
    for (const capability of ALL_DEV_APP_CAPABILITIES) {
      expect(CAPABILITY_DESCRIPTIONS[capability], `${capability} has no description`).toBeTruthy()
    }
  })

  it("assigns every capability a tier", () => {
    for (const capability of ALL_DEV_APP_CAPABILITIES) {
      expect(trustTierFor([capability])).not.toBe("sandboxed")
    }
  })
})

describe("Capability vocabulary — scope is part of identity", () => {
  // The single most important distinction, and one the existing IPC surface already
  // makes: project.readFile takes a workspaceId and authorizes against it, while
  // fs.readFile takes an absolute path and does not.
  it("treats project-scoped and machine-wide reads as different capabilities", () => {
    expect(trustTierFor(["project.read"])).toBe("scoped")
    expect(trustTierFor(["fs.read"])).toBe("privileged")
  })

  it("keeps a project-scoped app out of the privileged tier", () => {
    expect(trustTierFor(["project.read", "project.write", "git.read", "git.write"])).toBe("scoped")
  })
})

describe("Capability vocabulary — escalation is not a tier step", () => {
  it("treats spawning as conferring everything", () => {
    for (const capability of ESCALATING_CAPABILITIES) {
      expect(grantsUnrestrictedAccess([capability]), `${capability} understated`).toBe(true)
    }
  })

  it("does not let a modest-looking set hide an escalating capability", () => {
    // "read this project, and also run commands" must not read as a scoped grant.
    expect(grantsUnrestrictedAccess(["project.read", "terminal.spawn"])).toBe(true)
    expect(trustTierFor(["project.read", "terminal.spawn"])).toBe("privileged")
  })

  it("does not claim unrestricted access for genuinely bounded grants", () => {
    expect(grantsUnrestrictedAccess(["project.read", "project.write", "net.outbound"])).toBe(false)
  })

  it("reports no capabilities as sandboxed", () => {
    expect(trustTierFor([])).toBe("sandboxed")
    expect(grantsUnrestrictedAccess([])).toBe(false)
  })
})

describe("Capability vocabulary — approval binding", () => {
  // If declaration order changed the fingerprint, reordering a manifest list would
  // silently revoke a grant the user already made.
  it("produces the same fingerprint regardless of declaration order", () => {
    const a = grantFingerprint({ capabilities: ["project.read", "git.read"], agentInvocable: false })
    const b = grantFingerprint({ capabilities: ["git.read", "project.read"], agentInvocable: false })
    expect(a).toBe(b)
  })

  it("produces the same fingerprint despite duplicates", () => {
    const a = grantFingerprint(normalizeGrant({ capabilities: ["project.read", "project.read"] }))
    const b = grantFingerprint({ capabilities: ["project.read"], agentInvocable: false })
    expect(a).toBe(b)
  })

  it("changes the fingerprint when a capability is added", () => {
    const before = grantFingerprint({ capabilities: ["project.read"], agentInvocable: false })
    const after = grantFingerprint({ capabilities: ["project.read", "project.write"], agentInvocable: false })
    expect(before).not.toBe(after)
  })

  it("changes the fingerprint when agent invocation is enabled", () => {
    // Same capabilities, different proposition — this must force re-approval.
    const watched = grantFingerprint({ capabilities: ["project.write"], agentInvocable: false })
    const autonomous = grantFingerprint({ capabilities: ["project.write"], agentInvocable: true })
    expect(watched).not.toBe(autonomous)
  })

  it("carries a version marker so the format can change later", () => {
    expect(grantFingerprint({ capabilities: [], agentInvocable: false })).toMatch(/^v1;/)
  })
})

describe("Capability vocabulary — rejecting unknown input", () => {
  // Manifests are authored by org members and by agents, so an unrecognized capability
  // must be dropped rather than granted or silently passed through.
  it("drops capabilities outside the vocabulary", () => {
    expect(normalizeCapabilities(["project.read", "fs.destroy", "root", ""])).toEqual(["project.read"])
  })

  it("drops non-string entries", () => {
    expect(normalizeCapabilities([null, 42, {}, ["project.read"], "git.read"])).toEqual(["git.read"])
  })

  it("does not treat a near-miss as a real capability", () => {
    expect(isDevAppCapability("project.readFile")).toBe(false)
    expect(isDevAppCapability("PROJECT.READ")).toBe(false)
    expect(isDevAppCapability("project.read")).toBe(true)
  })

  it("defaults agent invocation to off for anything but an explicit true", () => {
    expect(normalizeGrant({ agentInvocable: "true" }).agentInvocable).toBe(false)
    expect(normalizeGrant({ agentInvocable: 1 }).agentInvocable).toBe(false)
    expect(normalizeGrant({}).agentInvocable).toBe(false)
    expect(normalizeGrant({ agentInvocable: true }).agentInvocable).toBe(true)
  })
})
