import { useEffect, useSyncExternalStore } from 'react'
import type { ScheduledTasksSnapshot } from '@shared/scheduledTasks'
import { createLocalSnapshot } from '@/lib/localSnapshot'

export const scheduledTasksSnapshot = createLocalSnapshot<ScheduledTasksSnapshot>({
  read: () => window.electronAPI.scheduledTasks.list(),
  connect: () => {
    // Computer use is switched on in Settings, in another window pane; coming
    // back to this page is the moment to re-read whether it is on.
    const refresh = () => { void scheduledTasksSnapshot.refresh().catch(() => undefined) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  },
})

export function useScheduledTasksSnapshot() {
  const state = useSyncExternalStore(
    scheduledTasksSnapshot.subscribe,
    scheduledTasksSnapshot.getSnapshot,
  )
  useEffect(() => { void scheduledTasksSnapshot.ensure().catch(() => undefined) }, [])
  return state
}

if (import.meta.hot) import.meta.hot.dispose(() => scheduledTasksSnapshot.dispose())
