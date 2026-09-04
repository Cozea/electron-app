import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { downloadAuthorizedProjectRepository } from "@/features/collaboration/api/downloadAuthorizedProjectRepository"

const mocks = vi.hoisted(() => ({ query: vi.fn(), credential: vi.fn(), auth: vi.fn() }))
vi.mock("@/lib/convex", () => ({ convex: { query: mocks.query } }))
vi.mock("@/features/collaboration/api/collaborationGatewayClient", () => ({
  requestCollaborationRepositoryCredential: mocks.credential,
  repositoryGitAuthOptions: mocks.auth,
}))
const binding = { enabled: true, repositoryId: "github:1", repositoryNumericId: "1", fullName: "owner/repo", cloneUrl: "https://github.com/owner/repo.git", defaultBranch: "main" }
beforeEach(() => { vi.resetAllMocks(); mocks.query.mockResolvedValue(binding) })
afterEach(() => vi.unstubAllGlobals())

describe("authorized repository download", () => {
  it.each(["repositoryId", "repositoryNumericId", "defaultBranch", "fullName", "cloneUrl"])("rejects a changed %s before any filesystem mutation", async (field) => {
    const create = vi.fn()
    vi.stubGlobal("window", { electronAPI: { workspace: { createForProject: create } } })
    mocks.credential.mockResolvedValue({ ...binding, [field]: "changed" })
    await expect(downloadAuthorizedProjectRepository({ projectId: "p", slug: "repo" })).rejects.toThrow(/binding changed/)
    expect(create).not.toHaveBeenCalled()
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it("uses the matching authorized URL and branch for all Git operations", async () => {
    const ensure = vi.fn(async () => ({ success: true }))
    const fetch = vi.fn(async () => ({ success: true }))
    const restore = vi.fn(async () => ({ success: true }))
    const workspace = { workspaceId: "w" }
    vi.stubGlobal("window", { electronAPI: {
      workspace: { createForProject: vi.fn(async () => ({ success: true, workspace })), verify: vi.fn(async () => ({ workspace })), trashManagedWorkspace: vi.fn() },
      workspaceSync: { gitEnsureRepo: ensure, gitFetchMain: fetch, gitRestoreMain: restore },
    } })
    mocks.credential.mockResolvedValue({ ...binding, operation: "read", token: "fixture" })
    mocks.auth.mockReturnValue({ provider: "github", extraHeader: "fixture-header" })
    await downloadAuthorizedProjectRepository({ projectId: "p", slug: "repo" })
    expect(mocks.credential).toHaveBeenCalledWith({ projectId: "p", operation: "read" })
    expect(ensure).toHaveBeenCalledWith(expect.objectContaining({ repoUrl: binding.cloneUrl, branch: "main" }))
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ branch: "main" }))
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ repoUrl: binding.cloneUrl, branch: "main" }))
  })
})
