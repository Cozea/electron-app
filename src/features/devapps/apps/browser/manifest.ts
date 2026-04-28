import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const browserDevAppManifest = {
  id: "browser",
  name: "Browser",
  description: "Persistent web surface for in-workbench browsing and preview flows.",
  categories: ["discover", "preview-tools"],
  icon: {
    src: iconSrc,
    alt: "Browser",
    className: "scale-[1.25] bg-white dark:bg-white",
  },
  launcher: {
    enabled: true,
    order: 10,
    group: "Development",
    searchTerms: ["web", "preview", "chrome", "arc", "surf"],
  },
  store: {
    categoryLabel: "Web surfaces",
    accentClassName: "from-slate-950/12 via-slate-900/4 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  launch: {
    kind: "browser",
    tileType: "browser",
  },
} satisfies DevAppManifest
