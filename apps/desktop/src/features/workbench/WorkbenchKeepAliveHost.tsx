import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { WorkbenchActivity } from "@/features/workbench/WorkbenchActivity"
import { WorkbenchDockviewSession } from "@/features/workbench/WorkbenchDockviewSession"
import {
  areWorkbenchKeepAliveSessionsEqual,
  selectWorkbenchKeepAliveSessions,
  type WorkbenchKeepAliveSession,
} from "@/features/workbench/workbenchKeepAlive"
import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"
import {
  ProjectRouteContext,
  useOptionalProjectRouteContext,
} from "@/contexts/project/ProjectRouteContext"
import {
  ProjectSyncContext,
  useOptionalProjectSyncContext,
} from "@/contexts/project/ProjectSyncContext"
import {
  ActiveWorkspaceContext,
  useActiveWorkspaceOrNull,
} from "@/contexts/workspace/ActiveWorkspaceContext"

interface WorkbenchKeepAliveHostProps {
  current: WorkbenchKeepAliveSession | null
  getWorkbenchSession: () => WorkbenchSessionSnapshot | null
  fallback: ReactNode
  onSessionsChange?: (sessions: readonly WorkbenchKeepAliveSession[]) => void
  renderSession?: (session: WorkbenchKeepAliveSession, active: boolean) => ReactNode
}

/**
 * A retained workbench must not start consuming project B's ambient contexts
 * when the router moves from project A to B. Capture each context while this
 * session is foreground and keep that exact identity while it is parked.
 */
function FrozenWorkbenchContextBoundary({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) {
  const routeContext = useOptionalProjectRouteContext()
  const syncContext = useOptionalProjectSyncContext()
  const activeWorkspace = useActiveWorkspaceOrNull()
  const frozenRef = useRef({ routeContext, syncContext, activeWorkspace })

  if (active) {
    frozenRef.current = { routeContext, syncContext, activeWorkspace }
  }

  const frozen = frozenRef.current
  return (
    <ProjectRouteContext.Provider value={frozen.routeContext}>
      <ActiveWorkspaceContext.Provider value={frozen.activeWorkspace}>
        <ProjectSyncContext.Provider value={frozen.syncContext}>
          {children}
        </ProjectSyncContext.Provider>
      </ActiveWorkspaceContext.Provider>
    </ProjectRouteContext.Provider>
  )
}

export function WorkbenchKeepAliveHost({
  current,
  getWorkbenchSession,
  fallback,
  onSessionsChange,
  renderSession,
}: WorkbenchKeepAliveHostProps) {
  const [sessions, setSessions] = useState<WorkbenchKeepAliveSession[]>(() =>
    current ? [current] : [],
  )
  const frozenSnapshotsRef = useRef(new Map<string, WorkbenchSessionSnapshot | null>())
  const sessionGettersRef = useRef(new Map<string, () => WorkbenchSessionSnapshot | null>())
  // Read by each session's getter. Written during render, like the foreground
  // key below, so a tile reading it in the same commit sees this render's value.
  const liveRef = useRef({ instanceKey: current?.instanceKey ?? null, getWorkbenchSession })
  liveRef.current = { instanceKey: current?.instanceKey ?? null, getWorkbenchSession }

  useLayoutEffect(() => {
    if (!current) {
      return
    }

    frozenSnapshotsRef.current.set(current.instanceKey, getWorkbenchSession())

    setSessions((previous) => {
      const themedPrevious = previous.map((session) =>
        session.scopeKey === current.scopeKey
          ? session
          : session.themeScheme === current.themeScheme
            ? session
            : { ...session, themeScheme: current.themeScheme },
      )
      const next = selectWorkbenchKeepAliveSessions(current, themedPrevious)

      const kept = new Set(next.map((session) => session.instanceKey))
      for (const instanceKey of Array.from(frozenSnapshotsRef.current.keys())) {
        if (!kept.has(instanceKey)) {
          frozenSnapshotsRef.current.delete(instanceKey)
          sessionGettersRef.current.delete(instanceKey)
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

  useLayoutEffect(() => {
    onSessionsChange?.(sessions)
  }, [onSessionsChange, sessions])

  const visibleInstanceKey = current?.instanceKey ?? null
  // While an ordinary page covers the surface, `current` is null but the
  // workbench the user left is still the one they will return to. Remember it
  // so its tiles can stay attached instead of parking and rebuilding.
  const foregroundInstanceKeyRef = useRef<string | null>(null)
  if (visibleInstanceKey) {
    foregroundInstanceKeyRef.current = visibleInstanceKey
  }
  const foregroundInstanceKey =
    visibleInstanceKey ??
    (sessions.some((session) => session.instanceKey === foregroundInstanceKeyRef.current)
      ? foregroundInstanceKeyRef.current
      : null)

  // One getter per session for its whole life. It reads the live session while
  // this session is the current one and the frozen snapshot while it is parked.
  // Swapping between two getters instead gave the dock runtime context a new
  // value on every hide and show, re-rendering every tile, chat included.
  const sessionGetter = (instanceKey: string) => {
    let getter = sessionGettersRef.current.get(instanceKey)
    if (!getter) {
      getter = () =>
        liveRef.current.instanceKey === instanceKey
          ? liveRef.current.getWorkbenchSession()
          : (frozenSnapshotsRef.current.get(instanceKey) ?? null)
      sessionGettersRef.current.set(instanceKey, getter)
    }
    return getter
  }

  if (sessions.length === 0) {
    return <>{fallback}</>
  }

  return (
    <div
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden"
      data-testid="workbench-presentation-host"
      data-resident-count={sessions.length}
    >
      {sessions.map((session) => (
        <WorkbenchActivity
          key={session.instanceKey}
          name={`workbench:${session.instanceKey}`}
          mode={session.instanceKey === visibleInstanceKey ? "visible" : "hidden"}
        >
          <FrozenWorkbenchContextBoundary active={session.instanceKey === visibleInstanceKey}>
            {renderSession ? renderSession(session, session.instanceKey === visibleInstanceKey) : (
              <WorkbenchDockviewSession
                session={session}
                isActive={session.instanceKey === visibleInstanceKey}
                isForeground={session.instanceKey === foregroundInstanceKey}
                getWorkbenchSession={sessionGetter(session.instanceKey)}
              />
            )}
          </FrozenWorkbenchContextBoundary>
        </WorkbenchActivity>
      ))}
    </div>
  )
}
