// Re-export shared types for convenience
export type { User, OrganizationMembership, Session } from '../../shared/types'

// Import for use in this file
import type { Session, OrganizationMembership } from '../../shared/types'

export interface ElectronAPI {
  platform: NodeJS.Platform
  auth: {
    login: () => Promise<{ success: boolean }>
    logout: () => Promise<{ success: boolean }>
    getSession: () => Promise<Session | null>
    refresh: () => Promise<Session | null>
    updateOrganizations: (organizations: OrganizationMembership[]) => Promise<{ success: boolean; error?: string }>
    onSuccess: (callback: (session: Session) => void) => () => void
    onError: (callback: (error: string) => void) => () => void
  }
  tools: {
    run: (request: { name: string; input: Record<string, unknown> }) => Promise<{ success: boolean; output?: unknown; error?: string }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
