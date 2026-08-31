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

async function rootFor(workspaceId: string, operation: "read-file" | "write-file" | "list-files") {
  const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation })
  return access.projectRootPath
}

/** Re-checks containment against the verified root, after the handler's own check. */
function within(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Path escapes the project.")
  }
  return resolved
}

export function createNodeDevAppHostServices(): DevAppHostServices {
  return {
    readProjectFile: async ({ workspaceId, filePath }) => {
      const full = within(await rootFor(workspaceId, "read-file"), filePath)
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
      const full = within(await rootFor(workspaceId, "write-file"), filePath)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content, "utf8")
    },

    listProjectDirectory: async ({ workspaceId, directory }) => {
      const full = within(await rootFor(workspaceId, "list-files"), directory)
      return fs.readdirSync(full, { withFileTypes: true })
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

    revealPath: async (absolutePath) => {
      shell.showItemInFolder(absolutePath)
    },
  }
}
