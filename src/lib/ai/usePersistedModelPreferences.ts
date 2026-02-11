import { useEffect, useRef, useState } from 'react'

import {
  loadModelSettings,
  saveModelSettings,
  type StoredModelSettings,
} from '@/lib/modelSettingsStorage'

export interface ModelPreferences {
  selectedAgent: 'Agent' | 'Assistant'
  selectedPerformance: 'High' | 'Medium' | 'Low'
  thinkingEffort: 'low' | 'medium' | 'high'
}

interface UsePersistedModelPreferencesArgs {
  model: string
  resolveDefaults: (model: string) => ModelPreferences
}

interface UsePersistedModelPreferencesResult extends ModelPreferences {
  setSelectedAgent: (value: 'Agent' | 'Assistant') => void
  setSelectedPerformance: (value: 'High' | 'Medium' | 'Low') => void
  setThinkingEffort: (value: 'low' | 'medium' | 'high') => void
}

export function usePersistedModelPreferences({
  model,
  resolveDefaults,
}: UsePersistedModelPreferencesArgs): UsePersistedModelPreferencesResult {
  const initialDefaults = resolveDefaults(model)
  const [selectedAgent, setSelectedAgent] = useState<'Agent' | 'Assistant'>(initialDefaults.selectedAgent)
  const [selectedPerformance, setSelectedPerformance] = useState<'High' | 'Medium' | 'Low'>(initialDefaults.selectedPerformance)
  const [thinkingEffort, setThinkingEffort] = useState<'low' | 'medium' | 'high'>(initialDefaults.thinkingEffort)
  const [modelSettings, setModelSettings] = useState<Record<string, StoredModelSettings>>(
    () => loadModelSettings()
  )

  const modelSettingsRef = useRef(modelSettings)
  useEffect(() => {
    modelSettingsRef.current = modelSettings
  }, [modelSettings])

  useEffect(() => {
    const stored = modelSettingsRef.current[model]
    const next = stored ?? resolveDefaults(model)
    setSelectedAgent(next.selectedAgent ?? 'Agent')
    setSelectedPerformance(next.selectedPerformance ?? 'High')
    setThinkingEffort(next.thinkingEffort ?? 'medium')
  }, [model, resolveDefaults])

  useEffect(() => {
    const nextSettings: StoredModelSettings = {
      selectedAgent,
      selectedPerformance,
      thinkingEffort,
    }

    setModelSettings((prev) => {
      const updated = { ...prev, [model]: nextSettings }
      saveModelSettings(updated)
      return updated
    })
  }, [model, selectedAgent, selectedPerformance, thinkingEffort])

  return {
    selectedAgent,
    setSelectedAgent,
    selectedPerformance,
    setSelectedPerformance,
    thinkingEffort,
    setThinkingEffort,
  }
}
