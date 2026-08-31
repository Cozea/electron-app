import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const authorizationMocks = vi.hoisted(() => ({
  projectRootPath: "",
  resolve: vi.fn(async () => ({
    projectRootPath: authorizationMocks.projectRootPath,
    workspace: { label: "Test project" },
    lane: { laneId: "lane_1", branch: "main" },
    gitRootPath: null,
  })),
}))

const shellMocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  showItemInFolder: vi.fn(),
}))

vi.mock("../../apps/desktop/electron/workspaces/authorization.ts", () => ({
  resolveAuthorizedWorkspaceAccess: authorizationMocks.resolve,
}))

vi.mock("electron", () => ({ shell: shellMocks }))

import { createNodeDevAppHostServices } from "../../apps/desktop/electron/services/devAppHostServices"

describe("DevApp host services — filesystem confinement", () => {
  let temporaryRoot = ""
  let projectRoot = ""
  let outsideRoot = ""

  beforeEach(() => {
    authorizationMocks.resolve.mockClear()
    shellMocks.openExternal.mockClear()
    shellMocks.showItemInFolder.mockClear()
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-host-services-"))
    projectRoot = path.join(temporaryRoot, "project")
    outsideRoot = path.join(temporaryRoot, "outside")
    fs.mkdirSync(projectRoot)
    fs.mkdirSync(outsideRoot)
    authorizationMocks.projectRootPath = projectRoot
  })

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  })

  it("returns null for a missing project file", async () => {
    const services = createNodeDevAppHostServices()
    await expect(
      services.readProjectFile({ workspaceId: "ws_1", filePath: "missing.txt" }),
    ).resolves.toBeNull()
  })

  it("refuses reads through a symlink that leaves the project", async () => {
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "secret", "utf8")
    fs.symlinkSync(outsideRoot, path.join(projectRoot, "linked"), "dir")
    const services = createNodeDevAppHostServices()
    await expect(
      services.readProjectFile({ workspaceId: "ws_1", filePath: "linked/secret.txt" }),
    ).rejects.toThrow(/symbolic link/)
  })

  it("refuses writes through a symlinked parent", async () => {
    fs.symlinkSync(outsideRoot, path.join(projectRoot, "linked"), "dir")
    const services = createNodeDevAppHostServices()
    await expect(
      services.writeProjectFile({
        workspaceId: "ws_1",
        filePath: "linked/created.txt",
        content: "must stay confined",
      }),
    ).rejects.toThrow(/symbolic link/)
    expect(fs.existsSync(path.join(outsideRoot, "created.txt"))).toBe(false)
  })

  it("refuses revealing a symlink target outside the granted root", async () => {
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "secret", "utf8")
    fs.symlinkSync(path.join(outsideRoot, "secret.txt"), path.join(projectRoot, "secret-link"))
    const services = createNodeDevAppHostServices()
    await expect(
      services.revealPath({ rootPath: projectRoot, relativePath: "secret-link" }),
    ).rejects.toThrow(/symbolic link/)
    expect(shellMocks.showItemInFolder).not.toHaveBeenCalled()
  })

  it("bounds worker writes before touching the filesystem", async () => {
    const services = createNodeDevAppHostServices()
    await expect(
      services.writeProjectFile({
        workspaceId: "ws_1",
        filePath: "large.txt",
        content: "x".repeat(5 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/too large/)
    expect(fs.existsSync(path.join(projectRoot, "large.txt"))).toBe(false)
  })
})
