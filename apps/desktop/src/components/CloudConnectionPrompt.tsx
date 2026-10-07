import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/contexts/AuthContext"
import { useConvex } from "@/lib/cloudQueries"

/** Cloud enrollment is an explicit action; mounting a shared screen cannot enroll a fresh device. */
export function CloudConnectionPrompt() {
  const { isConvexAuthReady, isRevalidating, retryDeviceSession, authError } = useAuth()
  const client = useConvex()
  const [error, setError] = useState<string | null>(null)
  if (isConvexAuthReady) return null

  return (
    <div className="my-4 space-y-2 rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">
        {client ? "Connect this device to use sharing and organization features." :
          "Cloud features are unavailable in this build. Local projects remain available."}
      </p>
      {client ? (
        <Button variant="outline" size="sm" disabled={isRevalidating}
          onClick={() => {
            setError(null)
            void retryDeviceSession().catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : "Could not connect this device.")
            })
          }}>
          {isRevalidating ? "Connecting…" : "Connect cloud features"}
        </Button>
      ) : null}
      {error || authError ? <p className="text-sm text-destructive" role="alert">{error || authError}</p> : null}
    </div>
  )
}
