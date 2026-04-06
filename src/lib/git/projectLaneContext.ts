import type { ConvexReactClient } from "convex/react"

import type { Id } from "../../../convex/_generated/dataModel"
import type { ProjectLaneDescriptor } from "@shared/electronApiTypes"
import {
  resolveProjectGitRemoteConfig,
  type ProjectGitRuntimeProjectLike,
} from "@/lib/git/projectGitRuntime"

export interface ResolvedProjectLaneGitContext {
  collabBranch: string
  collabLanePath: string
  laneBranch: string
  lanePath: string
  laneIsCollab: boolean
  remoteConfig: Awaited<ReturnType<typeof resolveProjectGitRemoteConfig>>
}

interface ResolveProjectLaneGitContextArgs {
  convex: ConvexReactClient
  project: ProjectGitRuntimeProjectLike | null
  projectId: string
  projectPath: string
  collabBranch: string
  activeLane?: ProjectLaneDescriptor | null
  userId?: Id<"users"> | null
}

export async function resolveProjectLaneGitContext(
  args: ResolveProjectLaneGitContextArgs,
): Promise<ResolvedProjectLaneGitContext> {
  if (!args.project) {
    throw new Error("Project metadata is unavailable.")
  }

  const remoteConfig = await resolveProjectGitRemoteConfig({
    convex: args.convex,
    project: args.project,
    userId: args.userId,
  })

  const ensuredLaneState = await window.electronAPI.project.ensureCollabLane({
    projectId: args.projectId,
    projectPath: args.projectPath,
    branch: args.collabBranch || remoteConfig.branch,
  })
  const collabLane =
    ensuredLaneState.lanes.find((lane) => lane.id === ensuredLaneState.collabLaneId) ?? null

  const resolvedCollabBranch =
    collabLane?.branch?.trim() ||
    args.collabBranch.trim() ||
    remoteConfig.branch.trim() ||
    "main"
  const resolvedCollabLanePath = collabLane?.projectPath ?? args.projectPath
  const resolvedActiveLane = args.activeLane ?? collabLane

  const lanePath = resolvedActiveLane?.projectPath ?? resolvedCollabLanePath
  const laneBranch =
    resolvedActiveLane?.branch?.trim() ||
    resolvedCollabBranch ||
    remoteConfig.branch.trim() ||
    "main"

  const ensureResult = await window.electronAPI.sync.gitEnsureRepo({
    projectPath: lanePath,
    branch: laneBranch,
    repoUrl: remoteConfig.repoUrl,
  })
  if (!ensureResult.success) {
    throw new Error(ensureResult.error || "Failed to prepare the local git repository.")
  }

  return {
    collabBranch: resolvedCollabBranch,
    collabLanePath: resolvedCollabLanePath,
    laneBranch,
    laneIsCollab: resolvedActiveLane?.isCollab ?? true,
    lanePath,
    remoteConfig,
  }
}

function normalizeRepoUrl(repoUrl: string): string {
  return repoUrl.trim().replace(/\.git$/i, "")
}

function parseRepositoryLocation(
  repoUrl: string,
): { host: string; owner: string; repo: string } | null {
  const normalized = normalizeRepoUrl(repoUrl)
  if (!normalized) return null

  const httpsMatch = normalized.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)$/i)
  if (httpsMatch) {
    return {
      host: httpsMatch[1]!,
      owner: httpsMatch[2]!,
      repo: httpsMatch[3]!,
    }
  }

  const sshMatch = normalized.match(/^git@([^:]+):([^/]+)\/(.+)$/i)
  if (sshMatch) {
    return {
      host: sshMatch[1]!,
      owner: sshMatch[2]!,
      repo: sshMatch[3]!,
    }
  }

  return null
}

export function buildPullRequestUrl(args: {
  repoUrl: string | null | undefined
  provider: string | null | undefined
  baseBranch: string
  headBranch: string
}): string | null {
  const repoUrl = args.repoUrl?.trim()
  const provider = args.provider?.trim().toLowerCase()
  if (!repoUrl || !provider) return null

  const location = parseRepositoryLocation(repoUrl)
  if (!location) return null

  const encodedBase = encodeURIComponent(args.baseBranch)
  const encodedHead = encodeURIComponent(args.headBranch)

  if (provider === "github") {
    return `https://${location.host}/${location.owner}/${location.repo}/compare/${encodedBase}...${encodedHead}?expand=1`
  }

  if (provider === "gitlab") {
    return `https://${location.host}/${location.owner}/${location.repo}/-/merge_requests/new?merge_request[source_branch]=${encodedHead}&merge_request[target_branch]=${encodedBase}`
  }

  return null
}
