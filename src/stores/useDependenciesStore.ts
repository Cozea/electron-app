import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export interface DependencyItem {
  name: string
  type: 'dependency' | 'devDependency' | 'optionalDependency' | 'peerDependency'
  declared: string
  installed?: string
  wanted?: string
  latest?: string
  status: 'upToDate' | 'outdated' | 'missing' | 'unknown'
}

export interface DependencySnapshot {
  items: DependencyItem[]
  pm: 'npm' | 'yarn' | 'pnpm' | 'bun'
  lastCheckedAt: number
  error?: string
}

export interface DependencyJob {
  id: string
  action: 'add' | 'update' | 'remove'
  packageName: string
  status: 'running' | 'success' | 'error'
  startedAt: number
  finishedAt?: number
  stdout: string[]
  stderr: string[]
  error?: string
}

interface DependenciesState {
  byProject: Record<string, DependencySnapshot | undefined>
  jobsByProject: Record<string, DependencyJob[]>
  actions: {
    setSnapshot: (projectPath: string, snapshot: DependencySnapshot) => void
    setError: (projectPath: string, error: string) => void
    upsertJob: (projectPath: string, job: Omit<DependencyJob, 'stdout' | 'stderr'> & { stdout?: string; stderr?: string }) => void
    clearJobs: (projectPath: string) => void
  }
}

export const useDependenciesStore = create<DependenciesState>()(
  immer((set) => ({
    byProject: {},
    jobsByProject: {},
    actions: {
      setSnapshot: (projectPath, snapshot) =>
        set((state) => {
          state.byProject[projectPath] = snapshot
        }),
      setError: (projectPath, error) =>
        set((state) => {
          const existing = state.byProject[projectPath]
          state.byProject[projectPath] = {
            items: existing?.items ?? [],
            pm: existing?.pm ?? 'npm',
            lastCheckedAt: existing?.lastCheckedAt ?? Date.now(),
            error,
          }
        }),
      upsertJob: (projectPath, job) =>
        set((state) => {
          const jobs = state.jobsByProject[projectPath] ?? []
          const existing = jobs.find((item) => item.id === job.id)
          if (!existing) {
            jobs.unshift({
              id: job.id,
              action: job.action,
              packageName: job.packageName,
              status: job.status,
              startedAt: job.startedAt,
              finishedAt: job.finishedAt,
              stdout: job.stdout ? [job.stdout] : [],
              stderr: job.stderr ? [job.stderr] : [],
              error: job.error,
            })
          } else {
            existing.status = job.status
            existing.finishedAt = job.finishedAt ?? existing.finishedAt
            existing.error = job.error ?? existing.error
            if (job.stdout) existing.stdout.push(job.stdout)
            if (job.stderr) existing.stderr.push(job.stderr)
          }
          state.jobsByProject[projectPath] = jobs
        }),
      clearJobs: (projectPath) =>
        set((state) => {
          state.jobsByProject[projectPath] = []
        }),
    },
  }))
)

export const selectDependenciesSnapshot = (projectPath: string | null | undefined) => (state: DependenciesState) =>
  projectPath ? state.byProject[projectPath] : undefined

export const selectDependencyJobs = (projectPath: string | null | undefined) => (state: DependenciesState) =>
  projectPath ? state.jobsByProject[projectPath] ?? [] : []
