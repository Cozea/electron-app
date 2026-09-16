import type { DevAppManifest } from "@/features/devapps/registry/types"

import iconSrc from "./icon.png"

export const securityScanDevAppManifest = {
  id: "security-scan",
  name: "Security scan",
  description: "Automated security scan of your app or dev server.",
  categories: ["discover", "preview-tools"],
  icon: {
    src: iconSrc,
    alt: "Security scan",
  },
  launcher: {
    enabled: true,
    order: 42,
    group: "Development",
    searchTerms: ["security", "pentest", "vulnerability", "scan", "owasp", "strix"],
  },
  store: {
    categoryLabel: "Security",
    accentClassName: "from-red-500/18 via-amber-500/8 to-transparent",
    badgeLabel: "Built in",
    featured: true,
  },
  parts: {
    view: { source: "native", rendererId: "securityScan" },
    // Development tier: runs with local privileges so it can reach Docker and the project.
    worker: { capabilities: ["project.read", "process.spawn"] },
    service: { runtimeKind: "node", singleton: true },
    runtime: { kind: "development", location: "device", state: "device" },
  },
  launch: {
    kind: "securityScan",
    tileType: "securityScan",
    singleton: true,
  },
} satisfies DevAppManifest

export default securityScanDevAppManifest
