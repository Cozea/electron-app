export type TaskOverlaySource = 'manual' | 'page' | 'entity' | 'build' | 'lock'

export interface TaskOverlayMarker {
  id: string
  label: string
  checked: boolean
}

export interface TaskOverlayContext {
  kind: 'file' | 'page'
  value: string
  label: string
  title: string
}

export interface TaskOverlayPayload {
  projectId: string
  storageId: string
  source: TaskOverlaySource
  title: string
  description: string
  context: TaskOverlayContext
  markers: TaskOverlayMarker[]
}

export interface TaskOverlayLocationState {
  taskOverlay?: TaskOverlayPayload | null
}

export function applyTaskOverlayCheckedMarkerIds(
  task: TaskOverlayPayload | null | undefined,
  checkedMarkerIds: string[] | null | undefined,
): TaskOverlayMarker[] {
  if (!task) return []

  const hasOverride = Array.isArray(checkedMarkerIds)
  const checkedIds = new Set(
    (checkedMarkerIds ?? [])
      .map((markerId) => markerId.trim())
      .filter((markerId) => markerId.length > 0),
  )

  return (task.markers ?? []).map((marker) => ({
    ...marker,
    checked: hasOverride ? checkedIds.has(marker.id) : marker.checked,
  }))
}

export function getSyntheticOverlaySource(
  source: TaskOverlaySource,
): Exclude<TaskOverlaySource, 'manual'> | null {
  if (source === 'manual') return null
  return source
}

export function getSyntheticSourceFromStorageId(
  storageId: string,
): Exclude<TaskOverlaySource, 'manual'> | null {
  if (storageId.startsWith('page:')) return 'page'
  if (storageId.startsWith('entity:')) return 'entity'
  if (storageId.startsWith('build:')) return 'build'
  if (storageId.startsWith('lock:')) return 'lock'
  return null
}
