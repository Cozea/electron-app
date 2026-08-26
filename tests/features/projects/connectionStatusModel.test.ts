import { describe, expect, it } from "vitest"

import {
  mapAssistantTransportState,
  mapDataSyncStatus,
  mapGitRemoteStatus,
  resolveConnectionStatusPresentation,
} from "@/features/projects/lib/connectionStatusModel"
import { isBackgroundRefreshAllowed, readDocumentVisibility } from "@/lib/backgroundPolicy"

describe("connectionStatusModel", () => {
  it("maps assistant transport independently of data sync", () => {
    expect(mapAssistantTransportState("open")).toBe("connected")
    expect(mapAssistantTransportState("connecting")).toBe("reconnecting")
    expect(mapAssistantTransportState("reconnecting")).toBe("reconnecting")
    expect(mapAssistantTransportState("closed")).toBe("disconnected")
    expect(mapAssistantTransportState(null)).toBe("disconnected")
  })

  it("maps data sync from journal progress, not Convex project.syncStatus", () => {
    expect(
      mapDataSyncStatus({
        syncProgressStatus: "syncing",
        collabConnected: true,
        isOnline: true,
        collaborationMode: "shared",
        hasSyncContext: true,
      }),
    ).toBe("syncing")

    expect(
      mapDataSyncStatus({
        syncProgressStatus: "error",
        collabConnected: true,
        isOnline: true,
        collaborationMode: "shared",
        hasSyncContext: true,
      }),
    ).toBe("error")

    expect(
      mapDataSyncStatus({
        syncProgressStatus: "idle",
        collabConnected: false,
        isOnline: true,
        collaborationMode: "shared",
        hasSyncContext: true,
      }),
    ).toBe("syncing")

    expect(
      mapDataSyncStatus({
        syncProgressStatus: "idle",
        collabConnected: true,
        isOnline: true,
        collaborationMode: "shared",
        hasSyncContext: true,
      }),
    ).toBe("idle")
  })

  it("maps git remote ahead/behind separately from transport and sync", () => {
    expect(mapGitRemoteStatus(null)).toBe("unknown")
    expect(mapGitRemoteStatus({ ahead: 0, behind: 0 })).toBe("idle")
    expect(mapGitRemoteStatus({ ahead: 2, behind: 1 })).toBe("diverged")
    expect(mapGitRemoteStatus({ ahead: 0, behind: 0, error: "fetch failed" })).toBe("error")
  })

  it("keeps transport, data sync, and git remote as distinct presentation layers", () => {
    const presentation = resolveConnectionStatusPresentation({
      assistantTransport: "closed",
      syncProgress: {
        status: "idle",
        message: "",
        current: 0,
        total: 0,
        logs: [],
      },
      collabConnected: true,
      isOnline: true,
      collaborationMode: "shared",
      sharedBranch: "main",
      gitRemote: { ahead: 1, behind: 0 },
    })

    expect(presentation.transport).toBe("disconnected")
    expect(presentation.dataSync).toBe("idle")
    expect(presentation.gitRemote).toBe("diverged")
    expect(presentation.layers.map((layer) => layer.id)).toEqual([
      "transport",
      "dataSync",
      "gitRemote",
    ])
    expect(presentation.primaryLabel).toBe("Live")
    expect(presentation.primaryDetail).toContain("Assistant disconnected")
    expect(presentation.layers[0]?.title).toBe("Assistant transport")
    expect(presentation.layers[1]?.title).toBe("Data sync")
    expect(presentation.layers[2]?.title).toBe("Git remote")
    expect(presentation.layers[2]?.detail).toContain("1 ahead")
  })

  it("labels collab reconnecting without implying assistant transport failure", () => {
    const presentation = resolveConnectionStatusPresentation({
      assistantTransport: "open",
      syncProgress: {
        status: "idle",
        message: "",
        current: 0,
        total: 0,
        logs: [],
      },
      collabConnected: false,
      isOnline: true,
      collaborationMode: "shared",
      sharedBranch: "main",
      gitRemote: null,
    })

    expect(presentation.transport).toBe("connected")
    expect(presentation.dataSync).toBe("syncing")
    expect(presentation.primaryLabel).toBe("Collab Reconnecting")
  })
})

describe("backgroundPolicy", () => {
  it("allows refresh when visible and surface-active", () => {
    expect(
      isBackgroundRefreshAllowed(
        { surfaceActive: true, pauseWhenDocumentHidden: true },
        "visible",
      ),
    ).toBe(true)
  })

  it("pauses refresh when the document is hidden", () => {
    expect(
      isBackgroundRefreshAllowed(
        { surfaceActive: true, pauseWhenDocumentHidden: true },
        "hidden",
      ),
    ).toBe(false)
  })

  it("pauses refresh when the surface is inactive", () => {
    expect(
      isBackgroundRefreshAllowed(
        { surfaceActive: false, pauseWhenDocumentHidden: true },
        "visible",
      ),
    ).toBe(false)
  })

  it("reads a document visibility value", () => {
    expect(["visible", "hidden", "prerender"]).toContain(readDocumentVisibility())
  })
})
