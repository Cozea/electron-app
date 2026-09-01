import fs from "node:fs"
import path from "node:path"

import { safeStorage } from "electron"

import {
  grantFingerprint,
  normalizeGrant,
  type DevAppGrant,
} from "../../../../shared/devAppCapabilities"
import type { OrgDevAppInstallationService } from "./OrgDevAppInstallationService"

const MAX_APPROVAL_MS = 30 * 24 * 60 * 60_000

export interface StoredPublishedDevAppApproval {
  ref: string
  workspaceId: string
  packageManifestDigest: string
  grant: DevAppGrant
  fingerprint: string
  expiresAt: number
}

interface ApprovalStore {
  version: 1
  approvals: StoredPublishedDevAppApproval[]
}

export class PublishedDevAppApprovalService {
  private readonly storePath: () => string
  private readonly installations: OrgDevAppInstallationService
  private readonly now: () => number

  constructor(
    storePath: () => string,
    installations: OrgDevAppInstallationService,
    now: () => number = Date.now,
  ) {
    this.storePath = storePath
    this.installations = installations
    this.now = now
  }

  requested(ref: string): DevAppGrant | null {
    const installation = this.installations.resolve(ref)
    const worker = installation?.activeRelease.parts.worker
    return worker ? normalizeGrant({ capabilities: worker.capabilities }) : null
  }

  get(ref: string, workspaceId: string): StoredPublishedDevAppApproval | null {
    const installation = this.installations.resolve(ref)
    const requested = this.requested(ref)
    if (!installation || !requested || !installation.activeRelease.packageManifestDigest) return null
    const current = this.read().approvals.find((approval) =>
      approval.ref === installation.ref &&
      approval.workspaceId === workspaceId &&
      approval.packageManifestDigest === installation.activeRelease.packageManifestDigest,
    )
    if (!current || current.expiresAt <= this.now()) return null
    const normalized = normalizeGrant(current.grant)
    if (
      normalized.capabilities.join("\0") !== requested.capabilities.join("\0") ||
      current.fingerprint !== grantFingerprint(normalized)
    ) return null
    return { ...current, grant: normalized }
  }

  approve(input: {
    ref: string
    workspaceId: string
    agentInvocable: boolean
    expiresAt?: number
  }): StoredPublishedDevAppApproval {
    if (!/^[A-Za-z0-9_-]{1,192}$/.test(input.workspaceId)) {
      throw new Error("The DevApp approval workspace is invalid.")
    }
    const installation = this.installations.resolve(input.ref)
    const requested = this.requested(input.ref)
    const manifestDigest = installation?.activeRelease.packageManifestDigest
    if (!installation || !requested || !manifestDigest) {
      throw new Error("This installed DevApp release has no worker to approve.")
    }
    const now = this.now()
    const expiresAt = Math.min(input.expiresAt ?? now + MAX_APPROVAL_MS, now + MAX_APPROVAL_MS)
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      throw new Error("The DevApp approval expiry is invalid.")
    }
    const grant = normalizeGrant({
      capabilities: requested.capabilities,
      agentInvocable: input.agentInvocable,
    })
    const approval: StoredPublishedDevAppApproval = {
      ref: installation.ref,
      workspaceId: input.workspaceId,
      packageManifestDigest: manifestDigest,
      grant,
      fingerprint: grantFingerprint(grant),
      expiresAt,
    }
    const store = this.read()
    store.approvals = store.approvals.filter((entry) =>
      entry.ref !== approval.ref || entry.workspaceId !== approval.workspaceId,
    )
    store.approvals.push(approval)
    this.write(store)
    return approval
  }

  revoke(ref: string, workspaceId: string): void {
    const store = this.read()
    store.approvals = store.approvals.filter((entry) =>
      entry.ref !== ref || entry.workspaceId !== workspaceId,
    )
    this.write(store)
  }

  private read(): ApprovalStore {
    const filePath = this.storePath()
    if (!fs.existsSync(filePath)) return { version: 1, approvals: [] }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable for published DevApp approvals.")
    }
    try {
      const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath))) as ApprovalStore
      if (value.version !== 1 || !Array.isArray(value.approvals)) throw new Error("invalid")
      return {
        version: 1,
        approvals: value.approvals.filter((entry) =>
          entry &&
          typeof entry.ref === "string" &&
          typeof entry.workspaceId === "string" &&
          typeof entry.packageManifestDigest === "string" &&
          typeof entry.fingerprint === "string" &&
          Number.isFinite(entry.expiresAt),
        ),
      }
    } catch {
      throw new Error("The published DevApp approval store is invalid.")
    }
  }

  private write(store: ApprovalStore): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable for published DevApp approvals.")
    }
    const filePath = this.storePath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
    const temporary = `${filePath}.tmp`
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(store)), { mode: 0o600 })
    fs.renameSync(temporary, filePath)
  }
}
