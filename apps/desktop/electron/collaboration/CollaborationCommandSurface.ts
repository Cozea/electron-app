import type { CollaborationDesktopAPI } from "../../../../shared/collaborationDesktop"
import type { CollaborationRuntimeAPI } from "../../../../shared/collaborationRuntime"
import type { SessionRuntimeHost } from "./SessionRuntimeHost"

// These are discovery / pre-open membership operations, not local lifecycle or
// publication shortcuts. Lease, leave, close and publication commands stay owned
// by the host even when an older renderer uses the generic control channel.
const rendererControlOperations = new Set(["getSession", "listForProject", "listParticipants", "startSession", "activateSession", "joinSession"])
type Host = Pick<SessionRuntimeHost, "withRuntime" | "control" | "open" | "retry" | "leave" | "prepareCommit" | "push" | "discard" | "importChanges" | "prepareBinding" | "leaveBinding" | "adoptPublished">
type RuntimeCommands = Pick<CollaborationRuntimeAPI, "control" | "open" | "retry" | "leave" | "openFile" | "edit" | "createFile" | "renameFile" | "deleteFile" | "restoreFile" | "resolveRecovered" | "commit" | "push" | "discard" | "importChanges">
type LegacyCommands = Pick<CollaborationDesktopAPI, "prepare" | "leave" | "adoptPublished">

/** The registered IPC surface and its behavioral tests use these same adapters. */
export function createCollaborationCommandSurface(host: Host): { runtime: RuntimeCommands; legacy: LegacyCommands } {
  return {
    runtime: {
      control: input => {
        if (!rendererControlOperations.has(input.operation)) return Promise.reject(new Error("Use the session runtime for lifecycle and publication operations"))
        return host.control(input.operation, input.args)
      },
      open: input => host.open(input.sessionId, input.sourceWorkspaceId),
      retry: id => host.retry(id),
      leave: input => host.leave(input.sessionId, input.end ?? false),
      openFile: input => host.withRuntime(input.sessionId, runtime => runtime.openFile(input.path)),
      edit: input => host.withRuntime(input.sessionId, runtime => runtime.applyEditorUpdate(input.update)),
      createFile: input => host.withRuntime(input.sessionId, runtime => runtime.createFile(input.path, input.content)),
      renameFile: input => host.withRuntime(input.sessionId, runtime => runtime.renameFile(input.fileId, input.path)),
      deleteFile: input => host.withRuntime(input.sessionId, runtime => runtime.deleteFile(input.fileId)),
      restoreFile: input => host.withRuntime(input.sessionId, runtime => runtime.restoreFile(input.fileId, input.path)),
      resolveRecovered: input => host.withRuntime(input.sessionId, runtime => runtime.resolveRecovered(input)),
      commit: input => host.withRuntime(input.sessionId, () => host.prepareCommit(input)),
      push: input => host.withRuntime(input.sessionId, () => host.push(input)),
      discard: id => host.withRuntime(id, () => host.discard(id)),
      importChanges: input => host.withRuntime(input.sessionId, () => host.importChanges(input.sessionId, input.selected)),
    },
    legacy: {
      // Compatibility shapes remain, but renderer tokens and protected-path
      // arrays are deliberately not forwarded to the coordinator.
      prepare: input => host.prepareBinding(input.sessionId, input.sourceWorkspaceId),
      leave: input => host.leaveBinding(input.sessionId, input.ended ?? false),
      adoptPublished: input => host.adoptPublished(input.sessionId),
    },
  }
}
