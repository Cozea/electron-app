export interface OrgDevAppArtifactLimits {
  maxCompressedBytes: number
  maxExpandedBytes: number
  maxEntryBytes: number
  maxEntries: number
  maxPathBytes: number
  maxCompressionRatio: number
}

export const ORG_DEVAPP_STATIC_ARTIFACT_LIMITS: OrgDevAppArtifactLimits = {
  maxCompressedBytes: 32 * 1024 * 1024,
  maxExpandedBytes: 128 * 1024 * 1024,
  maxEntryBytes: 32 * 1024 * 1024,
  maxEntries: 4_096,
  maxPathBytes: 512,
  maxCompressionRatio: 200,
} as const

export const ORG_DEVAPP_SERVICE_ARTIFACT_LIMITS: OrgDevAppArtifactLimits = {
  maxCompressedBytes: 256 * 1024 * 1024,
  maxExpandedBytes: 1024 * 1024 * 1024,
  maxEntryBytes: 128 * 1024 * 1024,
  maxEntries: 50_000,
  maxPathBytes: 512,
  maxCompressionRatio: 200,
} as const

/** Backwards-compatible static limit name. */
export const ORG_DEVAPP_ARTIFACT_LIMITS = ORG_DEVAPP_STATIC_ARTIFACT_LIMITS

export function orgDevAppArtifactLimits(runtimeKind: "static" | "service"): OrgDevAppArtifactLimits {
  return runtimeKind === "service" ? ORG_DEVAPP_SERVICE_ARTIFACT_LIMITS : ORG_DEVAPP_STATIC_ARTIFACT_LIMITS
}

export const ORG_DEVAPP_UPLOAD_RESERVATION_TTL_MS = 30 * 60_000
