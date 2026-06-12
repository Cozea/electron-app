import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
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
import type { GhCliStatus } from "../../../../shared/electronApiTypes"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import {
  SettingsGroup,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  settingsInlineInputClass,
  settingsInlineInputWidth,
} from "@/components/settings/SettingsChrome"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { buildProjectRouteNavigationState } from "@/features/projects/lib/projectNavigationState"
import {
  browseForDirectory,
  buildFilesystemSlug,
  deriveNameFromPath,
  formatWorkspaceBindFailure,
  inspectLocalGitState,
  type LocalGitState,
} from "@/features/projects/lib/localProjectImport"
import { useLocalProjectImport } from "@/features/projects/hooks/useLocalProjectImport"
import { appToast } from "@/lib/appToast"
import type { CreateProjectDialogMode } from "@/stores/useCreateProjectDialogStore"
import { useTranslation } from "@/lib/i18n"

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
  const deleteProject = useMutation(api.projects.deleteProject)
  const setSourceControl = useMutation(api.projects.setSourceControl)
  const updateProjectStatus = useMutation(api.projects.updateStatus)
  const { importPickedLocalFolder } = useLocalProjectImport()
  // One token per creation attempt: retries resume the same provisioning doc
  // instead of minting "name-1" twins. Cleared on success or clean rollback.
  const creationTokenRef = useRef<string | null>(null)

  const [name, setName] = useState("")
  const [parentDirectory, setParentDirectory] = useState("")
  const [localFolderPath, setLocalFolderPath] = useState("")
  const [localGitState, setLocalGitState] = useState<LocalGitState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasEditedName, setHasEditedName] = useState(false)
  const [createGitHubRepo, setCreateGitHubRepo] = useState(false)
  const [repoVisibility, setRepoVisibility] = useState<"private" | "public">("public")
  const [ghCliAvailable, setGhCliAvailable] = useState<boolean | null>(cachedGhCliStatus?.available ?? null)

  const copy = useMemo(() => {
    if (mode !== "local" || !initialLocalFolderPath.trim()) {
      return {
        title: mode === "empty" ? t("createProject.emptyTitle") : t("createProject.localTitle"),
        description: mode === "empty" ? t("createProject.emptyDesc") : t("createProject.localDescFallback"),
        submitLabel: mode === "empty" ? t("createProject.createBtn") : t("createProject.importBtn"),
      } satisfies DialogCopy
    }

    const folderName = deriveNameFromPath(initialLocalFolderPath.trim()) || "this folder"
    return {
      title: t("createProject.localTitle"),
      description: t("createProject.localDescFormat").replace("{folderName}", folderName),
      submitLabel: t("createProject.importBtn"),
    } satisfies DialogCopy
  }, [initialLocalFolderPath, mode, t])
  const locationPathPreview = useMemo(
    () => formatLocationPathPreview(parentDirectory, 2),
    [parentDirectory],
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
        setLocalFolderPath(mode === "local" ? initialLocalFolderPath : "")
        setLocalGitState(null)
        setError(null)
        setHasEditedName(false)
        setCreateGitHubRepo(false)
        creationTokenRef.current = null

        // Resolve cached gh CLI status (fires once per app session)
        if (mode === "empty") {
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
  }, [initialLocalFolderPath, open, mode])

  useEffect(() => {
    if (mode !== "local" || hasEditedName || !localFolderPath) {
      return
    }

    setName(deriveNameFromPath(localFolderPath))
  }, [hasEditedName, localFolderPath, mode])

  useEffect(() => {
    if (mode !== "local" || !localFolderPath.trim()) {
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
  }, [localFolderPath, mode])

  const closeDialog = useCallback(() => {
    if (isSubmitting) return
    onOpenChange(false)
  }, [isSubmitting, onOpenChange])

  const navigateToProjectWorkbench = useCallback(
    (projectId: string, projectSlug: string, workspaceId: string, projectName: string) => {
      onOpenChange(false)
      navigate(buildProjectPath(projectId, "workbench"), {
        state: buildProjectRouteNavigationState({
          projectId,
          projectSlug,
          projectName,
          preferredWorkspaceId: workspaceId,
        }),
      })
    },
    [navigate, onOpenChange],
  )
  const isCreateProjectDisabled =
    isSubmitting ||
    (mode === "empty" && name.trim().length === 0) ||
    // Submitting mid-inspection silently dropped the folder's remote/branch
    // from the imported project.
    (mode === "local" && Boolean(localGitState?.isLoading))

  const handleSubmit = useCallback(async () => {
    if (!convexUserId || isSubmitting) {
      return
    }

    const trimmedName =
      mode === "local"
        ? deriveNameFromPath(localFolderPath).trim() || name.trim()
        : name.trim()
    const trimmedParentDirectory = parentDirectory.trim()
    const trimmedLocalFolderPath = localFolderPath.trim()

    if (!trimmedName) {
      return
    }

    if (mode === "empty" && !trimmedParentDirectory) {
      setError("Choose a project location.")
      return
    }

    if (mode === "local" && !trimmedLocalFolderPath) {
      setError("Choose a local folder to import.")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      if (mode === "local") {
        // Same pipeline as every other local-import entry point; the dialog
        // only differs in rendering the failure inline.
        const importResult = await importPickedLocalFolder(trimmedLocalFolderPath, {
          reportError: "return",
        })
        if (importResult.outcome === "imported") {
          onOpenChange(false)
        } else if (importResult.outcome === "error") {
          setError(importResult.errorMessage ?? "Failed to import the local folder.")
        }
        return
      }

      // mode === "empty"
      let createdProjectId: Id<"projects"> | null = null
      let createdWorkspaceId: string | null = null
      try {
        creationTokenRef.current ??= crypto.randomUUID()
        const result = await createProject({
          userId: convexUserId,
          name: trimmedName,
          template: "blank",
          creationPath: "fresh",
          status: "provisioning",
          creationToken: creationTokenRef.current,
        })
        // Only a freshly-created doc is ours to roll back on failure.
        const createdThisRun = !result.resumed
        if (createdThisRun) {
          createdProjectId = result.projectId
        }

        const createWorkspaceResult = await window.electronAPI.workspace!.createForProject({
          projectId: result.projectId,
          slug: buildFilesystemSlug(trimmedName),
          initGit: true,
          rootPathOverride: trimmedParentDirectory,
          setActive: true,
        })

        if (!createWorkspaceResult.success || !createWorkspaceResult.workspace) {
          throw new Error(
            formatWorkspaceBindFailure(
              createWorkspaceResult,
              "Failed to create the local project folder.",
            ),
          )
        }

        const workspaceId = createWorkspaceResult.workspace.workspaceId
        if (createdThisRun) {
          createdWorkspaceId = workspaceId
        }

        // GitHub repo is best-effort: the project works without it, so a gh
        // failure must not torch the project + folder we just created.
        if (createGitHubRepo) {
          const ghResult = await window.electronAPI.project.createGitHubRepo({
            workspaceId,
            name: buildFilesystemSlug(trimmedName),
            visibility: repoVisibility,
          })
          if (ghResult.success && ghResult.repoUrl) {
            await setSourceControl({
              projectId: result.projectId,
              userId: convexUserId,
              provider: "github",
              repoUrl: ghResult.repoUrl,
              defaultBranch: ghResult.defaultBranch ?? "main",
              visibility: repoVisibility,
              workingCopyMode: "managed",
              setupMode: "personal",
            })
          } else {
            appToast.error({
              title: "GitHub repository not created",
              description: ghResult.error ?? "You can publish the project from settings later.",
            })
          }
        }

        // Local effects done: the saga finalizes the doc to active.
        await updateProjectStatus({
          projectId: result.projectId,
          userId: convexUserId,
          status: "active",
        })
        creationTokenRef.current = null

        navigateToProjectWorkbench(
          String(result.projectId),
          result.slug,
          workspaceId,
          trimmedName,
        )
      } catch (creationError) {
        // Compensate in reverse, undoing only what this run created: release
        // the local workspace (catalog row + on-disk marker) before deleting
        // the cloud doc. Without the forget, a later-step failure left a live
        // marker that turned every retry into a duplicate_path conflict.
        if (createdWorkspaceId) {
          try {
            await window.electronAPI.workspace!.forget(createdWorkspaceId)
          } catch (cleanupError) {
            console.warn("[CreateProjectDialog] Failed to release workspace after error:", cleanupError)
          }
        }
        if (createdProjectId) {
          try {
            await deleteProject({
              projectId: createdProjectId,
              userId: convexUserId,
              confirmName: trimmedName,
            })
            creationTokenRef.current = null
          } catch (cleanupError) {
            // Keep the token: the next attempt resumes the surviving
            // provisioning doc instead of duplicating it.
            console.warn("[CreateProjectDialog] Failed to clean up project after error:", cleanupError)
          }
        }
        throw creationError
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
    deleteProject,
    importPickedLocalFolder,
    isSubmitting,
    localFolderPath,
    mode,
    name,
    navigateToProjectWorkbench,
    onOpenChange,
    parentDirectory,
    repoVisibility,
    setSourceControl,
    updateProjectStatus,
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
        className={cn(
          "p-3 sm:max-w-md sm:p-4",
          mode === "empty" && "border-none bg-transparent shadow-none",
        )}
      >
        {mode !== "empty" ? (
          <DialogHeader className="items-start space-y-1 text-left">
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription className="text-sm">{copy.description}</DialogDescription>
          </DialogHeader>
        ) : null}

        <div
          className={cn(
            "max-h-[calc(100vh-16rem)] overflow-y-auto",
            mode === "local" ? "space-y-2" : "space-y-2.5",
          )}
        >
          {mode !== "local" ? (
            <section>
              <SettingsGroup>
                {mode === "empty" ? (
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
                        placeholder={t('createProject.namePlaceholder')}
                        disabled={isSubmitting}
                        autoFocus
                        className={cn(settingsInlineInputClass, "w-auto min-w-[72px] text-left text-[13px] font-normal")}
                        style={{ fieldSizing: "content" } as React.CSSProperties}
                      />
                    </SettingsRowControl>
                  </SettingsRow>
                ) : null}

                {mode === "empty" ? (
                  <SettingsRow>
                    <SettingsRowLabel
                      title={t('createProject.path')}
                      htmlFor="create-project-location"
                    />
                    <SettingsRowControl>
                      <Button
                        id="create-project-location"
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 max-w-full justify-end rounded-[6px] border-border/50 bg-transparent px-2 text-[11px] font-normal shadow-none transition-colors hover:bg-foreground/10 hover:text-foreground"
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
                        <span className="truncate text-right">
                          {locationPathPreview || t('createProject.chooseParentFolder')}
                        </span>
                      </Button>
                    </SettingsRowControl>
                  </SettingsRow>
                ) : null}

                {mode === "empty" ? (
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

                {mode === "empty" && createGitHubRepo ? (
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

                {mode === "empty" ? (
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
          ) : null}

          {mode === "local" && localGitState?.isLoading ? (
            <Alert className="rounded-2xl bg-secondary/35">
              <div className="loader" />
              <AlertTitle>{t('createProject.checkingFolder')}</AlertTitle>
              <AlertDescription>
                {t('createProject.checkingFolderDesc')}
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        {mode === "local" ? (
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
