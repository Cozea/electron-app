import { createContext, useContext, type ReactNode } from "react"
import type { ActiveWorkspaceContextValue } from "../../../../../../shared/workspaceTypes"

export const ActiveWorkspaceContext = createContext<ActiveWorkspaceContextValue | null>(null)

export function useActiveWorkspace(): ActiveWorkspaceContextValue {
  const ctx = useContext(ActiveWorkspaceContext)
  if (!ctx) {
    throw new Error("useActiveWorkspace must be used inside ActiveWorkspaceProvider")
  }
  return ctx
}

export function useActiveWorkspaceOrNull(): ActiveWorkspaceContextValue | null {
  return useContext(ActiveWorkspaceContext)
}

export function ActiveWorkspaceProvider({
  value,
  children,
}: {
  value: ActiveWorkspaceContextValue
  children: ReactNode
}) {
  return (
    <ActiveWorkspaceContext.Provider value={value}>
      {children}
    </ActiveWorkspaceContext.Provider>
  )
}
