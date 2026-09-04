/**
 * Which sprite sets the project icons may draw from.
 *
 * A user appearance preference, not project domain: settings toggles it and the
 * icon reads it, and nothing here knows what a project is. It lived under
 * `features/projects/model` because of the word in its name, which is also how
 * the icon that reads it ended up there.
 */

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export type ProjectIconSetId = "invaders" | "pacman" | "tetris" | "adventure"

export interface ProjectIconSetMeta {
  id: ProjectIconSetId
  name: string
  description: string
  sampleNames: readonly string[]
}

export const PROJECT_ICON_SETS: readonly ProjectIconSetMeta[] = [
  {
    id: "invaders",
    name: "Space Invaders",
    description: "Classic 1978 arcade aliens: Crab, Squid, and Octopus.",
    sampleNames: ["sample-crab", "sample-squid", "sample-octopus"],
  },
  {
    id: "pacman",
    name: "Pac-Man & Arcade",
    description: "Iconic 1980s sprites: Pac-Man, Blinky Ghost, and Cherries.",
    sampleNames: ["sample-pacman", "sample-ghost", "sample-cherry"],
  },
  {
    id: "tetris",
    name: "Tetris Blocks",
    description: "Tetrominoes assembled from distinct square blocks: T, L, Z, S, and O.",
    sampleNames: ["sample-tetris-t", "sample-tetris-l", "sample-tetris-o"],
  },
  {
    id: "adventure",
    name: "8-Bit Adventure",
    description: "Retro quest items: Heart, Star, Mushroom, Key, Gem, Potion, Skull, and Sword.",
    sampleNames: ["sample-heart", "sample-star", "sample-mushroom"],
  },
] as const

export interface ProjectIconSetsState {
  enabledSets: Record<ProjectIconSetId, boolean>
  actions: {
    toggleSet: (id: ProjectIconSetId) => void
    setSetEnabled: (id: ProjectIconSetId, enabled: boolean) => void
    enableAll: () => void
    disableAll: () => void
  }
}

export const useProjectIconSetsStore = create<ProjectIconSetsState>()(
  persist(
    (set) => ({
      enabledSets: {
        invaders: true,
        pacman: true,
        tetris: true,
        adventure: true,
      },
      actions: {
        toggleSet: (id) =>
          set((state) => ({
            enabledSets: {
              ...state.enabledSets,
              [id]: !state.enabledSets[id],
            },
          })),
        setSetEnabled: (id, enabled) =>
          set((state) => ({
            enabledSets: {
              ...state.enabledSets,
              [id]: enabled,
            },
          })),
        enableAll: () =>
          set({
            enabledSets: {
              invaders: true,
              pacman: true,
              tetris: true,
              adventure: true,
            },
          }),
        disableAll: () =>
          set({
            enabledSets: {
              invaders: false,
              pacman: false,
              tetris: false,
              adventure: false,
            },
          }),
      },
    }),
    {
      name: "cozea.appearance.projectIconSets",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ enabledSets: state.enabledSets }),
    },
  ),
)
