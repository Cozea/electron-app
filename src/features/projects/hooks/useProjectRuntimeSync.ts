import { useEffect } from 'react'

import {
  selectProjectRuntimeState,
  useProjectRuntimeStore,
} from '@/stores/useProjectRuntimeStore'

export function useProjectRuntimeSync(projectPath: string | null, enabled: boolean, sessionId?: string | null) {
  const recordRuntimeEvent = useProjectRuntimeStore((state) => state.recordRuntimeEvent)
  const recordLogEvent = useProjectRuntimeStore((state) => state.recordLogEvent)
  const setTools = useProjectRuntimeStore((state) => state.setTools)
  const runtimeState = useProjectRuntimeStore(selectProjectRuntimeState(projectPath))

  useEffect(() => {
    if (!enabled || !projectPath) {
      return
    }

    const disposeRuntime = window.electronAPI.radon.onRuntimeEvent((event) => {
      if (event.projectPath !== projectPath) {
        return
      }
      recordRuntimeEvent(projectPath, event)
    })

    const disposeTools = window.electronAPI.radon.onToolsUpdated((event) => {
      if (event.projectPath !== projectPath || !event.sessionId) {
        return
      }
      setTools(projectPath, event.sessionId, event.tools)
    })

    const disposeLogs = window.electronAPI.radon.onLogEvent((event) => {
      if (event.projectPath !== projectPath) {
        return
      }
      recordLogEvent(projectPath, event)
    })

    return () => {
      disposeRuntime()
      disposeTools()
      disposeLogs()
    }
  }, [enabled, projectPath, recordLogEvent, recordRuntimeEvent, setTools])

  useEffect(() => {
    if (!enabled || !projectPath || !sessionId) {
      return
    }

    let cancelled = false
    void window.electronAPI.radon.getAvailableTools({ sessionId }).then((result) => {
      if (cancelled || !result.success || !result.tools) {
        return
      }
      setTools(projectPath, sessionId, result.tools)
    })

    return () => {
      cancelled = true
    }
  }, [enabled, projectPath, sessionId, setTools])

  return runtimeState
}
