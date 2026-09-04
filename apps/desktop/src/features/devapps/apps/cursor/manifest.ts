import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const cursorDevAppManifest = {
  id: "cursor",
  name: "Cursor",
  description: "Fast coding agent.",
  categories: ["discover", "agent-kits"],
  icon: {
    src: iconSrc,
    alt: "Cursor",
    className: "scale-[1.25]",
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
  parts: {
    view: { source: "native", rendererId: "assistantChat" },
    worker: { capabilities: ["project.read", "project.write", "process.spawn"] },
  },
  launch: {
    kind: "assistantChat",
    tileType: "assistantChat",
    provider: "cursor",
  },
} satisfies DevAppManifest

export default cursorDevAppManifest
