export const MAX_WORKBENCH_KEEP_ALIVE_SESSIONS = 3

export interface WorkbenchKeepAliveSession {
  /** Revision-scoped React identity. Changes whenever a workspace binding is replaced. */
  instanceKey: string
  scopeKey: string
  projectId: string
  activeLaneId: string
  workspaceId: string | null
  workspaceRevision: number
  projectRootPath: string | null
  gitRootPath: string | null
  projectName: string
  framework: string | null
  storedDevCommand: string | null
  storedDevPort: number | null
  workbenchSessionKey: string | null
  themeScheme: "dark" | "light"
  lastActiveAt: number
}

export function selectWorkbenchKeepAliveSessions(
  current: WorkbenchKeepAliveSession,
  previous: readonly WorkbenchKeepAliveSession[],
  maxSessions: number = MAX_WORKBENCH_KEEP_ALIVE_SESSIONS,
): WorkbenchKeepAliveSession[] {
  const rest = previous
    .filter(
      (session) =>
        session.instanceKey !== current.instanceKey &&
        !(
          session.projectId === current.projectId &&
          session.activeLaneId === current.activeLaneId &&
          session.workspaceId === current.workspaceId
        ),
    )
    .sort((left, right) => right.lastActiveAt - left.lastActiveAt)

  return [current, ...rest].slice(0, Math.max(1, maxSessions))
}

export function areWorkbenchKeepAliveSessionsEqual(
  left: WorkbenchKeepAliveSession,
  right: WorkbenchKeepAliveSession,
): boolean {
  return (
    left.instanceKey === right.instanceKey &&
    left.scopeKey === right.scopeKey &&
    left.projectId === right.projectId &&
    left.activeLaneId === right.activeLaneId &&
    left.workspaceId === right.workspaceId &&
    left.workspaceRevision === right.workspaceRevision &&
    left.projectRootPath === right.projectRootPath &&
    left.gitRootPath === right.gitRootPath &&
    left.projectName === right.projectName &&
    left.framework === right.framework &&
    left.storedDevCommand === right.storedDevCommand &&
    left.storedDevPort === right.storedDevPort &&
    left.workbenchSessionKey === right.workbenchSessionKey &&
    left.themeScheme === right.themeScheme
  )
}
