import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const terminalDevAppManifest = {
  id: "terminal",
  name: "Terminal",
  description: "Command-line shell.",
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
  parts: {
    view: { source: "native", rendererId: "terminal" },
    worker: { capabilities: ["terminal.spawn"] },
  },
  launch: {
    kind: "terminal",
    tileType: "terminal",
  },
} satisfies DevAppManifest

export default terminalDevAppManifest
