import { assertCollaborationWorkspaceOperation } from "../collaboration/workspacePolicy"
import { collaborationWorkspacePolicyKey } from "../collaboration/SessionWorkspaceCoordinator"
import * as Effect from "effect/Effect"
import { WorkspaceCatalog } from "./WorkspaceCatalog.ts"
import { waitForWorkspaceCatalogRuntime } from "./WorkspaceCatalogRuntime.ts"
import { resolvePathWithinDirectory } from "../pathUtils.ts"
import type { LocalWorkspaceDTO, WorkspaceLaneDTO, CwdSpec } from "../../../../shared/workspaceTypes.ts"

export type WorkspaceOperation =
  | "read-file"
  | "write-file"
  | "delete-file"
  | "list-files"
  | "terminal-create"
  | "dev-server-start"
  | "git-read"
  | "git-write"
  | "runtime-detect"
  | "integration-tool"
  | "open-external-editor"
  | "import-read"

export async function resolveAuthorizedWorkspaceAccess(input: {
  workspaceId: string
  laneId?: string | null
  operation: WorkspaceOperation
  relativePath?: string | null
  cwd?: CwdSpec | null
}): Promise<{
  workspace: LocalWorkspaceDTO
  lane: WorkspaceLaneDTO
  projectRootPath: string
  gitRootPath: string | null
  cwd?: string
  fullPath?: string
}> {
  const rt = await waitForWorkspaceCatalogRuntime()

  return rt.runPromise(
    Effect.gen(function* () {
      const catalog = yield* Effect.service(WorkspaceCatalog)
      let workspace = yield* catalog.getById(input.workspaceId)

      if (!workspace) {
        throw new Error(`Workspace not found: ${input.workspaceId}`)
      }

      if (workspace.verificationStatus !== "verified") {
        const verification = yield* catalog.verify(input.workspaceId)
        if (verification.status !== "verified" || !verification.workspace) {
          throw new Error(`Workspace ${input.workspaceId} is not verified: ${verification.status}`)
        }
        workspace = verification.workspace
      }

      const lane = yield* catalog.getLane(input.workspaceId, input.laneId)
      if (!lane) {
        throw new Error(`Failed to resolve lane for workspace ${input.workspaceId}`)
      }

      const projectRootPath = lane.projectRootPath
      const gitRootPath = lane.gitRootPath

      let fullPath: string | undefined
      if (input.relativePath != null) {
        fullPath = resolvePathWithinDirectory(projectRootPath, input.relativePath)
      }

      let cwd: string | undefined
      if (input.cwd) {
        if (input.cwd.kind === "projectRoot") {
          cwd = projectRootPath
        } else if (input.cwd.kind === "gitRoot") {
          cwd = gitRootPath ?? projectRootPath
        } else if (input.cwd.kind === "relative") {
          cwd = resolvePathWithinDirectory(projectRootPath, input.cwd.path)
        }
      }

      assertCollaborationWorkspaceOperation(
        yield* catalog.getSetting(collaborationWorkspacePolicyKey(input.workspaceId)), input.operation,
      )

      return {
        workspace,
        lane,
        projectRootPath,
        gitRootPath,
        cwd,
        fullPath,
      }
    }),
  )
}
