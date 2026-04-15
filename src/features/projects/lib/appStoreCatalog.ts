import type { ComponentType } from "react"
import { AArrowDownIcon as __CloudDownloadHugeIcon, ArrowDownZeroOneIcon as __DownloadHugeIcon, ArrowLeftRightIcon as __ChatHugeIcon, CodeCircleIcon as __CodeHugeIcon, CommandLineIcon as __CommandLineHugeIcon, CpuChargeIcon as __ChipHugeIcon, EyeIcon as __EyeHugeIcon, FirstBracketCircleIcon as __BoltHugeIcon, PaintBrush01Icon as __PaintBrushHugeIcon, Rocket01Icon as __RocketHugeIcon, Shield01Icon as __ShieldHugeIcon, SparklesIcon as __SparklesHugeIcon, SwatchIcon as __SwatchHugeIcon, Wrench01Icon as __ToolsHugeIcon } from '@hugeicons/core-free-icons'

import { asHugeIcon } from '@/lib/icons/asHugeIcon'
const Download = asHugeIcon(__DownloadHugeIcon)
const Bolt = asHugeIcon(__BoltHugeIcon)
const Chat = asHugeIcon(__ChatHugeIcon)
const CloudDownload = asHugeIcon(__CloudDownloadHugeIcon)
const Code = asHugeIcon(__CodeHugeIcon)
const CommandLine = asHugeIcon(__CommandLineHugeIcon)
const Chip = asHugeIcon(__ChipHugeIcon)
const Eye = asHugeIcon(__EyeHugeIcon)
const PaintBrush = asHugeIcon(__PaintBrushHugeIcon)
const Rocket = asHugeIcon(__RocketHugeIcon)
const Shield = asHugeIcon(__ShieldHugeIcon)
const Sparkles = asHugeIcon(__SparklesHugeIcon)
const Swatch = asHugeIcon(__SwatchHugeIcon)
const Tools = asHugeIcon(__ToolsHugeIcon)
export type AppStoreCategoryId =
  | "discover"
  | "agent-kits"
  | "preview-tools"
  | "runtimes"
  | "build-release"
  | "themes"
  | "updates"

export interface AppStoreCategory {
  id: AppStoreCategoryId
  label: string
  description: string
  heroEyebrow: string
  heroTitle: string
  heroDescription: string
  icon: ComponentType<{ className?: string }>
}

export interface AppStoreFeatureCard {
  eyebrow: string
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
  accentClassName: string
  categories: AppStoreCategoryId[]
}

export interface AppStorePreviewApp {
  name: string
  category: string
  description: string
  icon: ComponentType<{ className?: string }>
  accentClassName: string
  categories: AppStoreCategoryId[]
}

export const APP_STORE_CATEGORIES: AppStoreCategory[] = [
  {
    id: "discover",
    label: "Discover",
    description: "Curated highlights, featured collections, and the best way to get started with Cozea tools.",
    heroEyebrow: "Featured collection",
    heroTitle: "Curated tools for shipping faster.",
    heroDescription:
      "Expect editorial shelves for launch kits, agent workflows, debugging tools, native previews, and the little utilities that turn projects into products.",
    icon: Sparkles,
  },
  {
    id: "agent-kits",
    label: "Agent Kits",
    description: "Provider presets, prompt packs, agent launchers, and workflow accelerators for AI-first projects.",
    heroEyebrow: "Agent workspace",
    heroTitle: "Prebuilt kits for faster AI workflows.",
    heroDescription:
      "Launch assistants with opinionated defaults, curated prompt bundles, and focused tooling for code, review, planning, and delivery.",
    icon: Chip,
  },
  {
    id: "preview-tools",
    label: "Preview Tools",
    description: "Browsers, simulators, and preview surfaces for testing the product you are actively building.",
    heroEyebrow: "Preview environments",
    heroTitle: "Everything you need to see work in motion.",
    heroDescription:
      "Set up browser workspaces, native simulators, and inspector flows that keep testing close to the code.",
    icon: Eye,
  },
  {
    id: "runtimes",
    label: "Runtimes & CLIs",
    description: "Local runtime packs, command-line tools, shells, and environment utilities for serious development work.",
    heroEyebrow: "Local power",
    heroTitle: "Runtimes that make projects feel alive.",
    heroDescription:
      "Install and manage the local pieces behind previews, builds, shells, and the day-to-day commands your workspace depends on.",
    icon: CommandLine,
  },
  {
    id: "build-release",
    label: "Build & Release",
    description: "Deployment helpers, release rails, sync checks, and delivery-oriented utilities for teams.",
    heroEyebrow: "Release rails",
    heroTitle: "Ship with more confidence and less friction.",
    heroDescription:
      "Surface the operational tools behind deployment, handoff, release prep, and collaborative workspace health.",
    icon: Rocket,
  },
  {
    id: "themes",
    label: "Themes & UI",
    description: "Visual systems, icon packs, interface templates, and presentation layers for workspace polish.",
    heroEyebrow: "Visual systems",
    heroTitle: "Shape the look and feel of your workspace.",
    heroDescription:
      "Find interface packs, theme foundations, and component starting points that make the product feel more intentional from day one.",
    icon: PaintBrush,
  },
  {
    id: "updates",
    label: "Updates",
    description: "Fresh drops, release notes, curated releases, and what is landing next in the store.",
    heroEyebrow: "What’s new",
    heroTitle: "Stay close to what just landed.",
    heroDescription:
      "Track new bundles, improvements, migrations, and the upcoming tools that are about to join the store.",
    icon: Download,
  },
]

export const APP_STORE_FEATURE_CARDS: AppStoreFeatureCard[] = [
  {
    eyebrow: "Agent workspace",
    title: "Provider launch kits",
    description: "Fast starts for Codex, Claude, and future providers with presets tuned for Cozea workbenches.",
    icon: Chip,
    accentClassName: "from-fuchsia-500/25 via-violet-500/15 to-transparent",
    categories: ["discover", "agent-kits"],
  },
  {
    eyebrow: "Preview environments",
    title: "Browsers, dev servers, and device surfaces",
    description: "One place for browsers, mobile simulators, CLIs, and the pieces that make projects feel alive.",
    icon: Eye,
    accentClassName: "from-sky-500/25 via-cyan-500/15 to-transparent",
    categories: ["discover", "preview-tools", "runtimes"],
  },
  {
    eyebrow: "Runtime packs",
    title: "Local tooling with less setup drag",
    description: "Install runtime bundles for shells, language tooling, and the commands your workspace needs most.",
    icon: Tools,
    accentClassName: "from-amber-500/25 via-orange-500/15 to-transparent",
    categories: ["discover", "runtimes"],
  },
  {
    eyebrow: "Release rails",
    title: "Deployment helpers and delivery checks",
    description: "Shared workflows for permissions, release prep, sync, and deployment checks are on the way.",
    icon: Shield,
    accentClassName: "from-emerald-500/25 via-teal-500/15 to-transparent",
    categories: ["discover", "build-release", "updates"],
  },
  {
    eyebrow: "Interface packs",
    title: "Themes and presentation systems",
    description: "Store-curated icon sets, templates, and polish layers for workspaces that need stronger visual identity.",
    icon: Swatch,
    accentClassName: "from-rose-500/20 via-pink-500/10 to-transparent",
    categories: ["discover", "themes"],
  },
  {
    eyebrow: "Fresh arrivals",
    title: "Editorial shelves and release spotlights",
    description: "A calmer way to see what is new, what changed, and which tools are worth installing next.",
    icon: Bolt,
    accentClassName: "from-indigo-500/20 via-blue-500/10 to-transparent",
    categories: ["discover", "updates"],
  },
]

export const APP_STORE_PREVIEW_APPS: AppStorePreviewApp[] = [
  {
    name: "Runtime Lab",
    category: "Developer tools",
    description: "Install local runtime packs for bun, node, python, and build chains.",
    icon: Tools,
    accentClassName: "bg-[#1d1f24] text-white",
    categories: ["discover", "runtimes"],
  },
  {
    name: "Preview Deck",
    category: "Web surfaces",
    description: "Launch persistent browser setups, preview presets, and inspector bundles.",
    icon: CloudDownload,
    accentClassName: "bg-[#316bff] text-white",
    categories: ["discover", "preview-tools"],
  },
  {
    name: "Agent Kits",
    category: "AI workflows",
    description: "Drop in provider presets, prompt packs, and opinionated tile templates.",
    icon: Chip,
    accentClassName: "bg-[#8b5cf6] text-white",
    categories: ["discover", "agent-kits"],
  },
  {
    name: "Prompt Atlas",
    category: "AI workflows",
    description: "Curated prompt libraries and reusable working styles for different kinds of build sessions.",
    icon: Chat,
    accentClassName: "bg-[#5b5bd6] text-white",
    categories: ["agent-kits"],
  },
  {
    name: "Mobile Mirror",
    category: "Native preview",
    description: "Ready-made simulator setups for validating mobile surfaces without extra ceremony.",
    icon: Eye,
    accentClassName: "bg-[#6d63ff] text-white",
    categories: ["preview-tools"],
  },
  {
    name: "Release Radar",
    category: "Delivery",
    description: "Track release readiness, launch notes, and what needs attention before shipping.",
    icon: Rocket,
    accentClassName: "bg-[#0f172a] text-white",
    categories: ["discover", "build-release", "updates"],
  },
  {
    name: "Theme Foundry",
    category: "Visual systems",
    description: "Store-curated icon sets, themes, templates, and workspace presentation packs.",
    icon: Swatch,
    accentClassName: "bg-[#f2b539] text-[#362500]",
    categories: ["discover", "themes"],
  },
  {
    name: "Change Logbook",
    category: "Updates",
    description: "See curated store drops, migration notes, and what changed across installed tools.",
    icon: Download,
    accentClassName: "bg-[#0f766e] text-white",
    categories: ["updates"],
  },
  {
    name: "Flight Checks",
    category: "Build & release",
    description: "Preflight checks for sync, deployment handoff, and production readiness.",
    icon: Shield,
    accentClassName: "bg-[#ef6f4e] text-white",
    categories: ["build-release"],
  },
  {
    name: "Code Garden",
    category: "Extensions",
    description: "Discover add-ons that enrich the editor, diff, review, and repository flow.",
    icon: Code,
    accentClassName: "bg-[#0b1320] text-white",
    categories: ["discover", "runtimes", "build-release"],
  },
]

export function resolveAppStoreCategory(value: string | null | undefined): AppStoreCategory {
  return (
    APP_STORE_CATEGORIES.find((category) => category.id === value) ??
    APP_STORE_CATEGORIES[0]
  )
}

