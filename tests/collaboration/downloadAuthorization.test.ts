import { afterEach, expect, it, vi } from "vitest"
import { downloadAuthorizedProjectRepository } from "@/features/collaboration/api/downloadAuthorizedProjectRepository"

afterEach(() => vi.unstubAllGlobals())
it("forwards repository download intent without requesting credentials in the renderer", async () => {
  const downloadRepository = vi.fn(async () => ({ workspaceId: "w" }))
  vi.stubGlobal("window", { electronAPI: { collaboration: { downloadRepository } } })
  expect(await downloadAuthorizedProjectRepository({ projectId: "p", slug: "repo" })).toEqual({ workspaceId: "w" })
  expect(downloadRepository).toHaveBeenCalledWith({ projectId: "p", slug: "repo" })
})
