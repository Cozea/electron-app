import { app, safeStorage } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  DESKTOP_BOOTSTRAP_VERSION,
  type DesktopBootstrapSession,
  type DesktopBootstrapSnapshot,
  type DesktopWorkbenchLocator,
  type LocalDevicePresentation,
  type LocalDevicePresentationUpdate,
} from '@cozea/app-contract/desktopBootstrap'
import { isDeviceIdentityKey } from '../../../../shared/deviceIdentity'

const SESSION_FILE_NAME = 'desktop-bootstrap-session.v2.enc'
const NAVIGATION_FILE_NAME = 'desktop-bootstrap-navigation.v1.json'
const LOCAL_DEVICE_FILE_NAME = 'desktop-local-device.v1.json'

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

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value)
}

function isDesktopBootstrapSession(value: unknown): value is DesktopBootstrapSession {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.personalWorkspace)) return false

  const principal = value.user
  const workspace = value.personalWorkspace
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    typeof value.principalId === 'string' &&
    value.principalId.length > 0 &&
    typeof principal.principalId === 'string' &&
    principal.principalId.length > 0 &&
    principal.principalId === value.principalId &&
    typeof principal.identityKey === 'string' &&
    principal.identityKey.length > 0 &&
    typeof principal.displayName === 'string' &&
    typeof principal.presentationConfigured === 'boolean' &&
    typeof principal.platform === 'string' &&
    isNullableString(principal.avatarUrl) &&
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
    isOptionalNullableString(value.workspaceId) &&
    isOptionalNullableString(value.projectName) &&
    isOptionalNullableString(value.collabBranch) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  )
}

function isLocalAvatar(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string' || value.length > 2_000_000 || hasControlCharacters(value)) return false
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !/\s/.test(value)
  } catch {
    return false
  }
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function isLocalDevicePresentation(value: unknown): value is LocalDevicePresentation {
  return isRecord(value) && typeof value.identityKey === 'string' && isDeviceIdentityKey(value.identityKey) &&
    value.identityKey === value.identityKey.trim().toLowerCase() &&
    Object.keys(value).every((key) => ['identityKey', 'platform', 'displayName', 'avatarUrl', 'presentationConfigured', 'updatedAt'].includes(key)) &&
    typeof value.platform === 'string' && value.platform.length > 0 && value.platform.length <= 32 &&
    typeof value.displayName === 'string' && value.displayName.trim().length > 0 && value.displayName.length <= 80 &&
    !hasControlCharacters(value.displayName) && isLocalAvatar(value.avatarUrl) &&
    typeof value.presentationConfigured === 'boolean' && typeof value.updatedAt === 'number' &&
    Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0
}

async function atomicWrite(filePath: string, data: Buffer | string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`
  await fs.promises.writeFile(temporaryPath, data, { mode: 0o600 })
  try {
    await fs.promises.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export class DesktopBootstrapStore {
  private writeQueues = new Map<string, Promise<void>>()
  private readonly getDeviceIdentity?: () => Promise<{ identityKey: string; platform: string }>

  constructor(getDeviceIdentity?: () => Promise<{ identityKey: string; platform: string }>) {
    this.getDeviceIdentity = getDeviceIdentity
  }

  private get sessionPath(): string {
    return path.join(app.getPath('userData'), SESSION_FILE_NAME)
  }

  private get navigationPath(): string {
    return path.join(app.getPath('userData'), NAVIGATION_FILE_NAME)
  }

  private get localDevicePath(): string {
    return path.join(app.getPath('userData'), LOCAL_DEVICE_FILE_NAME)
  }

  private async enqueueWrite(filePath: string, writeFn: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(filePath) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(writeFn)
    this.writeQueues.set(filePath, next)
    try {
      await next
    } finally {
      if (this.writeQueues.get(filePath) === next) {
        this.writeQueues.delete(filePath)
      }
    }
  }

  async getInitialSnapshot(): Promise<DesktopBootstrapSnapshot> {
    const [session, lastWorkbenchRoute, localDevice] = await Promise.all([
      this.readSession(),
      this.readLastWorkbenchRoute(),
      this.readLocalDevice(),
    ])
    return {
      version: DESKTOP_BOOTSTRAP_VERSION,
      capturedAt: Date.now(),
      session,
      localDevice,
      lastWorkbenchRoute,
    }
  }

  async getLocalDevice(): Promise<LocalDevicePresentation> {
    if (!this.getDeviceIdentity) throw new Error('Local device identity service is unavailable.')
    const identity = await this.getDeviceIdentity()
    if (!isDeviceIdentityKey(identity.identityKey)) throw new Error('Invalid physical device identity.')
    let result: LocalDevicePresentation | undefined
    await this.enqueueWrite(this.localDevicePath, async () => {
      const stored = await this.readLocalDevice()
      if (stored?.identityKey === identity.identityKey && stored.platform === identity.platform) {
        result = stored
        return
      }
      // Migration copies presentation only after checking the actual local key.
      const session = await this.readSession()
      const previous = session?.user.identityKey === identity.identityKey ? session.user : null
      const candidate: LocalDevicePresentation = {
        identityKey: identity.identityKey,
        platform: identity.platform,
        displayName: previous?.displayName ?? 'This Device',
        avatarUrl: previous?.avatarUrl ?? null,
        presentationConfigured: previous?.presentationConfigured ?? false,
        updatedAt: Date.now(),
      }
      result = isLocalDevicePresentation(candidate) ? candidate : {
        identityKey: identity.identityKey, platform: identity.platform, updatedAt: Date.now(),
        displayName: 'This Device', avatarUrl: null, presentationConfigured: false }
      if (!isLocalDevicePresentation(result)) throw new Error('Invalid physical device presentation.')
      await atomicWrite(this.localDevicePath, `${JSON.stringify(result)}\n`)
    })
    return result!
  }

  async updateLocalDevice(update: LocalDevicePresentationUpdate): Promise<LocalDevicePresentation> {
    if (!isRecord(update) || typeof update.identityKey !== 'string' || typeof update.displayName !== 'string' ||
      (update.avatarUrl !== undefined && !isLocalAvatar(update.avatarUrl))) {
      throw new Error('Invalid local device presentation update.')
    }
    const current = await this.getLocalDevice()
    if (update.identityKey !== current.identityKey) throw new Error('The physical device identity changed.')
    let result: LocalDevicePresentation | undefined
    await this.enqueueWrite(this.localDevicePath, async () => {
      const latest = await this.readLocalDevice()
      if (!latest || latest.identityKey !== update.identityKey) throw new Error('The physical device identity changed.')
      result = { ...latest, displayName: update.displayName.trim(),
        avatarUrl: update.avatarUrl === undefined ? latest.avatarUrl : update.avatarUrl,
        presentationConfigured: true, updatedAt: Date.now() }
      if (!isLocalDevicePresentation(result)) throw new Error('Invalid local device presentation update.')
      await atomicWrite(this.localDevicePath, `${JSON.stringify(result)}\n`)
    })
    return result!
  }

  async storeSession(session: DesktopBootstrapSession): Promise<void> {
    if (!isDesktopBootstrapSession(session)) throw new Error('Invalid desktop bootstrap session.')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable for the desktop bootstrap session.')
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(session))
    await this.enqueueWrite(this.sessionPath, () => atomicWrite(this.sessionPath, encrypted))
  }

  async clearSession(): Promise<void> {
    await this.enqueueWrite(this.sessionPath, () => fs.promises.rm(this.sessionPath, { force: true }))
  }

  async setLastWorkbenchRoute(entry: DesktopWorkbenchLocator): Promise<void> {
    if (!isDesktopWorkbenchLocator(entry)) throw new Error('Invalid desktop workbench locator.')
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
      return isDesktopWorkbenchLocator(parsed.lastWorkbenchRoute) ? parsed.lastWorkbenchRoute : null
    } catch {
      return null
    }
  }

  private async readLocalDevice(): Promise<LocalDevicePresentation | null> {
    try {
      const stat = await fs.promises.stat(this.localDevicePath)
      if (stat.size > 2_001_024) return null
      const parsed: unknown = JSON.parse(await fs.promises.readFile(this.localDevicePath, 'utf8'))
      return isLocalDevicePresentation(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private async writeNavigation(state: StoredNavigationState): Promise<void> {
    await this.enqueueWrite(this.navigationPath, () =>
      atomicWrite(this.navigationPath, `${JSON.stringify(state)}\n`),
    )
  }
}
