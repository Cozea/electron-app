import { describe, expect, it, vi } from "vitest"

import type { LocalWorkspaceRecord } from "@shared/workspaceTypes"
import type {
  EnsureDesktopSessionWorkbenchRequest,
  EnsureDesktopSessionWorkbenchResponse,
} from "@shared/electronApiTypes"
import {
  describeInviteeCopy,
  ensureInviteeCopy,
  isCloneableBranchName,
  type InviteeSessionWorkbenchApi,
  type InviteeWorkspaceApi,
} from "../../apps/desktop/src/features/inbox/sessionCopy"

const REQUEST = {
  projectId: "proj_1",
  projectName: "Moliere App",
  publicSessionId: "czs_0123456789abcdef",
  branchName: "mml-rebuild",
  repositoryUrl: "https://github.com/acme/app.git",
}
const SESSION_ROOT = "/Users/me/Library/Application Support/Cozea/Collaboration/proj_1/czs_0123456789abcdef/repo"
const SESSION_WORKSPACE_ID = "ws_collab_czs_0123456789abcdef"

function readyResponse(): EnsureDesktopSessionWorkbenchResponse {
  return {
    success: true,
    rootPath: SESSION_ROOT,
    reused: false,
    workbench: {
      workbenchId: "wb_1",
      projectId: REQUEST.projectId,
      workspaceId: SESSION_WORKSPACE_ID,
      workspaceRevision: 1,
      kind: "collaboration",
      branchName: REQUEST.branchName,
      collaborationSessionId: REQUEST.publicSessionId,
      lifecycle: "active",
      title: "Moliere App · mml-rebuild",
      createdAt: 1,
      updatedAt: 1,
      lastActivatedAt: 1,
      presentationStateRef: "presentation:wb_1",
    },
    workspace: {
      workspaceId: SESSION_WORKSPACE_ID,
      projectId: REQUEST.projectId,
      label: null,
      displayPath: SESSION_ROOT,
      rootPath: SESSION_ROOT,
      projectRootRelativePath: ".",
      projectRootPath: SESSION_ROOT,
      gitRootPath: SESSION_ROOT,
      gitOriginUrl: REQUEST.repositoryUrl,
      gitRepoIdentity: null,
      verificationStatus: "verified",
      verificationReason: null,
      verifiedAt: 1,
      source: "clone",
      storageOwnership: "managed",
      managedRootId: "root_1",
      markerPolicy: "required",
      isActive: true,
      workspaceRevision: 1,
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
    },
  }
}

function fakeApis(options: {
  active?: Partial<LocalWorkspaceRecord> | null
  activeFails?: boolean
  ensure?: EnsureDesktopSessionWorkbenchResponse | Error
} = {}) {
  const getActiveForProject = vi.fn(async () => {
    if (options.activeFails) throw new Error("catalog unavailable")
    return (options.active ?? null) as LocalWorkspaceRecord | null
  })
  const ensureSession = vi.fn(async (_request: EnsureDesktopSessionWorkbenchRequest) => {
    if (options.ensure instanceof Error) throw options.ensure
    return options.ensure ?? readyResponse()
  })
  const workspaceApi: InviteeWorkspaceApi = { getActiveForProject }
  const workbenchApi: InviteeSessionWorkbenchApi = { ensureSession }
  return { workspaceApi, workbenchApi, getActiveForProject, ensureSession }
}

describe("setting up an invitee's Session Workbench", () => {
  it("uses an existing project folder only as a clone source", async () => {
    const apis = fakeApis({ active: { workspaceId: "ordinary_ws", projectRootPath: "/Users/me/src/app" } })

    const outcome = await ensureInviteeCopy(REQUEST, apis.workspaceApi, apis.workbenchApi)

    expect(outcome).toEqual({
      kind: "ready",
      rootPath: SESSION_ROOT,
      workspaceId: SESSION_WORKSPACE_ID,
      repository: "github.com/acme/app",
    })
    expect(apis.ensureSession).toHaveBeenCalledWith(expect.objectContaining({
      sourceWorkspaceId: "ordinary_ws",
      includeDirtyChanges: false,
      setActive: true,
    }))
  })

  it("asks main/projectd for a dedicated clone on the session branch", async () => {
    const apis = fakeApis()

    await ensureInviteeCopy(REQUEST, apis.workspaceApi, apis.workbenchApi)

    expect(apis.ensureSession).toHaveBeenCalledWith({
      projectId: REQUEST.projectId,
      publicSessionId: REQUEST.publicSessionId,
      branchName: REQUEST.branchName,
      baseBranch: REQUEST.branchName,
      createBranch: false,
      title: "Moliere App · mml-rebuild",
      sourceRepoUrl: REQUEST.repositoryUrl,
      sourceWorkspaceId: null,
      includeDirtyChanges: false,
      setActive: true,
    })
  })

  it("preserves credential-bearing HTTPS remotes for Git after the user accepted the invite", async () => {
    const apis = fakeApis()
    const repositoryUrl = "https://ghp_token@github.com/acme/app.git"

    await ensureInviteeCopy({ ...REQUEST, repositoryUrl }, apis.workspaceApi, apis.workbenchApi)

    expect(apis.ensureSession.mock.calls[0]?.[0].sourceRepoUrl).toBe(repositoryUrl)
  })

  it("uses the remote even when the ordinary workspace catalog is temporarily unreadable", async () => {
    const apis = fakeApis({ activeFails: true })
    expect((await ensureInviteeCopy(REQUEST, apis.workspaceApi, apis.workbenchApi)).kind).toBe("ready")
  })

  it("reports no source when this Mac has no project copy and the session has no safe remote", async () => {
    for (const repositoryUrl of [null, "file:///etc", "--upload-pack=touch /tmp/x", "ext::sh"]) {
      const apis = fakeApis()
      expect(await ensureInviteeCopy({ ...REQUEST, repositoryUrl }, apis.workspaceApi, apis.workbenchApi)).toEqual({
        kind: "no_repository",
      })
      expect(apis.ensureSession).not.toHaveBeenCalled()
    }
  })

  it("refuses branch names Git could read as options or revisions", async () => {
    for (const branchName of ["--upload-pack=x", "a..b", "main~1", "HEAD@{1}", "with space", "ends.lock", ""]) {
      const apis = fakeApis()
      const outcome = await ensureInviteeCopy({ ...REQUEST, branchName }, apis.workspaceApi, apis.workbenchApi)
      expect(outcome.kind, branchName).toBe("failed")
      expect(apis.ensureSession).not.toHaveBeenCalled()
    }
    expect(isCloneableBranchName("feature/live-session_2")).toBe(true)
  })

  it("explains Git access and missing-branch failures", async () => {
    const denied = fakeApis({
      ensure: { success: false, error: "git clone failed: remote: Repository not found." },
    })
    expect(await ensureInviteeCopy(REQUEST, denied.workspaceApi, denied.workbenchApi)).toEqual({
      kind: "failed",
      message: "Git on this Mac can't read github.com/acme/app. Update this Mac's Git credentials and retry.",
    })

    const noBranch = fakeApis({
      ensure: new Error("git clone failed: warning: Remote branch mml-rebuild not found in upstream origin"),
    })
    expect(await ensureInviteeCopy(REQUEST, noBranch.workspaceApi, noBranch.workbenchApi)).toEqual({
      kind: "failed",
      message: "github.com/acme/app has no branch mml-rebuild.",
    })
  })

  it("reports when this build cannot prepare Session Workbenches", async () => {
    const apis = fakeApis()
    expect((await ensureInviteeCopy(REQUEST, apis.workspaceApi, undefined)).kind).toBe("failed")
  })

  it("describes the resulting dedicated workbench", () => {
    expect(
      describeInviteeCopy(
        { kind: "ready", rootPath: SESSION_ROOT, workspaceId: SESSION_WORKSPACE_ID, repository: "github.com/acme/app" },
        REQUEST.branchName,
      ),
    ).toContain("Session Workbench")
    expect(describeInviteeCopy({ kind: "no_repository" }, REQUEST.branchName)).toContain("no Git remote")
  })
})
