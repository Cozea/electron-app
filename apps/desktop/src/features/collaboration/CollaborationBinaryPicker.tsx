import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { CollaborationBinaryCandidate, CollaborationBinarySelection } from "@shared/collaborationCommitReview"

interface CollaborationBinaryPickerProps {
  sessionId: string
  disabled: boolean
  value: CollaborationBinarySelection[]
  onChange(value: CollaborationBinarySelection[]): void
}

export function CollaborationBinaryPicker({ sessionId, disabled, value, onChange }: CollaborationBinaryPickerProps) {
  const [candidates, setCandidates] = useState<CollaborationBinaryCandidate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      const files = await window.electronAPI.collaboration.runtime.binaryCandidates(sessionId)
      setCandidates(files)
      // Refresh is a new review, not silent approval of changed bytes.
      onChange([])
    } catch { setError("Local binary changes could not be inspected. Existing files were not changed.") }
    finally { setLoading(false) }
  }
  return <div className="space-y-2 rounded-md border p-3">
    <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">Optional publisher-owned binary files</span><Button size="sm" variant="outline" disabled={disabled || loading} onClick={() => void refresh()}>{loading ? "Inspecting…" : "Review local binaries"}</Button></div>
    <p className="text-xs text-muted-foreground">Nothing is selected automatically. Selected bytes are checked again when the shared commit is prepared.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {candidates?.length === 0 && <p className="text-xs text-muted-foreground">No changed Git-only regular files were found.</p>}
    {candidates && <div className="max-h-40 space-y-2 overflow-auto">{candidates.map(file => <label key={file.path} className="flex items-start gap-2 text-xs">
      <Checkbox disabled={disabled || loading} checked={value.some(item => item.path === file.path && item.reviewHash === file.reviewHash)} onCheckedChange={checked => onChange(checked === true ? [...value.filter(item => item.path !== file.path), { path: file.path, reviewHash: file.reviewHash }] : value.filter(item => item.path !== file.path))} />
      <span className="min-w-0 break-all"><span className="font-mono">{file.path}</span><span className="ml-2 text-muted-foreground">{file.change} · {file.bytes.toLocaleString()} bytes{file.executable ? " · executable" : ""}</span></span>
    </label>)}</div>}
  </div>
}
