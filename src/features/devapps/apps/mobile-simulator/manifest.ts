import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const mobileSimulatorDevAppManifest = {
  id: "mobile-simulator",
  name: "Mobile Simulator",
  description: "Native device preview surface for mobile-first development and QA checks.",
  categories: ["discover", "preview-tools"],
  icon: {
    src: iconSrc,
    alt: "Mobile Simulator",
    className: "scale-[1.25] bg-white dark:bg-white",
  },
  launcher: {
    enabled: true,
    order: 40,
    group: "Development",
    searchTerms: ["ios", "android", "phone", "simulator", "emulator"],
  },
  store: {
    categoryLabel: "Native preview",
    accentClassName: "from-indigo-500/18 via-violet-500/8 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  launch: {
    kind: "mobileSimulator",
    tileType: "mobileSimulator",
    singleton: true,
  },
} satisfies DevAppManifest
