import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type ProblemSource = 'tsserver' | 'eslint' | 'runtime' | 'build'
export type ProblemSeverity = 'error' | 'warning' | 'info'

export interface ProblemItem {
  id: string
  source: ProblemSource
  severity: ProblemSeverity
  message: string
  file?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  code?: string
  related?: Array<{ message: string; file?: string; line?: number; column?: number }>
  createdAt: number
  dismissed: boolean
}

export type ProblemInput = Omit<ProblemItem, 'id' | 'createdAt' | 'dismissed'> & { id?: string }

interface ProblemsState {
  problemsByProject: Record<string, ProblemItem[]>
  lastReadAtByProject: Record<string, number>
  actions: {
    replaceDiagnostics: (projectPath: string, source: ProblemSource, items: ProblemInput[]) => void
    addRuntimeProblem: (projectPath: string, item: ProblemInput) => void
    dismissProblem: (projectPath: string, id: string) => void
    clearProblems: (projectPath: string) => void
    clearProblemsBySource: (projectPath: string, source: ProblemSource) => void
    markRead: (projectPath: string) => void
  }
}

const normalizePath = (value: string) => value.replace(/^file:\/\//i, '').replace(/\\/g, '/')

const makeProblemId = (problem: ProblemInput) => {
  const file = problem.file ? normalizePath(problem.file).toLowerCase() : ''
  const line = problem.line ?? 0
  const column = problem.column ?? 0
  const code = problem.code ?? ''
  return `${problem.source}:${file}:${line}:${column}:${code}:${problem.message}`
}

const normalizeProblem = (
  problem: ProblemInput,
  existing?: ProblemItem
): ProblemItem => {
  const id = problem.id || makeProblemId(problem)
  if (existing) {
    return {
      ...problem,
      id,
      createdAt: existing.createdAt,
      dismissed: existing.dismissed,
    }
  }
  return {
    ...problem,
    id,
    createdAt: Date.now(),
    dismissed: false,
  }
}

export const useProblemsStore = create<ProblemsState>()(
  immer((set) => ({
    problemsByProject: {},
    lastReadAtByProject: {},
    actions: {
      replaceDiagnostics: (projectPath, source, items) =>
        set((state) => {
          const current = state.problemsByProject[projectPath] ?? []
          const existingById = new Map(current.map((problem) => [problem.id, problem]))

          const updatedItems = items.map((item) => {
            const normalized = normalizeProblem(item, existingById.get(item.id || makeProblemId(item)))
            return normalized
          })

          const retained = current.filter((problem) => problem.source !== source)
          state.problemsByProject[projectPath] = [...retained, ...updatedItems]
        }),
      addRuntimeProblem: (projectPath, item) =>
        set((state) => {
          const current = state.problemsByProject[projectPath] ?? []
          const id = item.id || makeProblemId(item)
          const existing = current.find((problem) => problem.id === id)
          const normalized = normalizeProblem(item, existing)
          const deduped = current.filter((problem) => problem.id !== id)
          state.problemsByProject[projectPath] = [normalized, ...deduped]
        }),
      dismissProblem: (projectPath, id) =>
        set((state) => {
          const current = state.problemsByProject[projectPath] ?? []
          const target = current.find((problem) => problem.id === id)
          if (target) {
            target.dismissed = true
          }
        }),
      clearProblems: (projectPath) =>
        set((state) => {
          state.problemsByProject[projectPath] = []
        }),
      clearProblemsBySource: (projectPath, source) =>
        set((state) => {
          const current = state.problemsByProject[projectPath] ?? []
          state.problemsByProject[projectPath] = current.filter((problem) => problem.source !== source)
        }),
      markRead: (projectPath) =>
        set((state) => {
          state.lastReadAtByProject[projectPath] = Date.now()
        }),
    },
  }))
)

const EMPTY_PROBLEMS: ProblemItem[] = []

export const selectProjectProblems = (projectPath: string | null | undefined) => (state: ProblemsState) =>
  projectPath ? state.problemsByProject[projectPath] ?? EMPTY_PROBLEMS : EMPTY_PROBLEMS

export const selectUnreadCount = (projectPath: string | null | undefined) => (state: ProblemsState) => {
  if (!projectPath) return 0
  const problems = state.problemsByProject[projectPath] ?? []
  const lastReadAt = state.lastReadAtByProject[projectPath] ?? 0
  return problems.filter((problem) => !problem.dismissed && problem.createdAt > lastReadAt).length
}
