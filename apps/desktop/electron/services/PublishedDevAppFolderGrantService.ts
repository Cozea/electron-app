import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { safeStorage } from "electron"

import {
  DEV_APP_CONTAINED_RUNTIME_MAX_MOUNTS,
  type DevAppFolderGrant,
  type DevAppFolderGrantAccess,
} from "../../../../shared/devAppContainedRuntime"
import type { OrgDevAppInstallationService } from "./OrgDevAppInstallationService"

const MAX_GRANT_MS = 30 * 24 * 60 * 60_000

interface FolderGrantStore {
  version: 1
  grants: DevAppFolderGrant[]
}

function isStoredGrant(value: unknown): value is DevAppFolderGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const grant = value as Partial<DevAppFolderGrant>
  return (
    typeof grant.grantId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(grant.grantId) &&
    typeof grant.publicationId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(grant.publicationId) &&
    typeof grant.releaseId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(grant.releaseId) &&
    typeof grant.canonicalHostPath === "string" &&
    grant.guestPath === `/cozea/grants/${grant.grantId}` &&
    (grant.access === "read" || grant.access === "readWrite") &&
    typeof grant.expiresAt === "number" &&
    Number.isFinite(grant.expiresAt)
  )
}

/** Stores only explicit, release-bound user folder grants; agents never reach this service. */
export class PublishedDevAppFolderGrantService {
  private readonly storePath: () => string
  private readonly installations: OrgDevAppInstallationService
  private readonly now: () => number

  constructor(storePath: () => string, installations: OrgDevAppInstallationService, now: () => number = Date.now) {
    this.storePath = storePath
    this.installations = installations
    this.now = now
  }

  list(ref: string): DevAppFolderGrant[] {
    const installation = this.installations.resolve(ref)
    if (!installation) throw new Error("This exact DevApp release is not installed.")
    const now = this.now()
    return this.read().grants.filter(
      (grant) =>
        grant.publicationId === installation.publicationId &&
        grant.releaseId === installation.activeRelease.id &&
        grant.expiresAt > now &&
        this.isStillCanonical(grant.canonicalHostPath),
    )
  }

  grant(input: {
    ref: string
    hostPath: string
    access: DevAppFolderGrantAccess
    expiresAt?: number
  }): DevAppFolderGrant {
    const installation = this.installations.resolve(input.ref)
    if (!installation) throw new Error("This exact DevApp release is not installed.")
    if (input.access !== "read" && input.access !== "readWrite") {
      throw new Error("The DevApp folder access mode is invalid.")
    }
    const canonicalHostPath = fs.realpathSync.native(input.hostPath)
    const stats = fs.statSync(canonicalHostPath)
    if (!stats.isDirectory()) throw new Error("A DevApp folder grant must select a directory.")
    if (path.parse(canonicalHostPath).root === canonicalHostPath) {
      throw new Error("The filesystem root cannot be granted to a DevApp.")
    }
    const now = this.now()
    const expiresAt = Math.min(input.expiresAt ?? now + MAX_GRANT_MS, now + MAX_GRANT_MS)
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      throw new Error("The DevApp folder grant expiry is invalid.")
    }
    const store = this.read()
    const current = store.grants.filter(
      (grant) =>
        grant.publicationId === installation.publicationId &&
        grant.releaseId === installation.activeRelease.id &&
        grant.expiresAt > now,
    )
    if (current.length >= DEV_APP_CONTAINED_RUNTIME_MAX_MOUNTS) {
      throw new Error("This DevApp already has the maximum number of folder grants.")
    }
    const grantId = randomUUID()
    const grant: DevAppFolderGrant = {
      grantId,
      publicationId: installation.publicationId,
      releaseId: installation.activeRelease.id,
      canonicalHostPath,
      guestPath: `/cozea/grants/${grantId}`,
      access: input.access,
      expiresAt,
    }
    store.grants = store.grants.filter(
      (entry) =>
        entry.publicationId !== grant.publicationId ||
        entry.releaseId !== grant.releaseId ||
        entry.canonicalHostPath !== grant.canonicalHostPath,
    )
    store.grants.push(grant)
    this.write(store)
    return grant
  }

  revoke(ref: string, grantId: string): boolean {
    const installation = this.installations.resolve(ref)
    if (!installation) throw new Error("This exact DevApp release is not installed.")
    const store = this.read()
    const before = store.grants.length
    store.grants = store.grants.filter(
      (grant) =>
        grant.grantId !== grantId ||
        grant.publicationId !== installation.publicationId ||
        grant.releaseId !== installation.activeRelease.id,
    )
    if (store.grants.length !== before) this.write(store)
    return store.grants.length !== before
  }

  removeReleases(publicationId: string, releaseIds: string[]): void {
    const targets = new Set(releaseIds)
    if (targets.size === 0 || !fs.existsSync(this.storePath())) return
    const store = this.read()
    const grants = store.grants.filter(
      (grant) => grant.publicationId !== publicationId || !targets.has(grant.releaseId),
    )
    if (grants.length !== store.grants.length) this.write({ version: 1, grants })
  }

  private isStillCanonical(hostPath: string): boolean {
    try {
      return fs.statSync(hostPath).isDirectory() && fs.realpathSync.native(hostPath) === hostPath
    } catch {
      return false
    }
  }

  private read(): FolderGrantStore {
    const filePath = this.storePath()
    if (!fs.existsSync(filePath)) return { version: 1, grants: [] }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable for DevApp folder grants.")
    }
    try {
      const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath))) as FolderGrantStore
      if (value.version !== 1 || !Array.isArray(value.grants)) throw new Error("invalid")
      return { version: 1, grants: value.grants.filter(isStoredGrant) }
    } catch {
      throw new Error("The DevApp folder grant store is invalid.")
    }
  }

  private write(store: FolderGrantStore): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable for DevApp folder grants.")
    }
    const filePath = this.storePath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
    const temporary = `${filePath}.tmp`
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(store)), { mode: 0o600 })
    fs.renameSync(temporary, filePath)
  }
}
