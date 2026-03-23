import type { ConvexReactClient } from 'convex/react'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { prepareGitProjectForOpen, type ProjectOpenGitProjectLike } from '@/features/projects/lib/projectOpenGitSync'
import { dispatchGitStatusEvent } from '@/lib/git/gitStatusEvents'
import {
  resolveEffectiveProjectGitBranch,
  resolveProjectGitRemoteConfig,
} from '@/lib/git/projectGitRuntime'

interface PublishWorkspaceToGitRemoteOptions {
  convex: ConvexReactClient
  project: ProjectOpenGitProjectLike
  projectPath: string
  userId: Id<'users'>
  message?: string
  onProgress?: (message: string) => void
  updateMemberLocalPath?: (args: {
    projectId: Id<'projects'>
    userId: Id<'users'>
    localPath: string
  }) => Promise<unknown>
}

export async function publishWorkspaceToGitRemote({
  convex,
  project,
  projectPath,
  userId,
  message = 'manual: sync workspace',
  onProgress,
  updateMemberLocalPath,
}: PublishWorkspaceToGitRemoteOptions): Promise<void> {
  const remoteConfig = await resolveProjectGitRemoteConfig({
    convex,
    project,
    userId,
  })

  const prepareResult = await prepareGitProjectForOpen({
    convex,
    project,
    localPath: projectPath,
    userId,
    onProgress,
    updateMemberLocalPath,
  })

  if (prepareResult.cancelled) {
    if (prepareResult.needsConflictResolution) {
      throw new Error('Resolve git conflicts before publishing workspace changes')
    }
    return
  }

  if (!remoteConfig.repoUrl && !remoteConfig.usesExistingRemote) {
    return
  }

  const branch = await resolveEffectiveProjectGitBranch({
    projectPath,
    fallbackBranch: remoteConfig.branch,
    usesExistingRemote: remoteConfig.usesExistingRemote,
  })

  onProgress?.('Publishing workspace changes...')
  const commitAndPushResult = await window.electronAPI.sync.gitCommitAndPush({
    projectPath,
    branch,
    repoUrl: remoteConfig.repoUrl,
    message,
    provider: remoteConfig.provider,
    accessToken: remoteConfig.accessToken,
  })

  if (!commitAndPushResult.success) {
    throw new Error(commitAndPushResult.error || 'Failed to publish workspace changes')
  }

  if (!commitAndPushResult.pushed) {
    const statusResult = await window.electronAPI.sync.gitStatus({
      projectPath,
      branch,
    })
    if (!statusResult.success || !statusResult.isRepo) {
      throw new Error(statusResult.error || 'Failed to verify git status before push')
    }

    if ((statusResult.ahead ?? 0) > 0) {
      const pushResult = await window.electronAPI.sync.gitPushMain({
        projectPath,
        branch,
        repoUrl: remoteConfig.repoUrl,
        provider: remoteConfig.provider,
        accessToken: remoteConfig.accessToken,
      })
      if (!pushResult.success) {
        throw new Error(pushResult.error || 'Failed to push workspace changes')
      }
      dispatchGitStatusEvent({
        projectId: String(project._id),
        projectPath,
        kind: 'published',
      })
    }
  }

  const finalStatus = await window.electronAPI.sync.gitStatus({
    projectPath,
    branch,
  })

  if (finalStatus.success && finalStatus.isRepo) {
    dispatchGitStatusEvent({
      projectId: String(project._id),
      projectPath,
      kind: 'published',
    })
    await convex.mutation(api.projects.updateGitSyncMetadata, {
      projectId: project._id,
      userId,
      gitSyncState: {
        accessState: 'granted',
        lastFetchedCommit: commitAndPushResult.commitSha ?? undefined,
        lastPushedCommit: commitAndPushResult.commitSha ?? undefined,
        lastFetchAt: Date.now(),
        lastPushAt: Date.now(),
        errorMessage: undefined,
      },
    })
  }
}
