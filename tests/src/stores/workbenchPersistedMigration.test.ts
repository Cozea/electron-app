import { describe, expect, it } from "vitest"

import { migratePersistedWorkbenchState } from "@/stores/useProjectWorkbenchStore"

function bench(input: {
  projectId: string
  laneId?: string
  workspaceId?: string | null
  tiles?: Array<{ id: string; type: string }>
}) {
  const tiles = Object.fromEntries(
    (input.tiles ?? []).map((tile) => [
      tile.id,
      { id: tile.id, type: tile.type, title: tile.type, createdAt: 1 },
    ]),
  )
  return {
    projectId: input.projectId,
    laneId: input.laneId ?? "collab",
    workspaceId: input.workspaceId ?? null,
    order: (input.tiles ?? []).map((tile) => tile.id),
    tiles,
    activeTileId: null,
    layoutResetKey: 0,
  }
}

describe("persisted workbench migration", () => {
  it("drops legacy benches shadowed by a workspace-scoped bench for the same lane", () => {
    const migrated = migratePersistedWorkbenchState({
      workbenches: {
        legacy: bench({ projectId: "p1", tiles: [{ id: "t1", type: "terminal" }] }),
        scoped: bench({
          projectId: "p1",
          workspaceId: "lws_abc",
          tiles: [{ id: "t2", type: "assistantChat" }],
        }),
      },
    })

    const keys = Object.keys(migrated.workbenches)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toContain("lws_abc")
  })

  it("drops empty or selection-only legacy benches", () => {
    const migrated = migratePersistedWorkbenchState({
      workbenches: {
        empty: bench({ projectId: "p2" }),
        selectionOnly: bench({ projectId: "p3", tiles: [{ id: "s1", type: "selection" }] }),
      },
    })

    expect(Object.keys(migrated.workbenches)).toHaveLength(0)
  })

  it("keeps tiled legacy benches that have no workspace-scoped shadow", () => {
    const migrated = migratePersistedWorkbenchState({
      workbenches: {
        legacy: bench({ projectId: "p4", tiles: [{ id: "t1", type: "terminal" }] }),
      },
    })

    const keys = Object.keys(migrated.workbenches)
    expect(keys).toHaveLength(1)
    expect(migrated.workbenches[keys[0]!]!.order).toEqual(["t1"])
  })

  it("keeps workspace-scoped benches for multiple workspaces of one project", () => {
    const migrated = migratePersistedWorkbenchState({
      workbenches: {
        a: bench({ projectId: "p5", workspaceId: "lws_a", tiles: [{ id: "t1", type: "terminal" }] }),
        b: bench({ projectId: "p5", workspaceId: "lws_b", tiles: [{ id: "t2", type: "terminal" }] }),
      },
    })

    expect(Object.keys(migrated.workbenches)).toHaveLength(2)
  })

  it("sanitizes persisted project DevApp launch metadata", () => {
    const persisted = bench({
      projectId: "p6",
      workspaceId: "lws_devapp",
      tiles: [{ id: "dev-app", type: "devServer" }],
    })
    persisted.tiles["dev-app"] = {
      ...persisted.tiles["dev-app"],
      title: "Project preview",
      devAppId: "  app_123  ",
      devAppReleaseId: " release_2 ",
      devAppReleaseVersion: 2,
      devAppProjectId: " source_project ",
      devAppWorkspaceId: " source_workspace ",
      devAppLaneId: " source_lane ",
      devAppFramework: " vite-react ",
      devAppCommand: " bun run dev ",
      devAppPort: 5173,
      autoStart: true,
      previewOverrideUrl: "  http://localhost:5173/dashboard  ",
    }

    const migrated = migratePersistedWorkbenchState({
      workbenches: { persisted },
    })
    const workbench = Object.values(migrated.workbenches)[0]!

    expect(workbench.tiles["dev-app"]).toMatchObject({
      type: "devServer",
      devAppId: "app_123",
      devAppReleaseId: "release_2",
      devAppReleaseVersion: 2,
      devAppProjectId: "source_project",
      devAppWorkspaceId: "source_workspace",
      devAppLaneId: "source_lane",
      devAppFramework: "vite-react",
      devAppCommand: "bun run dev",
      devAppPort: 5173,
      autoStart: true,
      previewOverrideUrl: "http://localhost:5173/dashboard",
      viewMode: "preview",
    })
  })

  it("drops stale DevApp launch metadata when no valid DevApp identity remains", () => {
    const persisted = bench({
      projectId: "p7",
      workspaceId: "lws_builtin",
      tiles: [{ id: "dev-server", type: "devServer" }],
    })
    persisted.tiles["dev-server"] = {
      ...persisted.tiles["dev-server"],
      devAppId: " ",
      devAppReleaseId: "release_3",
      devAppReleaseVersion: 3,
      devAppProjectId: "source_project",
      devAppWorkspaceId: "source_workspace",
      devAppLaneId: "source_lane",
      devAppFramework: "nextjs",
      devAppCommand: "bun run dev",
      devAppPort: 70_000,
      autoStart: true,
    }

    const migrated = migratePersistedWorkbenchState({
      workbenches: { persisted },
    })
    const tile = Object.values(migrated.workbenches)[0]!.tiles["dev-server"]

    expect(tile).toMatchObject({ type: "devServer" })
    expect(tile).not.toHaveProperty("devAppId")
    expect(tile).not.toHaveProperty("devAppReleaseId")
    expect(tile).not.toHaveProperty("devAppReleaseVersion")
    expect(tile).not.toHaveProperty("devAppProjectId")
    expect(tile).not.toHaveProperty("devAppWorkspaceId")
    expect(tile).not.toHaveProperty("devAppLaneId")
    expect(tile).not.toHaveProperty("devAppFramework")
    expect(tile).not.toHaveProperty("devAppCommand")
    expect(tile).not.toHaveProperty("devAppPort")
    expect(tile).not.toHaveProperty("autoStart")
  })
})
