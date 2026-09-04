export const MAX_WORKBENCH_KEEP_ALIVE_SESSIONS = 3

export interface WorkbenchKeepAliveSession {
  scopeKey: string
  projectId: string
  activeLaneId: string
  workspaceId: string | null
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
    .filter((session) => session.scopeKey !== current.scopeKey)
    .sort((left, right) => right.lastActiveAt - left.lastActiveAt)

  return [current, ...rest].slice(0, Math.max(1, maxSessions))
}

export function areWorkbenchKeepAliveSessionsEqual(
  left: WorkbenchKeepAliveSession,
  right: WorkbenchKeepAliveSession,
): boolean {
  return (
    left.scopeKey === right.scopeKey &&
    left.projectId === right.projectId &&
    left.activeLaneId === right.activeLaneId &&
    left.workspaceId === right.workspaceId &&
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
