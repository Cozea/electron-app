import type { ConvexReactClient } from 'convex/react'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { VersionControlSetupMode } from '@shared/versionControl'

export type ProjectGitSyncPolicy = 'auto' | 'manual'
export type ProjectWorkingCopyMode = 'managed' | 'attached'

export interface ProjectGitRuntimeSourceControlLike {
  provider?: string
  repoUrl?: string | null
  defaultBranch?: string | null
  visibility?: string
  mergeStrategy?: string
  mergeQueue?: string
  workingCopyMode?: ProjectWorkingCopyMode
  setupMode?: VersionControlSetupMode
}

export interface ProjectGitRuntimeRepositoryLike {
  provider?: string
  url?: string
  defaultBranch?: string | null
}

export interface ProjectGitRuntimeProjectLike {
  _id?: Id<'projects'>
  projectId?: Id<'projects'>
  organizationId: Id<'organizations'>
  gitRepository?: ProjectGitRuntimeRepositoryLike | null
  sourceControl?: ProjectGitRuntimeSourceControlLike | null
}

export interface ResolvedProjectGitRemoteConfig {
  branch: string
  syncPolicy: ProjectGitSyncPolicy
  workingCopyMode: ProjectWorkingCopyMode
  provider?: string
  repoUrl?: string
  accessToken?: string
  providerHost?: string
  usesExistingRemote: boolean
}

interface ProjectGitBindingLike {
  provider: string
  repoUrl?: string
  activeCollabBranch?: string
  defaultBranch: string
  syncPolicy: ProjectGitSyncPolicy
  workingCopyMode: ProjectWorkingCopyMode
}

interface ProjectProviderSessionLike {
  provider: 'github' | 'gitlab'
  providerHost: string
  accessToken: string
}

function normalizeProvider(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}

function resolveProjectRuntimeId(
  project: ProjectGitRuntimeProjectLike
): Id<'projects'> | undefined {
  return project._id ?? project.projectId
}

export function resolveProjectGitSyncPolicy(
  _sourceControl: ProjectGitRuntimeSourceControlLike | null | undefined
): ProjectGitSyncPolicy {
  return 'manual'
}

export function resolveProjectWorkingCopyMode(
  sourceControl: ProjectGitRuntimeSourceControlLike | null | undefined
): ProjectWorkingCopyMode {
  return sourceControl?.workingCopyMode === 'attached' ? 'attached' : 'managed'
}

export async function resolveProjectGitRemoteConfig(args: {
  convex: ConvexReactClient
  project: ProjectGitRuntimeProjectLike
  userId?: Id<'users'> | null | undefined
}): Promise<ResolvedProjectGitRemoteConfig> {
  let provider =
    normalizeProvider(args.project.gitRepository?.provider) ??
    normalizeProvider(args.project.sourceControl?.provider)
  let branch =
    args.project.sourceControl?.defaultBranch?.trim() ||
    args.project.gitRepository?.defaultBranch?.trim() ||
    'main'
  let syncPolicy = resolveProjectGitSyncPolicy(args.project.sourceControl)
  let workingCopyMode = resolveProjectWorkingCopyMode(args.project.sourceControl)

  if (provider === 'local') {
    return {
      branch,
      syncPolicy,
      workingCopyMode,
      provider,
      usesExistingRemote: workingCopyMode === 'attached',
    }
  }

  let repoUrl =
    args.project.gitRepository?.url?.trim() ||
    args.project.sourceControl?.repoUrl?.trim() ||
    undefined

  const projectId = resolveProjectRuntimeId(args.project)

  if (projectId && args.userId) {
    try {
      const credentialResult = await args.convex.action(
        api.sourceControl.issueProjectGitCredentials,
        {
          projectId,
          userId: args.userId,
        }
      ) as {
        binding?: ProjectGitBindingLike | null
        providerSession?: ProjectProviderSessionLike | null
      } | null

      if (credentialResult?.binding) {
        provider = normalizeProvider(credentialResult.binding.provider) ?? provider
        repoUrl = credentialResult.binding.repoUrl?.trim() || repoUrl
        branch =
          credentialResult.binding.activeCollabBranch?.trim() ||
          credentialResult.binding.defaultBranch?.trim() ||
          branch
        syncPolicy = credentialResult.binding.syncPolicy === 'manual' ? 'manual' : 'auto'
        workingCopyMode =
          credentialResult.binding.workingCopyMode === 'attached'
            ? 'attached'
            : 'managed'

        if (provider === 'local') {
          return {
            branch,
            syncPolicy,
            workingCopyMode,
            provider,
            usesExistingRemote: true,
          }
        }
      }

      if (
        credentialResult?.providerSession &&
        (provider === 'github' || provider === 'gitlab')
      ) {
        return {
          branch,
          syncPolicy,
          workingCopyMode,
          provider,
          repoUrl,
          accessToken: credentialResult.providerSession.accessToken,
          providerHost: credentialResult.providerSession.providerHost,
          usesExistingRemote: workingCopyMode === 'attached',
        }
      }
    } catch (error) {
      console.warn('[ProjectGitRuntime] Failed to resolve project source control credentials:', {
        projectId: String(projectId),
        organizationId: String(args.project.organizationId),
        error,
      })
    }
  }

  if (!repoUrl) {
    return {
      branch,
      syncPolicy,
      workingCopyMode,
      provider,
      usesExistingRemote: workingCopyMode === 'attached',
    }
  }

  if (provider !== 'github' && provider !== 'gitlab') {
    return {
      branch,
      syncPolicy,
      workingCopyMode,
      provider,
      repoUrl,
      usesExistingRemote: workingCopyMode === 'attached',
    }
  }

  return {
    branch,
    syncPolicy,
    workingCopyMode,
    provider,
    repoUrl,
    usesExistingRemote: workingCopyMode === 'attached',
  }
}
