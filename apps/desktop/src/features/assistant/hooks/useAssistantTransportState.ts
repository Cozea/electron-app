import { useEffect, useState } from "react"

import {
  getAssistantTransportState,
  onAssistantTransportState,
} from "@/lib/wsNativeApi"
import type { TransportState } from "@/stores/assistant-wsTransport"
import type { RawAssistantTransportState } from "@/features/projects/lib/connectionStatusModel"

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
