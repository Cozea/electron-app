import { useEffect, useState } from "react"

import type {
  ResolvedKeybindingsConfig,
  ServerConfigIssue,
} from "@cozea/assistant-contracts"

import { readNativeApi } from "@/lib/nativeApi"
import { CLIENT_FALLBACK_KEYBINDINGS } from "@/lib/keybindings/defaults"
import { onServerConfigUpdated } from "@/lib/wsNativeApi"

export interface KeybindingsConfigState {
  readonly keybindings: ResolvedKeybindingsConfig
  readonly issues: readonly ServerConfigIssue[]
  readonly configPath: string | null
  readonly ready: boolean
}

const INITIAL_STATE: KeybindingsConfigState = {
  keybindings: CLIENT_FALLBACK_KEYBINDINGS,
  issues: [],
  configPath: null,
  ready: false,
}

export function useKeybindingsConfig(): KeybindingsConfigState {
  const [state, setState] = useState<KeybindingsConfigState>(INITIAL_STATE)

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      const api = readNativeApi()
      if (!api) {
        if (!cancelled) {
          setState({
            keybindings: CLIENT_FALLBACK_KEYBINDINGS,
            issues: [],
            configPath: null,
            ready: true,
          })
        }
        return
      }

      try {
        const config = await api.server.getConfig()
        if (cancelled) return
        setState({
          keybindings:
            config.keybindings.length > 0 ? config.keybindings : CLIENT_FALLBACK_KEYBINDINGS,
          issues: config.issues,
          configPath: config.keybindingsConfigPath,
          ready: true,
        })
      } catch {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            keybindings: current.keybindings.length > 0 ? current.keybindings : CLIENT_FALLBACK_KEYBINDINGS,
            ready: true,
          }))
        }
      }
    }

    void refresh()

    const unsubscribe = onServerConfigUpdated((payload) => {
      setState((current) => ({
        ...current,
        issues: payload.issues,
      }))
      void refresh()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return state
}
