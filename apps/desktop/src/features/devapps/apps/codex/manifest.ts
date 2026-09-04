import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const codexDevAppManifest = {
  id: "codex",
  name: "Codex",
  description: "OpenAI coding agent.",
  categories: ["discover", "agent-kits"],
  icon: {
    src: iconSrc,
    alt: "Codex",
    className: "scale-[1.25]",
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
  parts: {
    view: { source: "native", rendererId: "assistantChat" },
    worker: { capabilities: ["project.read", "project.write", "process.spawn"] },
  },
  launch: {
    kind: "assistantChat",
    tileType: "assistantChat",
    provider: "codex",
  },
} satisfies DevAppManifest

export default codexDevAppManifest
