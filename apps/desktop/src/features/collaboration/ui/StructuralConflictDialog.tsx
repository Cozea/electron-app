import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectdStructuralConflictRequest, ProjectdStructuralConflictResponse } from "@cozea/projectd-protocol"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface StructuralConflictDialogProps { publicSessionId: string; canEdit: boolean; onClose: () => void }
interface Choice { action: "rename" | "restore" | "delete"; path: string }

export function StructuralConflictDialog({ publicSessionId, canEdit, onClose }: StructuralConflictDialogProps) {
  const [page, setPage] = useState<ProjectdStructuralConflictResponse | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)
  const pending = useRef(false)
  const run = useCallback(async (request: ProjectdStructuralConflictRequest) => {
    if (pending.current) return
    pending.current = true
    const current = generation.current
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await window.electronAPI.projectd.sessions.structuralConflicts(publicSessionId, request)
      if (current !== generation.current) return
      if (!result.success) throw new Error(result.error)
      if (request.action === "resolve") {
        setNotice("Resolution recorded. File history is retained.")
        const refreshed = await window.electronAPI.projectd.sessions.structuralConflicts(publicSessionId, { action: "list" })
        if (current !== generation.current) return
        if (!refreshed.success) throw new Error(refreshed.error)
        setPage(refreshed.response)
      } else setPage(result.response)
      setChoices({})
    } catch (failure) {
      if (current === generation.current) { setChoices({}); setError(failure instanceof Error ? failure.message : "Could not review paths.") }
    } finally { if (current === generation.current) { pending.current = false; setBusy(false) } }
  }, [publicSessionId])
  useEffect(() => {
    generation.current++; pending.current = false; setPage(null); setChoices({})
    void run({ action: "list" })
    return () => { generation.current++; pending.current = false }
  }, [run])
  return <Dialog open onOpenChange={(open) => { if (!open && !pending.current) onClose() }}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader><DialogTitle>Path conflicts</DialogTitle>
        <DialogDescription>Choose where each file belongs, or explicitly confirm its deletion. Resolutions apply across this session.</DialogDescription></DialogHeader>
      <div className="space-y-3" aria-busy={busy}>
        {error && <p role="alert" className="text-sm text-destructive">{error} Refresh before trying again.</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {!canEdit && <p className="text-sm text-muted-foreground">Viewers can review conflicts. Edit access is required to resolve them.</p>}
        {!page && busy && <p>Loading paths…</p>}
        {page?.conflicts.length === 0 && <p>No path conflicts on this page.</p>}
        <div className="max-h-80 space-y-4 overflow-auto">
          {page?.conflicts.map((conflict) => <fieldset key={conflict.fileId} disabled={busy || !canEdit} className="space-y-2 rounded border p-3">
            <legend className="break-all px-1 font-mono text-xs">{conflict.path}</legend>
            {conflict.textPreview !== undefined && <details><summary className="text-xs">Retained content preview (up to 2,000 characters)</summary>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">{conflict.textPreview}</pre>
            </details>}
            <p className="text-sm">{conflict.kinds.map((kind) => kind === "path_collision" ? "Multiple files share this path" : kind === "concurrent_rename" ? "Different rename destinations" : "Deletion overlaps edits").join(" · ")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setChoices((prior) => ({ ...prior, [conflict.fileId]: { action: conflict.deleted ? "restore" : "rename", path: conflict.path } }))}>{conflict.deleted ? "Restore file" : "Choose path"}</Button>
              <Button variant="outline" size="sm" onClick={() => setChoices((prior) => ({ ...prior, [conflict.fileId]: { action: "delete", path: conflict.path } }))}>{conflict.deleted ? "Keep deleted" : "Delete this file"}</Button>
            </div>
            {choices[conflict.fileId] && <>
              {choices[conflict.fileId]!.action === "delete" ? <p className="text-sm">This file will be deleted from the session. Its recorded content remains in history.</p> : <>
                <Input aria-label={`Destination for ${conflict.path}`} value={choices[conflict.fileId]!.path} onChange={(event) => {
                  const path = event.target.value; setChoices((prior) => ({ ...prior, [conflict.fileId]: { ...prior[conflict.fileId]!, path } }))
                }} />
                {conflict.alternatives.map((path) => <Button key={path} size="sm" variant="ghost" onClick={() => setChoices((prior) => ({ ...prior, [conflict.fileId]: { ...prior[conflict.fileId]!, path } }))}>Use {path}</Button>)}
              </>}
              <Button disabled={busy || !canEdit || Boolean(error) || !choices[conflict.fileId]!.path.trim()} onClick={() => void run({ action: "resolve", fileId: conflict.fileId,
                fingerprint: conflict.fingerprint, choice: choices[conflict.fileId]!.action,
                ...(choices[conflict.fileId]!.action !== "delete" ? { path: choices[conflict.fileId]!.path } : {}),
              })}>Apply resolution</Button>
            </>}
          </fieldset>)}
        </div>
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void run({ action: "list" })}>Refresh</Button>
          {page?.nextFileId && <Button variant="outline" disabled={busy} onClick={() => void run({ action: "list", afterFileId: page.nextFileId! })}>Next page</Button>}
          <Button variant="outline" disabled={busy} onClick={onClose}>Close</Button></div>
      </div>
    </DialogContent>
  </Dialog>
}
