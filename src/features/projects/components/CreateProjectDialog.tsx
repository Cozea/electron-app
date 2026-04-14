import { useCallback, useEffect, useMemo, useState } from "react"
import { useConvex, useMutation } from "convex/react"
import { ArrowPathIcon as Loader2, ArrowTopRightOnSquareIcon as ExternalLink, ExclamationCircleIcon as AlertCircle } from "@heroicons/react/24/outline"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import type {
  RepositoryDescriptor,
  RepositoryOwnerDescriptor,
} from "@shared/electronApiTypes"
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
import {
  createConnectedRepository,
  listConnectedRepositoryOwners,
} from "@/lib/git/providerRepositoryManagement"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { getWorkspaceSourceControlReadiness } from "@/lib/sourceControl/workspaceSourceControlReadiness"
import { cn } from "@/lib/utils"
import {
  SettingsGroup,
  SettingsGroupError,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
  settingsInlineInputClass,
  settingsInlineInputWidth,
  settingsNativeSelectClass,
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

interface RemoteCreationDetails {
  repository: RepositoryDescriptor
  owner: RepositoryOwnerDescriptor | null
}

const DIALOG_COPY: Record<CreateProjectDialogMode, DialogCopy> = {
  empty: {
    title: "Empty project",
    description:
      "Create a blank local project with a connected remote and jump straight into the workbench.",
    submitLabel: "Create project",
  },
  local: {
    title: "Import local folder",
    description:
      "Attach an existing local folder. Every imported project needs a remote, so Cozea will use the current origin or create one before saving.",
    submitLabel: "Import folder",
  },
  repo: {
    title: "Import repository",
    description:
      "Browse connected GitHub repositories, clone one locally, and open it directly in the workbench.",
    submitLabel: "Import repository",
  },
}

function getPreferredOwner(
  owners: RepositoryOwnerDescriptor[],
  setupMode: "personal" | "organization",
): RepositoryOwnerDescriptor | null {
  if (setupMode === "organization") {
    return owners.find((owner) => owner.kind !== "user") ?? owners[0] ?? null
  }

  return owners.find((owner) => owner.kind === "user") ?? owners[0] ?? null
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
          "Every project now requires a remote. Connect GitHub in Source Control before creating or importing projects.",
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
  const convex = useConvex()
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
  const [remoteRepositoryName, setRemoteRepositoryName] = useState("")
  const [remoteVisibility, setRemoteVisibility] = useState<"private" | "public">("private")
  const [owners, setOwners] = useState<RepositoryOwnerDescriptor[]>([])
  const [selectedOwnerId, setSelectedOwnerId] = useState("")
  const [isLoadingOwners, setIsLoadingOwners] = useState(false)
  const [ownersError, setOwnersError] = useState<string | null>(null)
  const [localGitState, setLocalGitState] = useState<LocalGitState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasEditedName, setHasEditedName] = useState(false)
  const [hasEditedRemoteRepositoryName, setHasEditedRemoteRepositoryName] = useState(false)
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
      title: "Create remote to import folder",
      description: `Cozea can import ${folderName} as soon as it has a GitHub remote. Set that up here and we'll finish the import.`,
      submitLabel: "Create remote and import",
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

  const ownerOptions = useMemo(() => {
    const compatibleOwners = owners.filter((owner) =>
      setupMode === "organization" ? owner.kind !== "user" : owner.kind === "user",
    )

    return compatibleOwners.length > 0 ? compatibleOwners : owners
  }, [owners, setupMode])

  const selectedOwner = useMemo(
    () => ownerOptions.find((owner) => owner.id === selectedOwnerId) ?? null,
    [ownerOptions, selectedOwnerId],
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
        setRemoteRepositoryName("")
        setRemoteVisibility("private")
        setOwners([])
        setSelectedOwnerId("")
        setOwnersError(null)
        setLocalGitState(null)
        setError(null)
        setHasEditedName(false)
        setHasEditedRemoteRepositoryName(false)
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
    if (hasEditedRemoteRepositoryName) {
      return
    }

    if (mode === "repo") {
      return
    }

    const fallbackName = mode === "local" && !name.trim() ? deriveNameFromPath(localFolderPath) : name
    setRemoteRepositoryName(buildFilesystemSlug(fallbackName))
  }, [hasEditedRemoteRepositoryName, localFolderPath, mode, name])

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

  useEffect(() => {
    if (
      !open ||
      !preferredConvexOrganizationId ||
      !convexUserId ||
      !sourceControlReadiness.isReady
    ) {
      setOwners([])
      setSelectedOwnerId("")
      setOwnersError(null)
      return
    }

    let cancelled = false
    setIsLoadingOwners(true)
    setOwnersError(null)

    void listConnectedRepositoryOwners({
      convex,
      organizationId: preferredConvexOrganizationId,
      userId: convexUserId,
      provider: "github",
    })
      .then((loadedOwners) => {
        if (cancelled) return
        setOwners(loadedOwners)
        const preferredOwner = getPreferredOwner(
          loadedOwners.filter((owner) =>
            setupMode === "organization" ? owner.kind !== "user" : owner.kind === "user",
          ).length > 0
            ? loadedOwners.filter((owner) =>
                setupMode === "organization" ? owner.kind !== "user" : owner.kind === "user",
              )
            : loadedOwners,
          setupMode,
        )
        setSelectedOwnerId((current) => {
          if (loadedOwners.some((owner) => owner.id === current)) {
            return current
          }
          return preferredOwner?.id ?? ""
        })
      })
      .catch((loadError) => {
        if (cancelled) return
        setOwners([])
        setSelectedOwnerId("")
        setOwnersError(
          loadError instanceof Error ? loadError.message : "Failed to load GitHub owners.",
        )
      })
      .finally(() => {
        if (cancelled) return
        setIsLoadingOwners(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    convex,
    convexUserId,
    open,
    preferredConvexOrganizationId,
    setupMode,
    sourceControlReadiness.isReady,
  ])

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
      owner?: RepositoryOwnerDescriptor | null
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
          ownerName: args.owner?.displayName ?? args.repository.ownerLogin,
          ownerType:
            args.owner?.kind ??
            (setupMode === "organization" ? "organization" : "user"),
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
          syncMode: "git",
        },
      })
    },
    [navigate, onOpenChange],
  )

  const createManagedRemoteRepository = useCallback(async (): Promise<RemoteCreationDetails> => {
    if (!preferredConvexOrganizationId || !convexUserId) {
      throw new Error("No workspace selected.")
    }

    if (!sourceControlReadiness.isReady) {
      throw new Error("Connect GitHub in Source Control before creating a project remote.")
    }

    if (!selectedOwner) {
      throw new Error("Choose a GitHub owner for the remote repository.")
    }

    const trimmedRemoteRepositoryName = remoteRepositoryName.trim()
    if (!trimmedRemoteRepositoryName) {
      throw new Error("Repository name is required.")
    }

    const repository = await createConnectedRepository({
      convex,
      organizationId: preferredConvexOrganizationId,
      userId: convexUserId,
      provider: "github",
      ownerId: selectedOwner.id,
      ownerLogin: selectedOwner.login,
      ownerKind: selectedOwner.kind,
      name: trimmedRemoteRepositoryName,
      private: remoteVisibility !== "public",
    })

    return {
      repository,
      owner: selectedOwner,
    }
  }, [
    convex,
    convexUserId,
    preferredConvexOrganizationId,
    remoteRepositoryName,
    remoteVisibility,
    selectedOwner,
    sourceControlReadiness.isReady,
  ])

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

    if ((mode === "empty" || (mode === "local" && !localGitState?.remoteUrl)) && !sourceControlReadiness.isReady) {
      setError("Connect GitHub in Source Control before continuing.")
      return
    }

    if (
      (mode === "empty" || (mode === "local" && !localGitState?.remoteUrl)) &&
      !remoteRepositoryName.trim()
    ) {
      setError("Repository name is required.")
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
        const remote = await createManagedRemoteRepository()
        const branch = remote.repository.defaultBranch || "main"
        const ensureRepoResult = await window.electronAPI.sync.gitEnsureRepo({
          projectPath: createdProjectPath,
          branch,
          repoUrl: remote.repository.url,
        })

        if (!ensureRepoResult.success) {
          throw new Error(ensureRepoResult.error || "Failed to attach the new remote repository.")
        }

        const result = await createProject({
          organizationId: preferredConvexOrganizationId,
          userId: convexUserId,
          name: trimmedName,
          template: "blank",
          creationPath: "fresh",
          sourceControl: {
            provider: remote.repository.provider,
            repoUrl: remote.repository.url,
            activeCollabBranch: branch,
            defaultBranch: branch,
            visibility: formatRemoteVisibility(
              remote.repository.visibility,
              remote.repository.private,
            ),
            workingCopyMode: "managed",
            setupMode,
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
          repository: remote.repository,
          branch,
          owner: remote.owner,
          workingCopyMode: "managed",
        })
        navigateToProjectWorkbench(String(result.projectId), createdProjectPath, trimmedName)
        return
      }

      if (mode === "local") {
        const existingRemoteUrl = localGitState?.remoteUrl?.trim() || ""
        let repositoryForBinding: RepositoryDescriptor | null = null
        let repositoryOwner: RepositoryOwnerDescriptor | null = null
        let repoUrl = existingRemoteUrl
        let branch = localGitState?.branch || "main"

        if (!existingRemoteUrl) {
          const remote = await createManagedRemoteRepository()
          repositoryForBinding = remote.repository
          repositoryOwner = remote.owner
          repoUrl = remote.repository.url
          branch = remote.repository.defaultBranch || branch

          const ensureRepoResult = await window.electronAPI.sync.gitEnsureRepo({
            projectPath: trimmedLocalFolderPath,
            branch,
            repoUrl,
          })

          if (!ensureRepoResult.success) {
            throw new Error(ensureRepoResult.error || "Failed to attach a remote to the local folder.")
          }
        }

        const provider = repositoryForBinding?.provider ?? deriveProviderFromRepoUrl(repoUrl)
        const normalizedBranch = await detectCurrentBranch(trimmedLocalFolderPath, branch)
        const result = await createProject({
          organizationId: preferredConvexOrganizationId,
          userId: convexUserId,
          name: trimmedName,
          template: "blank",
          creationPath: "repo",
          sourceControl: {
            provider,
            repoUrl,
            activeCollabBranch: normalizedBranch,
            defaultBranch: normalizedBranch,
            visibility:
              repositoryForBinding
                ? formatRemoteVisibility(
                    repositoryForBinding.visibility,
                    repositoryForBinding.private,
                  )
                : undefined,
            workingCopyMode: "attached",
            setupMode,
          },
          repoSource: {
            provider,
            repoUrl,
            branch: normalizedBranch,
          },
        })

        await updateProjectStatus({
          projectId: result.projectId,
          userId: convexUserId,
          status: "active",
        })
        await persistProjectPath(result.projectId, trimmedLocalFolderPath)
        if (repositoryForBinding) {
          await persistBindingDetails({
            projectId: result.projectId,
            repository: repositoryForBinding,
            branch: normalizedBranch,
            owner: repositoryOwner,
            workingCopyMode: "attached",
          })
        }
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
          activeCollabBranch: branch,
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
    createManagedRemoteRepository,
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
    remoteRepositoryName,
    selectedRepository,
    selectedRepositoryBranch,
    setupMode,
    sourceControlReadiness.isReady,
    updateProjectStatus,
  ])

  useEffect(() => {
    if (
      !open ||
      mode !== "local" ||
      isSubmitting ||
      !localFolderPath.trim() ||
      !localGitState?.remoteUrl
    ) {
      return
    }

    void handleSubmit()
  }, [
    handleSubmit,
    isSubmitting,
    localFolderPath,
    localGitState?.remoteUrl,
    mode,
    open,
  ])

  const blockingCopy = getBlockingCopy(sourceControlReadiness.blockingReason, setupMode)
  const shouldShowRemoteCreationSection =
    mode === "empty" || (mode === "local" && !localGitState?.remoteUrl)

  const renderRemoteCreationSection = () => {
    if (!shouldShowRemoteCreationSection) {
      return null
    }

    if (!sourceControlReadiness.isReady) {
      return (
        <Alert className="rounded-2xl bg-secondary/40">
          <AlertCircle className="h-4 w-4" />
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
              Open Source Control
              <ExternalLink className="h-4 w-4" />
            </Button>
          </AlertDescription>
        </Alert>
      )
    }

    return (
      <section>
        <SettingsSectionTitle>Remote repository</SettingsSectionTitle>
        <SettingsSectionDescription>
          {mode === "empty"
            ? "Cozea creates and connects a GitHub repository before opening workbench."
            : "No origin remote found, so Cozea will create one before import."}
        </SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title="Owner"
              htmlFor="create-project-remote-owner"
              description={isLoadingOwners ? "Loading owners..." : "Where the repository is created."}
              descriptionClassName="truncate"
            />
            <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
              <select
                id="create-project-remote-owner"
                value={selectedOwnerId}
                onChange={(event) => {
                  setSelectedOwnerId(event.target.value)
                  setError(null)
                }}
                disabled={isSubmitting || isLoadingOwners || ownerOptions.length === 0}
                className={cn(settingsNativeSelectClass, "w-[176px]")}
              >
                {ownerOptions.length === 0 ? (
                  <option value="">{isLoadingOwners ? "Loading owners..." : "No owner available"}</option>
                ) : null}
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.displayName} ({owner.login})
                  </option>
                ))}
              </select>
            </SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel
              title="Visibility"
              htmlFor="create-project-remote-visibility"
              description="Repository visibility."
              descriptionClassName="truncate"
            />
            <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
              <select
                id="create-project-remote-visibility"
                value={remoteVisibility}
                onChange={(event) => {
                  const value = event.target.value
                  setRemoteVisibility(value === "public" ? "public" : "private")
                  setError(null)
                }}
                disabled={isSubmitting}
                className={cn(settingsNativeSelectClass, "w-[176px]")}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel
              title="Repository name"
              htmlFor="create-project-remote-name"
              description="Created before opening workbench."
              descriptionClassName="truncate"
            />
            <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
              <Input
                id="create-project-remote-name"
                value={remoteRepositoryName}
                onChange={(event) => {
                  setHasEditedRemoteRepositoryName(true)
                  setRemoteRepositoryName(event.target.value)
                  setError(null)
                }}
                placeholder="my-project"
                className={cn(settingsInlineInputClass, "w-full text-[13px] font-normal")}
                disabled={isSubmitting}
              />
            </SettingsRowControl>
          </SettingsRow>
          {ownersError ? <SettingsGroupError>{ownersError}</SettingsGroupError> : null}
        </SettingsGroup>
      </section>
    )
  }

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
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertTitle>Checking the folder</AlertTitle>
              <AlertDescription>
                Preparing the import and confirming whether we need to create a remote first.
              </AlertDescription>
            </Alert>
          ) : null}

          {mode === "repo" ? (
            <>
              {!sourceControlReadiness.isReady ? (
                <Alert className="rounded-2xl bg-secondary/40">
                  <AlertCircle className="h-4 w-4" />
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
                      Open Source Control
                      <ExternalLink className="h-4 w-4" />
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

          {renderRemoteCreationSection()}

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
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {copy.submitLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
