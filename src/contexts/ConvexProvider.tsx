import type { ReactNode } from "react"
import { ConvexProvider as ConvexReactProvider } from "convex/react"
import { convex } from "@/lib/convex"

interface ConvexProviderProps {
  children: ReactNode
}

export function ConvexProvider({ children }: ConvexProviderProps) {
  // If Convex is not configured, render children without the provider
  if (!convex) {
    return <>{children}</>
  }

  return <ConvexReactProvider client={convex}>{children}</ConvexReactProvider>
}
