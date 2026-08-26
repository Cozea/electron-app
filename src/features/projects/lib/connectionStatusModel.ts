import type { SyncProgress } from "@/lib/sync/types"

/**
 * Track D status model: keep assistant transport, data sync (Yjs/journal), and
 * git-remote phases distinguishable. Never map Convex `projects.syncStatus`
 * into assistant transport (or the reverse).
 */

export type AssistantTransportUiStatus = "disconnected" | "reconnecting" | "connected"
export type DataSyncUiStatus = "idle" | "syncing" | "error"
export type GitRemoteUiStatus = "unknown" | "idle" | "diverged" | "error"

export type RawAssistantTransportState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "disposed"
  | null

export interface GitRemoteSnapshot {
  ahead: number
  behind: number
  error?: string | null
}

export interface ConnectionStatusModelInput {
  /** Assistant runtime WebSocket/RPC transport — not Yjs/collab. */
  assistantTransport: RawAssistantTransportState
  /** Journal / live-collab sync progress — not Convex project.syncStatus. */
  syncProgress: SyncProgress | null | undefined
  collabConnected: boolean
  isOnline: boolean
  collaborationMode: "shared" | "local" | null | undefined
  sharedBranch: string | null | undefined
  gitRemote: GitRemoteSnapshot | null | undefined
}

export interface ConnectionStatusLayerLine {
  id: "transport" | "dataSync" | "gitRemote"
  title: string
  status: string
  detail: string
}

export interface ConnectionStatusPresentation {
  transport: AssistantTransportUiStatus
  dataSync: DataSyncUiStatus
  gitRemote: GitRemoteUiStatus
  layers: ConnectionStatusLayerLine[]
  /** Compact chrome label (data-sync oriented; transport called out in layers). */
  primaryLabel: string
  primaryDetail: string
  motion?: "spin" | "pulse"
  transfer?: "upload" | "download"
  liveCount?: string
  severity: "error" | "busy" | "transport" | "ok" | "local" | "unavailable"
}

export function mapAssistantTransportState(
  state: RawAssistantTransportState,
): AssistantTransportUiStatus {
  if (state === "open") return "connected"
  if (state === "connecting" || state === "reconnecting") return "reconnecting"
  return "disconnected"
}

export function mapDataSyncStatus(input: {
  syncProgressStatus: SyncProgress["status"] | undefined
  collabConnected: boolean
  isOnline: boolean
  collaborationMode: "shared" | "local" | null | undefined
  hasSyncContext: boolean
}): DataSyncUiStatus {
  if (!input.hasSyncContext) return "idle"

  if (input.syncProgressStatus === "error") return "error"

  if (
    input.syncProgressStatus === "checking" ||
    input.syncProgressStatus === "planning" ||
    input.syncProgressStatus === "syncing"
  ) {
    return "syncing"
  }

  // Collab link recovery is a data-sync concern, not assistant transport.
  if (
    input.collaborationMode === "shared" &&
    input.isOnline &&
    !input.collabConnected
  ) {
    return "syncing"
  }

  return "idle"
}

export function mapGitRemoteStatus(
  gitRemote: GitRemoteSnapshot | null | undefined,
): GitRemoteUiStatus {
  if (!gitRemote) return "unknown"
  if (gitRemote.error) return "error"
  if (gitRemote.ahead > 0 || gitRemote.behind > 0) return "diverged"
  return "idle"
}

function formatGitRemoteDetail(gitRemote: GitRemoteSnapshot | null | undefined): string {
  if (!gitRemote) return "Not watching remote ahead/behind yet"
  if (gitRemote.error) return gitRemote.error
  const parts: string[] = []
  if (gitRemote.ahead > 0) parts.push(`${gitRemote.ahead} ahead`)
  if (gitRemote.behind > 0) parts.push(`${gitRemote.behind} behind`)
  if (parts.length === 0) return "In sync with upstream"
  return parts.join(" · ")
}

function transportStatusLabel(status: AssistantTransportUiStatus): string {
  switch (status) {
    case "connected":
      return "Connected"
    case "reconnecting":
      return "Reconnecting"
    case "disconnected":
      return "Disconnected"
  }
}

function dataSyncStatusLabel(status: DataSyncUiStatus): string {
  switch (status) {
    case "idle":
      return "Idle"
    case "syncing":
      return "Syncing"
    case "error":
      return "Error"
  }
}

function gitRemoteStatusLabel(status: GitRemoteUiStatus): string {
  switch (status) {
    case "unknown":
      return "Unknown"
    case "idle":
      return "Idle"
    case "diverged":
      return "Diverged"
    case "error":
      return "Error"
  }
}

function formatPendingCount(count: number): string {
  if (count <= 0) return "0 pending"
  return `${count} pending`
}

function formatProgressCount(current: number, total: number): string {
  if (total <= 0) return `${current}`
  return `${Math.min(current, total)}/${total}`
}

/**
 * Resolve chrome + layer copy. Primary chrome stays data-sync oriented so the
 * cloud indicator is not mistaken for assistant transport; transport and git
 * remote are always listed as separate layers.
 */
export function resolveConnectionStatusPresentation(
  input: ConnectionStatusModelInput,
): ConnectionStatusPresentation {
  const transport = mapAssistantTransportState(input.assistantTransport)
  const hasSyncContext = input.syncProgress !== undefined && input.syncProgress !== null
  const syncStatus = input.syncProgress?.status
  const syncMessage = input.syncProgress?.message ?? ""
  const syncCurrent = input.syncProgress?.current ?? 0
  const syncTotal = input.syncProgress?.total ?? 0
  const pendingCount = Math.max(0, syncTotal - syncCurrent)
  const isUploading = syncStatus === "syncing" && syncMessage.startsWith("Uploading")
  const isDownloading = syncStatus === "syncing" && syncMessage.startsWith("Downloading")

  const dataSync = mapDataSyncStatus({
    syncProgressStatus: syncStatus,
    collabConnected: input.collabConnected,
    isOnline: input.isOnline,
    collaborationMode: input.collaborationMode,
    hasSyncContext,
  })
  const gitRemote = mapGitRemoteStatus(input.gitRemote)

  const transportDetail =
    transport === "connected"
      ? "Assistant runtime WebSocket is open"
      : transport === "reconnecting"
        ? "Reconnecting to assistant runtime"
        : "Assistant runtime is not connected"

  let dataSyncDetail: string
  if (!hasSyncContext) {
    dataSyncDetail = "Project collaboration is not active here"
  } else if (input.collaborationMode === "local") {
    dataSyncDetail = input.sharedBranch
      ? `Switch back to ${input.sharedBranch} to collaborate live`
      : "Live collaboration is paused on this branch"
  } else if (!input.isOnline) {
    dataSyncDetail = "Waiting to reconnect live collaboration"
  } else if (syncStatus === "error") {
    dataSyncDetail = syncMessage || "Failed to refresh live collaboration."
  } else if (syncStatus === "checking") {
    dataSyncDetail = "Checking collaboration session"
  } else if (syncStatus === "planning") {
    dataSyncDetail = "Preparing collaboration state"
  } else if (syncStatus === "syncing") {
    dataSyncDetail = formatPendingCount(pendingCount)
  } else if (!input.collabConnected) {
    dataSyncDetail = "Trying to reach live collaboration"
  } else {
    dataSyncDetail = input.sharedBranch
      ? `Collaborating on ${input.sharedBranch}`
      : "Connected to live collaboration"
  }

  const gitRemoteDetail = formatGitRemoteDetail(input.gitRemote)

  const layers: ConnectionStatusLayerLine[] = [
    {
      id: "transport",
      title: "Assistant transport",
      status: transportStatusLabel(transport),
      detail: transportDetail,
    },
    {
      id: "dataSync",
      title: "Data sync",
      status: dataSyncStatusLabel(dataSync),
      detail: dataSyncDetail,
    },
    {
      id: "gitRemote",
      title: "Git remote",
      status: gitRemoteStatusLabel(gitRemote),
      detail: gitRemoteDetail,
    },
  ]

  // Primary chrome: data-sync first (cloud glyph), never assistant-only wording.
  if (!hasSyncContext) {
    return {
      transport,
      dataSync,
      gitRemote,
      layers,
      primaryLabel: "Unavailable",
      primaryDetail: dataSyncDetail,
      severity: "unavailable",
    }
  }

  if (input.collaborationMode === "local") {
    return {
      transport,
      dataSync,
      gitRemote,
      layers,
      primaryLabel: "Local Branch",
      primaryDetail: dataSyncDetail,
      severity: "local",
    }
  }

  if (!input.isOnline) {
    return {
      transport,
      dataSync,
      gitRemote,
      layers,
      primaryLabel: "Offline",
      primaryDetail: dataSyncDetail,
      severity: "transport",
    }
  }

  if (dataSync === "error") {
    return {
      transport,
      dataSync,
      gitRemote,
      layers,
      primaryLabel: "Collab Error",
      primaryDetail: dataSyncDetail,
      severity: "error",
    }
  }

  if (syncStatus === "checking") {
    return {
      transport,
      dataSync,
      gitRemote,
      layers,
      primaryLabel: "Checking",
      primaryDetail: dataSyncDetail,
      motion: "spin",
      severity: "busy",
    }
  }

  if (syncStatus === "planning") {
    return {
      transport,
      dataSync,
      gitRemote,
      layers,
      primaryLabel: "Planning",
      primaryDetail: dataSyncDetail,
      motion: "spin",
      severity: "busy",
    }
  }

  if (syncStatus === "syncing") {
    const liveCount = isDownloading
      ? String(pendingCount)
      : formatProgressCount(syncCurrent, syncTotal)

    return {
      transport,
      dataSync,
      gitRemote,
      layers,
      primaryLabel: isUploading ? "Uploading" : isDownloading ? "Downloading" : "Refreshing",
      primaryDetail: dataSyncDetail,
      motion: "pulse",
      transfer: isUploading ? "upload" : isDownloading ? "download" : undefined,
      liveCount,
      severity: "busy",
    }
  }

  if (!input.collabConnected) {
    return {
      transport,
      dataSync,
      gitRemote,
      layers,
      // Explicit "Collab" so this is not read as assistant transport.
      primaryLabel: "Collab Reconnecting",
      primaryDetail: dataSyncDetail,
      motion: "spin",
      severity: "busy",
    }
  }

  const transportHint =
    transport === "connected"
      ? null
      : transport === "reconnecting"
        ? "Assistant reconnecting"
        : "Assistant disconnected"

  return {
    transport,
    dataSync,
    gitRemote,
    layers,
    primaryLabel: "Live",
    primaryDetail: transportHint
      ? `${dataSyncDetail} · ${transportHint}`
      : dataSyncDetail,
    severity: transport === "connected" ? "ok" : "transport",
  }
}
