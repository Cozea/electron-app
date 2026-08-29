export const ORG_DEVAPP_ARTIFACT_LIMITS = {
  maxCompressedBytes: 32 * 1024 * 1024,
  maxExpandedBytes: 128 * 1024 * 1024,
  maxEntryBytes: 32 * 1024 * 1024,
  maxEntries: 4_096,
  maxPathBytes: 512,
  maxCompressionRatio: 200,
} as const

export const ORG_DEVAPP_UPLOAD_RESERVATION_TTL_MS = 30 * 60_000
