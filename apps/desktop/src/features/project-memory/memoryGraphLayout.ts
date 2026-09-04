import type { ProjectMemoryGraph, ProjectMemoryNode } from "@shared/electronApiTypes"

/**
 * Deterministic layout instead of a force simulation.
 *
 * At ~1300 nodes a simulation costs a visible settle on every open and, worse,
 * moves nodes between builds — which would make the change highlighting hard to
 * read, since a node would appear to move whether or not it actually changed.
 * Communities become islands on a ring; members are placed by phyllotaxis so
 * the packing stays even and identical for identical input.
 */

export interface MemoryLayoutNode {
  node: ProjectMemoryNode
  x: number
  y: number
  radius: number
}

export interface MemoryLayoutEdge {
  sourceId: string
  targetId: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  state: ProjectMemoryNode["state"]
  intraCommunity: boolean
}

export interface MemoryLayout {
  nodes: MemoryLayoutNode[]
  edges: MemoryLayoutEdge[]
  byId: Map<string, MemoryLayoutNode>
  adjacency: Map<string, Set<string>>
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const MEMBER_SPACING = 13
const ISLAND_PADDING = 34
const MIN_RADIUS = 3.2
const MAX_RADIUS = 11

function nodeRadius(degree: number): number {
  // Square root keeps hubs prominent without letting one node dominate.
  return Math.min(MAX_RADIUS, MIN_RADIUS + Math.sqrt(degree) * 1.5)
}

export function buildMemoryLayout(graph: ProjectMemoryGraph): MemoryLayout {
  const grouped = new Map<number, ProjectMemoryNode[]>()
  for (const node of graph.nodes) {
    const key = node.community ?? -1
    const bucket = grouped.get(key)
    if (bucket) bucket.push(node)
    else grouped.set(key, [node])
  }

  // Largest communities first so the biggest islands land in a stable order.
  const islands = Array.from(grouped.entries()).sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length
    return a[0] - b[0]
  })

  const islandRadiusOf = (count: number) => MEMBER_SPACING * Math.sqrt(Math.max(count, 1)) + 20

  const byId = new Map<string, MemoryLayoutNode>()
  const nodes: MemoryLayoutNode[] = []

  /*
   * Islands are packed into a filled disc rather than strung around one ring.
   * A ring leaves a dead centre that every cross-community link then has to
   * traverse, which reads as noise; packing keeps those links short so the
   * clusters look connected. Each island sits at the golden angle, pushed out
   * by the square root of the area already consumed — the standard way to tile
   * discs of uneven size without overlap.
   */
  let consumedArea = 0
  for (const [index, [, members]] of islands.entries()) {
    const islandRadius = islandRadiusOf(members.length)
    const padded = islandRadius + ISLAND_PADDING / 2
    consumedArea += padded * padded
    const distance = index === 0 ? 0 : Math.sqrt(consumedArea) * 1.05
    const angle = index * GOLDEN_ANGLE

    const centerX = Math.cos(angle) * distance
    const centerY = Math.sin(angle) * distance

    // Hubs to the middle of their island; the eye lands on structure first.
    const ordered = [...members].sort((a, b) => b.degree - a.degree)
    ordered.forEach((node, memberIndex) => {
      const spiralRadius = MEMBER_SPACING * Math.sqrt(memberIndex)
      const spiralAngle = memberIndex * GOLDEN_ANGLE
      const entry: MemoryLayoutNode = {
        node,
        x: centerX + Math.cos(spiralAngle) * spiralRadius,
        y: centerY + Math.sin(spiralAngle) * spiralRadius,
        radius: nodeRadius(node.degree),
      }
      nodes.push(entry)
      byId.set(node.id, entry)
    })
  }

  const adjacency = new Map<string, Set<string>>()
  const edges: MemoryLayoutEdge[] = []
  for (const link of graph.links) {
    const source = byId.get(link.source)
    const target = byId.get(link.target)
    if (!source || !target) continue

    if (!adjacency.has(link.source)) adjacency.set(link.source, new Set())
    if (!adjacency.has(link.target)) adjacency.set(link.target, new Set())
    adjacency.get(link.source)?.add(link.target)
    adjacency.get(link.target)?.add(link.source)

    edges.push({
      sourceId: link.source,
      targetId: link.target,
      sourceX: source.x,
      sourceY: source.y,
      targetX: target.x,
      targetY: target.y,
      state: link.state,
      intraCommunity: source.node.community === target.node.community,
    })
  }

  const bounds = nodes.reduce(
    (acc, entry) => ({
      minX: Math.min(acc.minX, entry.x - entry.radius),
      minY: Math.min(acc.minY, entry.y - entry.radius),
      maxX: Math.max(acc.maxX, entry.x + entry.radius),
      maxY: Math.max(acc.maxY, entry.y + entry.radius),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )

  return {
    nodes,
    edges,
    byId,
    adjacency,
    bounds: Number.isFinite(bounds.minX)
      ? bounds
      : { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  }
}

/** Nearest node within a generous hit radius, in graph space. */
export function hitTestMemoryLayout(
  layout: MemoryLayout,
  x: number,
  y: number,
  tolerance: number,
): MemoryLayoutNode | null {
  let best: MemoryLayoutNode | null = null
  let bestDistance = Infinity
  for (const entry of layout.nodes) {
    const distance = Math.hypot(entry.x - x, entry.y - y)
    if (distance <= Math.max(entry.radius, 0) + tolerance && distance < bestDistance) {
      best = entry
      bestDistance = distance
    }
  }
  return best
}
