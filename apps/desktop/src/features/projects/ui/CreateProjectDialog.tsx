import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Spinner } from "@/components/ui/spinner"
import { appToast } from "@/lib/appToast"
import { continueLocalProjectCreation } from "@/features/projects/lib/continueLocalProjectCreation"
import { requireLocalProjectsApi } from "@/features/projects/lib/localProjectsApi"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { UnifiedModal } from "@/components/ui/unified-modal"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { GhCliStatus } from "@cozea/app-contract/electronApi"
import type { DevAppScaffoldStarter } from "../../../../../../shared/devAppAuthoringTypes"
import { useNavigateTo } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import {
  SettingsGroup,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  settingsInlineInputWidth,
} from "@/features/settings/ui/SettingsChrome"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { buildWorkbenchIntentState } from "@/features/workbench/model/workbenchIntent"
import { browseForDirectory } from "@/lib/browseForDirectory"
import {
  buildFilesystemSlug,
  deriveNameFromPath,
  inspectLocalGitState,
  resolveImportedProjectName,
  type LocalGitState,
} from "@/features/projects/lib/localProjectImport"
import type { CreateProjectDialogMode } from "@/lib/createProjectDialogStore"
import { DEFAULT_WORKBENCH_LANE_ID } from "@/lib/workbenchScopeKey"
import {
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore"
import { useTranslation } from "@/lib/i18n"
import { useLocalProjectImport } from "@/features/projects/hooks/useLocalProjectImport"
import {
  readLocalProjectCreationIntent,
  saveLocalProjectCreationIntent,
  clearLocalProjectCreationIntent,
  type LocalProjectCreationIntent,
} from "@/features/projects/lib/localProjectCreationIntent"

import { HugeiconsIcon } from '@hugeicons/react'
import { Folder01Icon } from '@hugeicons/core-free-icons'

interface CreateProjectDialogProps {
  open: boolean
  mode: CreateProjectDialogMode
  initialLocalFolderPath?: string
  onOpenChange: (open: boolean) => void
}

interface DialogCopy {
  title: string
  description: string
  submitLabel: string
}

function formatLocationPathPreview(pathValue: string, maxParents = 2): string {
  const trimmed = pathValue.trim()
  if (!trimmed) return ""

  const maxSegments = Math.max(1, maxParents + 1)
  const segments = trimmed.split(/[\\/]+/).filter(Boolean)
  if (segments.length <= maxSegments) {
    return trimmed
  }

  return `.../${segments.slice(-maxSegments).join("/")}`
}

// Cache gh CLI status globally so we only probe once per app session.
let cachedGhCliStatus: GhCliStatus | null = null
let ghCliStatusPromise: Promise<GhCliStatus> | null = null

function getGhCliStatus(): Promise<GhCliStatus> {
  if (cachedGhCliStatus) return Promise.resolve(cachedGhCliStatus)
  if (ghCliStatusPromise) return ghCliStatusPromise
  ghCliStatusPromise = window.electronAPI.project
    .checkGhCliStatus()
    .then((status) => {
      cachedGhCliStatus = status
      return status
    })
    .catch(() => {
      const fallback: GhCliStatus = { available: false, error: "Failed to check GitHub CLI." }
      cachedGhCliStatus = fallback
      return fallback
    })
  return ghCliStatusPromise
}

export function CreateProjectDialog({
  open,
  mode,
  initialLocalFolderPath = "",
  onOpenChange,
}: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const navigateTo = useNavigateTo()
  const { importPickedLocalFolder } = useLocalProjectImport()

  const [creationIntent, setCreationIntent] = useState<LocalProjectCreationIntent | null>(null)
  const [isIntentReady, setIsIntentReady] = useState(false)
  const submissionRef = useRef(false)
  const [name, setName] = useState("")
  const [parentDirectory, setParentDirectory] = useState("")
  const [localFolderPath, setLocalFolderPath] = useState("")
  const [localGitState, setLocalGitState] = useState<LocalGitState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scaffoldWarnings, setScaffoldWarnings] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasEditedName, setHasEditedName] = useState(false)
  const [createGitHubRepo, setCreateGitHubRepo] = useState(false)
  const [repoVisibility, setRepoVisibility] = useState<"private" | "public">("public")
  const [ghCliAvailable, setGhCliAvailable] = useState<boolean | null>(cachedGhCliStatus?.available ?? null)
  const [devAppStarter, setDevAppStarter] = useState<DevAppScaffoldStarter>("view-worker")
  const isLocalMode = mode === "local" || mode === "devapp-local"
  const isFreshMode = !isLocalMode
  const isDevAppMode = creationIntent?.mode === "devapp" || mode === "devapp" || mode === "devapp-local"
  const areFieldsLocked = isSubmitting || Boolean(creationIntent) || !isIntentReady

  const copy = useMemo(() => {
    const selectedLocalFolderPath = localFolderPath.trim() || initialLocalFolderPath.trim()

    if (!isLocalMode || !selectedLocalFolderPath) {
      if (isDevAppMode) {
        return {
          title:
            mode === "devapp"
              ? t("createProject.devAppCreateTitle")
              : t("createProject.devAppOpenTitle"),
          description:
            mode === "devapp"
              ? t("createProject.devAppCreateDesc")
              : t("createProject.devAppOpenDesc"),
          submitLabel:
            mode === "devapp"
              ? t("createProject.devAppCreateBtn")
              : t("createProject.devAppOpenBtn"),
        } satisfies DialogCopy
      }
      return {
        title: mode === "empty" ? t("createProject.emptyTitle") : t("createProject.localTitle"),
        description: mode === "empty" ? t("createProject.emptyDesc") : t("createProject.localDescFallback"),
        submitLabel: mode === "empty" ? t("createProject.createBtn") : t("createProject.importBtn"),
      } satisfies DialogCopy
    }

    const folderName = deriveNameFromPath(selectedLocalFolderPath) || "this folder"
    if (isDevAppMode) {
      return {
        title: t("createProject.devAppOpenTitle"),
        description: t("createProject.devAppOpenSelectedDesc").replace("{folderName}", folderName),
        submitLabel: t("createProject.devAppOpenBtn"),
      } satisfies DialogCopy
    }
    return {
      title: t("createProject.localTitle"),
      description: t("createProject.localDescFormat").replace("{folderName}", folderName),
      submitLabel: t("createProject.importBtn"),
    } satisfies DialogCopy
  }, [initialLocalFolderPath, isDevAppMode, isLocalMode, localFolderPath, mode, t])
  const locationPathPreview = useMemo(
    () => formatLocationPathPreview(parentDirectory, 2),
    [parentDirectory],
  )
  const localPathPreview = useMemo(
    () => formatLocationPathPreview(localFolderPath, 2),
    [localFolderPath],
  )
  const localFolderName = useMemo(
    () => deriveNameFromPath(localFolderPath),
    [localFolderPath],
  )

  useEffect(() => {
    if (!open) return

    let cancelled = false

    setIsIntentReady(false)
    void Promise.all([
      window.electronAPI.settings.get(),
      isFreshMode ? readLocalProjectCreationIntent() : Promise.resolve(null),
    ]).then(([settings, pending]) => {
        if (cancelled) return

        setCreationIntent(pending)
        setName(pending?.request.name ?? "")
        setParentDirectory(pending?.request.parentFolder ?? settings.projectsDirectory)
        setScaffoldWarnings(pending?.warnings ?? [])
        setLocalFolderPath(isLocalMode ? initialLocalFolderPath : "")
        setLocalGitState(null)
        setError(null)
        setHasEditedName(false)
        setCreateGitHubRepo(pending?.createGitHubRepo ?? false)
        setRepoVisibility(pending?.repoVisibility ?? "public")
        setDevAppStarter(pending?.starter ?? "view-worker")
        setIsIntentReady(true)

        // Resolve cached gh CLI status (fires once per app session)
        if (isFreshMode) {
          void getGhCliStatus().then((status) => {
            if (!cancelled) setGhCliAvailable(status.available)
          })
        }
      })
      .catch((nextError) => {
        if (cancelled) return
        setError(nextError instanceof Error ? nextError.message : "Failed to load project settings.")
      })

    return () => {
      cancelled = true
    }
  }, [initialLocalFolderPath, isFreshMode, isLocalMode, open, mode])

  useEffect(() => {
    if (!isLocalMode || hasEditedName || !localFolderPath) {
      return
    }

    setName(deriveNameFromPath(localFolderPath))
  }, [hasEditedName, isLocalMode, localFolderPath])

  useEffect(() => {
    if (!isLocalMode || !localFolderPath.trim()) {
      setLocalGitState(null)
      return
    }

    let cancelled = false
    setLocalGitState({
      isLoading: true,
      isRepo: false,
      hasOriginRemote: false,
      branch: "main",
      remoteUrl: null,
      error: null,
    })

    void inspectLocalGitState(localFolderPath.trim()).then((nextState) => {
      if (cancelled) return
      setLocalGitState(nextState)
    })

    return () => {
      cancelled = true
    }
  }, [isLocalMode, localFolderPath])

  const closeDialog = useCallback(() => {
    if (isSubmitting) return
    onOpenChange(false)
  }, [isSubmitting, onOpenChange])

  const navigateToProjectWorkbench = useCallback(
    (
      projectId: string,
      projectSlug: string,
      workspaceId: string,
      projectName: string,
      devAppRef?: string | null,
    ) => {
      onOpenChange(false)
      useProjectWorkbenchStore
        .getState()
        .actions.ensureWorkbench(projectId, DEFAULT_WORKBENCH_LANE_ID, workspaceId)
      navigateTo(
        { to: "workbench", projectId },
        {
          state: buildProjectRouteNavigationState(
            {
              projectId,
              projectSlug,
              projectName,
              preferredWorkspaceId: workspaceId,
            },
            buildWorkbenchIntentState({
              laneId: DEFAULT_WORKBENCH_LANE_ID,
              ...(devAppRef
                ? {
                    openDevAppPreview: {
                      relativePath: ".",
                      sourceProjectId: projectId,
                      sourceWorkspaceId: workspaceId,
                      sourceRef: devAppRef,
                    },
                  }
                : { ensureTile: "assistantChat" as const }),
            }),
          ),
        },
      )
    },
    [navigateTo, onOpenChange],
  )
  const isCreateProjectDisabled =
    isSubmitting || !isIntentReady ||
    (isFreshMode && name.trim().length === 0) ||
    (isLocalMode && localFolderPath.trim().length === 0)

  const handleSubmit = useCallback(async () => {
    if (!isIntentReady || submissionRef.current || isSubmitting) {
      return
    }

    const trimmedParentDirectory = parentDirectory.trim()
    const trimmedLocalFolderPath = localFolderPath.trim()
    const trimmedName =
      isLocalMode
        ? resolveImportedProjectName(name, trimmedLocalFolderPath)
        : name.trim()

    if (!trimmedName) {
      return
    }

    if (isFreshMode && !trimmedParentDirectory) {
      setError("Choose a project location.")
      return
    }

    if (isLocalMode && !trimmedLocalFolderPath) {
      setError("Choose a local folder to open.")
      return
    }

    submissionRef.current = true
    setIsSubmitting(true)
    setError(null)

    try {
      if (isFreshMode) {
        const initial: LocalProjectCreationIntent = creationIntent ?? {
          request: { operationId: crypto.randomUUID(), name: trimmedName,
            slug: buildFilesystemSlug(trimmedName), parentFolder: trimmedParentDirectory },
          mode: isDevAppMode ? "devapp" : "empty",
          starter: devAppStarter,
          createGitHubRepo,
          repoVisibility,
          postEffects: "pending",
        }
        const { outcome, intent, needsReview, needsAcknowledgement } = await continueLocalProjectCreation(initial, {
          projects: requireLocalProjectsApi(),
          scaffold: (request) => window.electronAPI.devAppAuthoring.scaffold(request),
          createGitHubRepo: (request) => window.electronAPI.project.createGitHubRepo(request),
          saveIntent: saveLocalProjectCreationIntent,
          onIntentChanged: setCreationIntent,
        })
        const { project, workspace } = outcome
        setScaffoldWarnings(intent.warnings ?? [])
        if (needsReview) appToast.error({ title: "Project setup needs review",
          description: "The project exists. An earlier DevApp or GitHub step was interrupted; inspect it from the workbench before trying that step again." })
        if (needsAcknowledgement) return

        // Retain uncertain optional-effect evidence before acknowledging the local result.
        await clearLocalProjectCreationIntent(intent, project.projectId)
        navigateToProjectWorkbench(project.projectId, project.slug,
          workspace.workspaceId, project.name, intent.devAppRef)
        return
      }

      if (isLocalMode) {
        const outcome = await importPickedLocalFolder(trimmedLocalFolderPath, trimmedName, {
          requireDevApp: mode === "devapp-local",
        })
        if (outcome === "imported") {
          onOpenChange(false)
        } else if (outcome === "error") {
          setError("Cozea could not attach that folder. Review the error and try again.")
        }
        return
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create project.")
    } finally {
      submissionRef.current = false
      setIsSubmitting(false)
    }
  }, [
    creationIntent,
    isIntentReady,
    createGitHubRepo,
    isSubmitting,
    importPickedLocalFolder,
    isDevAppMode,
    isFreshMode,
    isLocalMode,
    localFolderPath,
    mode,
    name,
    navigateToProjectWorkbench,
    closeDialog,
    onOpenChange,
    parentDirectory,
    devAppStarter,
  ])

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeDialog()
        }
      }}
      title={copy.title}
      size="md"
      dismissable={!isSubmitting}
      tourTarget="create-project-dialog"
      footer={
        <>
          <Button type="button" variant="outline" onClick={closeDialog} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isCreateProjectDisabled}
          >
            {isSubmitting ? (
              <Spinner size="xs" />
            ) : null}
            {creationIntent ? creationIntent.postEffects === "pending" ? "Continue Creating" : "Open Project" : copy.submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{creationIntent
          ? "Continue the saved request for this project. Its name and folder are kept until creation is resolved."
          : copy.description}</p>

        <div className={isLocalMode ? "space-y-2" : "space-y-2.5"}>
          <section>
            <SettingsGroup>
              <SettingsRow isFirst>
                <SettingsRowLabel title={t('createProject.name')} htmlFor="create-project-name" />
                <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
                  <Input
                    id="create-project-name"
                    value={name}
                    onChange={(event) => {
                      setHasEditedName(true)
                      setName(event.target.value)
                      setError(null)
                    }}
                    placeholder={
                      isLocalMode
                        ? localFolderName || t('createProject.folderNamePlaceholder')
                        : t('createProject.namePlaceholder')
                    }
                    disabled={areFieldsLocked}
                    autoFocus
                    className="h-7 w-full border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:bg-transparent"
                  />
                </SettingsRowControl>
              </SettingsRow>

              {isFreshMode ? (
                <SettingsRow>
                  <SettingsRowLabel
                    title={t('createProject.path')}
                    htmlFor="create-project-location"
                  />
                  <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
                    <Button
                      id="create-project-location"
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-full max-w-full justify-start border-0 border-none bg-transparent px-0 text-xs font-normal shadow-none transition-colors hover:bg-transparent hover:text-foreground"
                      onClick={async () => {
                        const selectedPath = await browseForDirectory("Select project location")
                        if (!selectedPath) return
                        setParentDirectory(selectedPath)
                        setError(null)
                      }}
                      disabled={areFieldsLocked}
                      title={parentDirectory || t('createProject.chooseParentFolder')}
                    >
                      <HugeiconsIcon icon={Folder01Icon} className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                      <span className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground">
                        {locationPathPreview || t('createProject.chooseParentFolder')}
                      </span>
                    </Button>
                  </SettingsRowControl>
                </SettingsRow>
              ) : null}

              {isLocalMode ? (
                <SettingsRow>
                  <SettingsRowLabel
                    title={t('createProject.path')}
                    htmlFor="open-project-location"
                  />
                  <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
                    <Button
                      id="open-project-location"
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-full max-w-full justify-start border-0 border-none bg-transparent px-0 text-xs font-normal shadow-none transition-colors hover:bg-transparent hover:text-foreground"
                      onClick={async () => {
                        const selectedPath = await browseForDirectory("Select local project folder")
                        if (!selectedPath) return
                        setLocalFolderPath(selectedPath)
                        setError(null)
                      }}
                      disabled={areFieldsLocked}
                      title={localFolderPath || t('createProject.chooseLocalFolder')}
                    >
                      <HugeiconsIcon icon={Folder01Icon} className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                      <span className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground">
                        {localPathPreview || t('createProject.chooseLocalFolder')}
                      </span>
                    </Button>
                  </SettingsRowControl>
                </SettingsRow>
              ) : null}

              {isDevAppMode && isFreshMode ? (
                <SettingsRow>
                  <SettingsRowLabel
                    title={t("createProject.devAppStarter")}
                    description={t("createProject.devAppStarterDesc")}
                    htmlFor="create-devapp-starter"
                  />
                  <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
                    <select
                      id="create-devapp-starter"
                      value={devAppStarter}
                      onChange={(event) => setDevAppStarter(event.target.value as DevAppScaffoldStarter)}
                      disabled={areFieldsLocked}
                      className="h-7 w-full rounded-md border border-border/60 bg-background px-2 text-xs text-foreground outline-none"
                    >
                      <option value="view-worker">{t("createProject.devAppStarterViewWorker")}</option>
                      <option value="view">{t("createProject.devAppStarterView")}</option>
                      <option value="worker">{t("createProject.devAppStarterWorker")}</option>
                    </select>
                  </SettingsRowControl>
                </SettingsRow>
              ) : null}

              {isFreshMode ? (
                <SettingsRow>
                  <SettingsRowLabel
                    title={t('createProject.github')}
                    description={t('createProject.createRemoteRepo')}
                    htmlFor="create-project-github"
                  />
                  <SettingsRowControl>
                    {ghCliAvailable === false ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Switch
                              id="create-project-github"
                              checked={false}
                              disabled
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {t('createProject.installGhCli')}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Switch
                        id="create-project-github"
                        checked={createGitHubRepo}
                        onCheckedChange={setCreateGitHubRepo}
                        disabled={areFieldsLocked}
                      />
                    )}
                  </SettingsRowControl>
                </SettingsRow>
              ) : null}

              {isFreshMode && createGitHubRepo ? (
                <SettingsRow>
                  <SettingsRowLabel
                    title={t('createProject.privateRepo')}
                    description={t('createProject.privateRepoDesc')}
                    htmlFor="create-project-visibility"
                  />
                  <SettingsRowControl>
                    <Switch
                      id="create-project-visibility"
                      checked={repoVisibility === "private"}
                      onCheckedChange={(checked) => setRepoVisibility(checked ? "private" : "public")}
                      disabled={areFieldsLocked}
                    />
                  </SettingsRowControl>
                </SettingsRow>
              ) : null}

            </SettingsGroup>
          </section>

          {isLocalMode && localGitState?.isLoading ? (
            <Alert className="rounded-2xl bg-secondary/35">
              <Spinner size="xs" />
              <AlertTitle>{t('createProject.checkingFolder')}</AlertTitle>
              <AlertDescription>
                {t('createProject.checkingFolderDesc')}
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {scaffoldWarnings.length > 0 ? (
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                The local project is available. Review these setup details in its workbench.
              </p>
              {scaffoldWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </div>

      </div>
    </UnifiedModal>
  )
}
