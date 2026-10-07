import type { ProjectOperationDTO, LocalProjectsElectronAPI } from "@shared/localProjectTypes"
import { desktopPersistenceClient } from "@/app/model/persistence/desktopPersistenceClient"
import {
  ensureWorkbenchLayoutPersistenceReady,
  peekPersistedWorkbenchLayout,
  writePersistedWorkbenchLayout,
} from "./workbenchLayoutPersistence"

interface WorkbenchRevisionInput {
  projectId: string
  workspaceId: string
  rootPath: string
  scopeKey: string
  layoutResetKey: number
  previousRevision: number
  currentRevision: number
  projects: Pick<LocalProjectsElectronAPI, "getCompletedRepair">
  isCurrent: () => boolean
  commit: (repair: ProjectOperationDTO | undefined) => void
}

/** Confirm catalog provenance before carrying private tiles/layout into a new revision. */
export async function reconcileWorkbenchRevision(input: WorkbenchRevisionInput): Promise<void> {
  const repair = await input.projects.getCompletedRepair(input.workspaceId, null, input.rootPath, input.previousRevision)
  if (!input.isCurrent()) return
  if (repair) {
    if (repair.projectId !== input.projectId || repair.details.workspaceId !== input.workspaceId ||
      repair.kind !== "repair" || repair.state !== "completed" || repair.details.sourceFolder !== input.rootPath ||
      Number(repair.details.expectedWorkspaceRevision) + 1 !== input.currentRevision) throw new Error("The saved repair no longer matches this workspace.")
    await ensureWorkbenchLayoutPersistenceReady(input.scopeKey)
    if (!input.isCurrent()) return
    const layout = peekPersistedWorkbenchLayout(input.scopeKey, input.layoutResetKey, input.previousRevision)
    if (layout) {
      writePersistedWorkbenchLayout(input.scopeKey, input.layoutResetKey, layout, input.currentRevision)
      await desktopPersistenceClient.flush()
      if (!input.isCurrent()) return
    }
  }
  input.commit(repair ?? undefined)
}
