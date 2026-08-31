import fs from "node:fs"
import path from "node:path"
import { shell } from "electron"

import { resolveAuthorizedWorkspaceAccess } from "../workspaces/authorization"
import type { DevAppHostServices } from "./devAppWorkerHandlers"

/**
 * The real implementations behind the capability-gated worker methods.
 *
 * Two checks stand between a worker and a file, and they answer different questions. The
 * gate in `DevAppWorkerHost` decides whether this worker may read a project file at all.
 * `resolveAuthorizedWorkspaceAccess` decides whether this workspace is one the user has
 * actually granted, and returns its verified root. Neither substitutes for the other, and
 * the path confinement in `devAppWorkerHandlers` is what ties the answer to a location.
 */

const MAX_READ_BYTES = 5 * 1024 * 1024
const MAX_WRITE_BYTES = 5 * 1024 * 1024
const MAX_DIRECTORY_ENTRIES = 10_000

async function rootFor(workspaceId: string, operation: "read-file" | "write-file" | "list-files") {
  const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation })
  return access.projectRootPath
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

/** Re-checks lexical and symlink containment against the verified root. */
function existingWithinOrNull(root: string, relativePath: string): string | null {
  const realRoot = fs.realpathSync.native(root)
  const candidate = path.resolve(realRoot, relativePath)
  if (!isInside(realRoot, candidate)) {
    throw new Error("Path escapes the project.")
  }
  if (!fs.existsSync(candidate)) return null
  const realCandidate = fs.realpathSync.native(candidate)
  if (!isInside(realRoot, realCandidate)) {
    throw new Error("Path escapes the project through a symbolic link.")
  }
  return realCandidate
}

function existingWithin(root: string, relativePath: string): string {
  const resolved = existingWithinOrNull(root, relativePath)
  if (!resolved) throw new Error("That location does not exist.")
  return resolved
}

/** Resolves a write without following an existing or parent symlink outside the root. */
function writableWithin(root: string, relativePath: string): string {
  const realRoot = fs.realpathSync.native(root)
  const candidate = path.resolve(realRoot, relativePath)
  if (!isInside(realRoot, candidate)) {
    throw new Error("Path escapes the project.")
  }

  let existingAncestor = candidate
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor)
    if (parent === existingAncestor) throw new Error("Path escapes the project.")
    existingAncestor = parent
  }
  const realAncestor = fs.realpathSync.native(existingAncestor)
  if (!isInside(realRoot, realAncestor)) {
    throw new Error("Path escapes the project through a symbolic link.")
  }

  if (fs.existsSync(candidate)) {
    const realCandidate = fs.realpathSync.native(candidate)
    if (!isInside(realRoot, realCandidate)) {
      throw new Error("Path escapes the project through a symbolic link.")
    }
  }
  return candidate
}

export function createNodeDevAppHostServices(): DevAppHostServices {
  return {
    readProjectFile: async ({ workspaceId, filePath }) => {
      const full = existingWithinOrNull(await rootFor(workspaceId, "read-file"), filePath)
      if (!full) return null
      const stat = fs.statSync(full, { throwIfNoEntry: false })
      if (!stat?.isFile()) return null
      if (stat.size > MAX_READ_BYTES) {
        // A worker cannot be allowed to pull an arbitrarily large file across the port
        // and into the main process's heap.
        throw new Error("That file is too large to read.")
      }
      return fs.readFileSync(full, "utf8")
    },

    writeProjectFile: async ({ workspaceId, filePath, content }) => {
      if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
        throw new Error("That file is too large to write.")
      }
      const root = await rootFor(workspaceId, "write-file")
      const full = writableWithin(root, filePath)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      // Re-check after directory creation so a pre-existing symlinked parent cannot be
      // introduced between the first validation and the write.
      writableWithin(root, filePath)
      fs.writeFileSync(full, content, "utf8")
    },

    listProjectDirectory: async ({ workspaceId, directory }) => {
      const full = existingWithin(await rootFor(workspaceId, "list-files"), directory)
      const entries = fs.readdirSync(full, { withFileTypes: true })
      if (entries.length > MAX_DIRECTORY_ENTRIES) {
        throw new Error("That directory has too many entries to list.")
      }
      return entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    },

    projectMetadata: async ({ workspaceId }) => {
      const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: "read-file" })
      // Deliberately narrow. `project.metadata` is the least-privileged capability in the
      // vocabulary, so it must not become a way to learn the machine's directory layout.
      return {
        name: access.workspace.label,
        laneId: access.lane.laneId,
        branch: access.lane.branch,
        hasGit: access.gitRootPath !== null,
      }
    },

    openExternalUrl: async (url) => {
      // The scheme allowlist lives in the handler, which has already run. This is the
      // side effect only.
      await shell.openExternal(url)
    },

    revealPath: async ({ rootPath, relativePath }) => {
      shell.showItemInFolder(existingWithin(rootPath, relativePath))
    },
  }
}
