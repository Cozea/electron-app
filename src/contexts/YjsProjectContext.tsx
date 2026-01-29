import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react'
import * as Y from 'yjs'
import { useQuery, useConvex } from 'convex/react'
import xxhashInit, { type XXHashAPI } from 'xxhash-wasm'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { YjsProjectDoc } from '@/lib/yjs/YjsProjectDoc'
import { YConvexProvider } from '@/lib/yjs/YConvexProvider'
import { ProjectFilesPersistence } from '@/lib/yjs/ProjectFilesPersistence'
import { YConvexAwarenessProvider } from '@/lib/yjs/YConvexAwarenessProvider'
import type { Awareness } from 'y-protocols/awareness'

interface YjsProjectContextValue {
  yjsDoc: YjsProjectDoc | null
  awareness: Awareness | null
  isConnected: boolean
}

const YjsProjectContext = createContext<YjsProjectContextValue>({
  yjsDoc: null,
  awareness: null,
  isConnected: false,
})

/**
 * Generate a consistent color from a string (user ID).
 */
function generateColor(id: string): string {
  const colors = [
    '#f87171', // red
    '#fb923c', // orange
    '#facc15', // yellow
    '#4ade80', // green
    '#22d3ee', // cyan
    '#818cf8', // indigo
    '#e879f9', // pink
  ]
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

interface YjsProjectProviderProps {
  projectId: Id<"projects">
  userId: Id<"users">
  userName: string
  children: ReactNode
}

/**
 * YjsProjectProvider - Manages Yjs document for a project.
 *
 * Initializes the Y.Doc, sets up awareness with user info,
 * and syncs updates via Convex subscriptions.
 */
export function YjsProjectProvider({
  projectId,
  userId,
  userName,
  children,
}: YjsProjectProviderProps) {
  const [yjsDoc, setYjsDoc] = useState<YjsProjectDoc | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null)
  const [hasher, setHasher] = useState<XXHashAPI | null>(null)
  const providerRef = useRef<YConvexProvider | null>(null)
  const awarenessProviderRef = useRef<YConvexAwarenessProvider | null>(null)
  const persistenceRef = useRef<ProjectFilesPersistence | null>(null)
  const lastAppliedTimestampRef = useRef(0)
  const seenUpdateIdsAtLastTimestampRef = useRef<Set<string>>(new Set())
  const convex = useConvex()

  // Initialize xxhash
  useEffect(() => {
    xxhashInit().then(setHasher)
  }, [])

  // Subscribe to Yjs updates since lastSyncTime.
  // Note: Convex query is `timestamp > since`, so we overlap by 1ms and dedupe by update _id
  // to avoid missing updates that share the same millisecond timestamp.
  const updatesSince = lastSyncTime === null ? null : Math.max(0, lastSyncTime - 1)
  const updates = useQuery(
    api.yjs.getUpdatesSince,
    updatesSince === null ? 'skip' : { projectId, since: updatesSince }
  )

  const awarenessEntries = useQuery(api.yjsAwareness.getActiveAwareness, { projectId })

  // Initialize Y.Doc and provider on mount
  useEffect(() => {
    if (!hasher) return

    const initDoc = async () => {
      const doc = new YjsProjectDoc(projectId)

      // Try to load existing snapshot
      const snapshot = await convex.query(api.yjs.getLatestSnapshot, { projectId })
      if (snapshot?.snapshot) {
        Y.applyUpdate(doc.doc, new Uint8Array(snapshot.snapshot), 'snapshot')
      }

      // Set local awareness state with user info
      doc.awareness.setLocalStateField('user', {
        id: userId,
        name: userName,
        color: generateColor(userId),
      })

      // Create provider to sync with Convex
      providerRef.current = new YConvexProvider(doc.doc, projectId, convex)
      awarenessProviderRef.current = new YConvexAwarenessProvider(
        doc.doc,
        doc.awareness,
        projectId,
        convex
      )

      // Create persistence provider to sync with projectFiles
      persistenceRef.current = new ProjectFilesPersistence(
        doc.files,
        projectId,
        convex,
        hasher,
        userId,
        userName
      )

      setYjsDoc(doc)
      const initialSince = snapshot?.createdAt ?? 0
      lastAppliedTimestampRef.current = initialSince
      seenUpdateIdsAtLastTimestampRef.current = new Set()
      setLastSyncTime(initialSince)
    }

    initDoc()

    return () => {
      providerRef.current?.destroy()
      awarenessProviderRef.current?.destroy()
      persistenceRef.current?.destroy()
    }
  }, [projectId, userId, userName, convex, hasher])

  // Apply remote updates when they arrive from Convex
  useEffect(() => {
    if (!updates || updates.length === 0 || !providerRef.current) return

    // Ensure a stable ordering for cursor updates.
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
      providerRef.current.applyRemoteUpdates(toApply)
      lastAppliedTimestampRef.current = lastTimestamp
      seenUpdateIdsAtLastTimestampRef.current = seenIds
      setLastSyncTime(lastTimestamp)
    }
  }, [updates])

  // Apply remote awareness updates (live cursors) when they arrive from Convex
  useEffect(() => {
    if (!awarenessEntries || !awarenessProviderRef.current) return
    awarenessProviderRef.current.applyRemoteAwareness(awarenessEntries)
  }, [awarenessEntries])

  // Periodic snapshot saving
  useEffect(() => {
    if (!yjsDoc) return

    const saveSnapshot = async () => {
      const snapshot = Y.encodeStateAsUpdate(yjsDoc.doc)
      // Create a clean ArrayBuffer copy to avoid SharedArrayBuffer type issues
      const snapshotBuffer = new ArrayBuffer(snapshot.byteLength)
      new Uint8Array(snapshotBuffer).set(snapshot)
      await convex.mutation(api.yjs.saveSnapshot, {
        projectId,
        snapshot: snapshotBuffer,
        version: Date.now(),
      })

      // Cleanup old updates
      await convex.mutation(api.yjs.cleanupOldUpdates, {
        projectId,
        olderThan: Date.now() - 5 * 60 * 1000, // 5 minutes ago
      })
    }

    // Save every 5 minutes
    const interval = setInterval(saveSnapshot, 5 * 60 * 1000)

    return () => {
      clearInterval(interval)
      saveSnapshot() // Save on unmount
    }
  }, [yjsDoc, projectId, convex])

  return (
    <YjsProjectContext.Provider
      value={{
        yjsDoc,
        awareness: yjsDoc?.awareness ?? null,
        isConnected: !!providerRef.current,
      }}
    >
      {children}
    </YjsProjectContext.Provider>
  )
}

/**
 * Hook to access the Yjs project context.
 */
export function useYjsProject() {
  return useContext(YjsProjectContext)
}
