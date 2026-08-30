import { describe, expect, it } from "vitest"

import {
  ALL_DEV_APP_CAPABILITIES,
  CAPABILITY_DESCRIPTIONS,
  devAppGrantApprovalKey,
  ESCALATING_CAPABILITIES,
  grantFingerprint,
  grantsUnrestrictedAccess,
  isAllowedShellOpenUrl,
  isDevAppCapability,
  resolveRevealTarget,
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

describe("shell.open — narrowed to web schemes", () => {
  it("allows the schemes a link actually needs", () => {
    expect(isAllowedShellOpenUrl("https://example.com/docs")).toBe(true)
    expect(isAllowedShellOpenUrl("http://localhost:3000")).toBe(true)
    expect(isAllowedShellOpenUrl("mailto:someone@example.com")).toBe(true)
  })

  it("refuses file: URLs, which browse the disk rather than the web", () => {
    expect(isAllowedShellOpenUrl("file:///Users/admin/.ssh/id_rsa")).toBe(false)
    expect(isAllowedShellOpenUrl("FILE:///etc/passwd")).toBe(false)
  })

  it("refuses custom app schemes, which reach installed handlers", () => {
    for (const url of ["vscode://file/etc/passwd", "slack://open", "ssh://host", "smb://share"]) {
      expect(isAllowedShellOpenUrl(url), `${url} allowed`).toBe(false)
    }
  })

  it("refuses malformed and over-long input", () => {
    expect(isAllowedShellOpenUrl("not a url")).toBe(false)
    expect(isAllowedShellOpenUrl("")).toBe(false)
    expect(isAllowedShellOpenUrl(`https://example.com/${"x".repeat(3000)}`)).toBe(false)
  })
})

describe("shell.reveal — bounded to the workspace and the app's own data", () => {
  const join = (root: string, rel: string) => `${root}/${rel}`
  const normalize = (value: string) => {
    const parts: string[] = []
    for (const segment of value.split("/")) {
      if (segment === "" || segment === ".") continue
      if (segment === "..") parts.pop()
      else parts.push(segment)
    }
    return `/${parts.join("/")}`
  }
  const roots = { workspaceRoot: "/Users/admin/proj", dataDir: "/Users/admin/data/pub_1" }

  it("resolves a location inside the workspace", () => {
    expect(resolveRevealTarget("workspace", "dist", roots, join, normalize)).toBe("/Users/admin/proj/dist")
    expect(resolveRevealTarget("workspace", "out/report.pdf", roots, join, normalize))
      .toBe("/Users/admin/proj/out/report.pdf")
  })

  it("resolves a location inside the app's own data directory", () => {
    expect(resolveRevealTarget("data", "logs", roots, join, normalize)).toBe("/Users/admin/data/pub_1/logs")
  })

  // The same relative path must mean exactly one place. Inferring the root from what
  // happens to exist would make the boundary depend on filesystem state.
  it("resolves the same relative path to different places per root, never ambiguously", () => {
    expect(resolveRevealTarget("workspace", "logs", roots, join, normalize)).toBe("/Users/admin/proj/logs")
    expect(resolveRevealTarget("data", "logs", roots, join, normalize)).toBe("/Users/admin/data/pub_1/logs")
  })

  it("refuses traversal out of either root", () => {
    expect(resolveRevealTarget("workspace", "../../.ssh", roots, join, normalize)).toBeNull()
    expect(resolveRevealTarget("workspace", "dist/../../../etc", roots, join, normalize)).toBeNull()
    expect(resolveRevealTarget("data", "../../proj/.env", roots, join, normalize)).toBeNull()
  })

  it("refuses an absolute path rather than reinterpreting it", () => {
    expect(resolveRevealTarget("workspace", "/etc/passwd", roots, join, normalize)).toBeNull()
  })

  it("refuses the data root when no data directory is configured", () => {
    const only = { workspaceRoot: "/Users/admin/proj" }
    expect(resolveRevealTarget("workspace", "dist", only, join, normalize)).toBe("/Users/admin/proj/dist")
    expect(resolveRevealTarget("data", "logs", only, join, normalize)).toBeNull()
  })

  it("keeps revealing a project folder in the scoped tier", () => {
    // Tier inflation is the real risk: if scoped cannot do the ordinary things a dev
    // tool does, every app declares fs.read and the tier stops meaning anything.
    expect(trustTierFor(["shell.reveal", "project.read"])).toBe("scoped")
  })
})

describe("Grant approval keys — separate from service approvals", () => {
  const hash = "a".repeat(64)

  it("namespaces worker grants so they cannot collide with service approvals", () => {
    // A service approval is `publicationId:contentHash:permissionSetHash`. If a worker
    // key could take that shape, one approval could satisfy the other.
    const key = devAppGrantApprovalKey("pub_1", hash, normalizeGrant({ capabilities: ["project.read"] }))
    expect(key.startsWith("worker:")).toBe(true)
    expect(key.split(":").length).toBeGreaterThan(3)
  })

  it("changes when the capabilities change", () => {
    const before = devAppGrantApprovalKey("pub_1", hash, normalizeGrant({ capabilities: ["project.read"] }))
    const after = devAppGrantApprovalKey("pub_1", hash, normalizeGrant({ capabilities: ["project.read", "project.write"] }))
    expect(before).not.toBe(after)
  })

  it("changes when agent invocation is enabled, forcing re-approval", () => {
    const watched = devAppGrantApprovalKey("pub_1", hash, normalizeGrant({ capabilities: ["project.write"] }))
    const autonomous = devAppGrantApprovalKey("pub_1", hash, normalizeGrant({ capabilities: ["project.write"], agentInvocable: true }))
    expect(watched).not.toBe(autonomous)
  })

  it("is stable across declaration order, so reordering does not revoke a grant", () => {
    const a = devAppGrantApprovalKey("pub_1", hash, normalizeGrant({ capabilities: ["git.read", "project.read"] }))
    const b = devAppGrantApprovalKey("pub_1", hash, normalizeGrant({ capabilities: ["project.read", "git.read"] }))
    expect(a).toBe(b)
  })

  it("binds to the release, so a new release re-asks", () => {
    const grant = normalizeGrant({ capabilities: ["project.read"] })
    expect(devAppGrantApprovalKey("pub_1", hash, grant))
      .not.toBe(devAppGrantApprovalKey("pub_1", "b".repeat(64), grant))
  })

  it("rejects malformed identifiers rather than recording an unusable key", () => {
    const grant = normalizeGrant({ capabilities: [] })
    expect(() => devAppGrantApprovalKey("pub 1", hash, grant)).toThrow()
    expect(() => devAppGrantApprovalKey("pub_1", "not-a-hash", grant)).toThrow()
  })
})
