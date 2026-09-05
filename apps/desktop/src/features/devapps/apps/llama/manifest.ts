import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const llamaDevAppManifest = {
  id: "llama",
  name: "Llama",
  description: "Run local AI models.",
  categories: ["discover", "agent-kits", "runtimes"],
  icon: {
    src: iconSrc,
    alt: "Llama",
  },
  launcher: {
    enabled: true,
    order: 45,
    group: "Assistant",
    searchTerms: ["llama", "ollama", "local", "ai", "meta", "offline", "model"],
  },
  store: {
    categoryLabel: "Local AI",
    accentClassName: "from-purple-500/18 via-violet-500/8 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  parts: {
    view: { source: "native", rendererId: "llama" },
    service: { runtimeKind: "node", singleton: true },
  },
  launch: {
    kind: "llama",
    tileType: "llama",
    singleton: true,
  },
} satisfies DevAppManifest

export default llamaDevAppManifest
