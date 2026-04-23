import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const openCodeDevAppManifest = {
  id: "opencode",
  name: "OpenCode",
  description: "OpenCode coding assistant with a dedicated workspace chat surface.",
  categories: ["discover", "agent-kits"],
  icon: {
    src: iconSrc,
    alt: "OpenCode",
    frameClassName: "bg-white p-1.5 rounded-[12px]",
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
  launch: {
    kind: "assistantChat",
    tileType: "assistantChat",
    provider: "opencode",
  },
} satisfies DevAppManifest
