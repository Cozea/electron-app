import { useEffect, useSyncExternalStore } from 'react'
import type { AgentSkillsSnapshot } from '@shared/electronApiTypes'
import { createLocalSnapshot } from '@/lib/localSnapshot'

export const agentSkillsSnapshot = createLocalSnapshot<AgentSkillsSnapshot>({
  read: () => window.electronAPI.agentSkills.list(),
  connect: () => {
    const refresh = () => { void agentSkillsSnapshot.refresh().catch(() => undefined) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  },
})

export function useAgentSkillsSnapshot() {
  const state = useSyncExternalStore(agentSkillsSnapshot.subscribe, agentSkillsSnapshot.getSnapshot)
  useEffect(() => { void agentSkillsSnapshot.ensure().catch(() => undefined) }, [])
  return state
}

if (import.meta.hot) import.meta.hot.dispose(() => agentSkillsSnapshot.dispose())
