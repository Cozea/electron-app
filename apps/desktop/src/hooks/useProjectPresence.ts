import { useEffect, useCallback, useRef } from "react"
import { useMutation } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useLocation } from '@/lib/router'
import { useCollaborationActivityStore } from "@/features/collaboration/model/collaborationActivityStore"
import { useAuth } from "@/contexts/AuthContext"
import { useSafeConvexQuery } from "@/hooks/useSafeConvexQuery"

const HEARTBEAT_INTERVAL_MS = 30 * 1000 // 30 seconds

interface UseProjectPresenceOptions {
  projectId: Id<"projects"> | null | undefined
  userId: Id<"users"> | null | undefined
  userName: string | null | undefined
  userEmail: string | null | undefined
  userAvatarUrl?: string | null
  activeFile?: string | null
  activeRoute?: string | null
}

export interface PresenceUser {
  id: string
  userId: Id<"users">
  userName: string
  userEmail: string
  userAvatarUrl?: string
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
  userId,
  userName,
  userEmail,
  userAvatarUrl,
  activeFile,
  activeRoute,
}: UseProjectPresenceOptions) {
  const location = useLocation()
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

  // Determine active tab from current route
  const getActiveTab = useCallback(() => {
    const path = location.pathname
    if (path.includes("/workbench")) return "workbench"
    if (path.includes("/settings")) return "settings"
    if (path.includes("/deployments")) return "deployments"
    return "editor"
  }, [location.pathname])
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

  // Send heartbeat
  const sendHeartbeat = useCallback(async () => {
    if (!projectId || !userId || !userName || !userEmail) return
    // Same gate as the query: without a device token the server rejects this,
    // and the 30s interval would turn that into a steady warning drip.
    if (!isConvexAuthReady) return

    try {
      const snapshot = activitySnapshotRef.current
      await heartbeat({
        projectId,
        userId,
        userName,
        userEmail,
        userAvatarUrl: userAvatarUrl ?? undefined,
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
  }, [heartbeat, isConvexAuthReady, projectId, userAvatarUrl, userEmail, userId, userName])

  // Handle leaving
  const handleLeave = useCallback(async () => {
    if (!projectId || !userId || !isConvexAuthReady) return

    try {
      await leave({ projectId, userId })
    } catch (error) {
      console.warn("[Presence] Leave failed:", error)
    }
  }, [isConvexAuthReady, projectId, userId, leave])

  // Start heartbeat on mount, cleanup on unmount
  useEffect(() => {
    if (!projectId || !userId || !userName || !userEmail) return

    // Send initial heartbeat
    sendHeartbeat()

    // Set up interval
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

    // Cleanup on unmount
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
      // Fire and forget leave - don't await to avoid blocking unmount
      handleLeave()
    }
  }, [projectId, userId, userName, userEmail, sendHeartbeat, handleLeave])

  // Send heartbeat when tab changes
  useEffect(() => {
    if (projectId && userId) {
      sendHeartbeat()
    }
  }, [activeTab, projectId, userId, sendHeartbeat])

  // Send an immediate transition heartbeat for typing/agent-status changes.
  useEffect(() => {
    if (!projectId || !userId || !userName || !userEmail) return
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
    userEmail,
    userId,
    userName,
  ])

  // Handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        sendHeartbeat()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [sendHeartbeat])

  // Handle beforeunload to send leave
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery on page close
      if (projectId && userId) {
        // Note: Can't use Convex mutation in beforeunload, but the heartbeat
        // timeout will handle cleanup. This is a best-effort cleanup.
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [projectId, userId])

  useEffect(() => {
    return () => {
      collaborationActions.reset()
    }
  }, [collaborationActions])

  // Presence is a decorative avatar stack. It must never be able to take down
  // the project view, so it skips until Convex actually holds a device token and
  // reports a server rejection as an empty roster rather than throwing into the
  // route error boundary. `getActiveUsers` is an `authenticatedQuery`: it
  // rejects with "Authentication required" during the startup window where the
  // shell is painted but auth has not been re-established, and with "The
  // authenticated device cannot access this project" if membership is lost.
  const activeUsersQuery = useSafeConvexQuery(
    api.projectPresence.getActiveUsers,
    projectId && isConvexAuthReady ? { projectId } : "skip"
  )

  useEffect(() => {
    if (activeUsersQuery.status !== "error") return
    console.warn("[Presence] Active-user query failed; hiding presence:", activeUsersQuery.error)
  }, [activeUsersQuery.error, activeUsersQuery.status])

  const activeUsers = activeUsersQuery.data

  // Filter out current user from the list for display purposes
  const otherUsers = activeUsers?.filter((u) => u.userId !== userId) ?? []

  return {
    activeUsers: activeUsers ?? [],
    otherUsers,
    isLoading: activeUsersQuery.status === "loading",
    error: activeUsersQuery.error,
    sendHeartbeat,
  }
}
