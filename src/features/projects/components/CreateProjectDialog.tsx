import { useCallback, useEffect, useMemo, useState } from "react"
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
  deriveProviderFromRepoUrl,
  inspectLocalGitState,
  type LocalGitState,
} from "@/features/projects/lib/localProjectImport"
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
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)

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

  const persistProjectPath = useCallback(
    async (projectId: Id<"projects">, projectPath: string) => {
      try {
        const result = await window.electronAPI.project.rememberLocalPath({
          projectId: String(projectId),
          projectPath,
        })
        if (!result.success) {
          console.warn(
            "[CreateProjectDialog] Failed to persist local project path in desktop registry.",
            result.error,
          )
        }
      } catch (persistError) {
        console.warn(
          "[CreateProjectDialog] Failed to persist local project path in desktop registry.",
          persistError,
        )
      }

      if (!convexUserId) {
        return
      }

      try {
        await updateMemberLocalPath({
          projectId,
          userId: convexUserId,
          localPath: projectPath,
        })
      } catch (persistError) {
        console.warn(
          "[CreateProjectDialog] Failed to mirror local project path to project membership.",
          persistError,
        )
      }
    },
    [convexUserId, updateMemberLocalPath],
  )

  const navigateToProjectWorkbench = useCallback(
    (projectId: string, projectSlug: string, projectPath: string, projectName: string) => {
      onOpenChange(false)
      navigate(buildProjectPath(projectId, "workbench"), {
        state: buildProjectRouteNavigationState({
          projectId,
          projectSlug,
          projectName,
          localPath: projectPath,
        }),
      })
    },
    [navigate, onOpenChange],
  )
  const isCreateProjectDisabled = isSubmitting || (mode === "empty" && name.trim().length === 0)

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

    let createdProjectPath: string | null = null

    try {
      if (mode === "empty") {
        const createFolderResult = await window.electronAPI.project.createFolder({
          slug: buildFilesystemSlug(trimmedName),
          initGit: true,
          baseDirectory: trimmedParentDirectory,
        })

        if (!createFolderResult.success || !createFolderResult.localPath) {
          throw new Error(createFolderResult.error || "Failed to create the local project folder.")
        }

        createdProjectPath = createFolderResult.localPath

        // Optionally create a GitHub repo
        let gitHubRepoUrl: string | undefined
        if (createGitHubRepo) {
          const ghResult = await window.electronAPI.project.createGitHubRepo({
            name: buildFilesystemSlug(trimmedName),
            localPath: createdProjectPath,
            visibility: repoVisibility,
          })
          if (!ghResult.success) {
            throw new Error(ghResult.error || "Failed to create GitHub repository.")
          }
          gitHubRepoUrl = ghResult.repoUrl
        }

        const result = await createProject({
          userId: convexUserId,
          name: trimmedName,
          template: "blank",
          creationPath: "fresh",
          ...(gitHubRepoUrl ? {
            sourceControl: {
              provider: "github" as const,
              repoUrl: gitHubRepoUrl,
              defaultBranch: "main",
              workingCopyMode: "attached" as const,
              setupMode: "personal" as const,
            },
          } : {}),
        })

        await updateProjectStatus({
          projectId: result.projectId,
          userId: convexUserId,
          status: "active",
        })
        await persistProjectPath(result.projectId, createdProjectPath)
        navigateToProjectWorkbench(
          String(result.projectId),
          result.slug,
          createdProjectPath,
          trimmedName,
        )
        return
      }

      if (mode === "local") {
        const existingRemoteUrl = localGitState?.remoteUrl?.trim() || ""
        const normalizedBranch = localGitState?.branch || "main"
        const provider = existingRemoteUrl ? deriveProviderFromRepoUrl(existingRemoteUrl) : null
        const result = await createProject({
          userId: convexUserId,
          name: trimmedName,
          template: "blank",
          creationPath: "repo",
          sourceControl: existingRemoteUrl && provider
            ? {
                provider,
                repoUrl: existingRemoteUrl,
                defaultBranch: normalizedBranch,
                workingCopyMode: "attached",
                setupMode: "personal",
              }
            : undefined,
          repoSource: existingRemoteUrl && provider
            ? {
                provider,
                repoUrl: existingRemoteUrl,
                branch: normalizedBranch,
              }
            : undefined,
        })

        await updateProjectStatus({
          projectId: result.projectId,
          userId: convexUserId,
          status: "active",
        })
        await persistProjectPath(result.projectId, trimmedLocalFolderPath)
        navigateToProjectWorkbench(
          String(result.projectId),
          result.slug,
          trimmedLocalFolderPath,
          trimmedName,
        )
        return
      }
    } catch (nextError) {
      if (createdProjectPath && mode === "empty") {
        void window.electronAPI.storage.deleteProject({ projectPath: createdProjectPath })
      }

      setError(nextError instanceof Error ? nextError.message : "Failed to create project.")
    } finally {
      setIsSubmitting(false)
    }
  }, [
    convexUserId,
    createGitHubRepo,
    createProject,
    isSubmitting,
    localFolderPath,
    localGitState?.branch,
    localGitState?.remoteUrl,
    mode,
    name,
    navigateToProjectWorkbench,
    parentDirectory,
    persistProjectPath,
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
