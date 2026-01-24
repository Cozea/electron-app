import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react'
import { useQuery, useConvex } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { YjsProjectDoc } from '@/lib/yjs/YjsProjectDoc'
import { YConvexProvider } from '@/lib/yjs/YConvexProvider'
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
  const providerRef = useRef<YConvexProvider | null>(null)
  const convex = useConvex()

  // Subscribe to Yjs updates since lastSyncTime
  const updates = useQuery(api.yjs.getUpdatesSince, {
    projectId,
    since: lastSyncTime,
  })

  // Initialize Y.Doc and provider on mount
  useEffect(() => {
    const doc = new YjsProjectDoc(projectId)
    setYjsDoc(doc)

    // Set local awareness state with user info
    doc.awareness.setLocalStateField('user', {
      id: userId,
      name: userName,
      color: generateColor(userId),
    })

    // Create provider to sync with Convex
    providerRef.current = new YConvexProvider(doc.doc, projectId, convex)

    return () => {
      providerRef.current?.destroy()
      doc.destroy()
    }
  }, [projectId, userId, userName, convex])

  // Apply remote updates when they arrive from Convex
  useEffect(() => {
    if (updates && updates.length > 0 && providerRef.current) {
      providerRef.current.applyRemoteUpdates(updates)
      // Update lastSyncTime to the newest update timestamp
      const newestTimestamp = updates[updates.length - 1].timestamp
      setLastSyncTime(newestTimestamp)
    }
  }, [updates])

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
