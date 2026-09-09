import type { TranslationKey } from '@/lib/i18n'

export type TaskTranslator = (key: TranslationKey) => string

export type BoardStatus = 'planned' | 'active' | 'done'
export type BoardSource = 'manual' | 'page' | 'entity' | 'build' | 'lock'

export interface ProjectPlanPageRecord {
  id: string
  name: string
  route: string
  type: string
  purpose?: string
  actions?: string[]
}

export interface ManualTaskMarkerRecord {
  id: string
  label: string
}

export interface ManualTaskClaimantRecord {
  id: string
  name: string
  identityKey?: string
  avatarUrl?: string | null
}

export interface ManualTaskRecord {
  id: string
  title: string
  description: string
  status: BoardStatus
  createdAt: number
  deadlineDate?: string
  claimants?: ManualTaskClaimantRecord[]
  markers?: ManualTaskMarkerRecord[]
  checkedMarkerIds?: string[]
}

export interface ManualTaskAssigneeRecord {
  principalId?: string
  name: string
  identityKey?: string
  avatarUrl?: string | null
}

export interface ManualTaskContextRecord {
  kind: 'file' | 'page'
  value: string
  label: string
  title: string
}

export interface SharedManualTaskRecord {
  taskKey: string
  title: string
  description: string
  status: BoardStatus
  createdAt: number
  updatedAt: number
  deadlineDate?: string
  assignee?: ManualTaskAssigneeRecord
  context: ManualTaskContextRecord
  markers: ManualTaskMarkerRecord[]
  checkedMarkerIds: string[]
}

export interface TaskMarkerDefinition {
  id: string
  label: string
  defaultChecked: boolean
}

export interface TaskMarker {
  id: string
  label: string
  checked: boolean
}

export interface TaskClaimant {
  id: string
  name: string
  avatarUrl?: string | null
}

export interface TaskClaimantCandidate {
  id: string
  name: string
  identityKey: string
  avatarUrl?: string | null
  searchText: string
}

export interface ClaimantMemberSourceRecord {
  principalId: string
  identityKey: string
  displayName: string
  avatarUrl?: string | null
}

export interface TaskContextAttachment {
  kind: 'file' | 'page'
  value: string
  label: string
  href?: string
  title: string
}

export interface BoardItem {
  id: string
  storageId: string
  title: string
  description: string
  status: BoardStatus
  source: BoardSource
  href?: string
  createdAt?: number
  deadlineTimestamp?: number | null
  markers: TaskMarker[]
  claimants: TaskClaimant[]
  context: TaskContextAttachment
  files?: string[]
}

export function getManualTaskStorageKey(projectId: string): string {
  return `cozea:project-task-board:${projectId}`
}

export function getTaskMigrationFlagStorageKey(projectId: string): string {
  return `cozea:project-task-board-migrated:${projectId}`
}

export function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim()
}

export function createTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

export function getInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return initials || '?'
}

export function normalizeManualTaskMarkers(value: unknown): ManualTaskMarkerRecord[] {
  if (!Array.isArray(value)) return createDefaultManualTaskMarkers()

  const markers = value.flatMap((item, index) => {
    if (typeof item === 'string') {
      const label = item.trim()
      if (!label) return []
      return [{ id: `marker-${index}`, label }]
    }

    if (!item || typeof item !== 'object') return []

    const candidate = item as Partial<ManualTaskMarkerRecord>
    if (typeof candidate.label !== 'string') return []

    const label = candidate.label.trim()
    if (!label) return []

    return [
      {
        id: typeof candidate.id === 'string' && candidate.id.trim().length > 0
          ? candidate.id
          : `marker-${index}`,
        label,
      },
    ]
  })

  return markers.length > 0 ? markers : createDefaultManualTaskMarkers()
}

export function createDefaultManualTaskMarkers(t?: TaskTranslator): ManualTaskMarkerRecord[] {
  return [
    { id: 'scope', label: t ? t('tasks.markers.scope') : 'Scope the work' },
    { id: 'build', label: t ? t('tasks.markers.implement') : 'Implement the task' },
    { id: 'review', label: t ? t('tasks.markers.review') : 'Review and ship' },
  ]
}

export function getClaimantIdentityKey(claimant: {
  id?: string
  identityKey?: string | null
  name?: string | null
}): string {
  const identityKey = claimant.identityKey?.trim().toLowerCase()
  if (identityKey) return `device:${identityKey}`

  const id = claimant.id?.trim()
  if (id) return `id:${id}`

  const name = claimant.name?.trim().toLowerCase()
  return `name:${name || '?'}`
}

export function getDisplayFirstName(name: string): string {
  const normalized = name.trim()
  if (!normalized) return ''

  return normalized.split(/\s+/)[0] ?? normalized
}

export function normalizeManualTaskClaimants(value: unknown): ManualTaskClaimantRecord[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()

  return value.flatMap((item, index) => {
    if (typeof item === 'string') {
      const name = item.trim()
      if (!name) return []

      const key = getClaimantIdentityKey({ name })
      if (seen.has(key)) return []
      seen.add(key)

      return [
        {
          id: `claimant-${index}-${normalizeSearchValue(name).replace(/\s+/g, '-') || index}`,
          name,
        },
      ]
    }

    if (!item || typeof item !== 'object') return []

    const candidate = item as Partial<ManualTaskClaimantRecord>
    if (typeof candidate.name !== 'string') return []

    const name = candidate.name.trim()
    if (!name) return []

    const identityKey =
      typeof candidate.identityKey === 'string' && candidate.identityKey.trim().length > 0
        ? candidate.identityKey.trim().toLowerCase()
        : undefined
    const key = getClaimantIdentityKey({
      id: candidate.id,
      identityKey,
      name,
    })

    if (seen.has(key)) return []
    seen.add(key)

    return [
      {
        id:
          typeof candidate.id === 'string' && candidate.id.trim().length > 0
            ? candidate.id
            : `claimant-${index}-${normalizeSearchValue(name).replace(/\s+/g, '-') || index}`,
        name,
        identityKey,
        avatarUrl:
          typeof candidate.avatarUrl === 'string' && candidate.avatarUrl.trim().length > 0
            ? candidate.avatarUrl
            : null,
      },
    ]
  })
}

export function createDraftMarkerRows(): string[] {
  return createDefaultManualTaskMarkers().map((marker) => marker.label)
}

export function parseMarkerRowsInput(values: string[]): ManualTaskMarkerRecord[] {
  const markers = values
    .map((marker) => marker.trim())
    .filter(Boolean)
    .map((label, index) => ({
      id: `custom-${index}-${normalizeSearchValue(label).replace(/\s+/g, '-') || index}`,
      label,
    }))

  return markers.length > 0 ? markers : createDefaultManualTaskMarkers()
}

export function inferBoardStatusFromMarkers(markers: Array<Pick<TaskMarker, 'checked'>>): BoardStatus {
  if (markers.length === 0) return 'planned'

  const checkedCount = markers.filter((marker) => marker.checked).length

  if (checkedCount === 0) return 'planned'
  if (checkedCount === markers.length) return 'done'

  return 'active'
}

export function deadlineDateToTimestamp(deadlineDate?: string): number | null {
  if (!deadlineDate) return null
  const timestamp = new Date(`${deadlineDate}T12:00:00`).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export function truncatePath(path: string, maxLength = 34): string {
  if (path.length <= maxLength) return path
  const parts = path.split('/').filter(Boolean)
  const fileName = parts[parts.length - 1] ?? path
  if (fileName.length + 4 >= maxLength) {
    return `...${fileName.slice(-(maxLength - 3))}`
  }
  return `.../${fileName}`
}

export function getFileSelectionPriority(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/')

  if (normalized.startsWith('src/pages/')) return 0
  if (normalized.startsWith('src/')) return 1
  if (normalized.startsWith('convex/')) return 2
  if (normalized.startsWith('server/src/')) return 3
  return 4
}

export function getDeadlineMeta(deadlineTimestamp: number | null | undefined, t: TaskTranslator): {
  label: string
  className: string
} {
  if (!deadlineTimestamp) {
    return {
      label: t('tasks.deadline.none'),
      className: 'text-muted-foreground',
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.ceil((deadlineTimestamp - today.getTime()) / 86_400_000)

  if (diffDays < 0) {
    return {
      label: t('tasks.deadline.overdue').replace('{days}', String(Math.abs(diffDays))),
      className: 'text-rose-700 dark:text-rose-400',
    }
  }

  if (diffDays === 0) {
    return {
      label: t('tasks.deadline.today'),
      className: 'text-amber-700 dark:text-amber-400',
    }
  }

  if (diffDays === 1) {
    return {
      label: t('tasks.deadline.tomorrow'),
      className: 'text-amber-700 dark:text-amber-400',
    }
  }

  return {
    label: t('tasks.deadline.daysLeft').replace('{days}', String(diffDays)),
    className: 'text-foreground',
  }
}

export function createFileContextAttachment(
  filePath: string,
): TaskContextAttachment {
  return {
    kind: 'file',
    value: filePath,
    label: truncatePath(filePath, 26),
    title: filePath,
  }
}

export function createPageContextAttachment(
  page: Pick<ProjectPlanPageRecord, 'name' | 'route'>,
  projectPagesPath: string,
): TaskContextAttachment {
  const routeLabel = page.route?.trim() || page.name
  return {
    kind: 'page',
    value: page.route?.trim() || '',
    label: truncatePath(routeLabel, 26),
    href: page.route
      ? `${projectPagesPath}?route=${encodeURIComponent(page.route)}`
      : projectPagesPath,
    title: page.route ? `${page.name} · ${page.route}` : page.name,
  }
}

export function createStoredContextAttachment(
  context: ManualTaskContextRecord,
  projectPagesPath: string,
): TaskContextAttachment {
  if (context.kind === 'page') {
    const route = context.value.trim()
    return {
      kind: 'page',
      value: route,
      label: context.label || truncatePath(route || context.title || 'Preview', 26),
      href: route ? `${projectPagesPath}?route=${encodeURIComponent(route)}` : projectPagesPath,
      title: context.title || route || 'Preview',
    }
  }

  const filePath = context.value.trim()
  return {
    kind: 'file',
    value: filePath,
    label: context.label || truncatePath(filePath, 26),
    title: context.title || filePath,
  }
}

export function resolveMarkers(
  definitions: TaskMarkerDefinition[],
  checkedIdsOverride: string[] | undefined,
): TaskMarker[] {
  const checkedIds = new Set(
    checkedIdsOverride ?? definitions.filter((marker) => marker.defaultChecked).map((marker) => marker.id),
  )

  return definitions.map((marker) => ({
    id: marker.id,
    label: marker.label,
    checked: checkedIds.has(marker.id),
  }))
}

export function readStoredManualTasks(projectId: string): ManualTaskRecord[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(getManualTaskStorageKey(projectId))
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []

      const candidate = item as Partial<ManualTaskRecord>
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.title !== 'string' ||
        typeof candidate.description !== 'string' ||
        typeof candidate.createdAt !== 'number'
      ) {
        return []
      }

      return [
        {
          id: candidate.id,
          title: candidate.title,
          description: candidate.description,
          status:
            candidate.status === 'planned' ||
            candidate.status === 'active' ||
            candidate.status === 'done'
              ? candidate.status
              : 'planned',
          createdAt: candidate.createdAt,
          deadlineDate:
            typeof candidate.deadlineDate === 'string' && candidate.deadlineDate.length > 0
              ? candidate.deadlineDate
              : undefined,
          claimants: normalizeManualTaskClaimants(candidate.claimants),
          markers: normalizeManualTaskMarkers(candidate.markers),
          checkedMarkerIds: Array.isArray(candidate.checkedMarkerIds)
            ? candidate.checkedMarkerIds.filter((markerId): markerId is string => typeof markerId === 'string' && markerId.length > 0)
            : [],
        },
      ]
    })
  } catch {
    return []
  }
}

export function getPrimaryAssigneeRecord(
  claimants: ManualTaskClaimantRecord[],
): ManualTaskAssigneeRecord | undefined {
  const primary = claimants[0]
  if (!primary) return undefined

  return {
    principalId: primary.id,
    name: primary.name,
    identityKey: primary.identityKey,
    avatarUrl: primary.avatarUrl ?? null,
  }
}

export function buildAssigneeClaimants(
  assignee: ManualTaskAssigneeRecord | undefined,
  prefix: string,
): TaskClaimant[] {
  if (!assignee) return []

  return [
    {
      id:
        assignee.principalId ||
        `${prefix}-${normalizeSearchValue(assignee.name).replace(/\s+/g, '-') || 'assignee'}`,
      name: assignee.name,
      avatarUrl: assignee.avatarUrl ?? null,
    },
  ]
}
