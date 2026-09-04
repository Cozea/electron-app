import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: undefined, ipcMain: {} }))

import { ProjectMemoryService } from "../../apps/desktop/electron/services/ProjectMemoryService"

interface TestNode {
  id: string
  label: string
  community?: number
  community_name?: string
  source_file?: string
  source_location?: string
  file_type?: string
}

let projectRoot: string
let snapshotRoot: string
let service: ProjectMemoryService

function writeGraph(nodes: TestNode[], links: Array<[string, string]> = [], commit = "abc123") {
  const graphDir = path.join(projectRoot, "graphify-out")
  fs.mkdirSync(graphDir, { recursive: true })
  fs.writeFileSync(
    path.join(graphDir, "graph.json"),
    JSON.stringify({
      directed: false,
      built_at_commit: commit,
      nodes,
      links: links.map(([source, target]) => ({ source, target, relation: "calls", weight: 1 })),
    }),
    "utf8",
  )
}

function stateOf(workspaceId: string, nodeId: string): string | undefined {
  return service.getGraph(workspaceId, projectRoot)?.nodes.find((n) => n.id === nodeId)?.state
}

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-memory-"))
  projectRoot = path.join(base, "project")
  snapshotRoot = path.join(base, "snapshots")
  fs.mkdirSync(projectRoot, { recursive: true })
  service = new ProjectMemoryService(snapshotRoot)
})

afterEach(() => {
  fs.rmSync(path.dirname(projectRoot), { recursive: true, force: true })
})

describe("ProjectMemoryService", () => {
  it("reports a setup state instead of failing when no agent has built a graph", () => {
    const status = service.getStatus(projectRoot)
    expect(status.available).toBe(false)
    expect(status.graphPath).toBeNull()
    expect(service.getGraph("ws", projectRoot)).toBeNull()
  })

  it("treats the first build as a baseline rather than marking everything new", () => {
    writeGraph([
      { id: "a", label: "Alpha", community: 0, community_name: "Core" },
      { id: "b", label: "Beta", community: 0, community_name: "Core" },
    ])

    const graph = service.getGraph("ws", projectRoot)
    expect(graph?.counts).toEqual({ total: 2, new: 0, changed: 0, unchanged: 2, nonCode: 0 })
  })

  it("marks added nodes new and edited nodes changed on the next build", () => {
    writeGraph([
      { id: "a", label: "Alpha", source_file: "a.ts" },
      { id: "b", label: "Beta", source_file: "b.ts" },
    ])
    service.getGraph("ws", projectRoot)

    writeGraph(
      [
        { id: "a", label: "Alpha", source_file: "a.ts" },
        { id: "b", label: "Beta renamed", source_file: "b.ts" },
        { id: "c", label: "Gamma", source_file: "c.ts" },
      ],
      [],
      "def456",
    )

    const graph = service.getGraph("ws", projectRoot)
    expect(graph?.counts).toEqual({ total: 3, new: 1, changed: 1, unchanged: 1, nonCode: 0 })
    expect(stateOf("ws", "a")).toBe("unchanged")
    expect(stateOf("ws", "b")).toBe("changed")
    expect(stateOf("ws", "c")).toBe("new")
  })

  it("keeps highlighting the same build across repeated reads", () => {
    writeGraph([{ id: "a", label: "Alpha" }])
    service.getGraph("ws", projectRoot)
    writeGraph([{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }], [], "def456")

    // Refreshing the tile must not clear the highlights it just showed.
    expect(stateOf("ws", "b")).toBe("new")
    expect(stateOf("ws", "b")).toBe("new")
    expect(stateOf("ws", "b")).toBe("new")
  })

  it("scopes snapshots per workspace so one project cannot shift another's baseline", () => {
    writeGraph([{ id: "a", label: "Alpha" }])
    service.getGraph("ws-one", projectRoot)
    writeGraph([{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }], [], "def456")

    expect(stateOf("ws-one", "b")).toBe("new")
    // A workspace seeing this graph for the first time has no baseline of its own.
    expect(stateOf("ws-two", "b")).toBe("unchanged")
  })

  it("reports which fields moved for a changed node", () => {
    writeGraph([{ id: "a", label: "Alpha", source_file: "old.ts" }])
    service.getGraph("ws", projectRoot)
    writeGraph([{ id: "a", label: "Alpha", source_file: "new.ts" }], [], "def456")

    const detail = service.getNodeDetail("ws", projectRoot, "a")
    expect(detail?.node.state).toBe("changed")
    expect(detail?.changes).toEqual([{ field: "source_file", before: "old.ts", after: "new.ts" }])
  })

  it("propagates node state onto links and resolves neighbours", () => {
    writeGraph([{ id: "a", label: "Alpha" }], [])
    service.getGraph("ws", projectRoot)
    writeGraph(
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ],
      [["a", "b"]],
      "def456",
    )

    const graph = service.getGraph("ws", projectRoot)
    // A link touching a new node reads as new, so additions are visible as structure.
    expect(graph?.links[0]?.state).toBe("new")

    const detail = service.getNodeDetail("ws", projectRoot, "a")
    expect(detail?.neighbors).toEqual([
      { id: "b", label: "Beta", relation: "calls", direction: "out" },
    ])
  })

  it("groups nodes into communities ordered by size", () => {
    writeGraph([
      { id: "a", label: "A", community: 1, community_name: "Big" },
      { id: "b", label: "B", community: 1, community_name: "Big" },
      { id: "c", label: "C", community: 2, community_name: "Small" },
    ])

    const graph = service.getGraph("ws", projectRoot)
    expect(graph?.communities).toEqual([
      { id: 1, name: "Big", nodeCount: 2 },
      { id: 2, name: "Small", nodeCount: 1 },
    ])
  })

  it("counts non-code memories so docs can be told apart from code", () => {
    writeGraph([
      { id: "a", label: "createSession", file_type: "code" },
      { id: "b", label: "Pitch deck", file_type: "doc" },
      { id: "c", label: "Positioning notes", file_type: "rationale" },
    ])

    const graph = service.getGraph("ws", projectRoot)
    expect(graph?.counts.total).toBe(3)
    expect(graph?.counts.nonCode).toBe(2)
    expect(graph?.nodes.find((n) => n.id === "b")?.fileType).toBe("doc")
  })

  it("treats a graph with no file_type as code rather than documentation", () => {
    // Older graphs omit the field entirely; calling all of them docs would
    // recolour an entire map.
    writeGraph([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ])

    expect(service.getGraph("ws", projectRoot)?.counts.nonCode).toBe(0)
  })

  it("distinguishes an empty project from one with no map yet", () => {
    // Both lack a graph, but only one is worth offering to build.
    expect(service.getStatus(projectRoot).projectHasSource).toBe(false)

    fs.writeFileSync(path.join(projectRoot, "index.ts"), "export const a = 1", "utf8")
    expect(service.getStatus(projectRoot).projectHasSource).toBe(true)
  })

  it("ignores dependency and build directories when looking for source", () => {
    const noise = path.join(projectRoot, "node_modules", "left-pad")
    fs.mkdirSync(noise, { recursive: true })
    fs.writeFileSync(path.join(noise, "index.js"), "module.exports = 1", "utf8")
    fs.mkdirSync(path.join(projectRoot, "dist"), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, "dist", "bundle.js"), "1", "utf8")

    // A folder holding only installed packages has not been started.
    expect(service.getStatus(projectRoot).projectHasSource).toBe(false)
  })

  it("finds source nested a few directories down", () => {
    const nested = path.join(projectRoot, "src", "features", "auth")
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, "session.ts"), "export const s = 1", "utf8")

    expect(service.getStatus(projectRoot).projectHasSource).toBe(true)
  })

  it("survives a corrupt graph file without throwing", () => {
    const graphDir = path.join(projectRoot, "graphify-out")
    fs.mkdirSync(graphDir, { recursive: true })
    fs.writeFileSync(path.join(graphDir, "graph.json"), "{ not json", "utf8")

    expect(service.getGraph("ws", projectRoot)).toBeNull()
    expect(service.getStatus(projectRoot).available).toBe(false)
    expect(service.getStatus(projectRoot).error).toMatch(/could not be parsed/i)
  })
})
