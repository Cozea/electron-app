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
  userId: string
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
  const [lastSyncTime, setLastSyncTime] = useState(0)
  const [hasher, setHasher] = useState<XXHashAPI | null>(null)
  const providerRef = useRef<YConvexProvider | null>(null)
  const persistenceRef = useRef<ProjectFilesPersistence | null>(null)
  const convex = useConvex()

  // Initialize xxhash
  useEffect(() => {
    xxhashInit().then(setHasher)
  }, [])

  // Subscribe to Yjs updates since lastSyncTime
  const updates = useQuery(api.yjs.getUpdatesSince, {
    projectId,
    since: lastSyncTime,
  })

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

      // Create persistence provider to sync with projectFiles
      persistenceRef.current = new ProjectFilesPersistence(
        doc.files,
        projectId,
        convex,
        hasher,
        userId as any, // Cast to Id<"users"> - may be undefined if external user
        userName
      )

      setYjsDoc(doc)
    }

    initDoc()

    return () => {
      providerRef.current?.destroy()
      persistenceRef.current?.destroy()
    }
  }, [projectId, userId, userName, convex, hasher])

  // Apply remote updates when they arrive from Convex
  useEffect(() => {
    if (updates && updates.length > 0 && providerRef.current) {
      providerRef.current.applyRemoteUpdates(updates)
      // Update lastSyncTime to the newest update timestamp
      const newestTimestamp = updates[updates.length - 1].timestamp
      setLastSyncTime(newestTimestamp)
    }
  }, [updates])

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
