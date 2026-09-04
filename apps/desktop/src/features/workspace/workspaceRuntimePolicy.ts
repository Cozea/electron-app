import type { WorkspaceRuntimeRecord } from "@/lib/workspaceRuntimeStore"

const MAX_CONNECTED_COLLAB_BACKGROUND_HOSTS = 2
const MAX_BROWSER_BACKGROUND_HOSTS = 2
const MAX_WARM_BACKGROUND_HOSTS = 2

function canHostRuntime(record: WorkspaceRuntimeRecord): boolean {
  return (
    record.lifecycle !== "closed" &&
    record.lifecycle !== "background-frozen" &&
    Boolean(record.config.projectId && record.config.userId && record.config.workspaceId)
  )
}

export function hasCriticalWorkspaceRuntimeWork(record: WorkspaceRuntimeRecord): boolean {
  return (
    record.signals.hasSyncActivity ||
    record.signals.hasRunningTerminals ||
    record.signals.hasRunningDevServer ||
    record.signals.hasNativePreview
  )
}

function getRuntimeActivityAt(record: WorkspaceRuntimeRecord): number {
  return Math.max(
    record.signals.lastActivityAt ?? 0,
    record.lastAttachedAt ?? 0,
    record.lastDetachedAt ?? 0,
    record.createdAt,
  )
}

function sortMostRecentRuntimeFirst(
  left: WorkspaceRuntimeRecord,
  right: WorkspaceRuntimeRecord,
): number {
  const activityDelta = getRuntimeActivityAt(right) - getRuntimeActivityAt(left)
  if (activityDelta !== 0) {
    return activityDelta
  }

  const createdDelta = right.createdAt - left.createdAt
  if (createdDelta !== 0) {
    return createdDelta
  }

  return left.runtimeId.localeCompare(right.runtimeId)
}

function addRuntime(
  selected: Map<string, WorkspaceRuntimeRecord>,
  record: WorkspaceRuntimeRecord,
): void {
  selected.set(record.runtimeId, record)
}

function addRecentRuntimes(
  selected: Map<string, WorkspaceRuntimeRecord>,
  records: WorkspaceRuntimeRecord[],
  limit: number,
): void {
  let added = 0

  for (const record of records) {
    if (selected.has(record.runtimeId)) {
      continue
    }
    if (added >= limit) {
      return
    }

    addRuntime(selected, record)
    added += 1
  }
}

export function selectHostedWorkspaceRuntimeRecords(
  records: WorkspaceRuntimeRecord[],
): WorkspaceRuntimeRecord[] {
  const eligibleRecords = records.filter(canHostRuntime)
  const selected = new Map<string, WorkspaceRuntimeRecord>()

  for (const record of eligibleRecords) {
    if (record.lifecycle === "focused" || hasCriticalWorkspaceRuntimeWork(record)) {
      addRuntime(selected, record)
    }
  }

  const remainingRecords = eligibleRecords
    .filter((record) => !selected.has(record.runtimeId))
    .sort(sortMostRecentRuntimeFirst)

  addRecentRuntimes(
    selected,
    remainingRecords.filter((record) => record.signals.hasConnectedCollab),
    MAX_CONNECTED_COLLAB_BACKGROUND_HOSTS,
  )
  addRecentRuntimes(
    selected,
    remainingRecords.filter((record) => record.signals.hasVisibleBrowserSurface),
    MAX_BROWSER_BACKGROUND_HOSTS,
  )
  addRecentRuntimes(
    selected,
    remainingRecords.filter(
      (record) =>
        record.lifecycle === "background-warm" &&
        !record.signals.hasConnectedCollab &&
        !record.signals.hasVisibleBrowserSurface,
    ),
    MAX_WARM_BACKGROUND_HOSTS,
  )

  return records.filter((record) => selected.has(record.runtimeId))
}

export function hasHostableWorkspaceRuntime(records: WorkspaceRuntimeRecord[]): boolean {
  return selectHostedWorkspaceRuntimeRecords(records).length > 0
}

export function hasImmediateWorkspaceRuntimeHost(records: WorkspaceRuntimeRecord[]): boolean {
  return selectHostedWorkspaceRuntimeRecords(records).some(
    (record) => record.lifecycle === "focused" || hasCriticalWorkspaceRuntimeWork(record),
  )
}
