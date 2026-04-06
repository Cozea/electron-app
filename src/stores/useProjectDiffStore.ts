// @ts-nocheck
import { create } from 'zustand'

export interface ProjectDiffStatus {
  downloads: number  // Files newer in cloud
  uploads: number    // Files newer locally
  conflicts: number  // Files changed in both
  lastChecked: number
  isChecking: boolean
  error?: string
}

interface ProjectDiffStore {
  // Map of projectSlug -> diff status
  diffs: Record<string, ProjectDiffStatus>

  // Set diff status for a project
  setDiffStatus: (slug: string, status: Partial<ProjectDiffStatus>) => void

  // Mark a project as checking
  setChecking: (slug: string, isChecking: boolean) => void

  // Clear diff status for a project (after sync completes)
  clearDiff: (slug: string) => void

  // Get total pending changes for a project
  getTotalChanges: (slug: string) => number
}

export const useProjectDiffStore = create<ProjectDiffStore>((set, get) => ({
  diffs: {},

  setDiffStatus: (slug, status) => {
    set((state) => ({
      diffs: {
        ...state.diffs,
        [slug]: {
          ...state.diffs[slug],
          downloads: 0,
          uploads: 0,
          conflicts: 0,
          lastChecked: Date.now(),
          isChecking: false,
          ...status,
        },
      },
    }))
  },

  setChecking: (slug, isChecking) => {
    set((state) => ({
      diffs: {
        ...state.diffs,
        [slug]: {
          ...state.diffs[slug],
          downloads: state.diffs[slug]?.downloads ?? 0,
          uploads: state.diffs[slug]?.uploads ?? 0,
          conflicts: state.diffs[slug]?.conflicts ?? 0,
          lastChecked: state.diffs[slug]?.lastChecked ?? 0,
          isChecking,
        },
      },
    }))
  },

  clearDiff: (slug) => {
    set((state) => ({
      diffs: {
        ...state.diffs,
        [slug]: {
          downloads: 0,
          uploads: 0,
          conflicts: 0,
          lastChecked: Date.now(),
          isChecking: false,
        },
      },
    }))
  },

  getTotalChanges: (slug) => {
    const diff = get().diffs[slug]
    if (!diff) return 0
    return diff.downloads + diff.uploads + diff.conflicts
  },
}))
