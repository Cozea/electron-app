import { useEffect } from "react"

export function ProjectRemovalHost() {
  useEffect(() => {
    const api = window.electronAPI?.workspace?.projects
    if (!api?.onRemovalRequest) return
    return api.onRemovalRequest((request) => {
      void import("../lib/projectRemovalRenderer").then((module) => module.handleProjectRemovalRequest(request)).then(
        () => api.replyRemoval(request.requestId, null),
        (error: unknown) => api.replyRemoval(request.requestId, error instanceof Error ? error.message : String(error)),
      ).catch((error: unknown) => console.warn("[ProjectRemoval] Native acknowledgment failed", error))
    })
  }, [])
  return null
}
