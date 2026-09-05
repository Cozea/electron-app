import { useEffect, useState } from "react"
import type { SessionWorkspaceBinding } from "@shared/collaborationDesktop"

/** Catalog ownership must resolve before legacy synchronization touches a path. */
export function useSessionWorkspaceBinding(workspaceId: string | null | undefined) {
  const [resolved, setResolved] = useState<{ workspaceId: string; binding: SessionWorkspaceBinding | null } | null>(null)
  useEffect(() => {
    if (!workspaceId) return
    let alive = true
    const refresh = () => {
      void window.electronAPI.collaboration.bindingForWorkspace(workspaceId).then(binding => {
        if (alive) setResolved({ workspaceId, binding })
      }).catch(() => { if (alive) setResolved(null) })
    }
    refresh()
    const unsubscribe = window.electronAPI.collaboration.runtime.onChanged(refresh)
    return () => { alive = false; unsubscribe() }
  }, [workspaceId])
  return { ready: !workspaceId || resolved?.workspaceId === workspaceId,
    binding: resolved && resolved.workspaceId === workspaceId ? resolved.binding : null }
}
