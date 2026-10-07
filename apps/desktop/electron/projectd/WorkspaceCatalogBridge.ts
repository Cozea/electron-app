import type { WorkspaceCatalogSnapshot } from "../../../../shared/workspaceTypes.ts"
import type { ProjectdWorkspaceRecord, ProjectdWorkspaceRegistration } from "../../../../shared/projectdWorkspaceTypes.ts"

interface WorkspaceCatalogBridgeDependencies {
  register: (request: ProjectdWorkspaceRegistration) => Promise<ProjectdWorkspaceRecord>
  onError: (workspaceId: string, error: string) => void
}

/** Reconciles verified catalog bindings; omission never deletes daemon state. */
export class WorkspaceCatalogBridge {
  private readonly acknowledged = new Map<string, string>()
  private next: WorkspaceCatalogSnapshot | null = null
  private running: Promise<void> | null = null
  private newestRevision = -1
  private stopped = false
  private readonly deps: WorkspaceCatalogBridgeDependencies

  constructor(deps: WorkspaceCatalogBridgeDependencies) { this.deps = deps }

  enqueue(snapshot: WorkspaceCatalogSnapshot): Promise<void> {
    if (this.stopped || snapshot.revision < this.newestRevision) return Promise.resolve()
    this.newestRevision = snapshot.revision
    this.next = snapshot
    if (!this.running) this.running = this.drain().finally(() => {
      this.running = null
      if (this.next && !this.stopped) return this.enqueue(this.next)
    })
    return this.running
  }

  /** A new daemon process must receive bindings even if the catalog is unchanged. */
  resetAcknowledgments(): void { this.acknowledged.clear() }

  stop(): void { this.stopped = true; this.next = null }

  private async drain(): Promise<void> {
    while (this.next && !this.stopped) {
      const snapshot = this.next
      this.next = null
      for (const { workspace } of Object.values(snapshot.entries)) {
        if (this.stopped) return
        if (workspace.verificationStatus !== "verified") continue
        const request: ProjectdWorkspaceRegistration = {
          workspaceId: workspace.workspaceId, projectId: workspace.projectId,
          rootPath: workspace.rootPath, projectRootPath: workspace.projectRootPath,
          projectRootRelativePath: workspace.projectRootRelativePath,
          gitRootPath: workspace.gitRootPath, gitOriginUrl: workspace.gitOriginUrl,
          source: workspace.source, storageOwnership: workspace.storageOwnership,
          managedRootId: workspace.managedRootId, markerPolicy: workspace.markerPolicy,
          workspaceRevision: workspace.workspaceRevision,
        }
        const fingerprint = JSON.stringify(request)
        if (this.acknowledged.get(workspace.workspaceId) === fingerprint) continue
        try {
          const registered = await this.deps.register(request)
          if (registered.workspaceId !== request.workspaceId || registered.projectId !== request.projectId ||
            registered.workspaceRevision !== request.workspaceRevision || registered.rootPath !== request.rootPath ||
            registered.projectRootPath !== request.projectRootPath || registered.gitRootPath !== request.gitRootPath ||
            registered.projectRootRelativePath !== request.projectRootRelativePath ||
            registered.storageOwnership !== request.storageOwnership || registered.managedRootId !== request.managedRootId ||
            registered.markerPolicy !== request.markerPolicy) throw new Error("Daemon registration did not match the current catalog binding")
          this.acknowledged.set(workspace.workspaceId, fingerprint)
        } catch (error) {
          this.deps.onError(workspace.workspaceId, error instanceof Error ? error.message : String(error))
        }
      }
    }
  }
}
