import { randomUUID } from "node:crypto"
import type { ProjectdCloseChoice, ProjectdClosePreflight, ProjectdMergePreview } from "@cozea/projectd-protocol"
import type { BackgroundRecoveryAccess } from "./BackgroundSessionAuth"
import { SessionBinaryObjectStore } from "./BinaryObjectStore"
import { CloudReplicaStore } from "./CloudReplicaStore"
import { SessionReplica } from "./SessionReplica"
import { SessionTransport } from "./SessionTransport"
import { SessionRoomClient, webSocketRoomConnector, type RoomConnector } from "./SessionRoomClient"

interface RecoveryOptions {
  getAccess: () => Promise<BackgroundRecoveryAccess>
  connectorFactory?: (url: string) => RoomConnector
  fetchFn?: typeof fetch
  previewMerge?: (checkpointOid: string, unsavedChanges: number) => Promise<ProjectdMergePreview>
}

/** Short-lived connections and an isolated replica; never watches or writes a workspace. */
export class SessionRecoveryCoordinator {
  private review: { value: ProjectdClosePreflight; pauseFenceId: string } | null = null
  private readonly options: RecoveryOptions
  constructor(options: RecoveryOptions) { this.options = options }

  private async connected<T>(work: (client: SessionRoomClient, cloud: CloudReplicaStore) => Promise<T>): Promise<T> {
    const access = await this.options.getAccess()
    if (access.ticket.sessionAccess !== "paused_close" || access.ticket.role !== "project_manager") {
      throw new Error("A scoped manager ticket is required for paused Close")
    }
    const previousRoomKeys = Object.fromEntries(Object.entries(access.previousRoomKeysBase64)
      .map(([version, key]) => [version, Buffer.from(key, "base64")]))
    const replica = new SessionReplica(access.publicSessionId, `recovery_${randomUUID()}`)
    const keyOptions = { sessionId: access.publicSessionId, roomKey: Buffer.from(access.roomKeyBase64, "base64"),
      roomKeyVersion: access.roomKeyVersion, previousRoomKeys }
    const cloud = new CloudReplicaStore(access.publicSessionId, new SessionBinaryObjectStore({ ...keyOptions,
      getRoomUrl: () => access.ticket.wsUrl, getToken: async () => access.ticket.token, fetchFn: this.options.fetchFn }))
    const client = new SessionRoomClient({ transport: new SessionTransport({ ...keyOptions, replica }),
      connect: (this.options.connectorFactory ?? webSocketRoomConnector)(access.ticket.wsUrl),
      getToken: async () => access.ticket.token, loadSnapshot: (record) => cloud.download(record) })
    try {
      await client.connect()
      return await work(client, cloud)
    } finally { client.disconnect() }
  }

  async prepareClose(): Promise<ProjectdClosePreflight> {
    this.review = null
    return this.connected(async (client, cloud) => {
      const lifecycle = await client.getLifecycleState()
      const fence = lifecycle.fence
      const pauseFenceId = fence?.intent === "pause" ? fence.fenceId : lifecycle.pausedClose?.pauseFenceId
      const snapshot = await client.getSnapshot()
      if (!fence || !pauseFenceId || !snapshot || snapshot.barrierId !== fence.barrierId ||
        snapshot.sessionSeq !== fence.sessionSeq || snapshot.keyVersion !== fence.keyVersion) {
        throw new Error("A retained paused snapshot is required; refresh the session lifecycle")
      }
      const retained = await cloud.download(snapshot)
      const replica = new SessionReplica(retained.sessionId, `review_${randomUUID()}`)
      replica.restoreSnapshot(retained)
      const conflicts = replica.detectConflicts()
      let merge: ProjectdMergePreview | null = null
      let mergeUnavailable: string | null = "No Git target is available on this device."
      const checkpoint = client.autoGitState?.checkpoint
      if (checkpoint && this.options.previewMerge) {
        try {
          merge = await this.options.previewMerge(checkpoint.commitOid,
            Math.max(0, fence.sessionSeq - (fence.gitSavedThroughSeq ?? 0)))
          mergeUnavailable = null
        } catch { mergeUnavailable = "The retained checkpoint could not be compared with the target branch." }
      }
      const current = await client.getLifecycleFence()
      if (current?.fenceId !== fence.fenceId) throw new Error("The paused session changed during review")
      const value: ProjectdClosePreflight = { publicSessionId: retained.sessionId, reviewId: randomUUID(),
        sessionSeq: fence.sessionSeq, gitSavedThroughSeq: fence.gitSavedThroughSeq,
        gitLag: fence.gitSavedThroughSeq === null || fence.gitSavedThroughSeq < fence.sessionSeq,
        conflicts: { pathCollisions: conflicts.pathCollisions.length, concurrentRenames: conflicts.concurrentRenames.length,
          deleteModify: conflicts.deleteModifyConflicts.length, binary: conflicts.binaryConflicts.length }, merge, mergeUnavailable }
      this.review = { value, pauseFenceId }
      return value
    })
  }

  async closeSession(choice: ProjectdCloseChoice): Promise<{ gitLag: boolean }> {
    const review = this.review
    if (!review || review.value.reviewId !== choice.reviewId) throw new Error("Review the retained session before closing")
    if (review.value.gitLag && choice.allowUnpublishedGit !== true) throw new Error("Confirm closing with unpublished Git changes")
    if (Object.values(review.value.conflicts).some((count) => count > 0) && choice.allowUnresolvedConflicts !== true) {
      throw new Error("Confirm closing with unresolved conflicts")
    }
    return this.connected(async (client) => {
      const snapshot = await client.getSnapshot()
      if (!snapshot || snapshot.sessionSeq !== review.value.sessionSeq) throw new Error("The retained snapshot changed; review again")
      await client.closePausedSession(review.pauseFenceId, snapshot.barrierId, choice.allowUnpublishedGit)
      return { gitLag: review.value.gitLag }
    })
  }
}
