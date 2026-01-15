import { contextBridge, ipcRenderer } from 'electron'

export interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  profileImageUrl: string | null
}

export interface OrganizationMembership {
  id: string
  organizationId: string
  organizationName: string
  role: string
  status: 'active' | 'inactive' | 'pending'
}

export interface Session {
  accessToken: string
  refreshToken: string
  user: User
  organizations: OrganizationMembership[]
}

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
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getSession: () => ipcRenderer.invoke('auth:getSession'),
    refresh: () => ipcRenderer.invoke('auth:refresh'),
    updateOrganizations: (organizations: OrganizationMembership[]) => ipcRenderer.invoke('auth:updateOrganizations', organizations),
    onSuccess: (callback: (session: Session) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, session: Session) => callback(session)
      ipcRenderer.on('auth:success', handler)
      // Return cleanup function
      return () => ipcRenderer.removeListener('auth:success', handler)
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error)
      ipcRenderer.on('auth:error', handler)
      // Return cleanup function
      return () => ipcRenderer.removeListener('auth:error', handler)
    },
  },
} satisfies ElectronAPI)
