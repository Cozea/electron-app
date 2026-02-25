import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as Y from 'yjs'
import { useConvex, useQuery } from 'convex/react'
import type { Awareness } from 'y-protocols/awareness'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useReconnectionSync, type DeleteConflict } from '@/hooks/useReconnectionSync'
import { CollabWsProvider, type CollabSessionDescriptor } from '@/lib/yjs/CollabWsProvider'
import { YConvexAwarenessProvider } from '@/lib/yjs/YConvexAwarenessProvider'
import { YConvexProvider } from '@/lib/yjs/YConvexProvider'
import { YjsIndexedDBProvider } from '@/lib/yjs/IndexedDBPersistence'
import { ProjectFilesPersistence } from '@/lib/yjs/ProjectFilesPersistence'
import { YjsProjectDoc } from '@/lib/yjs/YjsProjectDoc'

type CollabTransport = 'convex' | 'ws'

interface YjsProjectContextValue {
  yjsDoc: YjsProjectDoc | null
  awareness: Awareness | null
  isConnected: boolean
  deleteConflicts: DeleteConflict[]
  resolveDeleteConflict: (filePath: string, keepLocal: boolean) => Promise<void>
}

interface InitialSyncResponse {
  serverSnapshot: ArrayBuffer | null
  snapshotVersion: number
  snapshotCreatedAt: number
  recentUpdates: Array<{ update: ArrayBuffer; clientId: string; timestamp: number }>
  deltaUpdate?: ArrayBuffer
  deltaByteLength?: number
  serverStateVector?: ArrayBuffer
  serverTimestamp?: number
  serverSeq?: number
}

const YjsProjectContext = createContext<YjsProjectContextValue>({
  yjsDoc: null,
  awareness: null,
  isConnected: false,
  deleteConflicts: [],
  resolveDeleteConflict: async () => {},
})

function normalizeCollabTransport(raw: string | undefined): CollabTransport {
  const normalized = raw?.trim().toLowerCase()
  if (normalized === 'convex') return 'convex'
  return 'ws'
}

function generateColor(id: string): string {
  const colors = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#e879f9']
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

interface YjsProjectProviderProps {
  projectId: Id<'projects'>
  userId: Id<'users'>
  userName: string
  projectPath: string | null
  collabSession?: CollabSessionDescriptor | null
  children: ReactNode
}

export function YjsProjectProvider({
  projectId,
  userId,
  userName,
  projectPath,
  collabSession = null,
  children,
}: YjsProjectProviderProps) {
  const [yjsDoc, setYjsDoc] = useState<YjsProjectDoc | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [wsCircuitOpen, setWsCircuitOpen] = useState(false)

  const convexProviderRef = useRef<YConvexProvider | null>(null)
  const awarenessProviderRef = useRef<YConvexAwarenessProvider | null>(null)
  const wsProviderRef = useRef<CollabWsProvider | null>(null)
  const persistenceRef = useRef<ProjectFilesPersistence | null>(null)
  const indexedDBProviderRef = useRef<YjsIndexedDBProvider | null>(null)
  const lastAppliedTimestampRef = useRef(0)
  const seenUpdateIdsAtLastTimestampRef = useRef<Set<string>>(new Set())
  const convex = useConvex()

  const wsSession = useMemo<CollabSessionDescriptor | null>(() => {
    if (!collabSession) return null
    return {
      projectId: collabSession.projectId,
      roomId: collabSession.roomId,
      collabWsUrl: collabSession.collabWsUrl,
      token: collabSession.token,
      protocolVersion: collabSession.protocolVersion,
    }
  }, [
    collabSession?.projectId,
    collabSession?.roomId,
    collabSession?.collabWsUrl,
    collabSession?.token,
    collabSession?.protocolVersion,
  ])

  const collabTransport = useMemo(
    () => normalizeCollabTransport(import.meta.env.VITE_COLLAB_TRANSPORT),
    []
  )
  const shouldUseWsTransport = collabTransport === 'ws' && !!wsSession && !wsCircuitOpen
  const shouldUseConvexTail = !shouldUseWsTransport

  useEffect(() => {
    setWsCircuitOpen(false)
  }, [projectId, wsSession?.roomId, wsSession?.collabWsUrl])

  const updatesSince = shouldUseConvexTail && lastSyncTime !== null ? Math.max(0, lastSyncTime - 1) : null
  const updates = useQuery(
    api.yjs.getUpdatesSince,
    updatesSince === null ? 'skip' : { projectId, since: updatesSince }
  )
  const awarenessEntries = useQuery(
    api.yjsAwareness.getActiveAwareness,
    shouldUseConvexTail ? { projectId } : 'skip'
  )

  useEffect(() => {
    let disposed = false
    let docInstance: YjsProjectDoc | null = null

    const initDoc = async () => {
      const doc = new YjsProjectDoc(projectId)
      docInstance = doc

      indexedDBProviderRef.current = new YjsIndexedDBProvider(projectId, doc.doc)
      await indexedDBProviderRef.current.waitForSync()

      const initialSync = (await convex.mutation(api.yjs.syncWithServer, {
        projectId,
        clientId: doc.doc.clientID.toString(),
        roomId: shouldUseWsTransport ? wsSession?.roomId : undefined,
      })) as InitialSyncResponse

      if (initialSync.deltaUpdate && initialSync.deltaUpdate.byteLength > 0) {
        Y.applyUpdate(doc.doc, new Uint8Array(initialSync.deltaUpdate), 'state-vector')
      } else if (initialSync.serverSnapshot) {
        Y.applyUpdate(doc.doc, new Uint8Array(initialSync.serverSnapshot), 'snapshot')
        for (const update of initialSync.recentUpdates) {
          if (update.clientId === doc.doc.clientID.toString()) continue
          Y.applyUpdate(doc.doc, new Uint8Array(update.update), 'snapshot')
        }
      }

      doc.awareness.setLocalStateField('user', {
        id: userId,
        name: userName,
        color: generateColor(userId),
      })

      if (shouldUseWsTransport && wsSession) {
        const initialKnownSeq =
          typeof initialSync.serverSeq === 'number' && Number.isFinite(initialSync.serverSeq)
            ? Math.max(0, Math.floor(initialSync.serverSeq))
            : 0

        wsProviderRef.current = new CollabWsProvider({
          doc: doc.doc,
          awareness: doc.awareness,
          session: wsSession,
          clientType: 'electron',
          initialKnownSeq,
          onStateChange: (state) => {
            if (disposed) return
            setIsConnected(state === 'connected')
          },
          onPermanentFailure: () => {
            if (disposed) return
            setWsCircuitOpen(true)
            setIsConnected(false)
          },
        })
        wsProviderRef.current.start()
      } else {
        convexProviderRef.current = new YConvexProvider(doc.doc, projectId, convex)
        awarenessProviderRef.current = new YConvexAwarenessProvider(
          doc.doc,
          doc.awareness,
          projectId,
          convex
        )
        setIsConnected(true)
      }

      persistenceRef.current = new ProjectFilesPersistence(
        doc.files,
        projectId,
        projectPath,
        convex,
        userId,
        userName
      )

      if (disposed) {
        wsProviderRef.current?.destroy()
        wsProviderRef.current = null
        convexProviderRef.current?.destroy()
        convexProviderRef.current = null
        awarenessProviderRef.current?.destroy()
        awarenessProviderRef.current = null
        persistenceRef.current?.destroy()
        persistenceRef.current = null
        indexedDBProviderRef.current?.destroy()
        indexedDBProviderRef.current = null
        doc.destroy()
        return
      }

      setYjsDoc(doc)
      const initialSince = initialSync.serverTimestamp ?? Date.now()
      lastAppliedTimestampRef.current = initialSince
      seenUpdateIdsAtLastTimestampRef.current = new Set()
      setLastSyncTime(initialSince)
    }

    void initDoc().catch((error) => {
      if (disposed) return
      console.error('[YjsProjectProvider] Failed to initialize Yjs project provider:', error)
      setIsConnected(false)
    })

    return () => {
      disposed = true
      wsProviderRef.current?.destroy()
      wsProviderRef.current = null
      convexProviderRef.current?.destroy()
      convexProviderRef.current = null
      awarenessProviderRef.current?.destroy()
      awarenessProviderRef.current = null
      persistenceRef.current?.destroy()
      persistenceRef.current = null
      indexedDBProviderRef.current?.destroy()
      indexedDBProviderRef.current = null
      setIsConnected(false)
      setYjsDoc(null)
      docInstance?.destroy()
    }
  }, [convex, projectId, projectPath, shouldUseWsTransport, userId, userName, wsSession])

  useEffect(() => {
    if (!shouldUseConvexTail || !updates || updates.length === 0 || !convexProviderRef.current) return

    const sorted = [...updates].sort((a, b) => a.timestamp - b.timestamp)
    const toApply: typeof updates = []

    let lastTimestamp = lastAppliedTimestampRef.current
    let seenIds = seenUpdateIdsAtLastTimestampRef.current

    for (const update of sorted) {
      if (update.timestamp < lastTimestamp) continue
      if (update.timestamp > lastTimestamp) {
        lastTimestamp = update.timestamp
        seenIds = new Set()
      }
      if (seenIds.has(update._id)) continue
      seenIds.add(update._id)
      toApply.push(update)
    }

    if (toApply.length > 0) {
      convexProviderRef.current.applyRemoteUpdates(toApply)
      lastAppliedTimestampRef.current = lastTimestamp
      seenUpdateIdsAtLastTimestampRef.current = seenIds
      setLastSyncTime(lastTimestamp)
    }
  }, [shouldUseConvexTail, updates])

  useEffect(() => {
    if (!shouldUseConvexTail || !awarenessEntries || !awarenessProviderRef.current) return
    awarenessProviderRef.current.applyRemoteAwareness(awarenessEntries)
  }, [awarenessEntries, shouldUseConvexTail])

  useEffect(() => {
    if (!yjsDoc) return

    const saveSnapshot = async () => {
      const snapshot = Y.encodeStateAsUpdate(yjsDoc.doc)
      const snapshotBuffer = new ArrayBuffer(snapshot.byteLength)
      new Uint8Array(snapshotBuffer).set(snapshot)
      await convex.mutation(api.yjs.saveSnapshot, {
        projectId,
        snapshot: snapshotBuffer,
        version: Date.now(),
      })
      await convex.mutation(api.yjs.cleanupOldUpdates, {
        projectId,
        olderThan: Date.now() - 5 * 60 * 1000,
      })
    }

    const interval = window.setInterval(() => {
      void saveSnapshot().catch(() => undefined)
    }, 5 * 60 * 1000)

    return () => {
      window.clearInterval(interval)
      void saveSnapshot().catch(() => undefined)
    }
  }, [convex, projectId, yjsDoc])

  const { deleteConflicts, resolveConflict } = useReconnectionSync(projectId, yjsDoc)

  return (
    <YjsProjectContext.Provider
      value={{
        yjsDoc,
        awareness: yjsDoc?.awareness ?? null,
        isConnected,
        deleteConflicts,
        resolveDeleteConflict: resolveConflict,
      }}
    >
      {children}
    </YjsProjectContext.Provider>
  )
}

export function useYjsProject() {
  return useContext(YjsProjectContext)
}
