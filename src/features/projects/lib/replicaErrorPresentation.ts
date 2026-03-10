const STAGE_MESSAGES: Record<string, string> = {
  acquire_lock: 'Another sync is already running for this project. Retry in a moment.',
  materialize_canonical_repository: 'Failed to load the cloud project snapshot. Retry sync.',
  rewrite_snapshot_with_lfs_pointers: 'Failed to prepare project files for sync. Retry sync.',
  resolve_remote_commit: 'Failed to resolve the latest cloud project state. Retry sync.',
  build_workspace_patch_from_canonical: 'Failed to prepare restored files for download. Retry sync.',
  persist_applied_session_restore:
    'Project files were restored, but sync status could not be recorded. Retry sync.',
  create_local_snapshot_commit: 'Failed to snapshot local files before syncing. Retry sync.',
  diff_local_and_remote: 'Failed to compare local and cloud files. Retry sync.',
  bootstrap_canonical_branch: 'Failed to initialize the cloud project replica. Retry sync.',
  store_bootstrap_bundle: 'Failed to store the initial cloud project state. Retry sync.',
  persist_applied_session_bootstrap:
    'Initial project sync finished, but sync status could not be recorded. Retry sync.',
  merge_local_into_canonical: 'Failed to merge local and cloud changes. Retry sync.',
  detect_conflicts: 'Failed to detect file conflicts during sync. Retry sync.',
  persist_conflict_session:
    'Conflicts were detected, but the sync session could not be recorded. Retry sync.',
  resolve_conflicts_from_decisions:
    'Failed to apply the selected conflict resolutions. Retry sync.',
  commit_merged_state: 'Failed to finalize the merged project state. Retry sync.',
  resolve_result_commit: 'Failed to resolve the merged project revision. Retry sync.',
  store_canonical_bundle: 'Failed to store the updated cloud project state. Retry sync.',
  build_workspace_patch_from_merge_result:
    'Failed to prepare merged files for download. Retry sync.',
  persist_applied_session_merge:
    'Project files were merged, but sync status could not be recorded. Retry sync.',
}

export interface ReplicaErrorPresentation {
  summary: string
  detail: string | null
  requestId: string | null
  stage: string | null
  rawMessage: string
}

function extractErrorText(input: unknown, fallback: string): string {
  if (input instanceof Error) {
    return input.message || fallback
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    return input.trim()
  }
  return fallback
}

function extractReplicaApiPayloadText(message: string): string | null {
  const replicaPrefixMatch = message.match(/^Replica API [^:]+ failed \(\d+\):\s*(.+)$/i)
  const payloadText = replicaPrefixMatch?.[1]?.trim() ?? message.trim()
  return payloadText.startsWith('{') ? payloadText : null
}

function parseReplicaApiPayload(message: string): Record<string, unknown> | null {
  const payloadText = extractReplicaApiPayloadText(message)
  if (!payloadText) {
    return null
  }

  try {
    const parsed = JSON.parse(payloadText)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function stripReplicaApiPrefix(message: string): string {
  const replicaPrefixMatch = message.match(/^Replica API [^:]+ failed \(\d+\):\s*(.+)$/i)
  return replicaPrefixMatch?.[1]?.trim() || message
}

function stripQuotedJsonError(message: string): string {
  const errorFieldMatch = message.match(/"error"\s*:\s*"([^"]+)"/)
  return errorFieldMatch?.[1]?.trim() || message
}

function cleanRawMessage(message: string): string {
  const payload = parseReplicaApiPayload(message)
  if (payload) {
    const detailedMessage =
      typeof payload.message === 'string' && payload.message.trim().length > 0
        ? payload.message.trim()
        : null
    if (detailedMessage) {
      return detailedMessage
    }

    const errorCode =
      typeof payload.error === 'string' && payload.error.trim().length > 0
        ? payload.error.trim()
        : null
    if (errorCode) {
      return errorCode
    }
  }

  return stripQuotedJsonError(stripReplicaApiPrefix(message))
}

export function isReplicaSyncEntitlementError(input: unknown): boolean {
  const rawMessage = extractErrorText(input, '')
  if (!rawMessage) {
    return false
  }

  const payload = parseReplicaApiPayload(rawMessage)
  const normalized = [
    rawMessage,
    typeof payload?.error === 'string' ? payload.error : '',
    typeof payload?.code === 'string' ? payload.code : '',
    typeof payload?.title === 'string' ? payload.title : '',
    typeof payload?.message === 'string' ? payload.message : '',
  ]
    .join(' ')
    .toLowerCase()

  return (
    normalized.includes('entitlement_required') ||
    normalized.includes('subscription required') ||
    normalized.includes('seat assignment required') ||
    (/\(402\)/.test(rawMessage) && normalized.includes('replica api'))
  )
}

export function formatReplicaSyncError(
  input: unknown,
  fallback = 'Failed to prepare project'
): ReplicaErrorPresentation {
  const rawMessage = extractErrorText(input, fallback)
  const cleaned = cleanRawMessage(rawMessage)
  const stageMatch = cleaned.match(/^\[([a-z0-9_]+)\]\s*/i)
  const requestMatch = cleaned.match(/\[Request ID:\s*([^\]]+)\]/i)

  const stage = stageMatch?.[1] ?? null
  const requestId = requestMatch?.[1] ?? null

  let detail = cleaned
    .replace(/^\[[a-z0-9_]+\]\s*/i, '')
    .replace(/\[Request ID:\s*[^\]]+\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (detail.toLowerCase() === 'server error') {
    detail = ''
  }

  const summary =
    (stage ? STAGE_MESSAGES[stage] : null) ||
    detail ||
    fallback

  const normalizedDetail =
    detail.length > 0
      ? requestId
        ? `${detail} (Request ID: ${requestId})`
        : detail
      : requestId
        ? `Request ID: ${requestId}`
        : null

  return {
    summary,
    detail: normalizedDetail,
    requestId,
    stage,
    rawMessage,
  }
}
