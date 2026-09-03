import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const memoryDevAppManifest = {
  id: "memory",
  name: "Memory",
  description:
    "Visual map of what the agents know about this project, and what changed in the last build.",
  categories: ["discover", "agent-kits"],
  icon: {
    src: iconSrc,
    alt: "Memory",
  },
  launcher: {
    enabled: true,
    order: 44,
    group: "Assistant",
    searchTerms: ["memory", "graph", "map", "knowledge", "graphify", "context"],
  },
  store: {
    categoryLabel: "Project memory",
    accentClassName: "from-violet-500/18 via-sky-500/8 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  parts: {
    // Read-only by design: agents own the graph, this surface only reads it.
    view: { source: "native", rendererId: "memory" },
    worker: { capabilities: ["project.read"] },
    service: { runtimeKind: "node", singleton: true },
  },
  launch: {
    kind: "memory",
    tileType: "memory",
    singleton: true,
  },
} satisfies DevAppManifest

export default memoryDevAppManifest
