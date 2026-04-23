import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const cursorDevAppManifest = {
  id: "cursor",
  name: "Cursor",
  description: "Cursor provider surface for fast coding sessions inside the shared workbench.",
  categories: ["discover", "agent-kits"],
  icon: {
    src: iconSrc,
    alt: "Cursor",
  },
  launcher: {
    enabled: true,
    order: 70,
    group: "Assistant",
    searchTerms: ["cursor", "agent", "editor"],
  },
  store: {
    categoryLabel: "AI workflows",
    accentClassName: "from-zinc-400/16 via-zinc-300/8 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  launch: {
    kind: "assistantChat",
    tileType: "assistantChat",
    provider: "cursor",
  },
} satisfies DevAppManifest
