import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const claudeDevAppManifest = {
  id: "claude",
  name: "Claude",
  description: "Anthropic assistant for thoughtful implementation, planning, and code changes.",
  categories: ["discover", "agent-kits"],
  icon: {
    src: iconSrc,
    alt: "Claude",
    className: "scale-[1.25] bg-white dark:bg-white",
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
  launch: {
    kind: "assistantChat",
    tileType: "assistantChat",
    provider: "claudeAgent",
  },
} satisfies DevAppManifest
