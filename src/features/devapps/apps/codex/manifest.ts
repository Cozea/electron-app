import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const codexDevAppManifest = {
  id: "codex",
  name: "Codex",
  description: "OpenAI-powered coding agent tuned for workspace implementation and review.",
  categories: ["discover", "agent-kits"],
  icon: {
    src: iconSrc,
    alt: "Codex",
  },
  launcher: {
    enabled: true,
    order: 50,
    group: "Assistant",
    searchTerms: ["openai", "agent", "coding", "review"],
  },
  store: {
    categoryLabel: "AI workflows",
    accentClassName: "from-zinc-950/14 via-zinc-900/4 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  launch: {
    kind: "assistantChat",
    tileType: "assistantChat",
    provider: "codex",
  },
} satisfies DevAppManifest
