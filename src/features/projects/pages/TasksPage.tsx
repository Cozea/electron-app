import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { Id } from '../../../../convex/_generated/dataModel'

import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { openProjectFileInExternalEditor } from '@/features/projects/lib/externalEditorPreference'
import { buildProjectPath } from '@/features/projects/lib/projectRoutes'
import {

  type TaskOverlayLocationState,
  type TaskOverlayPayload,
} from '@/features/projects/lib/taskFocusOverlay'
import type { ProjectScannedRoute } from '@shared/electronApiTypes'
import { GroupedVirtuoso } from 'react-virtuoso'
import { useTranslation } from '@/lib/i18n'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon as __PlusHugeIcon, Cancel01Icon as __XHugeIcon, CheckmarkCircle02Icon as __CheckCircle2HugeIcon, ChevronDoubleCloseIcon as __ChevronDownHugeIcon, Clock01Icon as __Clock3HugeIcon, ComputerActivityIcon as __AppWindowHugeIcon, Delete02Icon as __Trash2HugeIcon, DocumentAttachmentIcon as __FileTextHugeIcon, LeftToRightListBulletIcon as __ListTodoHugeIcon, SquareArrowDownRightIcon as __ArrowUpRightHugeIcon } from '@hugeicons/core-free-icons'

const CheckCircle2 = (props: any) => <HugeiconsIcon icon={__CheckCircle2HugeIcon} {...props} />
const Clock3 = (props: any) => <HugeiconsIcon icon={__Clock3HugeIcon} {...props} />
const ListTodo = (props: any) => <HugeiconsIcon icon={__ListTodoHugeIcon} {...props} />

type BoardStatus = 'planned' | 'active' | 'done'
type BoardSource = 'manual' | 'page' | 'entity' | 'build' | 'lock'

interface ProjectPlanPageRecord {
  id: string
  name: string
  route: string
  type: string
  purpose?: string
  actions?: string[]
}

interface ManualTaskMarkerRecord {
  id: string
  label: string
}

interface ManualTaskClaimantRecord {
  id: string
  name: string
  email?: string
  avatarUrl?: string | null
}

interface ManualTaskRecord {
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

interface ManualTaskAssigneeRecord {
  userId?: string
  name: string
  email?: string
  avatarUrl?: string | null
}

interface ManualTaskContextRecord {
  kind: 'file' | 'page'
  value: string
  label: string
  title: string
}

interface SharedManualTaskRecord {
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

interface TaskMarkerDefinition {
  id: string
  label: string
  defaultChecked: boolean
}

interface TaskMarker {
  id: string
  label: string
  checked: boolean
}

interface TaskClaimant {
  id: string
  name: string
  avatarUrl?: string | null
}

interface TaskClaimantCandidate {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
  searchText: string
}

interface ClaimantUserSummary {
  id?: string
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  profileImageUrl?: string | null
}

interface ClaimantMemberSourceRecord {
  userId: string
  displayName?: string | null
  secondaryLabel?: string | null
  contactEmail?: string | null
  user: ClaimantUserSummary | null
}

interface TaskContextAttachment {
  kind: 'file' | 'page'
  value: string
  label: string
  href?: string
  title: string
}

interface BoardItem {
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

interface TasksPageProps {
  presentation?: 'modal' | 'embedded'
  onRequestClose?: (() => void) | null
}

const HEADER_STATUS_ORDER: BoardStatus[] = ['planned', 'active', 'done']
const GRID_STATUS_ORDER: BoardStatus[] = ['active', 'planned', 'done']
const DEFAULT_COLLAPSED_GROUPS: Record<BoardStatus, boolean> = {
  planned: false,
  active: false,
  done: false,
}

const STATUS_META: Record<
  BoardStatus,
  {
    ariaLabelKey: 'tasks.status.backlog' | 'tasks.status.inProgress' | 'tasks.status.done'
    icon: typeof ListTodo
    iconClassName: string
    surfaceClassName: string
  }
> = {
  planned: {
    ariaLabelKey: 'tasks.status.backlog',
    icon: ListTodo,
    iconClassName: 'text-amber-700 dark:text-amber-900',
    surfaceClassName: 'bg-amber-200 dark:bg-amber-300',
  },
  active: {
    ariaLabelKey: 'tasks.status.inProgress',
    icon: Clock3,
    iconClassName: 'text-sky-700 dark:text-sky-900',
    surfaceClassName: 'bg-sky-200 dark:bg-sky-300',
  },
  done: {
    ariaLabelKey: 'tasks.status.done',
    icon: CheckCircle2,
    iconClassName: 'text-emerald-700 dark:text-emerald-900',
    surfaceClassName: 'bg-emerald-200 dark:bg-emerald-300',
  },
}

function getManualTaskStorageKey(projectId: string): string {
  return `cozea:project-task-board:${projectId}`
}

function getTaskMigrationFlagStorageKey(projectId: string): string {
  return `cozea:project-task-board-migrated:${projectId}`
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim()
}

function createTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

function getInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return initials || '?'
}

function normalizeManualTaskMarkers(value: unknown): ManualTaskMarkerRecord[] {
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

function createDefaultManualTaskMarkers(t?: any): ManualTaskMarkerRecord[] {
  return [
    { id: 'scope', label: t ? t('tasks.markers.scope') : 'Scope the work' },
    { id: 'build', label: t ? t('tasks.markers.implement') : 'Implement the task' },
    { id: 'review', label: t ? t('tasks.markers.review') : 'Review and ship' },
  ]
}

function getClaimantIdentityKey(claimant: {
  id?: string
  email?: string | null
  name?: string | null
}): string {
  const email = claimant.email?.trim().toLowerCase()
  if (email) return `email:${email}`

  const id = claimant.id?.trim()
  if (id) return `id:${id}`

  const name = claimant.name?.trim().toLowerCase()
  return `name:${name || '?'}`
}

function formatClaimantName(user: ClaimantUserSummary | null | undefined, fallback: string): string {
  const first = user?.firstName?.trim() ?? ''
  const last = user?.lastName?.trim() ?? ''
  const fullName = [first, last].filter(Boolean).join(' ')

  if (fullName) return fullName
  if (user?.email?.trim()) return user.email.trim()

  return fallback
}

function getDisplayFirstName(name: string): string {
  const normalized = name.trim()
  if (!normalized) return ''

  const emailPrefix = normalized.split('@')[0]?.trim()
  if (normalized.includes('@') && emailPrefix) return emailPrefix

  return normalized.split(/\s+/)[0] ?? normalized
}

function normalizeManualTaskClaimants(value: unknown): ManualTaskClaimantRecord[] {
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

    const email =
      typeof candidate.email === 'string' && candidate.email.trim().length > 0
        ? candidate.email.trim().toLowerCase()
        : undefined
    const key = getClaimantIdentityKey({
      id: candidate.id,
      email,
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
        email,
        avatarUrl:
          typeof candidate.avatarUrl === 'string' && candidate.avatarUrl.trim().length > 0
            ? candidate.avatarUrl
            : null,
      },
    ]
  })
}

function createDraftMarkerRows(): string[] {
  return createDefaultManualTaskMarkers().map((marker) => marker.label)
}

function parseMarkerRowsInput(values: string[]): ManualTaskMarkerRecord[] {
  const markers = values
    .map((marker) => marker.trim())
    .filter(Boolean)
    .map((label, index) => ({
      id: `custom-${index}-${normalizeSearchValue(label).replace(/\s+/g, '-') || index}`,
      label,
    }))

  return markers.length > 0 ? markers : createDefaultManualTaskMarkers()
}

function inferBoardStatusFromMarkers(markers: Array<Pick<TaskMarker, 'checked'>>): BoardStatus {
  if (markers.length === 0) return 'planned'

  const checkedCount = markers.filter((marker) => marker.checked).length

  if (checkedCount === 0) return 'planned'
  if (checkedCount === markers.length) return 'done'

  return 'active'
}

function deadlineDateToTimestamp(deadlineDate?: string): number | null {
  if (!deadlineDate) return null
  const timestamp = new Date(`${deadlineDate}T12:00:00`).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function truncatePath(path: string, maxLength = 34): string {
  if (path.length <= maxLength) return path
  const parts = path.split('/').filter(Boolean)
  const fileName = parts[parts.length - 1] ?? path
  if (fileName.length + 4 >= maxLength) {
    return `...${fileName.slice(-(maxLength - 3))}`
  }
  return `.../${fileName}`
}

function getFileSelectionPriority(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/')

  if (normalized.startsWith('src/pages/')) return 0
  if (normalized.startsWith('src/')) return 1
  if (normalized.startsWith('convex/')) return 2
  if (normalized.startsWith('server/src/')) return 3
  return 4
}

function getDeadlineMeta(deadlineTimestamp: number | null | undefined, t: any): {
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

function createFileContextAttachment(
  filePath: string,
): TaskContextAttachment {
  return {
    kind: 'file',
    value: filePath,
    label: truncatePath(filePath, 26),
    title: filePath,
  }
}

function createPageContextAttachment(
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

function createStoredContextAttachment(
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

function resolveMarkers(
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

function readStoredManualTasks(projectId: string): ManualTaskRecord[] {
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

function getPrimaryAssigneeRecord(
  claimants: ManualTaskClaimantRecord[],
): ManualTaskAssigneeRecord | undefined {
  const primary = claimants[0]
  if (!primary) return undefined

  return {
    userId: primary.id,
    name: primary.name,
    email: primary.email,
    avatarUrl: primary.avatarUrl ?? null,
  }
}

function buildAssigneeClaimants(
  assignee: ManualTaskAssigneeRecord | undefined,
  prefix: string,
): TaskClaimant[] {
  if (!assignee) return []

  return [
    {
      id:
        assignee.userId ||
        `${prefix}-${normalizeSearchValue(assignee.name).replace(/\s+/g, '-') || 'assignee'}`,
      name: assignee.name,
      avatarUrl: assignee.avatarUrl ?? null,
    },
  ]
}

function TaskListRow({
  item,
  projectId,
  projectPath,
  onToggleMarker,
  t,
}: {
  item: BoardItem
  projectId: string
  projectPath: string | null
  onToggleMarker: (item: BoardItem, markerId: string) => void
  t: any
}) {
  const navigate = useViewTransitionNavigate()
  const [isOpen, setIsOpen] = useState(item.status !== 'done')
  const deadlineMeta = getDeadlineMeta(item.deadlineTimestamp, t)
  const fileIconName = item.context.title.split('/').filter(Boolean).pop() ?? item.context.title
  const taskOverlay: TaskOverlayPayload = {
    projectId,
    storageId: item.storageId,
    source: item.source,
    title: item.title,
    description: item.description,
    context: {
      kind: item.context.kind,
      value: item.context.value,
      label: item.context.label,
      title: item.context.title,
    },
    markers: item.markers,
  }
  const navigationState: TaskOverlayLocationState = {
    taskOverlay,
  }

  async function openContext(): Promise<void> {
    if (item.context.kind === 'file') {
      const result = await openProjectFileInExternalEditor({
        filePath: item.context.value,
        projectPath,
      })
      if (!result.success) {
        console.error('[TasksPage] Failed to open file in external editor', result.error)
      }
      return
    }

    if (!item.context.href) return
    navigate(item.context.href, { state: navigationState })
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border-b border-border/50 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex min-w-0 flex-1 items-start gap-3 text-left"
            aria-label={`${isOpen ? t('tasks.action.collapse') : t('tasks.action.expand')} task ${item.title}`}
          >
            <HugeiconsIcon icon={__ChevronDownHugeIcon}
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-[transform,opacity] duration-200 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100',
                !isOpen && '-rotate-90',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <h3 className="truncate text-[15px] font-normal leading-5 text-foreground">
                  {item.title}
                </h3>

                <span className={cn('inline-flex items-center gap-1.5', deadlineMeta.className)} title={deadlineMeta.label}>
                  <Clock3 className="h-3.5 w-3.5" />
                  {deadlineMeta.label}
                </span>

                <span title={item.context.title} className="inline-flex min-w-0 items-center gap-1.5">
                  {item.context.kind === 'file' ? (
                    getFileIcon(fileIconName, { className: 'h-3.5 w-3.5' })
                  ) : (
                    <HugeiconsIcon icon={__AppWindowHugeIcon} className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{item.context.label}</span>
                </span>

                <span className="truncate">
                  {item.claimants.length > 0
                    ? t('tasks.assignee.assignedTo').replace('{names}', item.claimants.map((claimant) => claimant.name).join(', '))
                    : t('tasks.assignee.unassigned')}
                </span>
              </div>
            </div>
          </button>
        </CollapsibleTrigger>

        <Button
          variant="ghost"
          size="icon-sm"
          className="-mr-1 -mt-1 shrink-0"
          onClick={(event) => {
            event.stopPropagation()
            void openContext()
          }}
          aria-label={`Open ${item.context.title}`}
        >
          <HugeiconsIcon icon={__ArrowUpRightHugeIcon} className="h-4 w-4" />
        </Button>
      </div>

      <CollapsibleContent>
        <div className="space-y-3 pl-7 pt-3">
          {item.description ? (
            <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
          ) : null}

          <ul className="space-y-2">
            {item.markers.map((marker) => (
              <li key={marker.id}>
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={marker.checked}
                    onCheckedChange={() => onToggleMarker(item, marker.id)}
                    aria-label={marker.label}
                  />
                  <span
                    className={cn(
                      'text-sm leading-6',
                      marker.checked ? 'text-muted-foreground line-through' : 'text-foreground',
                    )}
                  >
                    {marker.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function TasksPage({
  presentation = 'modal',
  onRequestClose = null,
}: TasksPageProps = {}) {
  const { t } = useTranslation()
  const isEmbedded = presentation === 'embedded'
  const navigate = useViewTransitionNavigate()
  const { project } = useAccessibleProject()
  const { convexUserId } = useAuth()
  const syncContext = useOptionalProjectSyncContext()
  const projectPath = syncContext?.projectPath ?? null
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<BoardStatus, boolean>>(
    DEFAULT_COLLAPSED_GROUPS,
  )
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftDeadlineDate, setDraftDeadlineDate] = useState('')
  const [draftContextKind, setDraftContextKind] = useState<'file' | 'page'>('page')
  const [draftPageContextValue, setDraftPageContextValue] = useState('')
  const [draftFileContextValue, setDraftFileContextValue] = useState('convex/schema.ts')
  const [draftContextSearch, setDraftContextSearch] = useState('')
  const [draftClaimants, setDraftClaimants] = useState<ManualTaskClaimantRecord[]>([])
  const [draftClaimantSearch, setDraftClaimantSearch] = useState('')
  const [draftMarkerRows, setDraftMarkerRows] = useState<string[]>(() => createDraftMarkerRows())
  const [draftProjectFiles, setDraftProjectFiles] = useState<string[]>([])
  const [draftScannedRoutes, setDraftScannedRoutes] = useState<ProjectScannedRoute[]>([])
  const [draftContextFilesLoading, setDraftContextFilesLoading] = useState(false)
  const [draftContextPagesLoading, setDraftContextPagesLoading] = useState(false)
  const [isCreatingTask, setIsCreatingTask] = useState(false)
  const [isSyncingLocalTasks, setIsSyncingLocalTasks] = useState(false)
  const createManualTask = useMutation(api.projectTasks.createManualTask)
  const setManualTaskCheckedMarkers = useMutation(api.projectTasks.setManualTaskCheckedMarkers)
  const migrateLocalBoardState = useMutation(api.projectTasks.migrateLocalBoardState)

  const projectMembers = useQuery(
    api.projectMembers.listMembers,
    project?._id && convexUserId
      ? { projectId: project._id, viewerUserId: convexUserId }
      : 'skip',
  )
  const sharedManualTasks = useQuery(
    api.projectTasks.listForProject,
    project?._id && convexUserId
      ? { projectId: project._id, viewerUserId: convexUserId }
      : 'skip',
  )

  const projectId = project ? String(project._id) : null

  const projectPagesPath = projectId ? buildProjectPath(projectId, 'workbench') : '/projects'
  const storedFrameworkInfo = useMemo(() => {
    if (!project?.frameworkInfo) return null
    return {
      framework: project.frameworkInfo.framework,
      devCommand: project.frameworkInfo.devCommand,
      devPort: project.frameworkInfo.devPort,
    }
  }, [project?.frameworkInfo])
  const claimantCandidatesLoading = Boolean(project?._id) && projectMembers === undefined
  const claimantCandidates = useMemo(() => {
    const sourceMembers = (projectMembers ?? []) as ClaimantMemberSourceRecord[]
    const byIdentity = new Map<string, TaskClaimantCandidate>()

    for (const member of sourceMembers) {
      const email = (
        member.contactEmail ??
        member.secondaryLabel ??
        member.user?.email ??
        member.displayName ??
        String(member.userId)
      )
        .trim()
        .toLowerCase()
      if (!email) continue

      const name = member.displayName?.trim() || formatClaimantName(member.user, email)
      const candidate: TaskClaimantCandidate = {
        id: String(member.user?.id ?? member.userId),
        name,
        email,
        avatarUrl: member.user?.profileImageUrl ?? null,
        searchText: normalizeSearchValue(`${name} ${email}`),
      }

      byIdentity.set(getClaimantIdentityKey(candidate), candidate)
    }

    return Array.from(byIdentity.values()).sort((left, right) => {
      const nameCompare = left.name.localeCompare(right.name)
      if (nameCompare !== 0) return nameCompare
      return left.email.localeCompare(right.email)
    })
  }, [projectMembers])
  const selectedDraftClaimantKeys = useMemo(
    () => new Set(draftClaimants.map((claimant) => getClaimantIdentityKey(claimant))),
    [draftClaimants],
  )
  const hasDraftClaimantSearch = draftClaimantSearch.trim().length > 0
  const filteredClaimantCandidates = useMemo(() => {
    const searchTerms = normalizeSearchValue(draftClaimantSearch)
      .split(' ')
      .filter(Boolean)

    const unselectedCandidates = claimantCandidates.filter(
      (candidate) => !selectedDraftClaimantKeys.has(getClaimantIdentityKey(candidate)),
    )

    if (searchTerms.length === 0) return unselectedCandidates

    return unselectedCandidates.filter((candidate) =>
      searchTerms.every((term) => candidate.searchText.includes(term)),
    )
  }, [claimantCandidates, draftClaimantSearch, selectedDraftClaimantKeys])
  const defaultManualTaskContext = useMemo<TaskContextAttachment | null>(() => {
    if (!project) return null

    const planPages = (project.generatedPlan?.pages ?? []) as ProjectPlanPageRecord[]

    if (planPages[0]) {
      return createPageContextAttachment(planPages[0], projectPagesPath)
    }

    return createFileContextAttachment('convex/schema.ts')
  }, [project, projectPagesPath])
  const pageContextOptions = useMemo<TaskContextAttachment[]>(() => {
    const options: TaskContextAttachment[] = []
    const seen = new Set<string>()

    for (const route of draftScannedRoutes) {
      const routePath = route.path?.trim() || ''
      const key = routePath || route.name.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      options.push(
        createPageContextAttachment(
          {
            name: route.name,
            route: routePath,
          },
          projectPagesPath,
        ),
      )
    }

    const planPages = (project?.generatedPlan?.pages ?? []) as ProjectPlanPageRecord[]
    for (const page of planPages) {
      const routePath = page.route?.trim() || ''
      const key = routePath || page.name.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      options.push(createPageContextAttachment(page, projectPagesPath))
    }

    return options
  }, [draftScannedRoutes, project?.generatedPlan?.pages, projectPagesPath])
  const fileContextOptions = useMemo<TaskContextAttachment[]>(
    () =>
      [...draftProjectFiles]
        .sort((left, right) => {
          const priorityDelta = getFileSelectionPriority(left) - getFileSelectionPriority(right)
          if (priorityDelta !== 0) return priorityDelta
          return left.localeCompare(right)
        })
        .map((filePath) => createFileContextAttachment(filePath)),
    [draftProjectFiles],
  )
  const filteredPageContextOptions = useMemo(() => {
    const searchTerms = normalizeSearchValue(draftContextSearch)
      .split(' ')
      .filter(Boolean)

    if (searchTerms.length === 0) {
      return []
    }

    return pageContextOptions
      .filter((option) =>
        searchTerms.every((term) =>
          normalizeSearchValue(`${option.label} ${option.title}`).includes(term),
        ),
      )
      .slice(0, 10)
  }, [draftContextSearch, pageContextOptions])
  const filteredFileContextOptions = useMemo(() => {
    const searchTerms = normalizeSearchValue(draftContextSearch)
      .split(' ')
      .filter(Boolean)

    if (searchTerms.length === 0) {
      return []
    }

    return fileContextOptions
      .filter((option) =>
        searchTerms.every((term) =>
          normalizeSearchValue(`${option.label} ${option.title}`).includes(term),
        ),
      )
      .slice(0, 12)
  }, [draftContextSearch, fileContextOptions])
  const selectedDraftContext = useMemo<TaskContextAttachment | null>(() => {
    if (draftContextKind === 'page') {
      return (
        pageContextOptions.find((option) => option.value === draftPageContextValue) ??
        pageContextOptions[0] ??
        null
      )
    }

    return (
      fileContextOptions.find((option) => option.value === draftFileContextValue) ??
      fileContextOptions[0] ??
      null
    )
  }, [
    draftContextKind,
    draftFileContextValue,
    draftPageContextValue,
    fileContextOptions,
    pageContextOptions,
  ])
  const hasDraftContextSearch = draftContextSearch.trim().length > 0
  const visibleContextOptions =
    draftContextKind === 'page' ? filteredPageContextOptions : filteredFileContextOptions
  const isVisibleContextLoading =
    draftContextKind === 'page'
      ? draftContextPagesLoading && pageContextOptions.length === 0
      : draftContextFilesLoading && fileContextOptions.length === 0

  useEffect(() => {
    if (!isCreateDialogOpen || !projectPath) return

    let isCancelled = false

    const loadDraftContextOptions = async () => {
      if (window.electronAPI?.project) {
        setDraftContextFilesLoading(true)
      }
      setDraftContextPagesLoading(true)

      try {
        const contextResult = window.electronAPI?.project
          ? await window.electronAPI.project.getContextOptions({
            projectPath,
            frameworkInfo: storedFrameworkInfo,
          })
          : null

        if (isCancelled) return

        if (contextResult?.success) {
          setDraftProjectFiles(contextResult.files ?? [])
          setDraftScannedRoutes(contextResult.routes ?? [])
        }

        if (contextResult && !contextResult.success) {
          console.error('Failed to load task context options:', contextResult.error)
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to load task context options:', error)
        }
      } finally {
        if (!isCancelled) {
          setDraftContextFilesLoading(false)
          setDraftContextPagesLoading(false)
        }
      }
    }

    void loadDraftContextOptions()

    return () => {
      isCancelled = true
    }
  }, [isCreateDialogOpen, projectPath, storedFrameworkInfo])

  useEffect(() => {
    if (pageContextOptions.length > 0 && !pageContextOptions.some((option) => option.value === draftPageContextValue)) {
      setDraftPageContextValue(pageContextOptions[0].value)
    }
  }, [draftPageContextValue, pageContextOptions])

  useEffect(() => {
    if (fileContextOptions.length > 0 && !fileContextOptions.some((option) => option.value === draftFileContextValue)) {
      setDraftFileContextValue(fileContextOptions[0].value)
    }
  }, [draftFileContextValue, fileContextOptions])

  useEffect(() => {
    if (
      !project?._id ||
      !convexUserId ||
      !projectId ||
      !defaultManualTaskContext ||
      typeof window === 'undefined'
    ) {
      return
    }

    const migrationFlagKey = getTaskMigrationFlagStorageKey(projectId)
    if (window.localStorage.getItem(migrationFlagKey) === 'done') {
      return
    }

    const storedManualTasks = readStoredManualTasks(projectId)
    if (storedManualTasks.length === 0) {
      window.localStorage.setItem(migrationFlagKey, 'done')
      return
    }

    setIsSyncingLocalTasks(true)

    const syncLocalState = async () => {
      try {
        await migrateLocalBoardState({
          projectId: project._id,
          actorUserId: convexUserId,
          manualTasks: storedManualTasks.map((task) => {
            const assignee = getPrimaryAssigneeRecord(task.claimants ?? [])

            return {
              taskKey: task.id,
              title: task.title,
              description: task.description,
              deadlineDate: task.deadlineDate,
              assignee: assignee
                ? {
                    userId: assignee.userId as Id<'users'> | undefined,
                    name: assignee.name,
                    email: assignee.email,
                    avatarUrl: assignee.avatarUrl ?? undefined,
                  }
                : undefined,
              context: {
                kind: defaultManualTaskContext.kind,
                value: defaultManualTaskContext.value,
                label: defaultManualTaskContext.label,
                title: defaultManualTaskContext.title,
              },
              markers: task.markers ?? createDefaultManualTaskMarkers(),
              checkedMarkerIds: task.checkedMarkerIds ?? [],
              createdAt: task.createdAt,
              updatedAt: task.createdAt,
            }
          }),
          sharedStates: [],
        })

        window.localStorage.removeItem(getManualTaskStorageKey(projectId))
        window.localStorage.setItem(migrationFlagKey, 'done')
      } finally {
        setIsSyncingLocalTasks(false)
      }
    }

    void syncLocalState()
  }, [
    convexUserId,
    defaultManualTaskContext,
    migrateLocalBoardState,
    project?._id,
    projectId,
  ])

  const boardItems = useMemo<BoardItem[]>(() => {
    if (!project) return []

    const manualItems: BoardItem[] = ((sharedManualTasks ?? []) as SharedManualTaskRecord[]).map((task) => {
      const markers = resolveMarkers(
        (task.markers ?? createDefaultManualTaskMarkers()).map((marker) => ({
          id: marker.id,
          label: marker.label,
          defaultChecked: false,
        })),
        task.checkedMarkerIds,
      )

      return {
        id: `manual:${task.taskKey}`,
        storageId: task.taskKey,
        title: task.title,
        description: task.description || 'Manually added task.',
        status: inferBoardStatusFromMarkers(markers),
        source: 'manual',
        createdAt: task.createdAt,
        deadlineTimestamp: deadlineDateToTimestamp(task.deadlineDate),
        markers,
        claimants: buildAssigneeClaimants(task.assignee, task.taskKey),
        context: createStoredContextAttachment(task.context, projectPagesPath),
      }
    })

    return manualItems.sort(
      (left, right) => {
        const statusDelta =
          GRID_STATUS_ORDER.indexOf(left.status) - GRID_STATUS_ORDER.indexOf(right.status)
        if (statusDelta !== 0) return statusDelta

        const rightTime = right.createdAt ?? 0
        const leftTime = left.createdAt ?? 0
        if (rightTime !== leftTime) return rightTime - leftTime

        return left.title.localeCompare(right.title)
      },
    )
  }, [
    projectPagesPath,
    project,
    sharedManualTasks,
  ])

  const boardItemsByStatus = useMemo(
    () =>
      boardItems.reduce<Record<BoardStatus, BoardItem[]>>(
        (groups, item) => {
          groups[item.status].push(item)
          return groups
        },
        {
          planned: [],
          active: [],
          done: [],
        },
      ),
    [boardItems],
  )

  const statusStats = useMemo(
    () =>
      HEADER_STATUS_ORDER.map((status) => ({
        status,
        count: boardItemsByStatus[status].length,
      })),
    [boardItemsByStatus],
  )

  const statusSections = useMemo(
    () =>
      GRID_STATUS_ORDER.map((status) => ({
        status,
        items: boardItemsByStatus[status],
      })).filter((section) => section.items.length > 0),
    [boardItemsByStatus],
  )

  const tasksBoardVirtuoso = useMemo(() => {
    const groupCounts: number[] = []
    const flatItems: BoardItem[] = []
    for (const section of statusSections) {
      if (collapsedGroups[section.status]) {
        groupCounts.push(0)
      } else {
        groupCounts.push(section.items.length)
        flatItems.push(...section.items)
      }
    }
    return { groupCounts, flatItems }
  }, [statusSections, collapsedGroups])

  function closeTasksModal(): void {
    if (isEmbedded) {
      onRequestClose?.()
      return
    }
    navigate(projectPagesPath, { replace: true })
  }

  useEffect(() => {
    if (isEmbedded) return
    if (isCreateDialogOpen) return

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeTasksModal()
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isCreateDialogOpen, isEmbedded, projectPagesPath])

  function resetDraft(): void {
    setDraftTitle('')
    setDraftDescription('')
    setDraftDeadlineDate('')
    setDraftContextKind(defaultManualTaskContext?.kind ?? 'page')
    setDraftPageContextValue(defaultManualTaskContext?.kind === 'page' ? defaultManualTaskContext.value : '')
    setDraftFileContextValue(
      defaultManualTaskContext?.kind === 'file'
        ? defaultManualTaskContext.value
        : 'convex/schema.ts',
    )
    setDraftContextSearch('')
    setDraftClaimants([])
    setDraftClaimantSearch('')
    setDraftMarkerRows(createDraftMarkerRows())
  }

  function handleToggleDraftClaimant(candidate: TaskClaimantCandidate): void {
    const candidateKey = getClaimantIdentityKey(candidate)

    setDraftClaimants((current) => {
      if (current.some((claimant) => getClaimantIdentityKey(claimant) === candidateKey)) {
        return []
      }

      return [
        {
          id: candidate.id,
          name: candidate.name,
          email: candidate.email,
          avatarUrl: candidate.avatarUrl ?? null,
        },
      ]
    })
    setDraftClaimantSearch('')
  }

  function handleRemoveDraftClaimant(identityKey: string): void {
    setDraftClaimants((current) =>
      current.filter((claimant) => getClaimantIdentityKey(claimant) !== identityKey),
    )
  }

  function handleDraftMarkerRowChange(index: number, value: string): void {
    setDraftMarkerRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? value : row)),
    )
  }

  function handleAddDraftMarkerRow(): void {
    setDraftMarkerRows((current) => [...current, ''])
  }

  function handleRemoveDraftMarkerRow(index: number): void {
    setDraftMarkerRows((current) => {
      if (current.length === 1) {
        return ['']
      }

      return current.filter((_, rowIndex) => rowIndex !== index)
    })
  }

  async function handleCreateTask(): Promise<void> {
    if (!project?._id || !convexUserId || !selectedDraftContext) return

    const title = draftTitle.trim()
    const description = draftDescription.trim()
    const markers = parseMarkerRowsInput(draftMarkerRows)

    if (!title) return

    setIsCreatingTask(true)

    try {
      const assignee = getPrimaryAssigneeRecord(draftClaimants)

      await createManualTask({
        projectId: project._id,
        actorUserId: convexUserId,
        taskKey: createTaskId(),
        title,
        description,
        deadlineDate: draftDeadlineDate || undefined,
        assignee: assignee
          ? {
              userId: assignee.userId as Id<'users'> | undefined,
              name: assignee.name,
              email: assignee.email,
              avatarUrl: assignee.avatarUrl ?? undefined,
            }
          : undefined,
        context: {
          kind: selectedDraftContext.kind,
          value: selectedDraftContext.value,
          label: selectedDraftContext.label,
          title: selectedDraftContext.title,
        },
        markers,
      })

      resetDraft()
      setIsCreateDialogOpen(false)
    } finally {
      setIsCreatingTask(false)
    }
  }

  function handleToggleMarker(item: BoardItem, markerId: string): void {
    if (!project?._id || !convexUserId) return

    if (item.source !== 'manual') return

    const checkedMarkerIds = item.markers
      .map((marker) =>
        marker.id === markerId
          ? {
              ...marker,
              checked: !marker.checked,
            }
          : marker,
      )
      .filter((marker) => marker.checked)
      .map((marker) => marker.id)

    void setManualTaskCheckedMarkers({
      projectId: project._id,
      actorUserId: convexUserId,
      taskKey: item.storageId,
      checkedMarkerIds,
    })
  }

  if (project === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <div className="loader mr-2" />
        {t('tasks.loading')}
      </div>
    )
  }

  const shell = (
    <div
      role={isEmbedded ? undefined : 'dialog'}
      aria-modal={isEmbedded ? undefined : true}
      aria-labelledby={isEmbedded ? undefined : 'tasks-modal-title'}
      className={cn(
        'flex h-full w-full flex-col overflow-hidden bg-background',
        !isEmbedded &&
          'max-w-2xl rounded-[32px] border border-border/70 shadow-[0_32px_90px_rgba(15,23,42,0.28)]',
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={cn("border-b border-border/60", isEmbedded ? "px-4 py-3" : "px-6 py-5")}>
        {!isEmbedded ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h1 id="tasks-modal-title" className="text-xl font-semibold text-foreground">
                  {t('tasks.header.title')}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('tasks.header.desc')}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
                  disabled={!convexUserId || isCreatingTask || isSyncingLocalTasks || project === null}
                  onClick={() => {
                    resetDraft()
                    setIsCreateDialogOpen(true)
                  }}
                >
                  <HugeiconsIcon icon={__PlusHugeIcon} className="h-3.5 w-3.5" />
                  {isCreatingTask ? t('tasks.empty.btnAdding') : t('tasks.empty.btn')}
                </Button>
                <button
                  type="button"
                  onClick={closeTasksModal}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-secondary/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label={t('tasks.action.close')}
                >
                  <HugeiconsIcon icon={__XHugeIcon} className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {statusStats.map(({ status, count }) => {
                const statusMeta = STATUS_META[status]
                const StatusIcon = statusMeta.icon

                return (
                  <Badge
                    key={status}
                    variant="outline"
                    title={t(statusMeta.ariaLabelKey)}
                    aria-label={`${t(statusMeta.ariaLabelKey)}: ${count}`}
                    className={cn(
                      'gap-1.5 rounded-full border-transparent px-2.5 py-1',
                      statusMeta.surfaceClassName,
                    )}
                  >
                    <StatusIcon className={cn('h-3.5 w-3.5', statusMeta.iconClassName)} />
                    <span className="tabular-nums text-foreground">{count}</span>
                  </Badge>
                )
              })}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {statusStats.map(({ status, count }) => {
                const statusMeta = STATUS_META[status]
                const StatusIcon = statusMeta.icon

                return (
                  <Badge
                    key={status}
                    variant="outline"
                    title={t(statusMeta.ariaLabelKey)}
                    aria-label={`${t(statusMeta.ariaLabelKey)}: ${count}`}
                    className={cn(
                      'gap-1.5 rounded-full border-transparent px-2.5 py-1',
                      statusMeta.surfaceClassName,
                    )}
                  >
                    <StatusIcon className={cn('h-3.5 w-3.5', statusMeta.iconClassName)} />
                    <span className="tabular-nums text-foreground">{count}</span>
                  </Badge>
                )
              })}
            </div>
            <Button
              size="sm"
              className="h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs"
              disabled={!convexUserId || isCreatingTask || isSyncingLocalTasks || project === null}
              onClick={() => {
                resetDraft()
                setIsCreateDialogOpen(true)
              }}
            >
              <HugeiconsIcon icon={__PlusHugeIcon} className="h-3.5 w-3.5" />
              {isCreatingTask ? t('tasks.empty.btnAdding') : t('tasks.empty.btn')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-5 py-5">
        {project === null ? (
          <div className="flex h-full items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia>
                  <ListTodo className="h-8 w-8" />
                </EmptyMedia>
                <EmptyTitle>{t('tasks.empty.projectNotFound')}</EmptyTitle>
                <EmptyDescription>
                  {t('tasks.empty.projectNotFoundDesc')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : boardItems.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Empty className="w-full max-w-2xl py-6">
              <EmptyHeader>
                <EmptyMedia>
                  <ListTodo className="h-8 w-8" />
                </EmptyMedia>
                <EmptyTitle>{t('tasks.empty.title')}</EmptyTitle>
                <EmptyDescription>
                  {isSyncingLocalTasks
                    ? t('tasks.empty.syncing')
                    : t('tasks.empty.desc')}
                </EmptyDescription>
              </EmptyHeader>
              {!isSyncingLocalTasks ? (
                <EmptyContent>
                  <Button
                    type="button"
                    className="gap-2"
                    disabled={!convexUserId || isCreatingTask || project === null}
                    onClick={() => {
                      resetDraft()
                      setIsCreateDialogOpen(true)
                    }}
                  >
                    <HugeiconsIcon icon={__PlusHugeIcon} className="mr-2 h-4 w-4" />
                    {isCreatingTask ? t('tasks.empty.btnAdding') : t('tasks.empty.btn')}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          </div>
        ) : (
          <div
            className={cn(
              "flex min-h-0 w-full flex-1 flex-col",
              isEmbedded ? "max-w-none" : "mx-auto max-w-5xl",
            )}
          >
            <GroupedVirtuoso
              data={tasksBoardVirtuoso.flatItems}
              groupCounts={tasksBoardVirtuoso.groupCounts}
              defaultItemHeight={96}
              increaseViewportBy={{ top: 240, bottom: 480 }}
              style={{ height: "100%", minHeight: 0 }}
              computeItemKey={(_index, item) => item.id}
              groupContent={(groupIndex) => {
                const section = statusSections[groupIndex]
                if (!section) return null
                const statusMeta = STATUS_META[section.status]
                const StatusIcon = statusMeta.icon
                const isCollapsed = collapsedGroups[section.status]

                return (
                  <div className="flex items-center gap-3 pt-4 first:pt-0">
                    <button
                      type="button"
                      title={t(statusMeta.ariaLabelKey)}
                      aria-label={`${isCollapsed ? t('tasks.action.expand') : t('tasks.action.collapse')} ${t(statusMeta.ariaLabelKey)}`}
                      className="group inline-flex shrink-0 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() =>
                        setCollapsedGroups((current) => ({
                          ...current,
                          [section.status]: !current[section.status],
                        }))
                      }
                    >
                      <HugeiconsIcon icon={__ChevronDownHugeIcon}
                        className={cn(
                          "h-4 w-4 transition-[transform,opacity] duration-200 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                          isCollapsed && "-rotate-90",
                        )}
                      />
                      <span className="inline-flex h-7 w-7 items-center justify-center">
                        <StatusIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                      <span className="font-medium text-foreground">{t(statusMeta.ariaLabelKey)}</span>
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sidebar-accent/80 px-2 text-xs tabular-nums text-sidebar-accent-foreground dark:bg-sidebar-accent">
                        {section.items.length}
                      </span>
                    </button>
                    <div className="h-px flex-1 bg-border/70" aria-hidden="true" />
                  </div>
                )
              }}
              itemContent={(_index, _groupIndex, item) => (
                <div className="pt-3">
                  <TaskListRow
                    item={item}
                    projectId={projectId ?? ""}
                    projectPath={projectPath}
                    onToggleMarker={handleToggleMarker}
                    t={t}
                  />
                </div>
              )}
            />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {!isEmbedded ? (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]"
          onClick={closeTasksModal}
          aria-hidden="true"
        />
      ) : null}
      {!isEmbedded ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-14 sm:p-6 sm:pt-16">
          {shell}
        </div>
      ) : (
        shell
      )}

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open)
          if (!open) {
            resetDraft()
          }
        }}
      >
        <DialogContent className="sm:max-w-[860px]" showCloseButton={false}>
          <DialogClose asChild>
            <button
              type="button"
              className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent/70 text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent/85 dark:bg-sidebar-accent/80 dark:hover:bg-sidebar-accent"
              aria-label={t('tasks.action.close')}
            >
              <HugeiconsIcon icon={__XHugeIcon} className="h-4 w-4" />
            </button>
          </DialogClose>
          <DialogHeader>
            <DialogTitle>{t('tasks.create.title')}</DialogTitle>
            <DialogDescription>
              {t('tasks.create.desc')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="task-title">{t('tasks.label.title')}</Label>
                <Input
                  id="task-title"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  placeholder={t('tasks.placeholder.title')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-description">{t('tasks.label.desc')}</Label>
                <Textarea
                  id="task-description"
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  placeholder={t('tasks.placeholder.desc')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-deadline">{t('tasks.label.deadline')}</Label>
                <Input
                  id="task-deadline"
                  type="date"
                  value={draftDeadlineDate}
                  onChange={(event) => setDraftDeadlineDate(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-claimants-search">{t('tasks.label.assignee')}</Label>

                <div className="relative">
                  <Input
                    id="task-claimants-search"
                    value={draftClaimantSearch}
                    onChange={(event) => setDraftClaimantSearch(event.target.value)}
                    placeholder={t('tasks.placeholder.searchPeople')}
                    disabled={claimantCandidatesLoading ? false : claimantCandidates.length === 0}
                  />

                  {hasDraftClaimantSearch ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-[20px] bg-secondary/95 p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur dark:shadow-[0_22px_48px_rgba(0,0,0,0.36)]">
                      <div className="app-scrollbar max-h-56 space-y-1 overflow-y-auto">
                        {claimantCandidatesLoading ? (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            {t('tasks.loadingPeople')}
                          </div>
                        ) : claimantCandidates.length === 0 ? (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            {t('tasks.noPeople')}
                          </div>
                        ) : filteredClaimantCandidates.length === 0 ? (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            {t('tasks.noMatchingPeople')}
                          </div>
                        ) : (
                          filteredClaimantCandidates.map((candidate) => {
                            const identityKey = getClaimantIdentityKey(candidate)

                            return (
                              <button
                                key={identityKey}
                                type="button"
                                className="flex w-full items-center gap-3 rounded-[16px] px-2.5 py-2 text-left transition-colors hover:bg-background/50"
                                onClick={() => handleToggleDraftClaimant(candidate)}
                              >
                                <Avatar className="h-8 w-8">
                                  <AvatarImage
                                    src={candidate.avatarUrl ?? undefined}
                                    alt={candidate.name}
                                  />
                                  <AvatarFallback className="text-xs">
                                    {getInitials(candidate.name)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-foreground">
                                    {candidate.name}
                                  </span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {candidate.email}
                                  </span>
                                </div>
                              </button>
                            )
                          })
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                {draftClaimants.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {draftClaimants.map((claimant) => {
                      const identityKey = getClaimantIdentityKey(claimant)

                      return (
                        <div
                          key={identityKey}
                          className="inline-flex items-center gap-2 rounded-full bg-secondary px-2 py-1"
                        >
                          <Avatar className="h-5 w-5">
                            <AvatarImage
                              src={claimant.avatarUrl ?? undefined}
                              alt={claimant.name}
                            />
                            <AvatarFallback className="text-[10px]">
                              {getInitials(claimant.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span
                            className="max-w-[160px] truncate text-xs font-medium text-foreground"
                            title={claimant.name}
                          >
                            {getDisplayFirstName(claimant.name)}
                          </span>
                          <button
                            type="button"
                            className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                            onClick={() => handleRemoveDraftClaimant(identityKey)}
                            aria-label={t('tasks.action.removeAssignee')}
                          >
                            <HugeiconsIcon icon={__XHugeIcon} className="h-3 w-3" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="hidden self-stretch lg:block">
              <div className="h-full w-px bg-border/70" aria-hidden="true" />
            </div>

            <div className="space-y-4">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>{t('tasks.label.tiedTo')}</Label>
                </div>

                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      className="pr-24"
                      value={draftContextSearch}
                      onChange={(event) => setDraftContextSearch(event.target.value)}
                      placeholder={
                        draftContextKind === 'page'
                          ? t('tasks.placeholder.searchPreviews')
                          : t('tasks.placeholder.searchFiles')
                      }
                    />
                    <div className="absolute right-1 top-1/2 -translate-y-1/2">
                      <div className="relative inline-flex rounded-full bg-secondary p-1">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'pointer-events-none absolute left-1 top-1 h-7 w-7 rounded-full bg-black transition-transform duration-200 ease-out',
                            draftContextKind === 'page' ? 'translate-x-0' : 'translate-x-7',
                          )}
                        />
                      <button
                        type="button"
                        className={cn(
                          'relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-200',
                          draftContextKind === 'page'
                            ? 'text-white'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                        onClick={() => {
                          setDraftContextKind('page')
                          setDraftContextSearch('')
                        }}
                        aria-label={t('tasks.action.choosePreview')}
                        title={t('tasks.action.choosePreview')}
                      >
                        <HugeiconsIcon icon={__AppWindowHugeIcon} className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-200',
                          draftContextKind === 'file'
                            ? 'text-white'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                        onClick={() => {
                          setDraftContextKind('file')
                          setDraftContextSearch('')
                        }}
                        aria-label={t('tasks.action.chooseFile')}
                        title={t('tasks.action.chooseFile')}
                      >
                        <HugeiconsIcon icon={__FileTextHugeIcon} className="h-3.5 w-3.5" />
                      </button>
                      </div>
                    </div>

                    {hasDraftContextSearch ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-[20px] bg-secondary/95 p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur dark:shadow-[0_22px_48px_rgba(0,0,0,0.36)]">
                        <div className="app-scrollbar max-h-56 space-y-1 overflow-y-auto">
                          {isVisibleContextLoading ? (
                            <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                              <div className="loader" />
                              {t('tasks.loadingContext')}
                            </div>
                          ) : visibleContextOptions.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-muted-foreground">
                              {t('tasks.noMatchingContext')}
                            </div>
                          ) : (
                            visibleContextOptions.map((option) => {
                              const isSelected =
                                selectedDraftContext?.kind === option.kind &&
                                selectedDraftContext.value === option.value

                              return (
                                <button
                                  key={`${option.kind}:${option.value || option.title}`}
                                  type="button"
                                  className={cn(
                                    'flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors',
                                    isSelected
                                      ? 'bg-background/70 text-foreground'
                                      : 'hover:bg-background/50',
                                  )}
                                  onClick={() => {
                                    if (option.kind === 'page') {
                                      setDraftContextKind('page')
                                      setDraftPageContextValue(option.value)
                                      setDraftContextSearch('')
                                      return
                                    }

                                    setDraftContextKind('file')
                                    setDraftFileContextValue(option.value)
                                    setDraftContextSearch('')
                                  }}
                                >
                                  <span className="mt-0.5 shrink-0 text-muted-foreground">
                                    {option.kind === 'page' ? (
                                      <HugeiconsIcon icon={__AppWindowHugeIcon} className="h-4 w-4" />
                                    ) : (
                                      getFileIcon(option.title, { className: 'h-4 w-4' })
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-foreground">
                                      {option.kind === 'page'
                                        ? option.title.split('·')[0]?.trim() || option.label
                                        : option.label}
                                    </span>
                                    {option.kind === 'file' ? (
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {option.title}
                                      </span>
                                    ) : null}
                                  </span>
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {selectedDraftContext ? (
                    <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-sidebar-accent/80 px-3 py-1.5 text-xs text-sidebar-accent-foreground dark:bg-sidebar-accent">
                      {selectedDraftContext.kind === 'page' ? (
                        <HugeiconsIcon icon={__AppWindowHugeIcon} className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        getFileIcon(selectedDraftContext.title, {
                          className: 'h-3.5 w-3.5 shrink-0',
                        })
                      )}
                      <span className="truncate">
                        {selectedDraftContext.kind === 'page'
                          ? selectedDraftContext.title.split('·')[0]?.trim() ||
                            selectedDraftContext.label
                          : selectedDraftContext.title}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>{t('tasks.label.objectives')}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-full px-2 text-xs text-muted-foreground"
                    onClick={handleAddDraftMarkerRow}
                  >
                    <HugeiconsIcon icon={__PlusHugeIcon} className="h-3.5 w-3.5" />
                    {t('tasks.action.addRow')}
                  </Button>
                </div>

                <div className="space-y-2.5">
                  {draftMarkerRows.map((marker, index) => (
                    <div key={`draft-marker-row-${index}`} className="relative">
                      <Input
                        className="pr-10"
                        value={marker}
                        onChange={(event) => handleDraftMarkerRowChange(index, event.target.value)}
                        placeholder={`${t('tasks.placeholder.objective')} ${index + 1}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full text-muted-foreground"
                        onClick={() => handleRemoveDraftMarkerRow(index)}
                        aria-label={`Remove marker ${index + 1}`}
                      >
                        <HugeiconsIcon icon={__Trash2HugeIcon} className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                void handleCreateTask()
              }}
              disabled={draftTitle.trim().length === 0 || isCreatingTask || !selectedDraftContext}
            >
              {isCreatingTask ? 'Adding...' : 'Add Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
