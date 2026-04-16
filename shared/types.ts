import type {
  WorkspaceIconColorValue,
  WorkspaceIconKey,
} from "./workspaceIdentity"

export interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  profileImageUrl: string | null
}

export type WorkspaceType = "personal" | "organization"

export interface PersonalWorkspaceMembership {
  id: string
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
