import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const devServerDevAppManifest = {
  id: "dev-server",
  name: "Dev Server",
  description: "Run local dev servers.",
  categories: ["discover", "preview-tools", "runtimes"],
  icon: {
    src: iconSrc,
    alt: "Dev Server",
    className: "scale-[1.25]",
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
  parts: {
    view: { source: "native", rendererId: "devServer" },
    worker: { capabilities: ["process.spawn", "project.read"] },
    service: { runtimeKind: "node", singleton: true },
  },
  launch: {
    kind: "devServer",
    tileType: "devServer",
    singleton: true,
  },
} satisfies DevAppManifest

export default devServerDevAppManifest
