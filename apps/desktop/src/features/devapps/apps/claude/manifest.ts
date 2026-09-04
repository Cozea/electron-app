import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const claudeDevAppManifest = {
  id: "claude",
  name: "Claude",
  description: "Anthropic coding agent.",
  categories: ["discover", "agent-kits"],
  icon: {
    src: iconSrc,
    alt: "Claude",
    className: "scale-[1.25]",
  },
  launcher: {
    enabled: true,
    order: 60,
    group: "Assistant",
    searchTerms: ["anthropic", "agent", "writing", "reasoning"],
  },
  store: {
    categoryLabel: "AI workflows",
    accentClassName: "from-orange-500/18 via-amber-500/8 to-transparent",
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
    provider: "claudeAgent",
  },
} satisfies DevAppManifest

export default claudeDevAppManifest
