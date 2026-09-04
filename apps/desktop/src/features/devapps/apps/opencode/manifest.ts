import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const openCodeDevAppManifest = {
  id: "opencode",
  name: "OpenCode",
  description: "OpenCode coding agent.",
  categories: ["discover", "agent-kits"],
  icon: {
    src: iconSrc,
    alt: "OpenCode",
  },
  launcher: {
    enabled: true,
    order: 80,
    group: "Assistant",
    searchTerms: ["open code", "opencode", "agent", "coding"],
  },
  store: {
    categoryLabel: "AI workflows",
    accentClassName: "from-zinc-800/18 via-zinc-700/8 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  parts: {
    view: { source: "native", rendererId: "assistantChat" },
    worker: { capabilities: ["project.read", "project.write", "process.spawn"] },
  },
  launch: {
    kind: "assistantChat",
    tileType: "assistantChat",
    provider: "opencode",
  },
} satisfies DevAppManifest

export default openCodeDevAppManifest
