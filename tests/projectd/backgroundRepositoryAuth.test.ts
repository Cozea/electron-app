import { expect, it, vi } from "vitest"
import { getFunctionName } from "convex/server"
import { BackgroundDeviceIdentityManager } from "../../apps/projectd/src/identity/BackgroundDeviceIdentity"
import {
  getBackgroundRepositoryCapabilities,
  getBackgroundRepositoryToken,
} from "../../apps/projectd/src/collaboration/BackgroundRepositoryAuth"

const cloud = vi.hoisted(() => ({ action: vi.fn(), setAuth: vi.fn() }))
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { action = cloud.action; setAuth = cloud.setAuth } }))

it("uses saved device authentication and accepts only live credentials for the exact project/repository", async () => {
  const manager = new BackgroundDeviceIdentityManager()
  const identity = await manager.generateNewIdentity()
  vi.spyOn(manager, "loadExistingIdentity").mockResolvedValue(identity)
  vi.spyOn(manager, "authenticateWithCloud").mockResolvedValue({ token: "device-token", principalId: "principal", expiresAt: Date.now() + 60_000 })
  const descriptor = { publicSessionId: "session", projectId: "project", workspaceId: "workspace", rootPath: "/unused",
    background: { gatewayUrl: "https://gateway.example", convexUrl: "https://example.convex.cloud" } }
  let result = { token: "repository-token", expiresAt: Date.now() + 3600_000, projectId: "project", repositoryUrl: "git@github.com:team/app.git" }
  cloud.action.mockImplementation(async (reference, args) => {
    expect(getFunctionName(reference)).toBe("sessionRepositoryCredentials:forPullRequest")
    expect(args).toEqual({ publicSessionId: "session" })
    return result
  })
  const get = () => getBackgroundRepositoryToken(descriptor, { owner: "team", repository: "app" }, manager)
  expect(await get()).toBe("repository-token")
  cloud.action.mockImplementationOnce(async (reference, args) => {
    expect(getFunctionName(reference)).toBe("sessionRepositoryCredentials:forGitWrite")
    expect(args).toEqual({ publicSessionId: "session" })
    return result
  })
  expect(await getBackgroundRepositoryToken(descriptor, { owner: "team", repository: "app" }, manager, "git_write")).toBe("repository-token")
  expect(cloud.setAuth).toHaveBeenCalledWith("device-token")
  for (const override of [{ projectId: "other" }, { repositoryUrl: "https://github.com/team/other.git" },
    { repositoryUrl: "https://github.com.evil.test/team/app.git" }, { expiresAt: Date.now() - 1 }]) {
    const before = result
    result = { ...result, ...override }
    await expect(get()).rejects.toThrow("authorization is unavailable")
    result = before
  }
  cloud.action.mockRejectedValue(new Error("failure containing repository-token"))
  await expect(get()).rejects.not.toThrow("repository-token")
  vi.restoreAllMocks()
})

it("discovers operator capabilities without requesting a GitHub installation token", async () => {
  const manager = new BackgroundDeviceIdentityManager()
  const identity = await manager.generateNewIdentity()
  vi.spyOn(manager, "loadExistingIdentity").mockResolvedValue(identity)
  vi.spyOn(manager, "authenticateWithCloud").mockResolvedValue({ token: "device-token", principalId: "principal", expiresAt: Date.now() + 60_000 })
  const descriptor = { publicSessionId: "session", projectId: "project", workspaceId: "workspace", rootPath: "/unused",
    background: { gatewayUrl: "https://gateway.example", convexUrl: "https://example.convex.cloud" } }
  cloud.action.mockImplementationOnce(async (reference, args) => {
    expect(getFunctionName(reference)).toBe("sessionRepositoryCredentials:capabilities")
    expect(args).toEqual({ publicSessionId: "session" })
    return { projectId: "project", repositoryUrl: "https://github.com/team/app.git", pullRequest: true, gitWrite: false }
  })
  expect(await getBackgroundRepositoryCapabilities(descriptor, { owner: "team", repository: "app" }, manager))
    .toEqual({ pullRequest: true, gitWrite: false })

  cloud.action.mockResolvedValueOnce({ projectId: "project", repositoryUrl: "https://github.com/team/other.git", pullRequest: true, gitWrite: true })
  expect(await getBackgroundRepositoryCapabilities(descriptor, { owner: "team", repository: "app" }, manager))
    .toEqual({ pullRequest: false, gitWrite: false })
  vi.restoreAllMocks()
})
