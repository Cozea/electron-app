import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const devServerDevAppManifest = {
  id: "dev-server",
  name: "Dev Server",
  description: "Workspace runtime panel for booting, monitoring, and previewing local apps.",
  categories: ["discover", "preview-tools", "runtimes"],
  icon: {
    src: iconSrc,
    alt: "Dev Server",
  },
  launcher: {
    enabled: true,
    order: 20,
    group: "Development",
    searchTerms: ["vite", "next", "preview", "localhost", "runtime"],
  },
  store: {
    categoryLabel: "Local runtime",
    accentClassName: "from-emerald-500/18 via-teal-500/8 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  launch: {
    kind: "devServer",
    tileType: "devServer",
    singleton: true,
  },
} satisfies DevAppManifest
