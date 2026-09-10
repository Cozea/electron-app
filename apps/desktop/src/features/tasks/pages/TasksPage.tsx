import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  useMutation,
  useQuery,
} from 'convex/react';
import type {
  Id,
} from '../../../../../../convex/_generated/dataModel';

import {
  api,
} from '../../../../../../convex/_generated/api';
import {
  TaskListRow,
} from "@/features/tasks/components/TaskListRow";
import {
  getManualTaskStorageKey,
  getTaskMigrationFlagStorageKey,
  normalizeSearchValue,
  createTaskId,
  getInitials,
  createDefaultManualTaskMarkers,
  getClaimantIdentityKey,
  getDisplayFirstName,
  createDraftMarkerRows,
  parseMarkerRowsInput,
  inferBoardStatusFromMarkers,
  deadlineDateToTimestamp,
  getFileSelectionPriority,
  createFileContextAttachment,
  createPageContextAttachment,
  createStoredContextAttachment,
  resolveMarkers,
  readStoredManualTasks,
  getPrimaryAssigneeRecord,
  buildAssigneeClaimants,
} from '@/features/tasks/model/taskBoardModel';
import type {
  BoardStatus,
  ProjectPlanPageRecord,
  ManualTaskClaimantRecord,
  SharedManualTaskRecord,
  TaskClaimantCandidate,
  ClaimantMemberSourceRecord,
  TaskContextAttachment,
  BoardItem,
} from '@/features/tasks/model/taskBoardModel';
import {
  useAuth,
} from '@/contexts/AuthContext';
import {
  useAccessibleProject,
} from '@/contexts/project/useAccessibleProject';

import {
  buildProjectPath,
} from '@/contexts/project/projectRoutes';

import type {
  ProjectScannedRoute,
} from '@shared/electronApiTypes';
import {
  ScrollArea,
} from '@/components/ui/scroll-area';
import {
  GroupedVirtuoso,
} from 'react-virtuoso';
import {
  useTranslation,
} from '@/lib/i18n';
import {
  useViewTransitionNavigate,
} from '@/lib/navigation';
import {
  cn,
} from '@/lib/utils';
import {
  asHugeIcon,
} from '@/lib/icons/asHugeIcon';
import {
  getFileIcon,
} from '@/lib/fileExplorer/fileIcons';
import {
  useOptionalProjectSyncContext,
} from '@/contexts/project/ProjectSyncContext';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import {
  Badge,
} from '@/components/ui/badge';
import {
  Button,
} from '@/components/ui/button';


import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Input,
} from '@/components/ui/input';
import {
  Label,
} from '@/components/ui/label';
import {
  Textarea,
} from '@/components/ui/textarea';
import {
  AppOverlayPortal,
} from '@/components/ui/app-overlay-portal';
import {
  resolveAvailableTaskContextKind,
  selectDefaultTaskContext,
} from '@/features/tasks/model/taskContextSelection';

import {
  HugeiconsIcon,
} from '@hugeicons/react';
import {
  Add01Icon as __PlusHugeIcon,
  Cancel01Icon as __XHugeIcon,
  CheckmarkCircle02Icon as __CheckCircle2HugeIcon,
  ChevronDoubleCloseIcon as __ChevronDownHugeIcon,
  Clock01Icon as __Clock3HugeIcon,
  ComputerActivityIcon as __AppWindowHugeIcon,
  Delete02Icon as __Trash2HugeIcon,
  DocumentAttachmentIcon as __FileTextHugeIcon,
  LeftToRightListBulletIcon as __ListTodoHugeIcon,
} from '@hugeicons/core-free-icons';

const CheckCircle2 = asHugeIcon(__CheckCircle2HugeIcon)
const Clock3 = asHugeIcon(__Clock3HugeIcon)
const ListTodo = asHugeIcon(__ListTodoHugeIcon)


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




export function TasksPage({
  presentation = 'modal',
  onRequestClose = null,
}: TasksPageProps = {}) {
  const { t } = useTranslation()
  const isEmbedded = presentation === 'embedded'
  const navigate = useViewTransitionNavigate()
  const { project } = useAccessibleProject()
  const { principalId } = useAuth()
  // Plan pages live in the artifacts table (split off the project doc);
  // the query coalesces legacy inline fields server-side.
  const projectArtifacts = useQuery(
    api.projects.getArtifacts,
    project?._id && principalId
      ? { projectId: project._id, principalId: principalId }
      : 'skip',
  )
  const syncContext = useOptionalProjectSyncContext()
  const workspaceId = syncContext?.workspaceId ?? null
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<BoardStatus, boolean>>(
    DEFAULT_COLLAPSED_GROUPS,
  )
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftDeadlineDate, setDraftDeadlineDate] = useState('')
  const [draftContextKind, setDraftContextKind] = useState<'file' | 'page'>('page')
  const [draftPageContextValue, setDraftPageContextValue] = useState('')
  const [draftFileContextValue, setDraftFileContextValue] = useState('')
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
    project?._id && principalId
      ? { projectId: project._id, viewerPrincipalId: principalId }
      : 'skip',
  )
  const sharedManualTasks = useQuery(
    api.projectTasks.listForProject,
    project?._id && principalId
      ? { projectId: project._id, viewerPrincipalId: principalId }
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
      const identityKey = member.identityKey.trim().toLowerCase()
      if (!identityKey) continue
      const name = member.displayName.trim() || identityKey
      const candidate: TaskClaimantCandidate = {
        id: String(member.principalId),
        name,
        identityKey,
        avatarUrl: member.avatarUrl ?? null,
        searchText: normalizeSearchValue(`${name} ${identityKey}`),
      }
      byIdentity.set(getClaimantIdentityKey(candidate), candidate)
    }

    return Array.from(byIdentity.values()).sort((left, right) => {
      const nameCompare = left.name.localeCompare(right.name)
      if (nameCompare !== 0) return nameCompare
      return left.identityKey.localeCompare(right.identityKey)
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

    const planPages = (projectArtifacts?.generatedPlan?.pages ?? []) as ProjectPlanPageRecord[]
    for (const page of planPages) {
      const routePath = page.route?.trim() || ''
      const key = routePath || page.name.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      options.push(createPageContextAttachment(page, projectPagesPath))
    }

    return options
  }, [draftScannedRoutes, projectArtifacts?.generatedPlan?.pages, projectPagesPath])
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
  const defaultManualTaskContext = useMemo<TaskContextAttachment | null>(
    () => selectDefaultTaskContext(pageContextOptions, fileContextOptions),
    [fileContextOptions, pageContextOptions],
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
    if (!isCreateDialogOpen || !workspaceId) return

    let isCancelled = false

    const loadDraftContextOptions = async () => {
      if (window.electronAPI?.project) {
        setDraftContextFilesLoading(true)
      }
      setDraftContextPagesLoading(true)

      try {
        const contextResult = window.electronAPI?.project
          ? await window.electronAPI.project.getContextOptions({
            workspaceId,
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
  }, [isCreateDialogOpen, workspaceId, storedFrameworkInfo])

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
    setDraftContextKind((current) =>
      resolveAvailableTaskContextKind(current, pageContextOptions.length, fileContextOptions.length),
    )
  }, [fileContextOptions.length, pageContextOptions.length])

  useEffect(() => {
    if (
      !project?._id ||
      !principalId ||
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
          actorPrincipalId: principalId,
          manualTasks: storedManualTasks.map((task) => {
            const assignee = getPrimaryAssigneeRecord(task.claimants ?? [])

            return {
              taskKey: task.id,
              title: task.title,
              description: task.description,
              deadlineDate: task.deadlineDate,
              assignee: assignee
                ? {
                    principalId: assignee.principalId as Id<'devicePrincipals'> | undefined,
                    name: assignee.name,
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
    principalId,
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
        : '',
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
          identityKey: candidate.identityKey,
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
    if (!project?._id || !principalId || !selectedDraftContext) return

    const title = draftTitle.trim()
    const description = draftDescription.trim()
    const markers = parseMarkerRowsInput(draftMarkerRows)

    if (!title) return

    setIsCreatingTask(true)

    try {
      const assignee = getPrimaryAssigneeRecord(draftClaimants)

      await createManualTask({
        projectId: project._id,
        actorPrincipalId: principalId,
        taskKey: createTaskId(),
        title,
        description,
        deadlineDate: draftDeadlineDate || undefined,
        assignee: assignee
          ? {
              principalId: assignee.principalId as Id<'devicePrincipals'> | undefined,
              name: assignee.name,
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
    if (!project?._id || !principalId) return

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
      actorPrincipalId: principalId,
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
      aria-label={isEmbedded ? undefined : t('tasks.header.title')}
      className={cn(
        'flex h-full w-full flex-col overflow-hidden bg-background',
        !isEmbedded &&
          'max-w-2xl rounded-[32px] border border-border/70 shadow-[0_32px_90px_rgba(15,23,42,0.28)]',
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={cn("relative", isEmbedded ? "px-4 py-3" : "px-6 pt-5 pb-3")}>
        {!isEmbedded ? (
          <>
            <div className="flex items-center justify-end gap-4">
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
                  disabled={!principalId || isCreatingTask || isSyncingLocalTasks || project === null}
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
              disabled={!principalId || isCreatingTask || isSyncingLocalTasks || project === null}
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

      <ScrollArea scrollFade className="min-h-0 flex-1">
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
                    disabled={!principalId || isCreatingTask || project === null}
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
                    workspaceId={workspaceId}
                    onToggleMarker={handleToggleMarker}
                    t={t}
                  />
                </div>
              )}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  </div>
)

  return (
    <>
      {!isEmbedded ? (
        <AppOverlayPortal>
          <div
            className="fixed inset-0 z-[var(--cozea-layer-dialog)] bg-black/45 backdrop-blur-[2px]"
            data-cozea-overlay="dialog"
            onClick={closeTasksModal}
            aria-hidden="true"
          />
          <div
            className="fixed inset-0 z-[var(--cozea-layer-dialog)] flex items-start justify-center p-4 pt-14 sm:p-6 sm:pt-16"
            data-cozea-overlay="dialog"
          >
            {shell}
          </div>
        </AppOverlayPortal>
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
                                    {candidate.identityKey}
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
