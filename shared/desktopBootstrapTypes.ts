import type { PersonalWorkspaceMembership, User } from './types'

export const DESKTOP_BOOTSTRAP_VERSION = 1 as const

export interface DesktopBootstrapSession {
  accessToken: string
  expiresAt: number
  convexUserId: string
  user: User
  personalWorkspace: PersonalWorkspaceMembership
}

export interface DesktopWorkbenchLocator {
  workspaceSelectionId: string
  projectId: string
  laneId: string
  focusTileId: string | null
  /** Additive v1 fields; optional so already-persisted v1 snapshots remain valid. */
  workspaceId?: string | null
  projectName?: string | null
  collabBranch?: string | null
  updatedAt: number
}

export interface DesktopBootstrapSnapshot {
  version: typeof DESKTOP_BOOTSTRAP_VERSION
  capturedAt: number
  session: DesktopBootstrapSession | null
  lastWorkbenchRoute: DesktopWorkbenchLocator | null
}

export interface DesktopBootstrapBridge {
  getInitialSnapshot: () => Promise<DesktopBootstrapSnapshot>
  storeSession: (session: DesktopBootstrapSession) => Promise<{ success: true }>
  clearSession: () => Promise<{ success: true }>
  setLastWorkbenchRoute: (entry: DesktopWorkbenchLocator) => Promise<{ success: true }>
  clearLastWorkbenchRoute: (workspaceSelectionId: string) => Promise<{ success: true }>
  clearLastWorkbenchRoutesForProject: (projectId: string) => Promise<{ success: true }>
}
