import type { ReactNode } from "react"
import { ConvexProvider as ConvexReactProvider } from "convex/react"
import { convex } from "@/lib/convex"

interface ConvexProviderProps {
  children: ReactNode
}

export function ConvexProvider({ children }: ConvexProviderProps) {
  // If Convex is not configured, do not render the app tree:
  // many components call `useQuery/useMutation`, which require `ConvexProvider`.
  if (!convex) {
    return (
      <div
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: 24,
          lineHeight: 1.5,
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Configuration required</h1>
        <p style={{ margin: "0 0 12px" }}>
          This build is missing <code>VITE_CONVEX_URL</code>, so it cannot connect to Convex.
        </p>
        <p style={{ margin: 0 }}>
          If you are running a packaged app, this is a build configuration issue. If you are
          developing locally, set <code>VITE_CONVEX_URL</code> in your environment and restart.
        </p>
      </div>
    )
  }

  return <ConvexReactProvider client={convex}>{children}</ConvexReactProvider>
}
