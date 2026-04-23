import { createContext, useContext, type ReactNode } from "react"
import type { Awareness } from "y-protocols/awareness"

import type { DeleteConflict } from "@/hooks/useReconnectionSync"
import type { YjsProjectDoc } from "@/lib/yjs/YjsProjectDoc"

export interface YjsProjectContextValue {
  yjsDoc: YjsProjectDoc | null
  awareness: Awareness | null
  isConnected: boolean
  deleteConflicts: DeleteConflict[]
  resolveDeleteConflict: (filePath: string, keepLocal: boolean) => Promise<void>
}

export const EMPTY_YJS_PROJECT_CONTEXT_VALUE: YjsProjectContextValue = {
  yjsDoc: null,
  awareness: null,
  isConnected: false,
  deleteConflicts: [],
  resolveDeleteConflict: async () => {},
}

export const YjsProjectContext = createContext<YjsProjectContextValue>(
  EMPTY_YJS_PROJECT_CONTEXT_VALUE,
)

export function useYjsProject() {
  return useContext(YjsProjectContext)
}

export function YjsProjectContextBridgeProvider({
  children,
  value,
}: {
  children: ReactNode
  value: YjsProjectContextValue
}) {
  return <YjsProjectContext.Provider value={value}>{children}</YjsProjectContext.Provider>
}
