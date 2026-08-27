import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { WorkbenchActivity } from "@/features/projects/components/workbench/WorkbenchActivity"
import { WorkbenchDockviewSession } from "@/features/projects/components/workbench/WorkbenchDockviewSession"
import {
  areWorkbenchKeepAliveSessionsEqual,
  selectWorkbenchKeepAliveSessions,
  type WorkbenchKeepAliveSession,
} from "@/features/projects/components/workbench/workbenchKeepAlive"
import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

interface WorkbenchKeepAliveHostProps {
  current: WorkbenchKeepAliveSession | null
  getWorkbenchSession: () => WorkbenchSessionSnapshot | null
  fallback: ReactNode
}

export function WorkbenchKeepAliveHost({
  current,
  getWorkbenchSession,
  fallback,
}: WorkbenchKeepAliveHostProps) {
  const [sessions, setSessions] = useState<WorkbenchKeepAliveSession[]>(() =>
    current ? [current] : [],
  )
  const frozenSnapshotsRef = useRef(new Map<string, WorkbenchSessionSnapshot | null>())
  const frozenGettersRef = useRef(new Map<string, () => WorkbenchSessionSnapshot | null>())

  useLayoutEffect(() => {
    if (!current) {
      return
    }

    frozenSnapshotsRef.current.set(current.scopeKey, getWorkbenchSession())
    if (!frozenGettersRef.current.has(current.scopeKey)) {
      const scopeKey = current.scopeKey
      frozenGettersRef.current.set(scopeKey, () => frozenSnapshotsRef.current.get(scopeKey) ?? null)
    }

    setSessions((previous) => {
      const themedPrevious = previous.map((session) =>
        session.scopeKey === current.scopeKey
          ? session
          : session.themeScheme === current.themeScheme
            ? session
            : { ...session, themeScheme: current.themeScheme },
      )
      const next = selectWorkbenchKeepAliveSessions(current, themedPrevious)
      const kept = new Set(next.map((session) => session.scopeKey))
      for (const scopeKey of Array.from(frozenSnapshotsRef.current.keys())) {
        if (!kept.has(scopeKey)) {
          frozenSnapshotsRef.current.delete(scopeKey)
          frozenGettersRef.current.delete(scopeKey)
        }
      }
      if (
        previous.length === next.length &&
        previous.every((session, index) => {
          const other = next[index]
          return other ? areWorkbenchKeepAliveSessionsEqual(session, other) : false
        })
      ) {
        return previous
      }
      return next
    })
  }, [current, getWorkbenchSession])

  const visibleScopeKey = current?.scopeKey ?? sessions[0]?.scopeKey ?? null

  if (sessions.length === 0) {
    return <>{fallback}</>
  }

  return (
    <div className="relative isolate h-full min-h-0 w-full min-w-0 overflow-hidden">
      {sessions.map((session) => (
        <WorkbenchActivity
          key={session.scopeKey}
          name={`workbench:${session.scopeKey}`}
          mode={session.scopeKey === visibleScopeKey ? "visible" : "hidden"}
        >
          <WorkbenchDockviewSession
            session={session}
            isActive={session.scopeKey === visibleScopeKey}
            getWorkbenchSession={
              current?.scopeKey === session.scopeKey
                ? getWorkbenchSession
                : (frozenGettersRef.current.get(session.scopeKey) ?? getWorkbenchSession)
            }
          />
        </WorkbenchActivity>
      ))}
    </div>
  )
}
