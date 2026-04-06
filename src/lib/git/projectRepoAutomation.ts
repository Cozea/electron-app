import type { ConvexReactClient } from 'convex/react'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { resolveProjectGitRemoteConfig } from '@/lib/git/projectGitRuntime'
import {
  resolveProjectIntegrationProvider,
  resolveProjectRepoAccessStatus,
} from '@/lib/git/projectRepoAccess'

type ProjectRole = 'project_manager' | 'developer' | 'designer' | 'viewer'
type RepoAccessAction = 'grant' | 'revoke'
type RepoAccessSubjectType = 'member' | 'invite'

interface SyncProjectRepositoryAccessArgs {
  convex: ConvexReactClient
  project: {
    _id: Id<'projects'>
    organizationId: Id<'organizations'>
    gitRepository?: {
      provider?: string
      url?: string
    } | null
    sourceControl?: {
      provider?: string
      repoUrl?: string | null
      setupMode?: 'personal' | 'organization'
      workingCopyMode?: 'managed' | 'attached'
    } | null
  }
  actorUserId: Id<'users'>
  subjectType: RepoAccessSubjectType
  role: ProjectRole
  action: RepoAccessAction
  isPersonalWorkspace: boolean
  memberUserId?: Id<'users'>
  inviteEmail?: string
  providerAccountHandle?: string
}

export interface SyncProjectRepositoryAccessOutcome {
  success: boolean
  accessState: 'pending' | 'granted' | 'needs_identity' | 'manual_required' | 'revoked' | 'error'
  error?: string
  provider?: 'github' | 'gitlab'
  externalInvitationId?: string
  providerAccountHandle?: string
}

function buildManualOutcome(
  description: string,
  provider?: 'github' | 'gitlab'
): SyncProjectRepositoryAccessOutcome {
  return {
    success: false,
    accessState: 'manual_required',
    error: description,
    provider,
  }
}

export async function syncProjectRepositoryAccess(
  args: SyncProjectRepositoryAccessArgs
): Promise<SyncProjectRepositoryAccessOutcome> {
  const provider = resolveProjectIntegrationProvider(args.project)

  if (!provider) {
    return buildManualOutcome('This project is not connected to a GitHub or GitLab repository.')
  }

  const remoteConfig = await resolveProjectGitRemoteConfig({
    convex: args.convex,
    project: args.project,
    userId: args.actorUserId,
  })

  let sourceControlConnection: {
    authStatus?: string | null
    setupMode?: 'personal' | 'organization' | null
  } | null = null
  let isPersonalWorkspace = args.isPersonalWorkspace
  try {
    const providerContext = await args.convex.query(
      api.sourceControl.getProjectProviderContext,
      {
        projectId: args.project._id,
        userId: args.actorUserId,
      }
    )
    sourceControlConnection = providerContext?.connection ?? null
    isPersonalWorkspace = providerContext?.isPersonalWorkspace ?? isPersonalWorkspace
  } catch (error) {
    console.warn('[ProjectRepoAutomation] Falling back to project-scoped git credentials:', {
      projectId: String(args.project._id),
      actorUserId: String(args.actorUserId),
      provider,
      error,
    })
  }

  const repoAccessStatus = resolveProjectRepoAccessStatus({
    project: args.project,
    sourceControlConnection,
    isPersonalWorkspace,
  })
  const hasProjectScopedAutomationSession =
    Boolean(remoteConfig.repoUrl) &&
    (provider === 'github' || provider === 'gitlab'
      ? Boolean(remoteConfig.accessToken)
      : true)

  let outcome: SyncProjectRepositoryAccessOutcome

  if (
    (!hasProjectScopedAutomationSession && repoAccessStatus.state !== 'provider_ready') ||
    !remoteConfig.repoUrl
  ) {
    outcome = buildManualOutcome(repoAccessStatus.description, provider)
  } else {
    const result = await window.electronAPI.sourceControl.syncRepositoryAccess({
      provider,
      repoUrl: remoteConfig.repoUrl,
      accessToken: remoteConfig.accessToken,
      providerHost: remoteConfig.providerHost,
      action: args.action,
      role: args.role,
      inviteEmail: args.inviteEmail,
      providerAccountHandle: args.providerAccountHandle,
    })

    outcome = {
      success: result.success,
      accessState: result.accessState || 'error',
      error: result.error,
      provider,
      externalInvitationId: result.externalInvitationId,
      providerAccountHandle: result.providerAccountHandle,
    }
  }

  await args.convex.mutation(api.projectRepoAccess.recordSyncResult, {
    projectId: args.project._id,
    actorUserId: args.actorUserId,
    provider,
    repoUrl: remoteConfig.repoUrl,
    subjectType: args.subjectType,
    memberUserId: args.subjectType === 'member' ? args.memberUserId : undefined,
    inviteEmail: args.subjectType === 'invite' ? args.inviteEmail : undefined,
    role: args.role,
    accessState: outcome.accessState,
    providerAccountHandle: outcome.providerAccountHandle ?? args.providerAccountHandle,
    externalInvitationId: outcome.externalInvitationId,
    errorMessage: outcome.error,
  })

  return outcome
}
