import fs from "node:fs/promises"
import path from "node:path"
import type { Dirent } from "node:fs"
import type {
  RepoIdentity,
  WorkspaceCandidate,
  WorkspaceVerificationStatus,
} from "../../shared/workspaceTypes.ts"
import { readWorkspaceMarker } from "./markers.ts"
import { readGitRepoIdentity, repoIdentitiesMatch } from "./repoIdentity.ts"

interface ScanOptions {
  /** Absolute paths to directories to scan for project folders. */
  roots: string[]
  projectId: string
  slug: string
  expectedRepo?: RepoIdentity | null
  /** workspaceId already bound to projectId on this machine, if any */
  existingWorkspaceId?: string | null
}

function slugMatches(basename: string, slug: string): boolean {
  if (basename === slug) return true
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped}-\\d+$`).test(basename)
}

export async function scanForCandidates(
  options: ScanOptions,
): Promise<WorkspaceCandidate[]> {
  const { roots, projectId, slug, expectedRepo } = options
  const candidates: WorkspaceCandidate[] = []

  for (const root of roots) {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidatePath = path.join(root, entry.name)
      candidates.push(await scoreCandidate(candidatePath, entry.name, projectId, slug, expectedRepo))
    }
  }

  return candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
}

async function scoreCandidate(
  candidatePath: string,
  basename: string,
  projectId: string,
  slug: string,
  expectedRepo?: RepoIdentity | null,
): Promise<WorkspaceCandidate> {
  let score = 0
  const reasons: string[] = []
  const warnings: string[] = []
  let verificationStatus: WorkspaceVerificationStatus = "untrusted"
  let repoIdentity: RepoIdentity | null = null
  let markerProjectId: string | null = null
  let markerWorkspaceId: string | null = null

  let realPath = candidatePath
  try {
    realPath = await fs.realpath(candidatePath)
  } catch {
    // use original
  }

  // Read marker
  const markerResult = await readWorkspaceMarker(candidatePath)
  if (markerResult) {
    markerProjectId = markerResult.marker.projectId
    markerWorkspaceId = markerResult.marker.workspaceId

    if (markerResult.marker.projectId === projectId) {
      score += 100
      reasons.push("marker.projectId matches")
      verificationStatus = "verified"
    } else {
      score -= 100
      warnings.push(`marker.projectId=${markerResult.marker.projectId} does not match`)
      verificationStatus = "marker-mismatched-project"
    }
  } else {
    verificationStatus = "marker-missing"
  }

  // Read git repo identity
  try {
    repoIdentity = await readGitRepoIdentity(candidatePath)
  } catch {
    // non-fatal
  }

  if (repoIdentity) {
    // Cozea remote projectId match
    if (repoIdentity.provider === "cozea" && repoIdentity.projectId === projectId) {
      score += 60
      reasons.push("git remote cozea projectId matches")
    }

    // Expected repo match
    if (expectedRepo && repoIdentitiesMatch(repoIdentity, expectedRepo)) {
      score += 80
      reasons.push("git remote origin matches expected repo")
    } else if (expectedRepo && repoIdentity) {
      score -= 80
      warnings.push("git remote origin does not match expected repo")
      verificationStatus = "repo-mismatched"
    }
  }

  // Slug match
  if (basename === slug) {
    score += 40
    reasons.push("folder basename equals slug")
  } else if (slugMatches(basename, slug)) {
    score += 30
    reasons.push("folder basename matches slug pattern")
  }

  return {
    path: candidatePath,
    realPath,
    score,
    reasons,
    warnings,
    verificationStatus,
    repoIdentity,
    markerProjectId,
    markerWorkspaceId,
  }
}
