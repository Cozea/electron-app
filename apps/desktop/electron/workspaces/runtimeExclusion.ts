import * as Effect from "effect/Effect"
import { WorkspaceCatalog } from "./WorkspaceCatalog.ts"
import { waitForWorkspaceCatalogRuntime } from "./WorkspaceCatalogRuntime.ts"

export async function assertProjectRuntimeAvailable(projectId: string): Promise<void> {
  const runtime = await waitForWorkspaceCatalogRuntime()
  const excluded = await runtime.runPromise(Effect.flatMap(Effect.service(WorkspaceCatalog), (catalog) => catalog.projects.isExcluded(projectId)))
  if (excluded) throw new Error("This project is excluded by its saved local removal.")
}
