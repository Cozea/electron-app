import path from "node:path"

import {
  isAllowedShellOpenUrl,
  resolveRevealTarget,
  type DevAppRevealRoot,
} from "../../../../shared/devAppCapabilities"
import type {
  DevAppWorkerBinding,
  DevAppWorkerMethodHandler,
} from "./DevAppWorkerHost"

/**
 * The host methods a worker may call, once the gate has authorized them.
 *
 * Authorization decides *whether* a method may run. These decide *on what*: every path
 * resolves against the worker's binding, never against anything the request supplied.
 * A worker that could name its own workspace would reach past the grant it was approved
 * under, so params naming a workspace are ignored rather than honoured.
 */

export interface DevAppHostServices {
  readProjectFile: (options: { workspaceId: string; filePath: string }) => Promise<string | null>
  writeProjectFile: (options: { workspaceId: string; filePath: string; content: string }) => Promise<void>
  listProjectDirectory: (options: { workspaceId: string; directory: string }) => Promise<string[]>
  projectMetadata: (options: { workspaceId: string }) => Promise<Record<string, unknown>>
  openExternalUrl: (url: string) => Promise<void>
  revealPath: (absolutePath: string) => Promise<void>
}

export class DevAppRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DevAppRequestError"
  }
}

function paramsObject(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {}
}

function requiredString(params: Record<string, unknown>, key: string, max = 1024): string {
  const value = params[key]
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new DevAppRequestError(`${key} is required.`)
  }
  return value
}

/**
 * Confines a request-supplied path to the worker's workspace.
 *
 * Rejects absolute paths outright rather than reinterpreting them, and resolves through
 * the workspace root so `..` cannot climb out. This duplicates nothing the gate does —
 * the gate said the worker may read *a* project file, this decides *which*.
 */
function confineToWorkspace(binding: DevAppWorkerBinding, relativePath: string): string {
  if (relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new DevAppRequestError("Path must be relative to the project.")
  }
  const root = path.resolve(binding.workspaceRoot)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new DevAppRequestError("Path escapes the project.")
  }
  return path.relative(root, resolved) || "."
}

export function createDevAppWorkerHandlers(
  services: DevAppHostServices,
): Readonly<Record<string, DevAppWorkerMethodHandler>> {
  return {
    "project.metadata": async (_request, { binding }) =>
      await services.projectMetadata({ workspaceId: binding.workspaceId }),

    "project.readFile": async (request, { binding }) => {
      const params = paramsObject(request.params)
      const filePath = confineToWorkspace(binding, requiredString(params, "path"))
      // The workspace comes from the binding. Any workspaceId in params is ignored.
      return await services.readProjectFile({ workspaceId: binding.workspaceId, filePath })
    },

    "project.writeFile": async (request, { binding }) => {
      const params = paramsObject(request.params)
      const filePath = confineToWorkspace(binding, requiredString(params, "path"))
      const content = params.content
      if (typeof content !== "string") throw new DevAppRequestError("content must be a string.")
      await services.writeProjectFile({ workspaceId: binding.workspaceId, filePath, content })
      return { written: true }
    },

    "project.listDirectory": async (request, { binding }) => {
      const params = paramsObject(request.params)
      const directory = typeof params.path === "string" && params.path.length > 0
        ? confineToWorkspace(binding, params.path)
        : "."
      return await services.listProjectDirectory({ workspaceId: binding.workspaceId, directory })
    },

    "shell.open": async (request) => {
      const url = requiredString(paramsObject(request.params), "url", 2048)
      // file: and custom schemes reach the disk and installed handlers; a scoped
      // capability must not be a route to either.
      if (!isAllowedShellOpenUrl(url)) {
        throw new DevAppRequestError("Only https, http, and mailto links can be opened.")
      }
      await services.openExternalUrl(url)
      return { opened: true }
    },

    "shell.reveal": async (request, { binding }) => {
      const params = paramsObject(request.params)
      const rootName = params.root === "data" ? "data" : "workspace"
      const target = resolveRevealTarget(
        rootName as DevAppRevealRoot,
        requiredString(params, "path"),
        { workspaceRoot: binding.workspaceRoot, ...(binding.dataDir ? { dataDir: binding.dataDir } : {}) },
        (root, relative) => path.join(root, relative),
        (value) => path.resolve(value),
      )
      if (!target) throw new DevAppRequestError("That location is outside this DevApp's reach.")
      await services.revealPath(target)
      return { revealed: true }
    },
  }
}
