import { describe, expect, it } from "vitest"

import {
  asBarrierId,
  asBranchName,
  asProjectId,
  asRepositoryBindingId,
  asSessionId,
  asWorkbenchId,
  asWorkspaceId,
  type CollaborationSessionDescriptor,
  createOrdinaryWorkbench,
  createSessionWorkbench,
  InMemoryLocalProjectWorkbenchStore,
  isCollaborationActive,
  validateWorkbenchInvariants,
  WorkbenchInvariantError,
} from "@shared/collaboration"

describe("P01 canonical domain contracts & invariants", () => {
  const projectId = asProjectId("proj_test_123")
  const workspaceId = asWorkspaceId("ws_local_456")
  const branchName = asBranchName("feature/dashboard")
  const sessionId = asSessionId("session_789")

  describe("distinct identifier types", () => {
    it("validates non-empty strings and creates branded IDs", () => {
      expect(asWorkbenchId("wb_1")).toBe("wb_1")
      expect(asWorkspaceId("ws_1")).toBe("ws_1")
      expect(asSessionId("sess_1")).toBe("sess_1")
      expect(asBranchName("main")).toBe("main")
      expect(asProjectId("proj_1")).toBe("proj_1")
      expect(asRepositoryBindingId("repo_1")).toBe("repo_1")
      expect(asBarrierId("barrier_1")).toBe("barrier_1")

      expect(() => asWorkbenchId("")).toThrow(TypeError)
      expect(() => asWorkspaceId("")).toThrow(TypeError)
      expect(() => asSessionId("")).toThrow(TypeError)
      expect(() => asBranchName("")).toThrow(TypeError)
      expect(() => asProjectId("")).toThrow(TypeError)
    })
  })

  describe("workbench invariants", () => {
    it("creates an ordinary workbench and enforces null collaborationSessionId", () => {
      const wb = createOrdinaryWorkbench({
        projectId,
        workspaceId,
        branchName,
        title: "Main Dev Workbench",
      })

      expect(wb.kind).toBe("ordinary")
      expect(wb.collaborationSessionId).toBeNull()
      expect(wb.lifecycle).toBe("creating")

      // Invariant: Ordinary workbench cannot claim a collaborationSessionId
      const invalidWb = {
        ...wb,
        collaborationSessionId: sessionId,
      }
      expect(() => validateWorkbenchInvariants(invalidWb)).toThrow(WorkbenchInvariantError)
    })

    it("creates a session workbench and enforces non-null collaborationSessionId", () => {
      const wb = createSessionWorkbench({
        projectId,
        workspaceId,
        branchName,
        sessionId,
        title: "Session Workbench",
      })

      expect(wb.kind).toBe("collaboration")
      expect(wb.collaborationSessionId).toBe(sessionId)
      expect(wb.lifecycle).toBe("creating")

      // Invariant: Session workbench requires sessionId
      const invalidWb = {
        ...wb,
        collaborationSessionId: null,
      }
      expect(() => validateWorkbenchInvariants(invalidWb)).toThrow(WorkbenchInvariantError)
    })

    it("asserts branch equality cannot create collaboration membership (Invariant C06)", () => {
      const ordinaryWb = createOrdinaryWorkbench({
        projectId,
        workspaceId,
        branchName: asBranchName("collab-feature"),
        title: "Local Feature",
        lifecycle: "active",
      })

      const cloudSession: CollaborationSessionDescriptor = {
        sessionId,
        publicSessionId: "czs_123",
        projectId,
        repositoryBindingId: asRepositoryBindingId("repo_1"),
        sessionBranch: asBranchName("collab-feature"), // Same branch!
        targetBranch: asBranchName("main"),
        createdBy: "user_1",
        lifecycle: "ACTIVE",
        accessMode: "invite_only",
        organizationId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pausedAt: null,
        closedAt: null,
        lastDurableSeq: 10,
        lastSnapshotSeq: 10,
        lastAutoGitCheckpointSeq: null,
        lastAutoGitCommitOid: null,
      }

      // Despite having the exact same branch name ("collab-feature"),
      // ordinary workbench is NEVER collaborative!
      expect(isCollaborationActive(ordinaryWb, cloudSession)).toBe(false)

      // Now create a genuine Session Workbench enrolled in that session
      const sessionWb = createSessionWorkbench({
        projectId,
        workspaceId,
        branchName: asBranchName("collab-feature"),
        sessionId,
        title: "Collab Feature",
        lifecycle: "active",
      })

      expect(isCollaborationActive(sessionWb, cloudSession)).toBe(true)

      // If cloud session is not ACTIVE (e.g. PAUSED or DORMANT), collaboration is not active
      const pausedSession: CollaborationSessionDescriptor = {
        ...cloudSession,
        lifecycle: "PAUSED",
      }
      expect(isCollaborationActive(sessionWb, pausedSession)).toBe(false)
    })
  })

  describe("local workbench store & single active invariant (Invariant C29)", () => {
    it("allows one device to persist several workbenches for one project", async () => {
      const store = new InMemoryLocalProjectWorkbenchStore()

      const wb1 = createOrdinaryWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_1"),
        branchName: asBranchName("main"),
        title: "Main Workbench",
      })

      const wb2 = createOrdinaryWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_2"),
        branchName: asBranchName("feature/a"),
        title: "Feature A Workbench",
      })

      const wb3 = createSessionWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_collab"),
        branchName: asBranchName("feature/b"),
        sessionId,
        title: "Session Workbench",
      })

      await store.save(wb1)
      await store.save(wb2)
      await store.save(wb3)

      const list = await store.listByProject(projectId)
      expect(list).toHaveLength(3)
    })

    it("enforces exactly one active workbench per project (Invariant C29)", async () => {
      const store = new InMemoryLocalProjectWorkbenchStore()

      const wb1 = createOrdinaryWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_1"),
        title: "WB 1",
        lifecycle: "idle",
      })

      const wb2 = createOrdinaryWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_2"),
        title: "WB 2",
        lifecycle: "idle",
      })

      await store.save(wb1)
      await store.save(wb2)

      // Activate wb1
      const activate1 = await store.setActive(projectId, wb1.workbenchId)
      expect(activate1.activated.lifecycle).toBe("active")
      expect(activate1.idled).toBeNull()

      let active = await store.getActive(projectId)
      expect(active?.workbenchId).toBe(wb1.workbenchId)

      // Activate wb2 -> wb1 must become idled!
      const activate2 = await store.setActive(projectId, wb2.workbenchId)
      expect(activate2.activated.lifecycle).toBe("active")
      expect(activate2.activated.workbenchId).toBe(wb2.workbenchId)
      expect(activate2.idled?.workbenchId).toBe(wb1.workbenchId)
      expect(activate2.idled?.lifecycle).toBe("idle")

      active = await store.getActive(projectId)
      expect(active?.workbenchId).toBe(wb2.workbenchId)

      // Verify wb1 in store is indeed idle now
      const fetchedWb1 = await store.get(wb1.workbenchId)
      expect(fetchedWb1?.lifecycle).toBe("idle")
    })

    it("asserts switching local Workbench cannot pause global Session (Invariant C30)", async () => {
      const store = new InMemoryLocalProjectWorkbenchStore()

      const sessionWb = createSessionWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_collab"),
        branchName,
        sessionId,
        title: "Collab WB",
        lifecycle: "idle",
      })

      const ordinaryWb = createOrdinaryWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_main"),
        branchName: asBranchName("main"),
        title: "Main WB",
        lifecycle: "idle",
      })

      await store.save(sessionWb)
      await store.save(ordinaryWb)

      // Cloud session is ACTIVE
      const globalSession: CollaborationSessionDescriptor = {
        sessionId,
        publicSessionId: "czs_1",
        projectId,
        repositoryBindingId: asRepositoryBindingId("repo_1"),
        sessionBranch: branchName,
        targetBranch: asBranchName("main"),
        createdBy: "user_1",
        lifecycle: "ACTIVE",
        accessMode: "invite_only",
        organizationId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pausedAt: null,
        closedAt: null,
        lastDurableSeq: 1,
        lastSnapshotSeq: 1,
        lastAutoGitCheckpointSeq: null,
        lastAutoGitCommitOid: null,
      }

      // Activate session workbench
      await store.setActive(projectId, sessionWb.workbenchId)
      expect((await store.getActive(projectId))?.workbenchId).toBe(sessionWb.workbenchId)

      // Now user switches to ordinary workbench
      await store.setActive(projectId, ordinaryWb.workbenchId)

      const activeWb = await store.getActive(projectId)
      expect(activeWb?.workbenchId).toBe(ordinaryWb.workbenchId)

      const updatedSessionWb = await store.get(sessionWb.workbenchId)
      expect(updatedSessionWb?.lifecycle).toBe("idle")

      // Critical Invariant C30 assertion:
      // Idling the local Session Workbench does NOT pause the global session.
      // The global session remains ACTIVE.
      expect(globalSession.lifecycle).toBe("ACTIVE")
    })
  })
})
