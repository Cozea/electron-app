import { describe, expect, it } from "vitest"

// @ts-expect-error - plain node script, no type declarations
import { scoreMemoryMap } from "../../scripts/score-memory-map.mjs"

type Check = { name: string; ok: boolean; detail: string }

const check = (graph: unknown, name: string): Check => {
  const { checks } = scoreMemoryMap(graph) as { checks: Check[] }
  const found = checks.find((c) => c.name === name)
  if (!found) throw new Error(`no check named ${name}`)
  return found
}

/** A minimal map that satisfies every threshold, used as the base for each failure case. */
const healthyGraph = () => ({
  built_at_commit: "abc123",
  nodes: [
    { id: "f", label: "session.ts", source_file: "auth/session.ts", source_location: "L1", community: 0, community_name: "auth" },
    { id: "a", label: "createSession()", source_file: "auth/session.ts", source_location: "L10", community: 0, community_name: "auth" },
    { id: "b", label: "verify()", source_file: "auth/session.ts", source_location: "L40", community: 0, community_name: "auth" },
  ],
  links: [
    { source: "f", target: "a", relation: "contains", confidence: "EXTRACTED", source_file: "auth/session.ts" },
    { source: "f", target: "b", relation: "contains", confidence: "EXTRACTED", source_file: "auth/session.ts" },
    { source: "a", target: "b", relation: "calls", confidence: "EXTRACTED", source_file: "auth/session.ts" },
    { source: "b", target: "a", relation: "calls", confidence: "EXTRACTED", source_file: "auth/session.ts" },
    { source: "a", target: "f", relation: "imports", confidence: "EXTRACTED", source_file: "auth/session.ts" },
  ],
})

describe("scoreMemoryMap", () => {
  it("passes a map that meets every threshold", () => {
    const { passed, checks } = scoreMemoryMap(healthyGraph()) as { passed: boolean; checks: Check[] }
    expect(checks.filter((c) => !c.ok)).toEqual([])
    expect(passed).toBe(true)
  })

  it("fails a map with no file nodes, the gap that made maps shallow", () => {
    const graph = healthyGraph()
    graph.nodes = graph.nodes.filter((n) => n.id !== "f")
    graph.links = graph.links.filter((l) => l.source !== "f" && l.target !== "f")
    expect(check(graph, "a node per source file that holds symbols").ok).toBe(false)
  })

  it("fails a map whose containment spine is missing", () => {
    const graph = healthyGraph()
    graph.links = graph.links.map((l) => ({ ...l, relation: l.relation === "contains" ? "calls" : l.relation }))
    expect(check(graph, "contains is 20..50% of links").ok).toBe(false)
  })

  it("fails a map left with links pointing at deleted nodes", () => {
    const graph = healthyGraph()
    graph.nodes = graph.nodes.filter((n) => n.id !== "b")
    const dangling = check(graph, "no dangling links")
    expect(dangling.ok).toBe(false)
    expect(dangling.detail).toContain("->")
  })

  it("fails a map where a node was left out of a community", () => {
    const graph = healthyGraph()
    graph.nodes[2] = { ...graph.nodes[2], community_name: "" }
    expect(check(graph, "every node is in a named community").ok).toBe(false)
  })

  it("fails a map with too few links per node to be useful", () => {
    const graph = healthyGraph()
    graph.links = graph.links.slice(0, 2)
    expect(check(graph, "links per node in 1.5..2.5").ok).toBe(false)
  })

  it("fails a map that cannot be updated incrementally", () => {
    const graph = healthyGraph()
    graph.built_at_commit = ""
    expect(check(graph, "built_at_commit recorded").ok).toBe(false)
  })

  it("reports every check as failed for an empty map rather than throwing", () => {
    const { passed } = scoreMemoryMap({ nodes: [], links: [] }) as { passed: boolean }
    expect(passed).toBe(false)
  })
})
