import type { ReactNode } from "react"
import { ConvexProvider as ConvexReactProvider } from "convex/react"
import { convex } from "@/lib/convex"
import { cn } from "@/lib/utils"

interface ConvexProviderProps {
  children: ReactNode
}

export function ConvexProvider({ children }: ConvexProviderProps) {
  // If Convex is not configured, do not render the app tree:
  // many components call `useQuery/useMutation`, which require `ConvexProvider`.
  if (!convex) {
    return (
      <div
        className={cn(
          "font-sans p-6 text-sm leading-normal text-foreground",
          "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono",
        )}
      >
        <h1 className="mb-3 text-lg font-semibold tracking-tight">Configuration required</h1>
        <p className="mb-3 text-muted-foreground">
          This build is missing <code>VITE_CONVEX_URL</code>, so it cannot connect to Convex.
        </p>
        <p className="m-0 text-muted-foreground">
          If you are running a packaged app, this is a build configuration issue. If you are
          developing locally, set <code>VITE_CONVEX_URL</code> in your environment and restart.
        </p>
      </div>
    )
  }

  return <ConvexReactProvider client={convex}>{children}</ConvexReactProvider>
}
