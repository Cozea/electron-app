import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import {
  DESKTOP_BOOTSTRAP_VERSION,
  type DesktopBootstrapSession,
  type DesktopBootstrapSnapshot,
  type DesktopWorkbenchLocator,
} from '../../../../shared/desktopBootstrapTypes'

const SESSION_FILE_NAME = 'desktop-bootstrap-session.v1.enc'
const NAVIGATION_FILE_NAME = 'desktop-bootstrap-navigation.v1.json'

interface StoredNavigationState {
  version: 1
  lastWorkbenchRoute: DesktopWorkbenchLocator | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isDesktopBootstrapSession(value: unknown): value is DesktopBootstrapSession {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.personalWorkspace)) {
    return false
  }

  const user = value.user
  const workspace = value.personalWorkspace
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    typeof value.convexUserId === 'string' &&
    value.convexUserId.length > 0 &&
    typeof user.id === 'string' &&
    user.id.length > 0 &&
    typeof user.deviceId === 'string' &&
    typeof user.email === 'string' &&
    isNullableString(user.firstName) &&
    isNullableString(user.lastName) &&
    isNullableString(user.profileImageUrl) &&
    typeof workspace.id === 'string' &&
    typeof workspace.workspaceId === 'string' &&
    workspace.workspaceId.length > 0 &&
    typeof workspace.workspaceName === 'string' &&
    typeof workspace.organizationId === 'string' &&
    typeof workspace.organizationName === 'string' &&
    workspace.role === 'admin' &&
    workspace.status === 'active' &&
    workspace.workspaceType === 'personal'
  )
}

function isDesktopWorkbenchLocator(value: unknown): value is DesktopWorkbenchLocator {
  if (!isRecord(value)) return false
  return (
    typeof value.workspaceSelectionId === 'string' &&
    value.workspaceSelectionId.length > 0 &&
    typeof value.projectId === 'string' &&
    value.projectId.length > 0 &&
    typeof value.laneId === 'string' &&
    value.laneId.length > 0 &&
    (value.focusTileId === null || typeof value.focusTileId === 'string') &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  )
}

async function atomicWrite(filePath: string, data: Buffer | string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(temporaryPath, data, { mode: 0o600 })
  try {
    await fs.promises.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.promises.rm(filePath, { force: true }).catch(() => undefined)
    await fs.promises.rename(temporaryPath, filePath).catch(async (renameError) => {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined)
      throw renameError ?? error
    })
  }
}

export class DesktopBootstrapStore {
  private get sessionPath(): string {
    return path.join(app.getPath('userData'), SESSION_FILE_NAME)
  }

  private get navigationPath(): string {
    return path.join(app.getPath('userData'), NAVIGATION_FILE_NAME)
  }

  async getInitialSnapshot(): Promise<DesktopBootstrapSnapshot> {
    const [session, lastWorkbenchRoute] = await Promise.all([
      this.readSession(),
      this.readLastWorkbenchRoute(),
    ])
    return {
      version: DESKTOP_BOOTSTRAP_VERSION,
      capturedAt: Date.now(),
      session,
      lastWorkbenchRoute,
    }
  }

  async storeSession(session: DesktopBootstrapSession): Promise<void> {
    if (!isDesktopBootstrapSession(session)) {
      throw new Error('Invalid desktop bootstrap session.')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable for the desktop bootstrap session.')
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(session))
    await atomicWrite(this.sessionPath, encrypted)
  }

  async clearSession(): Promise<void> {
    await fs.promises.rm(this.sessionPath, { force: true })
  }

  async setLastWorkbenchRoute(entry: DesktopWorkbenchLocator): Promise<void> {
    if (!isDesktopWorkbenchLocator(entry)) {
      throw new Error('Invalid desktop workbench locator.')
    }
    await this.writeNavigation({ version: 1, lastWorkbenchRoute: entry })
  }

  async clearLastWorkbenchRoute(workspaceSelectionId: string): Promise<void> {
    const current = await this.readLastWorkbenchRoute()
    if (!current || current.workspaceSelectionId !== workspaceSelectionId) return
    await this.writeNavigation({ version: 1, lastWorkbenchRoute: null })
  }

  async clearLastWorkbenchRoutesForProject(projectId: string): Promise<void> {
    const current = await this.readLastWorkbenchRoute()
    if (!current || current.projectId !== projectId) return
    await this.writeNavigation({ version: 1, lastWorkbenchRoute: null })
  }

  private async readSession(): Promise<DesktopBootstrapSession | null> {
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      const encrypted = await fs.promises.readFile(this.sessionPath)
      const parsed: unknown = JSON.parse(safeStorage.decryptString(encrypted))
      return isDesktopBootstrapSession(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private async readLastWorkbenchRoute(): Promise<DesktopWorkbenchLocator | null> {
    try {
      const parsed: unknown = JSON.parse(await fs.promises.readFile(this.navigationPath, 'utf8'))
      if (!isRecord(parsed) || parsed.version !== 1) return null
      return isDesktopWorkbenchLocator(parsed.lastWorkbenchRoute)
        ? parsed.lastWorkbenchRoute
        : null
    } catch {
      return null
    }
  }

  private async writeNavigation(state: StoredNavigationState): Promise<void> {
    await atomicWrite(this.navigationPath, `${JSON.stringify(state)}\n`)
  }
}
