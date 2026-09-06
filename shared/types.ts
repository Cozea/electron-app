import type {
  WorkspaceIconColorValue,
  WorkspaceIconKey,
} from "./workspaceIdentity"

export interface User {
  principalId: string
  identityKey: string
  displayName: string
  avatarUrl: string | null
  platform: string
}

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
  refreshToken: string | null
  user: User
  personalWorkspace: PersonalWorkspaceMembership | null
}
