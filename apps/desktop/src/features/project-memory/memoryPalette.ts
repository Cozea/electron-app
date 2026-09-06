import type { ProjectMemoryNodeState } from "@shared/electronApiTypes"

import { resolveAppliedTheme, type Theme } from "@/lib/theme"

/**
 * Colour is the whole point of the memory map: it answers "what moved?" at a glance.
 *
 * Both themes carry the same four hues, because the hue is the meaning: green is
 * new growth, purple is a memory that moved, blue is the resting substrate, and
 * yellow is the thing under the cursor. Only tone changes between themes. Dark
 * mode can afford luminous tints; on a pale canvas the same hues are taken down
 * in lightness and up in chroma so they stay legible without glowing.
 *
 * The light tones are derived, not eyeballed: each holds its dark counterpart's
 * OKLCH hue angle to within half a degree and is placed at the lightness that
 * clears roughly 3.8:1 against the tile canvas. Yellow is the exception, since
 * hue 84 turns olive as it darkens; it sits lighter and leans on the focus ring
 * and white core stroke that only the hovered node gets.
 *
 * Lives here rather than in the tile so the legend swatches and the graph read
 * from one source. They are the same vocabulary, and a legend that disagrees
 * with the canvas is worse than no legend.
 */
export interface MemoryColorPalette {
  state: Record<ProjectMemoryNodeState, string>
  halo: Record<ProjectMemoryNodeState, string>
  edge: Record<ProjectMemoryNodeState, string>
  focus: string
  focusHalo: string
  focusEdge: string
  focusNeighborRing: string
  focusCoreStroke: string
  label: string
  labelStroke: string
}

export const DARK_MEMORY_PALETTE: MemoryColorPalette = {
  state: {
    new: "#3DE6A8",
    changed: "#B072FF",
    unchanged: "#4C8DFF",
  },
  halo: {
    new: "rgba(61, 230, 168, 0.22)",
    changed: "rgba(176, 114, 255, 0.22)",
    unchanged: "rgba(76, 141, 255, 0.14)",
  },
  edge: {
    new: "rgba(61, 230, 168, 0.34)",
    changed: "rgba(176, 114, 255, 0.30)",
    unchanged: "rgba(76, 141, 255, 0.16)",
  },
  focus: "#FFC53D",
  focusHalo: "rgba(255, 197, 61, 0.26)",
  focusEdge: "rgba(255, 197, 61, 0.58)",
  focusNeighborRing: "rgba(255, 201, 64, 0.95)",
  focusCoreStroke: "rgba(255, 255, 255, 0.85)",
  label: "#e5e7eb",
  labelStroke: "rgba(8, 8, 10, 0.9)",
}

export const LIGHT_MEMORY_PALETTE: MemoryColorPalette = {
  state: {
    new: "#1B8962",
    changed: "#8D5CCD",
    unchanged: "#3872DA",
  },
  halo: {
    new: "rgba(27, 137, 98, 0.16)",
    changed: "rgba(141, 92, 205, 0.15)",
    unchanged: "rgba(56, 114, 218, 0.10)",
  },
  edge: {
    new: "rgba(27, 137, 98, 0.28)",
    changed: "rgba(141, 92, 205, 0.25)",
    unchanged: "rgba(56, 114, 218, 0.17)",
  },
  focus: "#D5A226",
  focusHalo: "rgba(213, 162, 38, 0.20)",
  focusEdge: "rgba(213, 162, 38, 0.52)",
  focusNeighborRing: "rgba(213, 162, 38, 0.88)",
  focusCoreStroke: "rgba(255, 255, 255, 0.88)",
  label: "#3F454B",
  labelStroke: "rgba(255, 255, 255, 0.88)",
}

/** `theme` is the user's setting, which may be "system"; the applied theme is what paints. */
export function resolveMemoryPalette(theme: Theme): MemoryColorPalette {
  return resolveAppliedTheme(theme) === "light" ? LIGHT_MEMORY_PALETTE : DARK_MEMORY_PALETTE
}
