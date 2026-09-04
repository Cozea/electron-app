import { useEffect, useState } from "react"

import {
  getAssistantTransportState,
  onAssistantTransportState,
} from "@/lib/wsNativeApi"
import type { TransportState } from "@/features/assistant/model/wsTransport"
import type { RawAssistantTransportState } from "@/features/collaboration/model/connectionStatusModel"

/**
 * Live assistant runtime WebSocket transport state.
 * Intentionally separate from Yjs/collab connectivity and Convex project.syncStatus.
 */
export function useAssistantTransportState(): RawAssistantTransportState {
  const [state, setState] = useState<RawAssistantTransportState>(
    () => getAssistantTransportState() ?? "closed",
  )

  useEffect(() => {
    return onAssistantTransportState((next: TransportState) => {
      setState(next)
    })
  }, [])

  return state
}
