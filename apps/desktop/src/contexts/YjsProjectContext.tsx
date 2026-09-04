import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import * as Y from "yjs"
import { useConvex } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { seedProjectDocFromWorkspace } from "@/features/collaboration/runtime/seedProjectDocFromWorkspace"
import { useReconnectionSync } from "@/hooks/useReconnectionSync"
import { CollabWsProvider, type CollabSessionDescriptor } from "@/lib/yjs/CollabWsProvider"
import { YjsIndexedDBProvider } from "@/lib/yjs/IndexedDBPersistence"
import { ProjectFilesPersistence } from "@/lib/yjs/ProjectFilesPersistence"
import { YjsProjectDoc } from "@/lib/yjs/YjsProjectDoc"
import { EncryptedLocalSnapshotStore } from "@/lib/collab/EncryptedLocalSnapshotStore"
import {
  bytesToEnvelope,
  decryptPayload,
  encryptPayload,
  envelopeToBytes,
  generateRoomKeyBase64,
} from "@/lib/collab/cipherEnvelope"
import { YjsProjectContext } from "@/contexts/YjsProjectContextValue"

export {
  EMPTY_YJS_PROJECT_CONTEXT_VALUE,
  YjsProjectContextBridgeProvider,
  useYjsProject,
  type YjsProjectContextValue,
} from "@/contexts/YjsProjectContextValue"

interface InitialSyncResponse {
  serverSnapshot: ArrayBuffer | null
  snapshotVersion: number
  snapshotCreatedAt: number
  recentUpdates: Array<{
    update: ArrayBuffer
    clientId: string
    timestamp: number
  }>
  deltaUpdate?: ArrayBuffer
  deltaByteLength?: number
  serverStateVector?: ArrayBuffer
  serverTimestamp?: number
  serverSeq?: number
}

interface RoomEncryptionState {
  encryptionEnabled: boolean
  roomKeyBase64: string | null
  keyVersion: number | null
}

interface YjsProjectProviderProps {
  projectId: Id<"projects">
  userId: Id<"users">
  userName: string
  workspaceId: string | null
  enabled?: boolean
  documentScopeId?: string | null
  collaborationEnabled?: boolean
  collabSession?: CollabSessionDescriptor | null
  refreshCollabSession?: () => Promise<CollabSessionDescriptor | null>
  children: ReactNode
}

const SNAPSHOT_DEBOUNCE_MS = 1_200
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1_000
const SNAPSHOT_CLEANUP_BATCH_SIZE = 128

function generateColor(id: string): string {
  const colors = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#818cf8", "#e879f9"]
  const hash = id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function normalizeSequence(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0
}

function hasServerState(sync: InitialSyncResponse): boolean {
  return Boolean(
    sync.serverSnapshot ||
      sync.recentUpdates.length > 0 ||
      normalizeSequence(sync.serverSeq) > 0,
  )
}

function randomDebugId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function YjsProjectProvider({
  projectId,
  userId,
  userName,
  workspaceId,
  enabled = true,
  documentScopeId = null,
  collaborationEnabled = true,
  collabSession = null,
  refreshCollabSession,
  children,
}: YjsProjectProviderProps) {
  const [yjsDoc, setYjsDoc] = useState<YjsProjectDoc | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [roomEncryption, setRoomEncryption] = useState<RoomEncryptionState | null>(null)

  const wsProviderRef = useRef<CollabWsProvider | null>(null)
  const persistenceRef = useRef<ProjectFilesPersistence | null>(null)
  const indexedDBProviderRef = useRef<YjsIndexedDBProvider | null>(null)
  const initialKnownSeqRef = useRef(0)
  const wsSessionRef = useRef<CollabSessionDescriptor | null>(null)
  const encryptedLocalStoreRef = useRef<EncryptedLocalSnapshotStore | null>(null)
  const wsProviderLifecycleIdRef = useRef<string | null>(null)
  const convex = useConvex()

  const scopeKey = useMemo(() => {
    const trimmed = documentScopeId?.trim()
    return trimmed || String(projectId)
  }, [documentScopeId, projectId])

  const wsSession = useMemo<CollabSessionDescriptor | null>(() => {
    if (!collabSession || !collaborationEnabled) return null
    return {
      projectId: collabSession.projectId,
      roomId: collabSession.roomId,
      collabWsUrl: collabSession.collabWsUrl,
      token: collabSession.token,
      protocolVersion: collabSession.protocolVersion,
      deviceId: collabSession.deviceId,
      deviceFingerprint: collabSession.deviceFingerprint,
      devicePublicKeyJwk: collabSession.devicePublicKeyJwk,
      encryption: collabSession.encryption,
    }
  }, [collabSession, collaborationEnabled])
  const canRunCollaborationSync = collaborationEnabled && Boolean(wsSession)

  useEffect(() => {
    wsSessionRef.current = wsSession
  }, [wsSession])

  const destroyTransportProvider = useCallback(() => {
    wsProviderRef.current?.destroy()
    wsProviderRef.current = null
    wsProviderLifecycleIdRef.current = null
  }, [])

  const destroyPersistenceForInit = useCallback((args: {
    doc: YjsProjectDoc | null
    indexedDBProvider: YjsIndexedDBProvider | null
    persistence: ProjectFilesPersistence | null
  }) => {
    destroyTransportProvider()
    args.persistence?.destroy()
    if (persistenceRef.current === args.persistence) {
      persistenceRef.current = null
    }
    args.indexedDBProvider?.destroy()
    if (indexedDBProviderRef.current === args.indexedDBProvider) {
      indexedDBProviderRef.current = null
    }
    args.doc?.destroy()
  }, [destroyTransportProvider])

  useEffect(() => {
    let disposed = false
    let docInstance: YjsProjectDoc | null = null
    let indexedDBProviderInstance: YjsIndexedDBProvider | null = null
    let persistenceInstance: ProjectFilesPersistence | null = null

    if (!enabled) return

    const initializeDocument = async () => {
      const doc = new YjsProjectDoc(scopeKey)
      docInstance = doc

      const shouldUseIndexedDb =
        !collaborationEnabled ||
        (wsSession ? wsSession.encryption.encryptionRequired !== true : false)

      if (shouldUseIndexedDb) {
        const indexedDBProvider = new YjsIndexedDBProvider(scopeKey, doc.doc)
        indexedDBProviderInstance = indexedDBProvider
        indexedDBProviderRef.current = indexedDBProvider
        await indexedDBProvider.waitForSync()
      } else {
        indexedDBProviderRef.current = null
      }

      doc.awareness.setLocalStateField("user", {
        id: userId,
        name: userName,
        color: generateColor(userId),
      })

      const persistence = new ProjectFilesPersistence(
        doc.files,
        projectId,
        workspaceId,
        convex,
        userId,
        userName,
      )
      persistenceInstance = persistence
      persistenceRef.current = persistence

      if (disposed) {
        destroyPersistenceForInit({
          doc,
          indexedDBProvider: indexedDBProviderInstance,
          persistence,
        })
        return
      }

      setYjsDoc(doc)
    }

    void initializeDocument().catch((error) => {
      if (disposed) return
      destroyPersistenceForInit({
        doc: docInstance,
        indexedDBProvider: indexedDBProviderInstance,
        persistence: persistenceInstance,
      })
      console.error("[YjsProjectProvider] Failed to initialize project document:", error)
      setIsConnected(false)
      setYjsDoc(null)
    })

    return () => {
      disposed = true
      destroyPersistenceForInit({
        doc: docInstance,
        indexedDBProvider: indexedDBProviderInstance,
        persistence: persistenceInstance,
      })
      setIsConnected(false)
      setYjsDoc(null)
      setRoomEncryption(null)
      encryptedLocalStoreRef.current = null
    }
  }, [
    collaborationEnabled,
    convex,
    destroyPersistenceForInit,
    enabled,
    projectId,
    scopeKey,
    userId,
    userName,
    workspaceId,
    wsSession?.encryption.encryptionRequired,
  ])

  const resolveRoomEncryptionState = useCallback(async (
    session: CollabSessionDescriptor,
  ): Promise<RoomEncryptionState | null> => {
    if (!session.encryption.encryptionRequired) {
      return {
        encryptionEnabled: false,
        roomKeyBase64: null,
        keyVersion: null,
      }
    }

    if (session.encryption.status === "room_not_initialized") {
      if (!session.devicePublicKeyJwk) {
        throw new Error("Missing local collaboration device public key")
      }

      const roomKeyBase64 = generateRoomKeyBase64()
      const wrapped = await window.electronAPI.collab.wrapRoomKey({
        roomKeyBase64,
        recipientPublicKeyJwk: session.devicePublicKeyJwk,
      })
      await convex.mutation(api.yjs.initializeEncryptedRoom, {
        projectId,
        roomId: session.roomId,
        userId,
        deviceId: session.deviceId,
        keyVersion: session.encryption.activeKeyVersion ?? 1,
        wrapAlgorithm: wrapped.wrapAlgorithm,
        wrappedKey: wrapped.wrappedKey,
        senderPublicKeyJwk: wrapped.senderPublicKeyJwk,
      })

      return {
        encryptionEnabled: true,
        roomKeyBase64,
        keyVersion: session.encryption.activeKeyVersion ?? 1,
      }
    }

    if (session.encryption.status === "ready") {
      if (!session.encryption.wrappedRoomKey || !session.encryption.senderPublicKeyJwk) {
        throw new Error("Encrypted collaboration room is missing wrapped key metadata")
      }

      const unwrapped = await window.electronAPI.collab.unwrapRoomKey({
        senderPublicKeyJwk: session.encryption.senderPublicKeyJwk,
        wrappedKey: session.encryption.wrappedRoomKey,
        wrapAlgorithm: session.encryption.wrapAlgorithm ?? undefined,
      })
      return {
        encryptionEnabled: true,
        roomKeyBase64: unwrapped.roomKeyBase64,
        keyVersion: session.encryption.activeKeyVersion ?? 1,
      }
    }

    if (session.encryption.status === "missing_for_device") {
      if (session.devicePublicKeyJwk) {
        await convex.mutation(api.yjs.createKeyRequest, {
          projectId,
          roomId: session.roomId,
          recipientUserId: userId,
          recipientDeviceId: session.deviceId,
          recipientPublicKeyJwk: session.devicePublicKeyJwk,
          recipientFingerprint: session.deviceFingerprint ?? session.deviceId,
        })
      }
      return null
    }

    return null
  }, [convex, projectId, userId])

  useEffect(() => {
    if (!enabled || !yjsDoc) return

    let disposed = false
    destroyTransportProvider()
    setIsConnected(false)
    setRoomEncryption(null)

    const persistBootstrapSnapshot = async (
      encryption: RoomEncryptionState,
      session: CollabSessionDescriptor,
      snapshotBaseSeq: number,
    ) => {
      if (!encryption.encryptionEnabled || !encryption.roomKeyBase64) return

      const envelope = await encryptPayload({
        roomKeyBase64: encryption.roomKeyBase64,
        kind: "yjs_snapshot",
        keyVersion: encryption.keyVersion ?? 1,
        plaintext: Y.encodeStateAsUpdate(yjsDoc.doc),
        metadata: {
          projectId: String(projectId),
          roomId: session.roomId,
          snapshotBaseSeq,
        },
      })

      const store = encryptedLocalStoreRef.current ?? new EncryptedLocalSnapshotStore()
      encryptedLocalStoreRef.current = store
      await store.save({
        scopeKey,
        keyVersion: encryption.keyVersion ?? 1,
        envelopeJson: JSON.stringify(envelope),
        updatedAt: Date.now(),
      })

      const snapshotBytes = envelopeToBytes(envelope)
      await convex.mutation(api.yjs.saveSnapshot, {
        projectId,
        snapshot: toArrayBuffer(snapshotBytes),
        version: Date.now(),
        snapshotBaseSeq,
        createdByClientId: yjsDoc.doc.clientID.toString(),
      })
    }

    const bootstrapCollaborationState = async () => {
      if (!collaborationEnabled) {
        initialKnownSeqRef.current = 0
        setRoomEncryption({
          encryptionEnabled: false,
          roomKeyBase64: null,
          keyVersion: null,
        })
        return
      }

      const session = wsSessionRef.current
      if (!session) return

      const encryption = await resolveRoomEncryptionState(session)
      if (disposed || !encryption) return

      if (encryption.encryptionEnabled && encryption.roomKeyBase64) {
        const localStore = new EncryptedLocalSnapshotStore()
        encryptedLocalStoreRef.current = localStore
        const localSnapshot = await localStore.load(scopeKey)
        if (disposed) return

        if (localSnapshot?.envelopeJson) {
          try {
            const decrypted = await decryptPayload({
              roomKeyBase64: encryption.roomKeyBase64,
              envelope: JSON.parse(localSnapshot.envelopeJson),
              expectedKind: "yjs_snapshot",
            })
            Y.applyUpdate(yjsDoc.doc, decrypted, "snapshot")
          } catch (error) {
            console.warn("[YjsProjectProvider] Failed to restore encrypted local snapshot:", error)
          }
        }
      } else {
        encryptedLocalStoreRef.current = null
      }

      const initialSync = await convex.mutation(api.yjs.syncWithServer, {
        projectId,
        clientId: yjsDoc.doc.clientID.toString(),
        roomId: session.roomId,
      }) as InitialSyncResponse
      if (disposed) return

      if (encryption.encryptionEnabled && encryption.roomKeyBase64) {
        if (initialSync.serverSnapshot) {
          const decryptedSnapshot = await decryptPayload({
            roomKeyBase64: encryption.roomKeyBase64,
            envelope: bytesToEnvelope(new Uint8Array(initialSync.serverSnapshot)),
            expectedKind: "yjs_snapshot",
          })
          Y.applyUpdate(yjsDoc.doc, decryptedSnapshot, "snapshot")
        }

        for (const update of initialSync.recentUpdates) {
          if (update.clientId === yjsDoc.doc.clientID.toString()) continue
          const decryptedUpdate = await decryptPayload({
            roomKeyBase64: encryption.roomKeyBase64,
            envelope: bytesToEnvelope(new Uint8Array(update.update)),
            expectedKind: "yjs_update",
          })
          Y.applyUpdate(yjsDoc.doc, decryptedUpdate, "snapshot")
        }
      }

      const serverSeq = normalizeSequence(initialSync.serverSeq)
      initialKnownSeqRef.current = serverSeq

      if (!hasServerState(initialSync)) {
        const seedResult = await seedProjectDocFromWorkspace({
          doc: yjsDoc,
          workspaceId,
        })
        if (disposed) return

        if (seedResult.failedFiles > 0) {
          console.warn("[YjsProjectProvider] Some project files could not seed collaboration:", seedResult)
        }

        if (yjsDoc.files.size > 0) {
          await persistBootstrapSnapshot(encryption, session, serverSeq)
        }
      }

      if (!disposed) {
        setRoomEncryption(encryption)
      }
    }

    void bootstrapCollaborationState().catch((error) => {
      if (disposed) return
      console.error("[YjsProjectProvider] Failed to bootstrap collaboration state:", error)
      setRoomEncryption(null)
      setIsConnected(false)
    })

    return () => {
      disposed = true
    }
  }, [
    collaborationEnabled,
    convex,
    destroyTransportProvider,
    enabled,
    projectId,
    resolveRoomEncryptionState,
    scopeKey,
    workspaceId,
    yjsDoc,
    wsSession?.projectId,
    wsSession?.roomId,
    wsSession?.encryption.status,
    wsSession?.encryption.activeKeyVersion,
    wsSession?.encryption.wrappedRoomKey,
    wsSession?.token,
  ])

  useEffect(() => {
    if (!enabled || !yjsDoc) return

    let disposed = false
    destroyTransportProvider()

    if (!collaborationEnabled) {
      setIsConnected(false)
      return
    }

    const session = wsSessionRef.current
    if (!session) {
      setIsConnected(false)
      return
    }

    if (session.encryption.encryptionRequired && !roomEncryption?.encryptionEnabled) {
      setIsConnected(false)
      return
    }

    const provider = new CollabWsProvider({
      doc: yjsDoc.doc,
      awareness: yjsDoc.awareness,
      session,
      clientType: "electron",
      initialKnownSeq: initialKnownSeqRef.current,
      refreshSession: refreshCollabSession,
      encryption: roomEncryption?.encryptionEnabled && roomEncryption.roomKeyBase64
        ? {
            roomKeyBase64: roomEncryption.roomKeyBase64,
            keyVersion: roomEncryption.keyVersion ?? 1,
          }
        : null,
      onStateChange: (state, error) => {
        if (disposed) return
        if (error) {
          console.warn("[YjsProjectProvider] Collaboration transport state change", {
            projectId: String(projectId),
            state,
            error,
          })
        }
        setIsConnected(state === "connected")
      },
      onPermanentFailure: (reason) => {
        if (disposed) return
        console.warn("[YjsProjectProvider] Collaboration websocket failed", {
          projectId: String(projectId),
          lifecycleId: wsProviderLifecycleIdRef.current,
          reason,
        })
        setIsConnected(false)
      },
    })

    wsProviderRef.current = provider
    wsProviderLifecycleIdRef.current = randomDebugId("yjs_ws_provider")
    provider.start()

    return () => {
      disposed = true
      destroyTransportProvider()
      setIsConnected(false)
    }
  }, [
    collaborationEnabled,
    destroyTransportProvider,
    enabled,
    projectId,
    refreshCollabSession,
    roomEncryption?.encryptionEnabled,
    roomEncryption?.roomKeyBase64,
    roomEncryption?.keyVersion,
    yjsDoc,
    wsSession?.projectId,
    wsSession?.roomId,
    wsSession?.collabWsUrl,
    wsSession?.protocolVersion,
    wsSession?.token,
    wsSession?.encryption.encryptionRequired,
  ])

  useEffect(() => {
    if (
      !enabled ||
      !collaborationEnabled ||
      !refreshCollabSession ||
      wsSession?.encryption.status !== "missing_for_device"
    ) {
      return
    }

    const interval = window.setInterval(() => {
      void refreshCollabSession().catch(() => undefined)
    }, 3_000)

    return () => window.clearInterval(interval)
  }, [collaborationEnabled, enabled, refreshCollabSession, wsSession?.encryption.status])

  useEffect(() => {
    if (!enabled || !yjsDoc) return

    let snapshotTimer: number | null = null

    const persistSnapshot = async (persistServer: boolean) => {
      if (!roomEncryption?.encryptionEnabled || !roomEncryption.roomKeyBase64) return

      const snapshotBaseSeq = wsProviderRef.current?.getKnownSeq() ?? initialKnownSeqRef.current
      const snapshot = Y.encodeStateAsUpdate(yjsDoc.doc)
      const envelope = await encryptPayload({
        roomKeyBase64: roomEncryption.roomKeyBase64,
        kind: "yjs_snapshot",
        keyVersion: roomEncryption.keyVersion ?? 1,
        plaintext: snapshot,
        metadata: {
          projectId: String(projectId),
          roomId: wsSession?.roomId ?? String(projectId),
          snapshotBaseSeq,
        },
      })

      await encryptedLocalStoreRef.current?.save({
        scopeKey,
        keyVersion: roomEncryption.keyVersion ?? 1,
        envelopeJson: JSON.stringify(envelope),
        updatedAt: Date.now(),
      })

      if (!persistServer || !collaborationEnabled) return

      const snapshotBytes = envelopeToBytes(envelope)
      await convex.mutation(api.yjs.saveSnapshot, {
        projectId,
        snapshot: toArrayBuffer(snapshotBytes),
        version: Date.now(),
        snapshotBaseSeq,
        createdByClientId: yjsDoc.doc.clientID.toString(),
      })
      await convex.mutation(api.yjsMaintenance.cleanupUpdatesThroughSeq, {
        projectId,
        throughSeq: snapshotBaseSeq,
        limit: SNAPSHOT_CLEANUP_BATCH_SIZE,
      })
    }

    const handleDocUpdate = () => {
      if (!roomEncryption?.encryptionEnabled) return
      if (snapshotTimer !== null) window.clearTimeout(snapshotTimer)
      snapshotTimer = window.setTimeout(() => {
        void persistSnapshot(false).catch(() => undefined)
      }, SNAPSHOT_DEBOUNCE_MS)
    }

    yjsDoc.doc.on("update", handleDocUpdate)
    const interval = window.setInterval(() => {
      void persistSnapshot(true).catch(() => undefined)
    }, SNAPSHOT_INTERVAL_MS)

    return () => {
      yjsDoc.doc.off("update", handleDocUpdate)
      if (snapshotTimer !== null) window.clearTimeout(snapshotTimer)
      window.clearInterval(interval)
      void persistSnapshot(true).catch(() => undefined)
    }
  }, [
    collaborationEnabled,
    convex,
    enabled,
    projectId,
    roomEncryption?.encryptionEnabled,
    roomEncryption?.keyVersion,
    roomEncryption?.roomKeyBase64,
    scopeKey,
    wsSession?.roomId,
    yjsDoc,
  ])

  const { deleteConflicts, resolveConflict } = useReconnectionSync(
    canRunCollaborationSync ? projectId : null,
    canRunCollaborationSync ? yjsDoc : null,
  )

  const contextValue = useMemo(
    () => ({
      yjsDoc,
      awareness: yjsDoc?.awareness ?? null,
      isConnected,
      deleteConflicts,
      resolveDeleteConflict: resolveConflict,
    }),
    [yjsDoc, isConnected, deleteConflicts, resolveConflict],
  )

  return (
    <YjsProjectContext.Provider value={contextValue}>
      {children}
    </YjsProjectContext.Provider>
  )
}
