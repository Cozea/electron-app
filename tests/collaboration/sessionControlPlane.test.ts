import { describe, expect, it } from "vitest"

import type {
  SessionAccessMode,
  SessionLifecycle,
} from "@shared/collaboration"

interface MockSessionRecord {
  sessionId: string
  publicSessionId: string
  projectId: string
  branchName: string
  targetBranch: string
  lifecycle: SessionLifecycle
  accessMode: SessionAccessMode
  createdBy: string
}

interface MockMember {
  sessionId: string
  principalId: string
  role: "viewer" | "developer" | "project_manager"
  status: "active" | "left" | "revoked"
}

interface MockInvite {
  sessionId: string
  targetPrincipalId: string
  status: "pending" | "accepted" | "revoked"
}

class MockControlPlane {
  sessions = new Map<string, MockSessionRecord>()
  members: MockMember[] = []
  invites: MockInvite[] = []
  projectMembers = new Map<string, Set<string>>() // projectId -> Set of principalIds

  createSession(params: {
    projectId: string
    branchName: string
    targetBranch: string
    accessMode: SessionAccessMode
    creatorPrincipalId: string
  }): MockSessionRecord {
    // Branch uniqueness check: no duplicate non-closed session for same branch (Section 6.1)
    for (const s of this.sessions.values()) {
      if (s.projectId === params.projectId && s.branchName === params.branchName && s.lifecycle !== "CLOSED") {
        throw new Error(`A non-closed collaboration session already exists for branch '${params.branchName}'`)
      }
    }

    const sessionId = `sess_${crypto.randomUUID().slice(0, 8)}`
    const record: MockSessionRecord = {
      sessionId,
      publicSessionId: `czs_${crypto.randomUUID().slice(0, 12)}`,
      projectId: params.projectId,
      branchName: params.branchName,
      targetBranch: params.targetBranch,
      lifecycle: "ACTIVE",
      accessMode: params.accessMode,
      createdBy: params.creatorPrincipalId,
    }

    this.sessions.set(sessionId, record)
    this.members.push({
      sessionId,
      principalId: params.creatorPrincipalId,
      role: "project_manager",
      status: "active",
    })

    // Ensure creator is in project
    const pMembers = this.projectMembers.get(params.projectId) ?? new Set()
    pMembers.add(params.creatorPrincipalId)
    this.projectMembers.set(params.projectId, pMembers)

    return record
  }

  createInvite(sessionId: string, targetPrincipalId: string): void {
    this.invites.push({
      sessionId,
      targetPrincipalId,
      status: "pending",
    })
  }

  joinSession(sessionId: string, principalId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error("Session not found")
    if (session.lifecycle === "CLOSED") throw new Error("Cannot join closed collaboration session")

    // Check revoked
    const existing = this.members.find((m) => m.sessionId === sessionId && m.principalId === principalId)
    if (existing?.status === "revoked") {
      throw new Error("Device access revoked")
    }

    // Access mode check
    if (session.accessMode === "invite_only") {
      const invite = this.invites.find(
        (i) => i.sessionId === sessionId && i.targetPrincipalId === principalId && i.status === "pending",
      )
      if (!invite && session.createdBy !== principalId) {
        throw new Error("Outsider denied: invitation required for invite-only session")
      }
      if (invite) {
        invite.status = "accepted"
      }
    }

    // Atomically ensure project membership (Section 6.1 / 6.3)
    const pMembers = this.projectMembers.get(session.projectId) ?? new Set()
    pMembers.add(principalId)
    this.projectMembers.set(session.projectId, pMembers)

    if (existing) {
      existing.status = "active"
    } else {
      this.members.push({
        sessionId,
        principalId,
        role: "developer",
        status: "active",
      })
    }

    // Dormant resume
    if (session.lifecycle === "DORMANT") {
      session.lifecycle = "ACTIVE"
    }
  }

  leaveSession(sessionId: string, principalId: string): void {
    const member = this.members.find((m) => m.sessionId === sessionId && m.principalId === principalId)
    if (member) {
      member.status = "left"
    }
    const active = this.members.filter((m) => m.sessionId === sessionId && m.status === "active")
    if (active.length === 0) {
      const s = this.sessions.get(sessionId)
      if (s && s.lifecycle === "ACTIVE") {
        s.lifecycle = "DORMANT"
      }
    }
  }
}

describe("P12 session control plane and invitation/access model", () => {
  it("prevents duplicate active sessions for the same branch", () => {
    const cp = new MockControlPlane()
    cp.createSession({
      projectId: "proj_1",
      branchName: "feature/login",
      targetBranch: "main",
      accessMode: "invite_only",
      creatorPrincipalId: "p_alice",
    })

    // Attempt to create second session on same branch -> rejected
    expect(() =>
      cp.createSession({
        projectId: "proj_1",
        branchName: "feature/login",
        targetBranch: "main",
        accessMode: "invite_only",
        creatorPrincipalId: "p_bob",
      }),
    ).toThrow(/already exists/)
  })

  it("atomically grants project membership upon session invite acceptance", () => {
    const cp = new MockControlPlane()
    const session = cp.createSession({
      projectId: "proj_alpha",
      branchName: "feature/checkout",
      targetBranch: "main",
      accessMode: "invite_only",
      creatorPrincipalId: "p_creator",
    })

    // Bob is NOT in project yet
    expect(cp.projectMembers.get("proj_alpha")?.has("p_bob")).toBeFalsy()

    // Invite Bob to session
    cp.createInvite(session.sessionId, "p_bob")

    // Bob joins session
    cp.joinSession(session.sessionId, "p_bob")

    // Bob is now in both session and project atomically!
    expect(cp.projectMembers.get("proj_alpha")?.has("p_bob")).toBe(true)
    const member = cp.members.find((m) => m.sessionId === session.sessionId && m.principalId === "p_bob")
    expect(member?.status).toBe("active")
  })

  it("denies outsiders on invite-only sessions", () => {
    const cp = new MockControlPlane()
    const session = cp.createSession({
      projectId: "proj_secure",
      branchName: "feature/audit",
      targetBranch: "main",
      accessMode: "invite_only",
      creatorPrincipalId: "p_admin",
    })

    // Eve tries to join without an invite -> rejected
    expect(() => cp.joinSession(session.sessionId, "p_eve")).toThrow(/Outsider denied/)
  })

  it("denies revoked devices from rejoining", () => {
    const cp = new MockControlPlane()
    const session = cp.createSession({
      projectId: "proj_x",
      branchName: "main",
      targetBranch: "main",
      accessMode: "organization_available",
      creatorPrincipalId: "p_admin",
    })

    cp.joinSession(session.sessionId, "p_charlie")
    const member = cp.members.find((m) => m.sessionId === session.sessionId && m.principalId === "p_charlie")!
    member.status = "revoked"

    // Rejoin rejected
    expect(() => cp.joinSession(session.sessionId, "p_charlie")).toThrow(/revoked/)
  })

  it("transitions to DORMANT when all members leave, and resumes to ACTIVE on join", () => {
    const cp = new MockControlPlane()
    const session = cp.createSession({
      projectId: "proj_dormant",
      branchName: "feature/dormant",
      targetBranch: "main",
      accessMode: "organization_available",
      creatorPrincipalId: "p_solo",
    })

    expect(session.lifecycle).toBe("ACTIVE")

    // Solo member leaves
    cp.leaveSession(session.sessionId, "p_solo")
    expect(session.lifecycle).toBe("DORMANT")

    // Member rejoins -> resumes to ACTIVE
    cp.joinSession(session.sessionId, "p_solo")
    expect(session.lifecycle).toBe("ACTIVE")
  })

  it("denies joining closed sessions", () => {
    const cp = new MockControlPlane()
    const session = cp.createSession({
      projectId: "proj_closed",
      branchName: "feature/done",
      targetBranch: "main",
      accessMode: "organization_available",
      creatorPrincipalId: "p_owner",
    })

    session.lifecycle = "CLOSED"
    expect(() => cp.joinSession(session.sessionId, "p_joiner")).toThrow(/closed/)
  })
})
