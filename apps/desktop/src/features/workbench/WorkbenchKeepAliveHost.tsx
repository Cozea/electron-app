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
import {
  YjsProjectContext,
  useYjsProject,
} from "@/contexts/YjsProjectContextValue"

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
  const yjsProject = useYjsProject()
  const frozenRef = useRef({ routeContext, syncContext, activeWorkspace, yjsProject })

  if (active) {
    frozenRef.current = { routeContext, syncContext, activeWorkspace, yjsProject }
  }

  const frozen = frozenRef.current
  return (
    <ProjectRouteContext.Provider value={frozen.routeContext}>
      <ActiveWorkspaceContext.Provider value={frozen.activeWorkspace}>
        <ProjectSyncContext.Provider value={frozen.syncContext}>
          <YjsProjectContext.Provider value={frozen.yjsProject}>
            {children}
          </YjsProjectContext.Provider>
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
  const frozenGettersRef = useRef(new Map<string, () => WorkbenchSessionSnapshot | null>())

  useLayoutEffect(() => {
    if (!current) {
      return
    }

    frozenSnapshotsRef.current.set(current.instanceKey, getWorkbenchSession())
    if (!frozenGettersRef.current.has(current.instanceKey)) {
      const instanceKey = current.instanceKey
      frozenGettersRef.current.set(
        instanceKey,
        () => frozenSnapshotsRef.current.get(instanceKey) ?? null,
      )
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

      const kept = new Set(next.map((session) => session.instanceKey))
      for (const instanceKey of Array.from(frozenSnapshotsRef.current.keys())) {
        if (!kept.has(instanceKey)) {
          frozenSnapshotsRef.current.delete(instanceKey)
          frozenGettersRef.current.delete(instanceKey)
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
                getWorkbenchSession={
                  current?.instanceKey === session.instanceKey
                    ? getWorkbenchSession
                    : (frozenGettersRef.current.get(session.instanceKey) ?? getWorkbenchSession)
                }
              />
            )}
          </FrozenWorkbenchContextBoundary>
        </WorkbenchActivity>
      ))}
    </div>
  )
}
