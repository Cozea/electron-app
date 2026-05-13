import fs from "node:fs/promises"
import path from "node:path"
import type { WorkspaceMarker } from "../../shared/workspaceTypes.ts"

const GIT_MARKER_RELATIVE = path.join(".git", "cozea", "workspace.json")
const PLAIN_MARKER_RELATIVE = path.join(".cozea", "workspace.json")

/** Returns the marker path that exists for the given project root, or null. */
async function resolveMarkerPath(projectRootPath: string): Promise<string | null> {
  const gitMarker = path.join(projectRootPath, GIT_MARKER_RELATIVE)
  try {
    await fs.access(gitMarker)
    return gitMarker
  } catch {
    // fall through to plain marker
  }

  const plainMarker = path.join(projectRootPath, PLAIN_MARKER_RELATIVE)
  try {
    await fs.access(plainMarker)
    return plainMarker
  } catch {
    return null
  }
}

export async function readWorkspaceMarker(
  projectRootPath: string,
): Promise<{ marker: WorkspaceMarker; markerPath: string } | null> {
  const markerPath = await resolveMarkerPath(projectRootPath)
  if (!markerPath) return null

  try {
    const raw = await fs.readFile(markerPath, "utf-8")
    const parsed = JSON.parse(raw) as unknown

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as WorkspaceMarker).version !== 1
    ) {
      return null
    }

    return { marker: parsed as WorkspaceMarker, markerPath }
  } catch {
    return null
  }
}

export async function writeWorkspaceMarker(
  projectRootPath: string,
  marker: WorkspaceMarker,
): Promise<void> {
  const gitDir = path.join(projectRootPath, ".git")
  let useGitMarker = false

  try {
    const stat = await fs.stat(gitDir)
    useGitMarker = stat.isDirectory()
  } catch {
    // no .git dir
  }

  const markerPath = useGitMarker
    ? path.join(projectRootPath, GIT_MARKER_RELATIVE)
    : path.join(projectRootPath, PLAIN_MARKER_RELATIVE)

  await fs.mkdir(path.dirname(markerPath), { recursive: true })
  await fs.writeFile(markerPath, JSON.stringify(marker, null, 2), "utf-8")
}

export async function deleteWorkspaceMarker(
  projectRootPath: string,
  expected?: Partial<Pick<WorkspaceMarker, "projectId" | "workspaceId">>,
): Promise<boolean> {
  const markerResult = await readWorkspaceMarker(projectRootPath)
  if (!markerResult) return false

  if (expected?.projectId && markerResult.marker.projectId !== expected.projectId) {
    return false
  }
  if (expected?.workspaceId && markerResult.marker.workspaceId !== expected.workspaceId) {
    return false
  }

  await fs.rm(markerResult.markerPath, { force: true })
  try {
    await fs.rmdir(path.dirname(markerResult.markerPath))
  } catch {
    // Leave non-empty marker directories alone.
  }
  return true
}
