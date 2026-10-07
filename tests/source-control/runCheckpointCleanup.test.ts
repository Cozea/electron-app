import { describe, expect, it, vi } from "vitest"

import type { Id } from "../../convex/_generated/dataModel"
import { runCheckpointCleanup } from "@/features/source-control/model/runCheckpointCleanup"

describe("local and shared commit cleanup", () => {
  const cloudProjectId = "shared_project" as Id<"projects">

  it("cleans local refs without contacting cloud for a personal project", async () => {
    const deleteLocalRefs = vi.fn(async () => {})
    const clearSharedActivity = vi.fn(async () => { throw new Error("Cloud unavailable") })
    await runCheckpointCleanup({ workspaceId: "ws_local", cloudProjectId: null, cloudActivityEnabled: true }, { deleteLocalRefs, clearSharedActivity })
    expect(deleteLocalRefs).toHaveBeenCalledWith("ws_local")
    expect(clearSharedActivity).not.toHaveBeenCalled()
  })

  it("does not write shared activity when an associated project is outside collaboration", async () => {
    const deleteLocalRefs = vi.fn(async () => {})
    const clearSharedActivity = vi.fn(async () => {})
    await runCheckpointCleanup({ workspaceId: "ws_local", cloudProjectId, cloudActivityEnabled: false }, { deleteLocalRefs, clearSharedActivity })
    expect(deleteLocalRefs).toHaveBeenCalledOnce()
    expect(clearSharedActivity).not.toHaveBeenCalled()
  })

  it("uses the genuine cloud ID and cleans local refs even when cloud cleanup fails", async () => {
    const deleteLocalRefs = vi.fn(async () => {})
    const clearSharedActivity = vi.fn(async () => { throw new Error("Offline") })
    await expect(runCheckpointCleanup({ workspaceId: "ws_local", cloudProjectId, cloudActivityEnabled: true },
      { deleteLocalRefs, clearSharedActivity })).rejects.toThrow("Offline")
    expect(deleteLocalRefs).toHaveBeenCalledWith("ws_local")
    expect(clearSharedActivity).toHaveBeenCalledWith(cloudProjectId)
  })
})
