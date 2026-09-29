import type {
  WorkspaceIconColorValue,
  WorkspaceIconKey,
} from "./workspaceIdentity"

/**
 * Public presentation of a device principal.
 * Cozea has no human user accounts; this represents the device's visible profile.
 */
export interface User {
  principalId: string
  identityKey: string
  displayName: string
  presentationConfigured: boolean
  avatarUrl: string | null
  platform: string
}

export type DevicePresentation = User

export type WorkspaceType = "personal" | "organization"

export interface PersonalWorkspaceMembership {
  id: string
  workspaceId: string
  workspaceName: string
  organizationId: string
  organizationName: string
  role: "admin"
  status: "active"
  workspaceType: "personal"
  iconKey?: WorkspaceIconKey | null
  iconColor?: WorkspaceIconColorValue | null
  logoUrl?: string | null
}

export type WorkspaceMembership = PersonalWorkspaceMembership

export interface Session {
  accessToken: string | null
  user: User
  personalWorkspace: PersonalWorkspaceMembership | null
}
