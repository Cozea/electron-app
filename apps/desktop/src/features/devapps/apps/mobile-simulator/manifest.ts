import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const mobileSimulatorDevAppManifest = {
  id: "mobile-simulator",
  name: "iOS Simulator",
  description: "iOS device preview.",
  categories: ["discover", "preview-tools"],
  icon: {
    src: iconSrc,
    alt: "iOS Simulator",
    className: "scale-[1.25]",
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
  parts: {
    view: { source: "native", rendererId: "mobileSimulator" },
    worker: { capabilities: ["process.spawn"] },
  },
  launch: {
    kind: "mobileSimulator",
    tileType: "mobileSimulator",
    singleton: true,
  },
} satisfies DevAppManifest

export default mobileSimulatorDevAppManifest
