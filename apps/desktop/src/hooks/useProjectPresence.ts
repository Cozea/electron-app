import { useEffect, useCallback, useMemo, useRef } from "react"
import { useMutation } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useLocation } from '@/lib/router'
import { useCollaborationActivityStore } from "@/features/collaboration/model/collaborationActivityStore"
import { useAuth } from "@/contexts/AuthContext"
import { useSafeConvexQuery } from "@/hooks/useSafeConvexQuery"

const HEARTBEAT_INTERVAL_MS = 30 * 1000

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

export function useProjectPresence({
  projectId,
  principalId,
  activeFile,
  activeRoute,
}: UseProjectPresenceOptions) {
  // Only the pathname is used; the whole location would re-render the
  // project layout on search and state changes too.
  const pathname = useLocation({ select: (location) => location.pathname })
  const { isConvexAuthReady } = useAuth()
  const heartbeat = useMutation(api.projectPresence.heartbeat)
  const leave = useMutation(api.projectPresence.leave)
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null)
  const lastTransitionHeartbeatAtRef = useRef(0)
  const {
    isAiTyping,
    isAgentWorking,
    lastActivityAt,
    actions: collaborationActions,
  } = useCollaborationActivityStore((state) => state)
  const activitySnapshotRef = useRef({
    activeFile: activeFile ?? null,
    activeRoute: activeRoute ?? null,
    activeTab: "editor",
    isAiTyping,
    isAgentWorking,
    lastActivityAt,
  })

  const getActiveTab = useCallback(() => {
    const path = pathname
    if (path.includes("/workbench")) return "workbench"
    if (path.includes("/settings")) return "settings"
    if (path.includes("/deployments")) return "deployments"
    return "editor"
  }, [pathname])
  const activeTab = getActiveTab()

  useEffect(() => {
    activitySnapshotRef.current = {
      activeFile: activeFile ?? null,
      activeRoute: activeRoute ?? null,
      activeTab,
      isAiTyping,
      isAgentWorking,
      lastActivityAt,
    }
  }, [activeFile, activeRoute, activeTab, isAiTyping, isAgentWorking, lastActivityAt])

  const sendHeartbeat = useCallback(async () => {
    if (!projectId || !principalId || !isConvexAuthReady) return

    try {
      const snapshot = activitySnapshotRef.current
      // Identity and presentation are intentionally absent. Convex derives the
      // canonical device principal from ctx.auth and reads its name/avatar.
      await heartbeat({
        projectId,
        activeTab: snapshot.activeTab,
        activeFile: snapshot.activeFile ?? undefined,
        activeRoute: snapshot.activeRoute ?? undefined,
        isAiTyping: snapshot.isAiTyping,
        isAgentWorking: snapshot.isAgentWorking,
        lastActivityAt: snapshot.lastActivityAt > 0 ? snapshot.lastActivityAt : undefined,
      })
    } catch (error) {
      console.warn("[Presence] Heartbeat failed:", error)
    }
  }, [heartbeat, isConvexAuthReady, projectId, principalId])

  const handleLeave = useCallback(async () => {
    if (!projectId || !principalId || !isConvexAuthReady) return

    try {
      await leave({ projectId })
    } catch (error) {
      console.warn("[Presence] Leave failed:", error)
    }
  }, [isConvexAuthReady, projectId, principalId, leave])

  useEffect(() => {
    if (!projectId || !principalId) return

    void sendHeartbeat()
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
      void handleLeave()
    }
  }, [projectId, principalId, sendHeartbeat, handleLeave])

  useEffect(() => {
    if (projectId && principalId) void sendHeartbeat()
  }, [activeTab, projectId, principalId, sendHeartbeat])

  useEffect(() => {
    if (!projectId || !principalId) return
    const now = Date.now()
    if (now - lastTransitionHeartbeatAtRef.current < 1000) return
    lastTransitionHeartbeatAtRef.current = now
    void sendHeartbeat()
  }, [
    activeFile,
    activeRoute,
    isAgentWorking,
    isAiTyping,
    projectId,
    sendHeartbeat,
    principalId,
  ])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void sendHeartbeat()
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [sendHeartbeat])

  useEffect(() => {
    const handleBeforeUnload = () => {
      // Convex mutations cannot be reliably sent during beforeunload; expiry
      // handles cleanup.
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])

  useEffect(() => {
    return () => {
      collaborationActions.reset()
    }
  }, [collaborationActions])

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
    sendHeartbeat,
  }
}
