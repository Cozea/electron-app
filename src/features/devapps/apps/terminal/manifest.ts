import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const terminalDevAppManifest = {
  id: "terminal",
  name: "Terminal",
  description: "Local shell surface for commands, logs, and project-side workflows.",
  categories: ["discover", "runtimes"],
  icon: {
    src: iconSrc,
    alt: "Terminal",
    className: "scale-[1.25]",
  },
  launcher: {
    enabled: true,
    order: 30,
    group: "Development",
    searchTerms: ["shell", "cli", "console", "command line"],
  },
  store: {
    categoryLabel: "Developer tools",
    accentClassName: "from-zinc-950/14 via-zinc-900/4 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  launch: {
    kind: "terminal",
    tileType: "terminal",
  },
} satisfies DevAppManifest
