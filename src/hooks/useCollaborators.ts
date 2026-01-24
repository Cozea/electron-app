import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'

export interface Collaborator {
  id: string
  name: string
  color: string
  isAgent?: boolean
  cursor?: {
    filePath: string
    line: number
    column: number
  }
}

/**
 * useCollaborators - Hook to get list of active collaborators from Yjs awareness.
 *
 * Listens to awareness changes and returns a list of other connected users.
 * Filters out the local user (self).
 */
export function useCollaborators(awareness: Awareness | null): Collaborator[] {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])

  useEffect(() => {
    if (!awareness) return

    const updateCollaborators = () => {
      const states = awareness.getStates()
      const collabs: Collaborator[] = []

      states.forEach((state, clientId) => {
        // Skip self
        if (clientId === awareness.clientID) return
        // Skip entries without user info
        if (!state.user) return

        collabs.push({
          id: state.user.id,
          name: state.user.name,
          color: state.user.color,
          isAgent: state.user.isAgent,
          cursor: state.cursor,
        })
      })

      setCollaborators(collabs)
    }

    // Initial update
    updateCollaborators()

    // Listen for awareness changes
    awareness.on('change', updateCollaborators)

    return () => {
      awareness.off('change', updateCollaborators)
    }
  }, [awareness])

  return collaborators
}
