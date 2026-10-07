import { useEffect, useMemo, useRef } from "react"
import { useMutation } from "@/lib/cloudQueries"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useLocation } from '@/lib/router'
import { useCollaborationActivityStore } from "@/features/collaboration/model/collaborationActivityStore"
import { useAuth } from "@/contexts/AuthContext"
import { useSafeConvexQuery } from "@/hooks/useSafeConvexQuery"

import { createProjectPresencePublisher } from "./projectPresencePublisher"

interface UseProjectPresenceOptions {
  projectId: Id<"projects"> | null | undefined
  // Current principal ID is retained client-side for self-filtering only. The
  // server derives the heartbeat actor from device auth.
  principalId: Id<"devicePrincipals"> | null | undefined
  activeFile?: string | null
  activeRoute?: string | null
}

// Shared empty result, so "nobody here" keeps one identity across renders.
const NO_USERS: never[] = []

export interface PresenceUser {
  id: string
  principalId: Id<"devicePrincipals">
  displayName: string
  avatarUrl?: string
  activeTab?: string
  activeFile?: string
  activeRoute?: string
  isAiTyping?: boolean
  isAgentWorking?: boolean
  lastActivityAt?: number
  lastHeartbeat: number
}

/** Read-only presence consumer; mounting a header never writes or leaves. */
export function useProjectPresence({ projectId, principalId }: UseProjectPresenceOptions) {
  const { isConvexAuthReady } = useAuth()
  const activeUsersQuery = useSafeConvexQuery(
    api.projectPresence.getActiveUsers,
    projectId && isConvexAuthReady ? { projectId } : "skip"
  )

  useEffect(() => {
    if (activeUsersQuery.status !== "error") return
    console.warn("[Presence] Active-user query failed; hiding presence:", activeUsersQuery.error)
  }, [activeUsersQuery.error, activeUsersQuery.status])

  const activeUsers = activeUsersQuery.data
  // Stable between renders so the header's online set is rebuilt only when
  // presence actually changes.
  const otherUsers = useMemo(
    () => activeUsers?.filter((u) => u.principalId !== principalId) ?? NO_USERS,
    [activeUsers, principalId],
  )

  return {
    activeUsers: activeUsers ?? NO_USERS,
    otherUsers,
    isLoading: activeUsersQuery.status === "loading",
    error: activeUsersQuery.error,
  }
}

/** Mounted once by the visible project layout, only for explicit session membership. */
export function useProjectPresencePublisher({ projectId, principalId, activeFile, activeRoute }: UseProjectPresenceOptions) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const { isConvexAuthReady } = useAuth()
  const heartbeat = useMutation(api.projectPresence.heartbeat)
  const leave = useMutation(api.projectPresence.leave)
  const { isAiTyping, isAgentWorking, lastActivityAt } = useCollaborationActivityStore((state) => state)
  const activeTab = pathname.includes("/workbench") ? "workbench" : pathname.includes("/settings") ? "settings" : "editor"
  const snapshot = useRef({ activeFile, activeRoute, activeTab, isAiTyping, isAgentWorking, lastActivityAt })
  snapshot.current = { activeFile, activeRoute, activeTab, isAiTyping, isAgentWorking, lastActivityAt }
  const publisher = useRef<ReturnType<typeof createProjectPresencePublisher> | null>(null)
  useEffect(() => {
    if (!projectId || !principalId || !isConvexAuthReady) return
    const owner = createProjectPresencePublisher({
      heartbeat: async () => {
        const current = snapshot.current
        await heartbeat({
          projectId,
          activeTab: current.activeTab,
          activeFile: current.activeFile ?? undefined,
          activeRoute: current.activeRoute ?? undefined,
          isAiTyping: current.isAiTyping,
          isAgentWorking: current.isAgentWorking,
          lastActivityAt: current.lastActivityAt > 0 ? current.lastActivityAt : undefined,
        })
      },
      leave: () => leave({ projectId }),
      isVisible: () => document.visibilityState === "visible",
      onVisibilityChange: (callback) => {
        document.addEventListener("visibilitychange", callback)
        return () => document.removeEventListener("visibilitychange", callback)
      },
      setInterval: (callback, delay) => setInterval(callback, delay),
      clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
      onError: (error) => console.warn("[Presence] Foreground publication failed:", error),
    }, `${projectId}:${principalId}`)
    publisher.current = owner
    return () => { owner.stop(); if (publisher.current === owner) publisher.current = null }
  }, [projectId, principalId, isConvexAuthReady, heartbeat, leave])
  useEffect(() => { publisher.current?.update() }, [activeFile, activeRoute, activeTab, isAiTyping, isAgentWorking])
}
