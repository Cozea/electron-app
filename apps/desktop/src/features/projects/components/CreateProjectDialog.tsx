import { useCallback, useEffect, useMemo, useState } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { GhCliStatus } from "../../../../../../shared/electronApiTypes"
import type { DevAppScaffoldStarter } from "../../../../../../shared/devAppAuthoringTypes"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import {
  SettingsGroup,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  settingsInlineInputWidth,
} from "@/components/settings/SettingsChrome"
import { buildWorkbenchHref } from "@/features/projects/lib/lastWorkbenchRoute"
import { buildProjectRouteNavigationState } from "@/features/projects/lib/projectNavigationState"
import { buildWorkbenchIntentState } from "@/features/projects/lib/workbenchIntent"
import {
  browseForDirectory,
  buildFilesystemSlug,
  deriveNameFromPath,
  inspectLocalGitState,
  resolveImportedProjectName,
  type LocalGitState,
} from "@/features/projects/lib/localProjectImport"
import type { CreateProjectDialogMode } from "@/stores/useCreateProjectDialogStore"
import {
  DEFAULT_WORKBENCH_LANE_ID,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import { useTranslation } from "@/lib/i18n"
import { useLocalProjectImport } from "@/features/projects/hooks/useLocalProjectImport"

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
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const createProject = useMutation(api.projects.create)
  const updateProjectStatus = useMutation(api.projects.updateStatus)
  const { importPickedLocalFolder } = useLocalProjectImport()

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
  const isDevAppMode = mode === "devapp" || mode === "devapp-local"

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

    void window.electronAPI.settings
      .get()
      .then((settings) => {
        if (cancelled) return

        setName("")
        setParentDirectory(settings.projectsDirectory)
        setLocalFolderPath(isLocalMode ? initialLocalFolderPath : "")
        setLocalGitState(null)
        setError(null)
        setHasEditedName(false)
        setCreateGitHubRepo(false)
        setDevAppStarter("view-worker")

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
      navigate(
        buildWorkbenchHref(projectId, DEFAULT_WORKBENCH_LANE_ID),
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
                : { openTile: "assistantChat" as const }),
            }),
          ),
        },
      )
    },
    [navigate, onOpenChange],
  )
  const isCreateProjectDisabled =
    isSubmitting ||
    (isFreshMode && name.trim().length === 0) ||
    (isLocalMode && localFolderPath.trim().length === 0)

  const handleSubmit = useCallback(async () => {
    if (!convexUserId || isSubmitting) {
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

    setIsSubmitting(true)
    setError(null)

    let createdWorkspaceId: string | null = null

    try {
      if (isFreshMode) {
        const result = await createProject({
          userId: convexUserId,
          name: trimmedName,
          template: "blank",
          creationPath: "fresh",
        })

        console.log("[CreateProjectDialog] Calling workspace.createForProject with:", {
          projectId: result.projectId,
          slug: buildFilesystemSlug(trimmedName),
          rootPathOverride: trimmedParentDirectory,
        })
        const createWorkspaceResult = await window.electronAPI.workspace!.createForProject({
          projectId: result.projectId,
          slug: buildFilesystemSlug(trimmedName),
          initGit: true,
          rootPathOverride: trimmedParentDirectory,
          setActive: true,
        })
        console.log("[CreateProjectDialog] createWorkspaceResult:", createWorkspaceResult)

        if (!createWorkspaceResult.success || !createWorkspaceResult.workspace) {
          throw new Error(createWorkspaceResult.error || "Failed to create the local project folder.")
        }

        createdWorkspaceId = createWorkspaceResult.workspace.workspaceId

        const scaffold = isDevAppMode
          ? await window.electronAPI.devAppAuthoring.scaffold({
              workspaceId: createdWorkspaceId,
              name: trimmedName,
              starter: devAppStarter,
            })
          : null
        if (scaffold && !scaffold.success) {
          throw new Error(scaffold.error)
        }
        // The package previews fine without these; it cannot publish. Say so now rather than
        // letting the author discover it from the publish dialog later.
        if (scaffold?.success && scaffold.preparation.warnings.length > 0) {
          setScaffoldWarnings(scaffold.preparation.warnings)
        }

        // Optionally create a GitHub repo
        let gitHubRepoUrl: string | undefined
        if (createGitHubRepo) {
          const ghResult = await window.electronAPI.project.createGitHubRepo({
            workspaceId: createdWorkspaceId,
            name: buildFilesystemSlug(trimmedName),
            visibility: repoVisibility,
          })
          if (!ghResult.success) {
            throw new Error(ghResult.error || "Failed to create GitHub repository.")
          }
          gitHubRepoUrl = ghResult.repoUrl
        }

        if (gitHubRepoUrl) {
          // If we created a GitHub repo, update the project with sourceControl
          // (This requires a mutation to update sourceControl, but since we already created it,
          //  we might need a new mutation or just skip it for now. Actually, let's just leave it 
          //  as created in GitHub. The app will sync it.)
        }

        await updateProjectStatus({
          projectId: result.projectId,
          userId: convexUserId,
          status: "active",
        })

        navigateToProjectWorkbench(
          String(result.projectId),
          result.slug,
          createdWorkspaceId,
          trimmedName,
          scaffold?.success ? scaffold.source.ref : null,
        )
        return
      }

      if (isLocalMode) {
        const outcome = await importPickedLocalFolder(trimmedLocalFolderPath, trimmedName, {
          requireDevApp: mode === "devapp-local",
        })
        if (outcome === "imported") {
          closeDialog()
        } else if (outcome === "error") {
          setError("Cozea could not attach that folder. Review the error and try again.")
        }
        return
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create project.")
    } finally {
      setIsSubmitting(false)
    }
  }, [
    convexUserId,
    createGitHubRepo,
    createProject,
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
    parentDirectory,
    updateProjectStatus,
    devAppStarter,
  ])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeDialog()
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="border-border/70 bg-popover p-4 shadow-xl sm:max-w-md"
      >
        <DialogHeader className="items-start space-y-1 text-left">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="text-sm">{copy.description}</DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "max-h-[calc(100vh-16rem)] overflow-y-auto",
            isLocalMode ? "space-y-2" : "space-y-2.5",
          )}
        >
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
                    disabled={isSubmitting}
                    autoFocus
                    className="h-7 w-full border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:border-none dark:bg-transparent"
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
                      disabled={isSubmitting}
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
                      disabled={isSubmitting}
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
                      disabled={isSubmitting}
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
                        disabled={isSubmitting}
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
                      disabled={isSubmitting}
                    />
                  </SettingsRowControl>
                </SettingsRow>
              ) : null}

              {isFreshMode ? (
                <SettingsRow>
                  <div className="min-w-0 flex-1" />
                  <SettingsRowControl className="gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={closeDialog}
                      disabled={isSubmitting}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full"
                      onClick={() => void handleSubmit()}
                      disabled={isCreateProjectDisabled}
                    >
                      {isSubmitting ? (
                        <div className="loader" />
                      ) : null}
                      {copy.submitLabel}
                    </Button>
                  </SettingsRowControl>
                </SettingsRow>
              ) : null}
            </SettingsGroup>
          </section>

          {isLocalMode && localGitState?.isLoading ? (
            <Alert className="rounded-2xl bg-secondary/35">
              <div className="loader" />
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
                The DevApp was created, but it cannot be published yet.
              </p>
              {scaffoldWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </div>

        {isLocalMode ? (
          <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <div className="flex shrink-0 justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={closeDialog}
                disabled={isSubmitting}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="rounded-full"
                onClick={() => void handleSubmit()}
                disabled={isCreateProjectDisabled}
              >
                {isSubmitting ? (
                  <div className="loader" />
                ) : null}
                {copy.submitLabel}
              </Button>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
