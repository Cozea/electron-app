import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useDependenciesStore, selectDependenciesSnapshot } from '@/stores/useDependenciesStore'

const REFRESH_INTERVAL_MS = 60 * 60 * 1000
const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000
const WATCH_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
])

function normalizeFileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function useDependenciesMonitor(projectPath: string | null) {
  const setSnapshot = useDependenciesStore((state) => state.actions.setSnapshot)
  const setError = useDependenciesStore((state) => state.actions.setError)
  const upsertJob = useDependenciesStore((state) => state.actions.upsertJob)
  const snapshotSelector = useMemo(
    () => selectDependenciesSnapshot(projectPath),
    [projectPath]
  )
  const snapshot = useDependenciesStore(snapshotSelector)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const inspect = useCallback(async () => {
    if (!projectPath || !window.electronAPI?.dependencies) return
    try {
      const result = await window.electronAPI.dependencies.inspect({ projectPath })
      if (result.success && result.snapshot) {
        setSnapshot(projectPath, result.snapshot)
      } else if (result.error) {
        setError(projectPath, result.error)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to inspect dependencies'
      setError(projectPath, message)
    }
  }, [projectPath, setSnapshot, setError])

  useEffect(() => {
    if (!projectPath) return
    void inspect()
  }, [projectPath, inspect])

  useEffect(() => {
    if (!projectPath || !window.electronAPI?.yjs) return
    const normalizedProjectPath = normalizePath(projectPath)
    const unsubscribe = window.electronAPI.yjs.onExternalFileChange((payload) => {
      const changedPath = normalizePath(payload.filePath)
      if (!changedPath.startsWith(`${normalizedProjectPath}/`) && changedPath !== normalizedProjectPath) {
        return
      }
      const fileName = normalizeFileName(payload.filePath)
      if (!WATCH_FILES.has(fileName)) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void inspect()
      }, 500)
    })
    return () => {
      unsubscribe?.()
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [projectPath, inspect])

  useEffect(() => {
    if (!projectPath) return
    const interval = setInterval(() => {
      const lastChecked = snapshot?.lastCheckedAt ?? 0
      if (Date.now() - lastChecked > REGISTRY_TTL_MS) {
        void inspect()
      }
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [projectPath, snapshot?.lastCheckedAt, inspect])

  useEffect(() => {
    if (!projectPath || !window.electronAPI?.dependencies) return
    const unsubscribe = window.electronAPI.dependencies.onJobStatus((payload) => {
      if (payload.projectPath !== projectPath) return
      upsertJob(projectPath, payload.job)
      if (payload.job.status === 'success') {
        void inspect()
      } else if (payload.job.status === 'error' && payload.job.error) {
        setError(projectPath, payload.job.error)
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [projectPath, upsertJob, inspect, setError])
}
