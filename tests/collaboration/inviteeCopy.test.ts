import { describe, expect, it, vi } from "vitest"

import type {
  CloneWorkspaceForProjectRequest,
  CloneWorkspaceForProjectResult,
  LocalWorkspaceDTO,
  LocalWorkspaceRecord,
} from "@shared/workspaceTypes"
import {
  describeInviteeCopy,
  ensureInviteeCopy,
  isCloneableBranchName,
  type InviteeWorkspaceApi,
} from "../../apps/desktop/src/features/inbox/sessionCopy"

/**
 * An invitee who accepts a live session without a copy of the project gets the
 * session's recorded remote cloned on the session branch. The workspace catalog is
 * simulated; nothing here runs Git.
 */

const REQUEST = {
  projectId: "proj_1",
  projectName: "Moliere App",
  branchName: "mml-rebuild",
  repositoryUrl: "https://github.com/acme/app.git",
}
const CLONED_ROOT = "/Users/me/Developer/Cozea/moliere-app"

function fakeWorkspaceApi(
  options: { active?: Partial<LocalWorkspaceRecord> | null; clone?: CloneWorkspaceForProjectResult | Error; activeFails?: boolean } = {},
) {
  const getActiveForProject = vi.fn(async (_projectId: string) => {
    if (options.activeFails) throw new Error("catalog unavailable")
    return (options.active ?? null) as LocalWorkspaceRecord | null
  })
  const cloneForProject = vi.fn(async (_req: CloneWorkspaceForProjectRequest): Promise<CloneWorkspaceForProjectResult> => {
    if (options.clone instanceof Error) throw options.clone
    return options.clone ?? { success: true, workspace: { projectRootPath: CLONED_ROOT } as LocalWorkspaceDTO }
  })
  const api: InviteeWorkspaceApi = { getActiveForProject, cloneForProject }
  return { api, getActiveForProject, cloneForProject }
}

describe("setting up an invitee's copy", () => {
  it("uses the folder this Mac already has for the project", async () => {
    const workspace = fakeWorkspaceApi({ active: { projectRootPath: "/Users/me/src/app" } })

    expect(await ensureInviteeCopy(REQUEST, workspace.api)).toEqual({ kind: "existing", rootPath: "/Users/me/src/app" })
    expect(workspace.cloneForProject).not.toHaveBeenCalled()
  })

  it("clones the session's remote on the session branch into a managed folder", async () => {
    const workspace = fakeWorkspaceApi()

    const outcome = await ensureInviteeCopy(REQUEST, workspace.api)

    expect(outcome).toEqual({ kind: "cloned", rootPath: CLONED_ROOT, repository: "github.com/acme/app" })
    expect(workspace.cloneForProject).toHaveBeenCalledWith({
      projectId: "proj_1",
      slug: "moliere-app",
      repoUrl: "https://github.com/acme/app.git",
      branch: "mml-rebuild",
      setActive: true,
    })
  })

  it("treats an unreadable catalog as no folder yet", async () => {
    const workspace = fakeWorkspaceApi({ activeFails: true })

    expect((await ensureInviteeCopy(REQUEST, workspace.api)).kind).toBe("cloned")
  })

  it("never hands Git a credential or an unsafe remote from the session record", async () => {
    const withToken = fakeWorkspaceApi()
    await ensureInviteeCopy({ ...REQUEST, repositoryUrl: "https://ghp_token@github.com/acme/app.git" }, withToken.api)
    expect(withToken.cloneForProject.mock.calls[0]?.[0].repoUrl).toBe("https://github.com/acme/app.git")

    for (const repositoryUrl of [null, "file:///etc", "--upload-pack=touch /tmp/x", "ext::sh"]) {
      const workspace = fakeWorkspaceApi()
      expect(await ensureInviteeCopy({ ...REQUEST, repositoryUrl }, workspace.api)).toEqual({ kind: "no_repository" })
      expect(workspace.cloneForProject).not.toHaveBeenCalled()
    }
  })

  it("refuses branch names Git could read as options or revisions", async () => {
    for (const branchName of ["--upload-pack=x", "a..b", "main~1", "HEAD@{1}", "with space", "ends.lock", ""]) {
      const workspace = fakeWorkspaceApi()
      const outcome = await ensureInviteeCopy({ ...REQUEST, branchName }, workspace.api)
      expect(outcome.kind, branchName).toBe("failed")
      expect(workspace.cloneForProject).not.toHaveBeenCalled()
    }
    expect(isCloneableBranchName("feature/live-session_2")).toBe(true)
  })

  it("explains clone failures in terms of access and branches", async () => {
    const denied = fakeWorkspaceApi({ clone: { success: false, error: "git clone failed: remote: Repository not found." } })
    expect(await ensureInviteeCopy(REQUEST, denied.api)).toEqual({
      kind: "failed",
      message:
        "Git on this Mac can't read github.com/acme/app. Get access to it, then link a copy with Relink Local Folder.",
    })

    const noBranch = fakeWorkspaceApi({
      clone: new Error("git clone failed: warning: Remote branch mml-rebuild not found in upstream origin"),
    })
    expect(await ensureInviteeCopy(REQUEST, noBranch.api)).toEqual({
      kind: "failed",
      message: "github.com/acme/app has no branch mml-rebuild.",
    })
  })

  it("reports when this build cannot set up folders", async () => {
    expect((await ensureInviteeCopy(REQUEST, undefined)).kind).toBe("failed")
  })

  it("tells the invitee what happened", () => {
    expect(describeInviteeCopy({ kind: "cloned", rootPath: CLONED_ROOT, repository: "github.com/acme/app" }, "mml-rebuild")).toBe(
      `Cozea cloned github.com/acme/app on mml-rebuild into ${CLONED_ROOT}. Open the project to start syncing.`,
    )
    expect(describeInviteeCopy({ kind: "no_repository" }, "mml-rebuild")).toContain("Relink Local Folder")
  })
})
