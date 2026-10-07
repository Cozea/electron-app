import type { PersonalWorkspaceMembership, User } from './types'

export const DESKTOP_BOOTSTRAP_VERSION = 2 as const

export interface DesktopBootstrapSession {
  accessToken: string
  expiresAt: number
  principalId: string
  user: User
  personalWorkspace: PersonalWorkspaceMembership
}

/** Device-local presentation has no cloud principal or credentials. */
export interface LocalDevicePresentation {
  identityKey: string
  platform: string
  displayName: string
  avatarUrl: string | null
  presentationConfigured: boolean
  updatedAt: number
}

export interface LocalDevicePresentationUpdate {
  identityKey: string
  displayName: string
  avatarUrl?: string | null
}

export interface DesktopWorkbenchLocator {
  workspaceSelectionId: string
  projectId: string
  laneId: string
  focusTileId: string | null
  workspaceId?: string | null
  projectName?: string | null
  collabBranch?: string | null
  updatedAt: number
}

export interface DesktopBootstrapSnapshot {
  version: typeof DESKTOP_BOOTSTRAP_VERSION
  capturedAt: number
  session: DesktopBootstrapSession | null
  localDevice?: LocalDevicePresentation | null
  lastWorkbenchRoute: DesktopWorkbenchLocator | null
}

export interface DesktopBootstrapBridge {
  getInitialSnapshot: () => Promise<DesktopBootstrapSnapshot>
  storeSession: (session: DesktopBootstrapSession) => Promise<{ success: true }>
  clearSession: () => Promise<{ success: true }>
  getLocalDevice: () => Promise<LocalDevicePresentation>
  updateLocalDevice: (update: LocalDevicePresentationUpdate) => Promise<LocalDevicePresentation>
  setLastWorkbenchRoute: (entry: DesktopWorkbenchLocator) => Promise<{ success: true }>
  clearLastWorkbenchRoute: (workspaceSelectionId: string) => Promise<{ success: true }>
  clearLastWorkbenchRoutesForProject: (projectId: string) => Promise<{ success: true }>
}
