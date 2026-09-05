import { describe, expect, it } from "vitest"

import { migratePersistedWorkbenchState } from "@/lib/workbenchStore"

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
  it("preserves layoutResetKey across rehydration so saved layouts still match", () => {
    // The key gates whether the separately stored dockview layout is accepted.
    // Regenerating it while reading guaranteed a mismatch, so every restart
    // rebuilt the default layout and the user's tiles moved.
    const migrated = migratePersistedWorkbenchState({
      workbenches: {
        "p1::collab::ws1": {
          ...bench({
            projectId: "p1",
            workspaceId: "ws1",
            tiles: [{ id: "t1", type: "terminal" }],
          }),
          layoutResetKey: 1717171717,
        },
      },
    })

    expect(Object.values(migrated.workbenches)[0]?.layoutResetKey).toBe(1717171717)
  })

  it("keeps the reset key even when an obsolete tile is dropped", () => {
    // Removing a dead tile type must not invalidate the layout of the tiles
    // that survived; the restore path handles a genuinely broken layout itself.
    const migrated = migratePersistedWorkbenchState({
      workbenches: {
        "p1::collab::ws1": {
          ...bench({
            projectId: "p1",
            workspaceId: "ws1",
            tiles: [
              { id: "t1", type: "terminal" },
              { id: "t2", type: "tasks" },
            ],
          }),
          layoutResetKey: 42,
        },
      },
    })

    const restored = Object.values(migrated.workbenches)[0]
    expect(restored?.layoutResetKey).toBe(42)
    expect(Object.keys(restored?.tiles ?? {})).toEqual(["t1"])
  })

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

  it("defaults legacy assistant tiles to chat and preserves a valid artifacts view", () => {
    const legacy = bench({
      projectId: "p-assistant-legacy",
      workspaceId: "lws_assistant_legacy",
      tiles: [{ id: "assistant", type: "assistantChat" }],
    })
    const artifacts = bench({
      projectId: "p-assistant-artifacts",
      workspaceId: "lws_assistant_artifacts",
      tiles: [{ id: "assistant", type: "assistantChat" }],
    })
    artifacts.tiles.assistant = {
      ...artifacts.tiles.assistant,
      viewMode: "artifacts",
    }

    const migrated = migratePersistedWorkbenchState({
      workbenches: { legacy, artifacts },
    })
    const byProject = Object.values(migrated.workbenches).reduce<Record<string, unknown>>(
      (result, workbench) => {
        result[workbench.projectId] = workbench.tiles.assistant
        return result
      },
      {},
    )

    expect(byProject["p-assistant-legacy"]).toMatchObject({ viewMode: "chat" })
    expect(byProject["p-assistant-artifacts"]).toMatchObject({ viewMode: "artifacts" })
  })

  it("collapses same-tick default assistant placeholders while keeping the active bound tile", () => {
    const duplicated = bench({
      projectId: "p-duplicate-agent",
      workspaceId: "lws_duplicate_agent",
      tiles: [
        { id: "agent-1", type: "assistantChat" },
        { id: "agent-2", type: "assistantChat" },
      ],
    })
    duplicated.tiles["agent-1"] = {
      ...duplicated.tiles["agent-1"],
      title: "AI Agent",
      createdAt: 1_000,
      assistantProjectId: "assistant-project",
      threadId: null,
    }
    duplicated.tiles["agent-2"] = {
      ...duplicated.tiles["agent-2"],
      title: "AI Agent 2",
      createdAt: 1_000,
      assistantProjectId: "assistant-project",
      threadId: "thread-2",
    }
    duplicated.activeTileId = "agent-2"
    duplicated.layout = { grid: {}, panels: {} }

    const migrated = migratePersistedWorkbenchState({
      workbenches: { duplicated },
    })
    const workbench = Object.values(migrated.workbenches)[0]!

    expect(workbench.order).toEqual(["agent-2"])
    expect(workbench.activeTileId).toBe("agent-2")
    expect(workbench.tiles["agent-1"]).toBeUndefined()
    expect(workbench.layout).toBeNull()
  })

  it("preserves deliberately named assistant panels even when created together", () => {
    const deliberate = bench({
      projectId: "p-deliberate-agents",
      workspaceId: "lws_deliberate_agents",
      tiles: [
        { id: "planner", type: "assistantChat" },
        { id: "reviewer", type: "assistantChat" },
      ],
    })
    deliberate.tiles.planner = {
      ...deliberate.tiles.planner,
      title: "Planner",
      createdAt: 2_000,
    }
    deliberate.tiles.reviewer = {
      ...deliberate.tiles.reviewer,
      title: "Reviewer",
      createdAt: 2_000,
    }

    const migrated = migratePersistedWorkbenchState({
      workbenches: { deliberate },
    })

    expect(Object.values(migrated.workbenches)[0]!.order).toEqual(["planner", "reviewer"])
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

  it("preserves a durable Org DevApp ref across workbench restoration", () => {
    const persisted = bench({
      projectId: "p8",
      workspaceId: "lws_org_devapp",
      tiles: [{ id: "org-app", type: "orgDevApp" }],
    })
    persisted.tiles["org-app"] = {
      ...persisted.tiles["org-app"],
      title: "Inventory",
      devAppRef: "  cozea-devapp:org_1/pub_1@2  ",
      publicationId: " pub_1 ",
      organizationId: " org_1 ",
      contentHash: ` ${"a".repeat(64)} `,
      entryPath: " index.html ",
      runtimeKind: "static",
      storageScope: "workspace",
    }

    const migrated = migratePersistedWorkbenchState({ workbenches: { persisted } })
    const tile = Object.values(migrated.workbenches)[0]!.tiles["org-app"]

    expect(tile).toMatchObject({
      type: "orgDevApp",
      devAppRef: "cozea-devapp:org_1/pub_1@2",
      publicationId: "pub_1",
      organizationId: "org_1",
      contentHash: "a".repeat(64),
      entryPath: "index.html",
      runtimeKind: "static",
      storageScope: "orgDevApp",
    })
  })
})
