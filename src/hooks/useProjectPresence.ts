import { useEffect, useCallback, useRef } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { useLocation } from "react-router-dom"

const HEARTBEAT_INTERVAL_MS = 30 * 1000 // 30 seconds

interface UseProjectPresenceOptions {
  projectId: Id<"projects"> | null | undefined
  userId: Id<"users"> | null | undefined
  userName: string | null | undefined
  userEmail: string | null | undefined
  userAvatarUrl?: string | null
}

export interface PresenceUser {
  id: string
  userId: Id<"users">
  userName: string
  userEmail: string
  userAvatarUrl?: string
  activeTab?: string
  activeFile?: string
  lastHeartbeat: number
}

export function useProjectPresence({
  projectId,
  userId,
  userName,
  userEmail,
  userAvatarUrl,
}: UseProjectPresenceOptions) {
  const location = useLocation()
  const heartbeat = useMutation(api.projectPresence.heartbeat)
  const leave = useMutation(api.projectPresence.leave)
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null)

  // Determine active tab from current route
  const getActiveTab = useCallback(() => {
    const path = location.pathname
    if (path.includes("/pages")) return "pages"
    if (path.includes("/backend")) return "backend"
    if (path.includes("/settings")) return "settings"
    if (path.includes("/dependencies")) return "dependencies"
    if (path.includes("/deployments")) return "deployments"
    return "editor"
  }, [location.pathname])

  // Send heartbeat
  const sendHeartbeat = useCallback(async () => {
    if (!projectId || !userId || !userName || !userEmail) return

    try {
      await heartbeat({
        projectId,
        userId,
        userName,
        userEmail,
        userAvatarUrl: userAvatarUrl ?? undefined,
        activeTab: getActiveTab(),
      })
    } catch (error) {
      console.warn("[Presence] Heartbeat failed:", error)
    }
  }, [projectId, userId, userName, userEmail, userAvatarUrl, getActiveTab, heartbeat])

  // Handle leaving
  const handleLeave = useCallback(async () => {
    if (!projectId || !userId) return

    try {
      await leave({ projectId, userId })
    } catch (error) {
      console.warn("[Presence] Leave failed:", error)
    }
  }, [projectId, userId, leave])

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
  }, [location.pathname, projectId, userId, sendHeartbeat])

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

  // Query active users
  const activeUsers = useQuery(
    api.projectPresence.getActiveUsers,
    projectId ? { projectId } : "skip"
  )

  // Filter out current user from the list for display purposes
  const otherUsers = activeUsers?.filter((u) => u.userId !== userId) ?? []

  return {
    activeUsers: activeUsers ?? [],
    otherUsers,
    isLoading: activeUsers === undefined,
    sendHeartbeat,
  }
}
