import type { ReactNode } from "react"
import { ConvexProvider as ConvexReactProvider, ConvexReactClient } from "convex/react"
import { convex } from "@/lib/convex"
import { CloudClientContext } from "@/lib/cloudQueries"

interface ConvexProviderProps {
  children: ReactNode
}

const navigationTestClient =
  typeof __COZEA_NAVIGATION_TEST__ !== "undefined" && __COZEA_NAVIGATION_TEST__
    ? new ConvexReactClient("http://127.0.0.1:3210")
    : null

export function ConvexProvider({ children }: ConvexProviderProps) {
  const client = convex ?? navigationTestClient
  return (
    <CloudClientContext value={client}>
      {client ? <ConvexReactProvider client={client}>{children}</ConvexReactProvider> : children}
    </CloudClientContext>
  )
}
