import { useEffect, useState } from "react"

import type { ConnectionPhase } from "@cozea/client-runtime"

import {
  createSubstrateRpcChatAdapter,
  runSubstrateRpcChatSmoke,
  type SubstrateRpcChatSmokeResult,
} from "@/substrate/rpcChatAdapter"
import { isSubstrateRpcChatEnabled } from "@/substrate/rpcChatFlags"

export interface SubstrateRpcChatHookState {
  readonly enabled: boolean
  readonly phase: ConnectionPhase | "disabled"
  readonly lastSmoke: SubstrateRpcChatSmokeResult | null
  readonly lastError: string | null
}

/**
 * Opt-in Phase 2 substrate RPC chat hook for the workbench assistant path.
 * No-ops unless `COZEA_SUBSTRATE_RPC_CHAT=1` (and shadow server is up).
 */
export function useSubstrateRpcChat(options?: {
  readonly autoSmoke?: boolean
  readonly shadowBaseUrl?: string
}): SubstrateRpcChatHookState {
  const enabled = isSubstrateRpcChatEnabled()
  const [phase, setPhase] = useState<ConnectionPhase | "disabled">(
    enabled ? "idle" : "disabled",
  )
  const [lastSmoke, setLastSmoke] = useState<SubstrateRpcChatSmokeResult | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }
    const client = createSubstrateRpcChatAdapter({
      shadowBaseUrl: options?.shadowBaseUrl,
    })
    if (!client) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        await client.connect()
        if (cancelled) {
          return
        }
        setPhase(client.getPhase())
        if (options?.autoSmoke) {
          const smoke = await runSubstrateRpcChatSmoke({
            shadowBaseUrl: options.shadowBaseUrl,
          })
          if (!cancelled) {
            setLastSmoke(smoke)
          }
        }
      } catch (error) {
        if (!cancelled) {
          setPhase("error")
          setLastError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        await client.close()
      }
    })()
    return () => {
      cancelled = true
      void client.close()
    }
  }, [enabled, options?.autoSmoke, options?.shadowBaseUrl])

  return { enabled, phase, lastSmoke, lastError }
}
