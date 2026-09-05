import { CollabWsProvider as SharedCollaborationTransport } from "@shared/CollaborationTransport"
import { EncryptedCollabOutbox } from "../persistence/EncryptedCollabOutbox"
import { invalidateCollabSession } from "../hooks/useCollabSession"
import { ensureActiveCheckpointGroup } from "@/lib/yjs/checkpointGroups"
export type { CollaborationConnectionState, CollabSessionDescriptor } from "@shared/CollaborationTransport"

type TransportOptions = ConstructorParameters<typeof SharedCollaborationTransport>[0]
/** Legacy renderer adapter; session orchestration also runs in Electron main. */
export class CollabWsProvider extends SharedCollaborationTransport {
  constructor(args: Omit<TransportOptions, "outbox"> & { outbox?: TransportOptions["outbox"] }) {
    super({ ...args, outbox: args.outbox ?? new EncryptedCollabOutbox(),
      onInvalidated: invalidateCollabSession, getCheckpointGroup: ensureActiveCheckpointGroup })
  }
}
