import type { ConvexReactClient } from 'convex/react'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { prepareGitProjectForOpen, type ProjectOpenGitProjectLike } from '@/features/projects/lib/projectOpenGitSync'
import { buildCozeaGitAuthHeader, buildCozeaGitRemoteUrl } from '@/lib/git/cozeaRemote'
import { dispatchGitStatusEvent } from '@/lib/git/gitStatusEvents'

interface PublishWorkspaceToCozeaGitOptions {
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

async function resolveAccessToken(): Promise<string | undefined> {
  try {
    const session = await window.electronAPI.auth.getSession()
    return session?.accessToken
  } catch (error) {
    console.warn('[GitPublish] Failed to resolve session token:', error)
    return undefined
  }
}

export async function publishWorkspaceToCozeaGit({
  convex,
  project,
  projectPath,
  userId,
  message = 'cozea: sync workspace',
  onProgress,
  updateMemberLocalPath,
}: PublishWorkspaceToCozeaGitOptions): Promise<void> {
  const branch = project.gitRepository?.defaultBranch?.trim() || 'main'

  await prepareGitProjectForOpen({
    convex,
    project,
    localPath: projectPath,
    userId,
    onProgress,
    updateMemberLocalPath,
  })

  const accessToken = await resolveAccessToken()
  const repoUrl = buildCozeaGitRemoteUrl(String(project._id))
  const extraHeader = buildCozeaGitAuthHeader(accessToken)

  onProgress?.('Publishing workspace changes...')
  const commitAndPushResult = await window.electronAPI.sync.gitCommitAndPush({
    projectPath,
    branch,
    repoUrl,
    message,
    extraHeader,
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
        repoUrl,
        extraHeader,
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
