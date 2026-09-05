import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { CollaborationRecoveryInventory } from "@shared/collaborationRecovery"

interface CollaborationRecoveryPanelProps { sessionId: string | null; disabled: boolean }
export function CollaborationRecoveryPanel({ sessionId, disabled }: CollaborationRecoveryPanelProps) {
  const [inventory, setInventory] = useState<CollaborationRecoveryInventory | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inspect = async (cleanup: boolean) => {
    setBusy(true); setError(null); setMessage(null)
    try {
      if (cleanup && sessionId) {
        const result = await window.electronAPI.collaboration.runtime.cleanupRecovery(sessionId)
        setMessage(`Removed ${result.files} recovery records proven safe to retire. Unpublished edits, required keys and recovery backups were retained.`)
      }
      setInventory(await window.electronAPI.collaboration.runtime.recoveryInventory())
    } catch { setError("Recovery storage could not be fully inspected or compacted. No unpublished edits were discarded; retry after resolving storage or key availability.") }
    finally { setBusy(false) }
  }
  const mib = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1)
  return <details className="rounded-md border px-3 py-2 text-xs">
    <summary className="cursor-pointer font-medium">Local recovery storage</summary>
    <div className="mt-2 space-y-2">
      <p className="text-muted-foreground">Storage limits pause new recovery writes rather than deleting unpublished work. This inventory contains counts only, not source text or key material.</p>
      {inventory && <p>{mib(inventory.bytes)} / {mib(inventory.limitBytes)} MiB · {inventory.files} files · {inventory.outboxRecords} pending sends · {inventory.editorIngressRecords} accepted editor records · {inventory.projectionBackups} retained backups. Each room is limited to {mib(inventory.roomLimitBytes)} MiB across key versions.</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <p className="text-muted-foreground">Active sessions clean covered receive logs. After leaving, cleanup can also retire initialization histories contained in the durable checkpoint and older keys with no remaining dependencies.</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => void inspect(false)}>Inspect recovery storage</Button><Button size="sm" variant="outline" disabled={disabled || busy || !sessionId} onClick={() => void inspect(true)}>Clean covered recovery</Button></div>
    </div>
  </details>
}
