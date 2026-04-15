import { useCallback, useEffect, useMemo, useState } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import type { RepositoryDescriptor } from "@shared/electronApiTypes"
import {

  ConnectedRepositoryPicker,
  type ConnectedRepositoryPickerPaginationState,
} from "@/components/git/ConnectedRepositoryPicker"
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
import { TablePaginationControls } from "@/components/ui/table-pagination-controls"
import { useAuth } from "@/contexts/AuthContext"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import { useWorkspaceSourceControl } from "@/hooks/useWorkspaceSourceControl"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { getWorkspaceSourceControlReadiness } from "@/lib/sourceControl/workspaceSourceControlReadiness"
import { cn } from "@/lib/utils"
import {
  SettingsGroup,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionTitle,
  settingsInlineInputClass,
  settingsInlineInputWidth,
} from "@/components/settings/SettingsChrome"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import {
  browseForDirectory,
  buildFilesystemSlug,
  deriveNameFromPath,
  deriveProviderFromRepoUrl,
  detectCurrentBranch,
  inspectLocalGitState,
  type LocalGitState,
} from "@/features/projects/lib/localProjectImport"
import type { CreateProjectDialogMode } from "@/stores/useCreateProjectDialogStore"

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __AlertCircleHugeIcon, Refresh01Icon as __Loader2HugeIcon, SquareArrowDownRightIcon as __ExternalLinkHugeIcon } from '@hugeicons/core-free-icons'

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

const DIALOG_COPY: Record<CreateProjectDialogMode, DialogCopy> = {
  empty: {
    title: "Empty project",
    description:
      "Create a blank local project and jump straight into the workbench.",
    submitLabel: "Create project",
  },
  local: {
    title: "Import local folder",
    description:
      "Attach an existing local folder and start working in Cozea. Git stays exactly as it is on your machine.",
    submitLabel: "Import folder",
  },
  repo: {
    title: "Import repository",
    description:
      "Browse connected GitHub repositories, clone one locally, and open it directly in the workbench.",
    submitLabel: "Import repository",
  },
}

function getBlockingCopy(reason: string | null, setupMode: "personal" | "organization") {
  switch (reason) {
    case "wrong_setup_mode":
      return {
        title: "GitHub is connected with the wrong workspace scope",
        description:
          setupMode === "organization"
            ? "This workspace needs an organization-scoped GitHub connection before Cozea can create or browse remote repositories."
            : "This workspace needs a personal GitHub connection before Cozea can create or browse remote repositories.",
      }
    case "needs_reauth":
      return {
        title: "GitHub needs attention",
        description:
          "Reconnect GitHub or finish its setup before using provider-backed project creation.",
      }
    case "missing_namespace":
      return {
        title: "Choose a GitHub namespace first",
        description:
          "Cozea needs a resolved GitHub namespace before it can create or browse repositories for this workspace.",
      }
    case "missing_installation":
      return {
        title: "GitHub App installation required",
        description:
          "Install or select the GitHub App for this workspace’s namespace before creating repositories from Cozea.",
      }
    case "missing_connection":
    default:
      return {
        title: "Connect GitHub to continue",
        description:
          "Connect GitHub in Git Providers before importing a connected repository.",
      }
  }
}

function formatRemoteVisibility(visibility: string | undefined, isPrivate: boolean | undefined): "public" | "private" {
  if (visibility === "public" || visibility === "private") {
    return visibility
  }
  return isPrivate ? "private" : "public"
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

export function CreateProjectDialog({
  open,
  mode,
  initialLocalFolderPath = "",
  onOpenChange,
}: CreateProjectDialogProps) {
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const {
    personalScoped,
    preferredConvexOrganizationId,
  } = useScopedAppContext()
  const createProject = useMutation(api.projects.create)
  const updateProjectStatus = useMutation(api.projects.updateStatus)
  const updateProjectBinding = useMutation(api.sourceControl.upsertProjectBinding)
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
  const { getConnection } = useWorkspaceSourceControl({ enabled: open })

  const [name, setName] = useState("")
  const [parentDirectory, setParentDirectory] = useState("")
  const [localFolderPath, setLocalFolderPath] = useState("")
  const [repositorySearchValue, setRepositorySearchValue] = useState("")
  const [selectedRepository, setSelectedRepository] = useState<RepositoryDescriptor | null>(null)
  const [selectedRepositoryBranch, setSelectedRepositoryBranch] = useState("")
  const [localGitState, setLocalGitState] = useState<LocalGitState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasEditedName, setHasEditedName] = useState(false)
  const [repoPickerPagination, setRepoPickerPagination] =
    useState<ConnectedRepositoryPickerPaginationState | null>(null)

  const handleRepoPickerPaginationChange = useCallback(
    (next: ConnectedRepositoryPickerPaginationState | null) => {
      setRepoPickerPagination((prev) => {
        if (prev === next) {
          return prev
        }
        if (!prev || !next) {
          return next
        }
        if (
          prev.totalCount === next.totalCount &&
          prev.currentPage === next.currentPage &&
          prev.pageSize === next.pageSize &&
          prev.isNextDisabled === next.isNextDisabled &&
          prev.onPageChange === next.onPageChange &&
          prev.onNextClick === next.onNextClick
        ) {
          return prev
        }
        return next
      })
    },
    [],
  )

  const copy = useMemo(() => {
    if (mode !== "local" || !initialLocalFolderPath.trim()) {
      return DIALOG_COPY[mode]
    }

    const folderName = deriveNameFromPath(initialLocalFolderPath.trim()) || "this folder"
    return {
      title: "Import local folder",
      description: `Import ${folderName} into Cozea and keep any git setup on disk exactly as it already is.`,
      submitLabel: "Import folder",
    } satisfies DialogCopy
  }, [initialLocalFolderPath, mode])
  const setupMode = personalScoped ? "personal" : "organization"
  const githubConnection = getConnection("github")
  const sourceControlReadiness = useMemo(
    () =>
      getWorkspaceSourceControlReadiness({
        connections: githubConnection ? [githubConnection] : [],
        expectedSetupMode: setupMode,
      }),
    [githubConnection, setupMode],
  )
  const sourceControlSettingsHref = "/settings/source-control"
  const locationPathPreview = useMemo(
    () => formatLocationPathPreview(parentDirectory, 2),
    [parentDirectory],
  )

  useEffect(() => {
    if (!open || mode !== "repo") {
      setRepoPickerPagination(null)
    }
  }, [mode, open])

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
        setRepositorySearchValue("")
        setSelectedRepository(null)
        setSelectedRepositoryBranch("")
        setLocalGitState(null)
        setError(null)
        setHasEditedName(false)
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
    if (mode !== "repo") {
      return
    }
    if (!selectedRepository) {
      setName("")
      return
    }
    setName(selectedRepository.name)
  }, [mode, selectedRepository])

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

  const persistBindingDetails = useCallback(
    async (args: {
      projectId: Id<"projects">
      repository: RepositoryDescriptor
      branch: string
      workingCopyMode: "managed" | "attached"
    }) => {
      if (!convexUserId) {
        return
      }

      try {
        await updateProjectBinding({
          projectId: args.projectId,
          userId: convexUserId,
          provider: args.repository.provider,
          repoUrl: args.repository.url,
          activeCollabBranch: args.branch,
          defaultBranch: args.repository.defaultBranch || args.branch,
          visibility: formatRemoteVisibility(args.repository.visibility, args.repository.private),
          workingCopyMode: args.workingCopyMode,
          setupMode,
          repoId: args.repository.id,
          ownerId: args.repository.ownerId,
          ownerName: args.repository.ownerLogin,
          ownerType: setupMode === "organization" ? "organization" : "user",
          providerHost: githubConnection?.providerHost,
        })
      } catch (bindingError) {
        console.warn(
          "[CreateProjectDialog] Failed to persist repository binding metadata.",
          bindingError,
        )
      }
    },
    [convexUserId, githubConnection?.providerHost, setupMode, updateProjectBinding],
  )

  const navigateToProjectWorkbench = useCallback(
    (projectId: string, projectPath: string, projectName: string) => {
      onOpenChange(false)
      navigate(buildProjectPath(projectId, "workbench"), {
        state: {
          projectId,
          projectName,
          localPath: projectPath,
        },
      })
    },
    [navigate, onOpenChange],
  )

  const handleSubmit = useCallback(async () => {
    if (!convexUserId || !preferredConvexOrganizationId || isSubmitting) {
      return
    }

    const trimmedName =
      mode === "local"
        ? deriveNameFromPath(localFolderPath).trim() || name.trim()
        : mode === "repo"
          ? (selectedRepository?.name ?? name).trim()
          : name.trim()
    const trimmedParentDirectory = parentDirectory.trim()
    const trimmedLocalFolderPath = localFolderPath.trim()
    const resolvedBranch =
      selectedRepositoryBranch ||
      selectedRepository?.defaultBranch ||
      localGitState?.branch ||
      "main"

    if (!trimmedName) {
      setError("Project name is required.")
      return
    }

    if ((mode === "empty" || mode === "repo") && !trimmedParentDirectory) {
      setError("Choose a project location.")
      return
    }

    if (mode === "local" && !trimmedLocalFolderPath) {
      setError("Choose a local folder to import.")
      return
    }

    if (mode === "repo" && !selectedRepository) {
      setError("Choose a repository to import.")
      return
    }

    if (mode === "repo" && !sourceControlReadiness.isReady) {
      setError("Connect GitHub in Git Providers before importing a connected repository.")
      return
    }

    setIsSubmitting(true)
    setError(null)

    let createdProjectPath: string | null = null

    try {
      if (mode === "empty") {
        const createFolderResult = await window.electronAPI.project.createFolder({
          slug: buildFilesystemSlug(trimmedName),
          initGit: false,
          baseDirectory: trimmedParentDirectory,
        })

        if (!createFolderResult.success || !createFolderResult.localPath) {
          throw new Error(createFolderResult.error || "Failed to create the local project folder.")
        }

        createdProjectPath = createFolderResult.localPath

        const result = await createProject({
          organizationId: preferredConvexOrganizationId,
          userId: convexUserId,
          name: trimmedName,
          template: "blank",
          creationPath: "fresh",
        })

        await updateProjectStatus({
          projectId: result.projectId,
          userId: convexUserId,
          status: "active",
        })
        await persistProjectPath(result.projectId, createdProjectPath)
        navigateToProjectWorkbench(String(result.projectId), createdProjectPath, trimmedName)
        return
      }

      if (mode === "local") {
        const existingRemoteUrl = localGitState?.remoteUrl?.trim() || ""
        const normalizedBranch = await detectCurrentBranch(
          trimmedLocalFolderPath,
          localGitState?.branch || "main",
        )
        const provider = existingRemoteUrl ? deriveProviderFromRepoUrl(existingRemoteUrl) : null
        const result = await createProject({
          organizationId: preferredConvexOrganizationId,
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
                setupMode,
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
        navigateToProjectWorkbench(String(result.projectId), trimmedLocalFolderPath, trimmedName)
        return
      }

      const repository = selectedRepository
      if (!repository) {
        throw new Error("Choose a repository to import.")
      }

      const cloneResult = await window.electronAPI.project.cloneRepository({
        slug: buildFilesystemSlug(trimmedName || repository.name),
        repoUrl: repository.url,
        provider: repository.provider,
        branch: resolvedBranch || undefined,
        baseDirectory: trimmedParentDirectory,
      })

      if (!cloneResult.success || !cloneResult.localPath) {
        throw new Error(cloneResult.error || "Failed to clone the repository.")
      }

      createdProjectPath = cloneResult.localPath
      const branch = await detectCurrentBranch(createdProjectPath, resolvedBranch)
      const result = await createProject({
        organizationId: preferredConvexOrganizationId,
        userId: convexUserId,
        name: trimmedName,
        template: "blank",
        creationPath: "repo",
        sourceControl: {
          provider: repository.provider,
          repoUrl: repository.url,
          defaultBranch: branch,
          visibility: formatRemoteVisibility(
            repository.visibility,
            repository.private,
          ),
          workingCopyMode: "managed",
          setupMode,
        },
        repoSource: {
          provider: repository.provider,
          repoUrl: repository.url,
          branch,
        },
      })

      await updateProjectStatus({
        projectId: result.projectId,
        userId: convexUserId,
        status: "active",
      })
      await persistProjectPath(result.projectId, createdProjectPath)
      await persistBindingDetails({
        projectId: result.projectId,
        repository,
        branch,
        workingCopyMode: "managed",
      })
      navigateToProjectWorkbench(String(result.projectId), createdProjectPath, trimmedName)
    } catch (nextError) {
      if (createdProjectPath && (mode === "empty" || mode === "repo")) {
        void window.electronAPI.storage.deleteProject({ projectPath: createdProjectPath })
      }

      setError(nextError instanceof Error ? nextError.message : "Failed to create project.")
    } finally {
      setIsSubmitting(false)
    }
  }, [
    convexUserId,
    createProject,
    isSubmitting,
    localFolderPath,
    localGitState?.branch,
    localGitState?.remoteUrl,
    mode,
    name,
    navigateToProjectWorkbench,
    parentDirectory,
    persistBindingDetails,
    persistProjectPath,
    preferredConvexOrganizationId,
    selectedRepository,
    selectedRepositoryBranch,
    setupMode,
    sourceControlReadiness.isReady,
    updateProjectStatus,
  ])
  const blockingCopy = getBlockingCopy(sourceControlReadiness.blockingReason, setupMode)

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
        className="p-3 sm:max-w-xl sm:p-4"
      >
        {mode !== "empty" && mode !== "repo" ? (
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
                    <SettingsRowLabel title="Project name" htmlFor="create-project-name" />
                    <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
                      <Input
                        id="create-project-name"
                        value={name}
                        onChange={(event) => {
                          setHasEditedName(true)
                          setName(event.target.value)
                          setError(null)
                        }}
                        placeholder="My project"
                        disabled={isSubmitting}
                        autoFocus
                        className={cn(settingsInlineInputClass, "w-full text-[13px] font-normal")}
                      />
                    </SettingsRowControl>
                  </SettingsRow>
                ) : null}

                {mode === "empty" || mode === "repo" ? (
                  <SettingsRow isFirst={mode === "repo"}>
                    <SettingsRowLabel
                      title="Location"
                      htmlFor="create-project-location"
                      description="Parent folder for the local project."
                      descriptionClassName="truncate"
                    />
                    <SettingsRowControl>
                      <Button
                        id="create-project-location"
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 w-[220px] max-w-full justify-end rounded-md border-border/50 bg-transparent px-2 text-[11px] font-normal shadow-none transition-colors hover:bg-accent/50 hover:text-foreground"
                        onClick={async () => {
                          const selectedPath = await browseForDirectory("Select project location")
                          if (!selectedPath) return
                          setParentDirectory(selectedPath)
                          setError(null)
                        }}
                        disabled={isSubmitting}
                        title={parentDirectory || "Choose a parent folder"}
                      >
                        <span className="w-full truncate text-right">
                          {locationPathPreview || "Choose a parent folder"}
                        </span>
                      </Button>
                    </SettingsRowControl>
                  </SettingsRow>
                ) : null}
              </SettingsGroup>
            </section>
          ) : null}

          {mode === "local" && localGitState?.isLoading ? (
            <Alert className="rounded-2xl bg-secondary/35">
              <HugeiconsIcon icon={__Loader2HugeIcon} className="h-4 w-4 animate-spin" />
              <AlertTitle>Checking the folder</AlertTitle>
              <AlertDescription>
                Preparing the local import and reading any existing git details on disk.
              </AlertDescription>
            </Alert>
          ) : null}

          {mode === "repo" ? (
            <>
              {!sourceControlReadiness.isReady ? (
                <Alert className="rounded-2xl bg-secondary/40">
                  <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-4 w-4" />
                  <AlertTitle>{blockingCopy.title}</AlertTitle>
                  <AlertDescription className="space-y-3">
                    <p>{blockingCopy.description}</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        onOpenChange(false)
                        navigate(sourceControlSettingsHref)
                      }}
                      disabled={isSubmitting}
                    >
                      Open Git Providers
                      <HugeiconsIcon icon={__ExternalLinkHugeIcon} className="h-4 w-4" />
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2.5">
                  <SettingsGroup>
                    <SettingsRow isFirst>
                      <SettingsRowLabel
                        title="Search repositories"
                        htmlFor="import-project-repo-search"
                        description="Filter connected GitHub repositories."
                        descriptionClassName="truncate"
                      />
                      <SettingsRowControl className="min-w-0 max-w-full flex-1 shrink">
                        <Input
                          id="import-project-repo-search"
                          value={repositorySearchValue}
                          onChange={(event) => {
                            setRepositorySearchValue(event.target.value)
                            setError(null)
                          }}
                          placeholder="Search connected repositories"
                          disabled={isSubmitting}
                          className="h-7 w-full min-w-0 rounded-md border border-border/50 bg-transparent px-2 text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-ring/50"
                        />
                      </SettingsRowControl>
                    </SettingsRow>
                  </SettingsGroup>

                  <section>
                    <SettingsSectionTitle>Connected repositories</SettingsSectionTitle>
                    <SettingsGroup className="bg-card/50">
                      <SettingsRow isFirst className="flex-col items-stretch gap-2 py-2">
                        <div className="w-full min-w-0">
                          <ConnectedRepositoryPicker
                            provider="github"
                            organizationId={preferredConvexOrganizationId}
                            integrationConnected={sourceControlReadiness.isReady}
                            selectedRepoUrl={selectedRepository?.url}
                            selectedBranch={selectedRepositoryBranch}
                            repositorySearchValue={repositorySearchValue}
                            paginationSlot="none"
                            onPaginationStateChange={handleRepoPickerPaginationChange}
                            onRepositorySelected={(repository) => {
                              setSelectedRepository(repository)
                              setSelectedRepositoryBranch(
                                repository.defaultBranch || selectedRepositoryBranch || "main",
                              )
                              setError(null)
                            }}
                            onRepositoryBranchSelected={(repository, branch) => {
                              setSelectedRepository(repository)
                              setSelectedRepositoryBranch(branch)
                              setError(null)
                            }}
                            onRepositorySelectionCleared={() => {
                              setSelectedRepository(null)
                              setSelectedRepositoryBranch("")
                              setError(null)
                            }}
                          />
                        </div>
                      </SettingsRow>
                    </SettingsGroup>
                  </section>
                </div>
              )}
            </>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter
          className={cn(
            "flex-col gap-3 sm:flex-row sm:items-center",
            mode === "repo" &&
              sourceControlReadiness.isReady &&
              repoPickerPagination &&
              repoPickerPagination.totalCount > 0
              ? "sm:justify-between"
              : "sm:justify-end",
          )}
        >
          {mode === "repo" &&
          sourceControlReadiness.isReady &&
          repoPickerPagination &&
          repoPickerPagination.totalCount > 0 ? (
            <TablePaginationControls
              showEntryCount={false}
              className="mt-0 min-w-0 flex-1"
              currentPage={repoPickerPagination.currentPage}
              totalCount={repoPickerPagination.totalCount}
              pageSize={repoPickerPagination.pageSize}
              onPageChange={repoPickerPagination.onPageChange}
              onNextClick={repoPickerPagination.onNextClick}
              isNextDisabled={repoPickerPagination.isNextDisabled}
            />
          ) : null}
          <div className="flex shrink-0 justify-end gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={closeDialog} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="button" size="sm" className="rounded-full" onClick={() => void handleSubmit()} disabled={isSubmitting}>
              {isSubmitting ? <HugeiconsIcon icon={__Loader2HugeIcon} className="h-4 w-4 animate-spin" /> : null}
              {copy.submitLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

