/**
 * Resolves CRDT tree paths to absolute paths inside a session workspace.
 *
 * Master Specification: Section 10.15, 10.20, Invariant C37
 * A peer controls tree paths, so every write or delete goes through here. The path is
 * validated, must resolve under the workspace root, and may not pass through a
 * symlinked directory (Git refuses to write "beyond a symbolic link" for the same reason).
 */

import fs from "node:fs/promises"
import path from "node:path"

import { InvalidProjectPathError, normalizeProjectPath } from "../collaboration/projectPath"

export async function resolveWorkspaceFilePath(workspaceRoot: string, relativePath: string): Promise<string> {
  const normalized = normalizeProjectPath(relativePath)
  const root = path.resolve(workspaceRoot)
  const absolute = path.resolve(root, normalized)

  if (!absolute.startsWith(root + path.sep)) {
    throw new InvalidProjectPathError(relativePath, "path resolves outside the workspace")
  }

  let current = root
  const parentSegments = path.relative(root, path.dirname(absolute)).split(path.sep).filter(Boolean)
  for (const segment of parentSegments) {
    current = path.join(current, segment)
    let stat
    try {
      stat = await fs.lstat(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break
      throw error
    }
    if (stat.isSymbolicLink()) {
      throw new InvalidProjectPathError(relativePath, `parent '${path.relative(root, current)}' is a symlink`)
    }
    if (!stat.isDirectory()) {
      throw new InvalidProjectPathError(relativePath, `parent '${path.relative(root, current)}' is not a directory`)
    }
  }

  return absolute
}
