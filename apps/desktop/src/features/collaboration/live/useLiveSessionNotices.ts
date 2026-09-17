/**
 * Toasts for what the header's live-session pill can't say in its space: a session
 * on another branch, why saving to Git stopped (with the GitHub step that fixes it),
 * and how the target branch moved.
 *
 * Master Specification: Section 5.3, 23.2
 *
 * Each situation raises one toast. It closes itself when the situation ends, and a
 * toast the user closes stays closed until the situation changes.
 */

import { useEffect, useRef } from "react"

import { toastManager } from "@/components/ui/toast"
import { useGitHubConnect } from "@/features/github/useGitHubConnect"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { describeLiveSessionNotices, type LiveSessionNotice, type LiveSessionNoticeRun } from "./liveSessionModel"
import type { LiveSessionController } from "./useLiveSession"

export function useLiveSessionNotices(live: LiveSessionController | null): void {
  const notices = live ? describeLiveSessionNotices(live) : []
  const signature = notices.map((notice) => notice.key).join("\n")

  const github = useGitHubConnect()
  const liveRef = useRef(live)
  liveRef.current = live
  const githubRef = useRef(github)
  githubRef.current = github
  const noticesRef = useRef<LiveSessionNotice[]>(notices)
  noticesRef.current = notices
  const shown = useRef(new Map<string, string>())
  const dismissed = useRef(new Set<string>())

  useEffect(() => {
    const current = new Set(noticesRef.current.map((notice) => notice.key))
    for (const [key, toastId] of shown.current) {
      if (current.has(key)) continue
      shown.current.delete(key)
      toastManager.close(toastId)
    }
    for (const key of dismissed.current) {
      if (!current.has(key)) dismissed.current.delete(key)
    }

    for (const notice of noticesRef.current) {
      if (shown.current.has(notice.key) || dismissed.current.has(notice.key)) continue
      const action = notice.action
      const toastId = toastManager.add({
        type: notice.type,
        title: notice.title,
        description: notice.description ?? undefined,
        // Toasts that offer a fix wait for the user; the rest fade like any other.
        timeout: action ? 0 : undefined,
        actionProps: action
          ? { children: action.label, onClick: () => runNoticeAction(liveRef.current, githubRef.current, action.run) }
          : undefined,
        onClose: () => {
          // Closed by us because the situation ended: nothing to remember.
          if (shown.current.get(notice.key) !== toastId) return
          shown.current.delete(notice.key)
          dismissed.current.add(notice.key)
          if (notice.dismissesTarget) liveRef.current?.dismissTarget()
        },
      })
      shown.current.set(notice.key, toastId)
    }
  }, [signature])

  useEffect(() => {
    const open = shown.current
    return () => {
      for (const toastId of open.values()) toastManager.close(toastId)
      open.clear()
    }
  }, [])
}

function runNoticeAction(
  live: LiveSessionController | null,
  github: ReturnType<typeof useGitHubConnect>,
  run: LiveSessionNoticeRun,
): void {
  if (!live) return
  switch (run) {
    case "switch": {
      const other = live.otherSessions[0]
      if (other) live.openSessionWorkbench(other.publicSessionId)
      return
    }
    case "ignore_env":
      live.ignoreEnvironmentFiles()
      return
    case "check_target":
      live.checkTarget()
      return
    case "github_link":
      if (live.projectId) void github.link(live.projectId as Id<"projects">, live.recheckGitAccess)
      return
    case "github_copy_link":
      if (live.repository?.repository) void github.copyInstallLink(live.repository.repository.owner)
      return
  }
}
