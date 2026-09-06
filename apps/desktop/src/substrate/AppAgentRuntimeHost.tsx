import { useEffect } from 'react'

import {
  readAvailableNativeApi,
  readT3NativeApiOverlay,
} from '@/lib/nativeApi'

import { shouldStartScheduledTaskRunner } from './appAgentRuntimePolicy'
import { isSubstrateRpcChatEnabled } from './rpcChatFlags'
import { useSubstrateChatTransport } from './useSubstrateChatTransport'
import { useT3Cutover } from './useT3Cutover'

export interface AppAgentRuntimeHostProps {
  readonly enableScheduledTasks: boolean
}

/**
 * Own the renderer's full local-agent runtime independently from whichever page
 * or workbench tile happens to be mounted. Each renderer gets one T3 cutover;
 * only the main renderer is allowed to own the scheduled-task clock.
 */
export function AppAgentRuntimeHost({
  enableScheduledTasks,
}: AppAgentRuntimeHostProps) {
  const rpcChatEnabled = isSubstrateRpcChatEnabled()
  const transport = useSubstrateChatTransport()
  const cutover = useT3Cutover({
    substrateActive: transport.active,
    shadowBaseUrl: transport.shadowBaseUrl,
  })
  const primaryExpected =
    transport.shadowStatus?.features.primary === true &&
    transport.shadowStatus.features.inProcessAssistant === false
  const schedulerReady = shouldStartScheduledTaskRunner({
    enableScheduledTasks,
    rpcChatEnabled,
    transportLoading: transport.loading,
    hasShadowStatus: transport.shadowStatus !== null,
    primaryExpected,
    substrateActive: transport.active,
    cutoverActive: cutover.active,
  })

  useEffect(() => {
    if (!schedulerReady) return

    let cancelled = false
    let stop: (() => void) | null = null
    const getNativeApi = primaryExpected
      ? readT3NativeApiOverlay
      : readAvailableNativeApi

    void import('@/features/projects/model/scheduledTaskRunner').then((module) => {
      if (cancelled) return
      stop = module.startScheduledTaskRunner({ getNativeApi })
    })

    return () => {
      cancelled = true
      stop?.()
    }
  }, [primaryExpected, schedulerReady])

  return null
}
