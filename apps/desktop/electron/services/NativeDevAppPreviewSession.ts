import fs from "node:fs"
import path from "node:path"

import {
  grantFingerprint,
  normalizeGrant,
  type DevAppGrant,
} from "../../../../shared/devAppCapabilities"
import {
  developmentTrustBadge,
  type DevAppDevelopmentTrustStore,
} from "../../../../shared/devAppDevelopmentTrust"
import {
  DEV_APP_V3_FILENAME,
  type DevAppAuthoringManifestV3,
} from "../../../../shared/devAppManifestV3"
import {
  parseDevAppManifestV3,
  requestedDevAppCapabilitiesV3,
} from "../../../../shared/devAppManifestV3Parser"
import type {
  DevAppPreviewDiagnostic,
  DevAppPreviewStatus,
} from "../../../../shared/devAppPreviewTypes"
import type { OrgDevAppPreflightReport } from "../../../../shared/orgDevAppDiagnostics"
import type { NativeDevAppBuildService } from "./NativeDevAppBuildService"

interface NativePreviewRecord {
  sourceId: string
  sourcePath: string
  workspaceId: string
  workspaceRoot: string
  leases: Set<string>
  manifest: DevAppAuthoringManifestV3
  reloadToken: number
  status: DevAppPreviewStatus
  buildSequence: number
}

export interface NativeDevAppPreviewOpenOptions {
  sourceId: string
  sourcePath: string
  workspaceId: string
  workspaceRoot: string
  leaseId: string
}

/**
 * Native-v3 development sessions.
 *
 * Native React is trusted same-renderer code, so even a package requesting no host
 * capabilities receives an explicit session-only approval. The grant still controls all
 * privileged extension-host operations; renderer trust and host capabilities are separate
 * facts presented in one prompt.
 */
export class NativeDevAppPreviewSession {
  private readonly records = new Map<string, NativePreviewRecord>()
  private readonly builds: NativeDevAppBuildService
  private readonly trust: DevAppDevelopmentTrustStore

  constructor(builds: NativeDevAppBuildService, trust: DevAppDevelopmentTrustStore) {
    this.builds = builds
    this.trust = trust
  }

  recognizes(sourcePath: string): boolean {
    const manifestPath = path.join(sourcePath, DEV_APP_V3_FILENAME)
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { manifestVersion?: unknown }
      return raw?.manifestVersion === 3
    } catch {
      return false
    }
  }

  async open(options: NativeDevAppPreviewOpenOptions): Promise<DevAppPreviewStatus> {
    assertLeaseId(options.leaseId)
    const parsed = readManifest(options.sourcePath)
    if (!parsed.manifest) return { status: "invalid", diagnostics: parsed.diagnostics }

    const existing = this.records.get(options.sourceId)
    if (existing) {
      if (
        existing.sourcePath !== options.sourcePath ||
        existing.workspaceId !== options.workspaceId ||
        existing.workspaceRoot !== options.workspaceRoot
      ) {
        throw new Error("This native DevApp preview is already bound to another workspace.")
      }
      existing.leases.add(options.leaseId)
      return existing.status
    }

    const requested = requestedGrant(parsed.manifest)
    const resolvedTrust = this.trust.resolve(options.sourceId, requested, {
      requireExplicitApproval: true,
    })
    const record: NativePreviewRecord = {
      sourceId: options.sourceId,
      sourcePath: options.sourcePath,
      workspaceId: options.workspaceId,
      workspaceRoot: options.workspaceRoot,
      leases: new Set([options.leaseId]),
      manifest: parsed.manifest,
      reloadToken: Date.now(),
      buildSequence: 0,
      status:
        resolvedTrust.status === "approved"
          ? {
              status: "invalid",
              diagnostics: [
                {
                  code: "native-build-pending",
                  severity: "warning",
                  message: "The native DevApp is being built.",
                },
              ],
            }
          : approvalStatus(options.sourceId, parsed.manifest, requested, resolvedTrust),
    }
    this.records.set(options.sourceId, record)
    return resolvedTrust.status === "approved" ? await this.build(record) : record.status
  }

  status(sourceId: string): DevAppPreviewStatus | null {
    return this.records.get(sourceId)?.status ?? null
  }

  async approve(sourceId: string, expectedFingerprint: string): Promise<DevAppPreviewStatus | null> {
    const record = this.records.get(sourceId)
    if (!record) return null
    const parsed = readManifest(record.sourcePath)
    if (!parsed.manifest) {
      record.status = { status: "invalid", diagnostics: parsed.diagnostics }
      return record.status
    }
    record.manifest = parsed.manifest
    const requested = requestedGrant(record.manifest)
    if (grantFingerprint(requested) !== expectedFingerprint) {
      record.status = approvalStatus(
        record.sourceId,
        record.manifest,
        requested,
        this.trust.resolve(record.sourceId, requested, { requireExplicitApproval: true }),
      )
      return record.status
    }
    this.trust.approve(record.sourceId, requested)
    return await this.build(record)
  }

  async reload(sourceId: string): Promise<DevAppPreviewStatus | null> {
    const record = this.records.get(sourceId)
    if (!record) return null
    const parsed = readManifest(record.sourcePath)
    record.reloadToken += 1
    if (!parsed.manifest) {
      record.status = { status: "invalid", diagnostics: parsed.diagnostics }
      return record.status
    }
    record.manifest = parsed.manifest
    const requested = requestedGrant(record.manifest)
    const trust = this.trust.resolve(record.sourceId, requested, {
      requireExplicitApproval: true,
    })
    if (trust.status !== "approved") {
      this.builds.releaseDevelopment(record.sourceId)
      record.status = approvalStatus(record.sourceId, record.manifest, requested, trust)
      return record.status
    }
    return await this.build(record)
  }

  close(sourceId: string, leaseId?: string): boolean {
    const record = this.records.get(sourceId)
    if (!record) return true
    if (leaseId) record.leases.delete(leaseId)
    else record.leases.clear()
    if (record.leases.size > 0) return false
    this.records.delete(sourceId)
    this.builds.releaseDevelopment(sourceId)
    return true
  }

  dispose(): void {
    for (const sourceId of this.records.keys()) this.builds.releaseDevelopment(sourceId)
    this.records.clear()
  }

  private async build(record: NativePreviewRecord): Promise<DevAppPreviewStatus> {
    const requested = requestedGrant(record.manifest)
    const trust = this.trust.resolve(record.sourceId, requested, {
      requireExplicitApproval: true,
    })
    if (trust.status !== "approved") {
      record.status = approvalStatus(record.sourceId, record.manifest, requested, trust)
      return record.status
    }

    const sequence = ++record.buildSequence
    try {
      const built = await this.builds.buildDevelopment({
        sourceId: record.sourceId,
        packageRoot: record.sourcePath,
        generation: record.reloadToken,
      })
      if (sequence !== record.buildSequence || !this.records.has(record.sourceId)) {
        return record.status
      }
      record.manifest = built.manifest
      record.status = {
        status: "running",
        sourceId: record.sourceId,
        name: record.manifest.name,
        view: built.view,
        grant: trust.effective,
        declaredTools: [],
        badge: {
          ...developmentTrustBadge(trust),
          detail:
            "Unpublished native React code is running inside Cozea. Privileged operations remain capability-gated.",
        },
        preflight: nativePreflight(record.manifest),
        worker: null,
        reloadToken: record.reloadToken,
      }
      return record.status
    } catch (error) {
      if (sequence !== record.buildSequence || !this.records.has(record.sourceId)) {
        return record.status
      }
      record.status = {
        status: "invalid",
        diagnostics: this.builds.diagnostics(error),
      }
      return record.status
    }
  }
}

function readManifest(sourcePath: string): {
  manifest: DevAppAuthoringManifestV3 | null
  diagnostics: DevAppPreviewDiagnostic[]
} {
  const manifestPath = path.join(sourcePath, DEV_APP_V3_FILENAME)
  let source: string
  try {
    source = fs.readFileSync(manifestPath, "utf8")
  } catch {
    return {
      manifest: null,
      diagnostics: [
        {
          code: "manifest-missing",
          severity: "blocker",
          message: `${DEV_APP_V3_FILENAME} is missing.`,
        },
      ],
    }
  }
  const parsed = parseDevAppManifestV3(source)
  return {
    manifest: parsed.manifest,
    diagnostics: parsed.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: "blocker",
      message: diagnostic.message,
      field: diagnostic.field,
    })),
  }
}

function requestedGrant(manifest: DevAppAuthoringManifestV3): DevAppGrant {
  const permissions = requestedDevAppCapabilitiesV3(manifest)
  return normalizeGrant({
    capabilities: [...permissions.required, ...permissions.optional],
    agentInvocable: false,
  })
}

function approvalStatus(
  sourceId: string,
  manifest: DevAppAuthoringManifestV3,
  requested: DevAppGrant,
  trust: ReturnType<DevAppDevelopmentTrustStore["resolve"]>,
): DevAppPreviewStatus {
  if (trust.status === "approved") {
    throw new Error("Approved native DevApps must be built before becoming runnable.")
  }
  return {
    status: "needsApproval",
    sourceId,
    name: manifest.name,
    requested,
    declaredTools: [],
    workerExecution: Boolean(manifest.extension),
    nativeExecution: true,
    approvalFingerprint: grantFingerprint(requested),
    missing:
      trust.status === "unapproved" ? [...trust.missing] : [...requested.capabilities],
    badge: {
      ...developmentTrustBadge(trust),
      detail:
        "Native React code runs inside Cozea's renderer. Allow only source code you trust.",
    },
    preflight: nativePreflight(manifest),
  }
}

function nativePreflight(manifest: DevAppAuthoringManifestV3): OrgDevAppPreflightReport {
  return {
    ok: true,
    framework: "cozea-native-react",
    expectedRuntimeKind:
      Object.keys(manifest.services ?? {}).length > 0 ? "service" : "static",
    diagnostics: [],
  }
}

function assertLeaseId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,192}$/.test(value)) {
    throw new Error("The DevApp preview lease is invalid.")
  }
}
