import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { RuntimeEnsureResult, RuntimeKind } from '@/types/electron'

export type RuntimeInstallStatus = 'idle' | 'installing' | 'success' | 'error'

export interface RuntimeInstallJob {
  runtime: RuntimeKind
  status: RuntimeInstallStatus
  progress: number
  error?: string
  startedAt?: number
  finishedAt?: number
}

interface RuntimeInstallStore {
  jobs: Partial<Record<RuntimeKind, RuntimeInstallJob>>
  ensureRuntimeInstalled: (runtime: RuntimeKind) => Promise<RuntimeEnsureResult | null>
  resetRuntimeInstallJob: (runtime: RuntimeKind) => void
}

const progressTimers = new Map<RuntimeKind, ReturnType<typeof setInterval>>()
const activeInstalls = new Map<RuntimeKind, Promise<RuntimeEnsureResult | null>>()

function stopProgressTimer(runtime: RuntimeKind) {
  const timer = progressTimers.get(runtime)
  if (!timer) return
  clearInterval(timer)
  progressTimers.delete(runtime)
}

function startProgressTimer(runtime: RuntimeKind) {
  stopProgressTimer(runtime)
  const timer = setInterval(() => {
    useRuntimeInstallStore.setState((state) => {
      const current = state.jobs[runtime]
      if (!current || current.status !== 'installing') return state
      const remaining = Math.max(0, 95 - current.progress)
      if (remaining <= 0) return state
      const bump = Math.min(remaining, Math.max(1, Math.ceil(remaining * 0.18)))
      return {
        jobs: {
          ...state.jobs,
          [runtime]: {
            ...current,
            progress: Math.min(95, current.progress + bump),
          },
        },
      }
    })
  }, 600)
  progressTimers.set(runtime, timer)
}

export const useRuntimeInstallStore = create<RuntimeInstallStore>()(
  immer((set, get) => ({
    jobs: {},

    ensureRuntimeInstalled: async (runtime) => {
      const existing = activeInstalls.get(runtime)
      if (existing) return existing
      const previousJob = get().jobs[runtime]
      const shouldRepairLocalFiles = previousJob?.status === 'error'

      const installPromise = (async () => {
        set((draft) => {
          draft.jobs[runtime] = {
            runtime,
            status: 'installing',
            progress: 4,
            error: undefined,
            startedAt: Date.now(),
            finishedAt: undefined,
          }
        })

        startProgressTimer(runtime)

        try {
          if (!window.electronAPI?.runtime?.ensureRuntime) {
            throw new Error('Runtime install API is unavailable in this environment.')
          }

          const result = await window.electronAPI.runtime.ensureRuntime({
            runtime,
            cleanBrokenLocalFiles: shouldRepairLocalFiles,
          })
          stopProgressTimer(runtime)

          if (result.success) {
            set((draft) => {
              draft.jobs[runtime] = {
                runtime,
                status: 'success',
                progress: 100,
                error: undefined,
                startedAt: draft.jobs[runtime]?.startedAt ?? Date.now(),
                finishedAt: Date.now(),
              }
            })
            return result
          }

          set((draft) => {
            draft.jobs[runtime] = {
              runtime,
              status: 'error',
              progress: 0,
              error: result.error || `Runtime ${runtime} is unavailable.`,
              startedAt: draft.jobs[runtime]?.startedAt ?? Date.now(),
              finishedAt: Date.now(),
            }
          })
          return result
        } catch (error) {
          stopProgressTimer(runtime)
          const message = error instanceof Error ? error.message : `Failed to install ${runtime}.`
          set((draft) => {
            draft.jobs[runtime] = {
              runtime,
              status: 'error',
              progress: 0,
              error: message,
              startedAt: draft.jobs[runtime]?.startedAt ?? Date.now(),
              finishedAt: Date.now(),
            }
          })
          return {
            success: false,
            runtime,
            target: 'unknown',
            source: 'missing',
            installed: false,
            error: message,
          } as RuntimeEnsureResult
        } finally {
          activeInstalls.delete(runtime)
        }
      })()

      activeInstalls.set(runtime, installPromise)
      return installPromise
    },

    resetRuntimeInstallJob: (runtime) => {
      stopProgressTimer(runtime)
      const state = get()
      if (!state.jobs[runtime]) return
      set((draft) => {
        delete draft.jobs[runtime]
      })
    },
  }))
)
