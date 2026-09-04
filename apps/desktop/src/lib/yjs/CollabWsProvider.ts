import {
  CollabWsProvider as BaseCollabWsProvider,
  type CollabSessionDescriptor,
  type CollaborationConnectionState,
} from "@/features/collaboration/runtime/CollaborationTransport"
import { registerCollaborationRuntime } from "@/features/collaboration/runtime/CollaborationRuntimeRegistry"

export type { CollabSessionDescriptor, CollaborationConnectionState }

type ProviderOptions = ConstructorParameters<typeof BaseCollabWsProvider>[0]

/**
 * Compatibility export used by the existing project runtime. Explicit v2
 * sessions additionally publish their transport and Y.Doc into the feature
 * registry so project chrome can perform barrier-consistent Commit and media
 * actions without leaking transport details into React context values.
 */
export class CollabWsProvider extends BaseCollabWsProvider {
  private readonly registryOptions: ProviderOptions
  private unregisterRuntime: (() => void) | null = null

  constructor(options: ProviderOptions) {
    super(options)
    this.registryOptions = options
  }

  override start(): void {
    super.start()
    const sessionId = this.registryOptions.session.sessionId
    if (sessionId) {
      this.unregisterRuntime = registerCollaborationRuntime({
        projectId: this.registryOptions.session.projectId,
        sessionId,
        provider: this,
        document: this.registryOptions.doc,
      })
    }
  }

  override destroy(): void {
    this.unregisterRuntime?.()
    this.unregisterRuntime = null
    super.destroy()
  }
}
