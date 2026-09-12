import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectdBinaryConflictRequest, ProjectdBinaryConflictResponse } from "@cozea/projectd-protocol"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface BinaryConflictDialogProps {
  publicSessionId: string
  canEdit: boolean
  onClose: () => void
}

export function BinaryConflictDialog({ publicSessionId, canEdit, onClose }: BinaryConflictDialogProps) {
  const [page, setPage] = useState<ProjectdBinaryConflictResponse | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, NonNullable<ProjectdBinaryConflictResponse["preview"]>>>({})
  const generation = useRef(0)
  const pending = useRef(false)
  const run = useCallback(async (request: ProjectdBinaryConflictRequest) => {
    if (pending.current) return
    pending.current = true
    const current = generation.current
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (request.action === "export") {
        const exported = await window.electronAPI.projectd.sessions.exportBinaryVersion(publicSessionId, request)
        if (current !== generation.current) return
        if (!exported.success) throw new Error(exported.error)
        if (!exported.canceled) setNotice(`Copy exported to ${exported.response?.exportedPath ?? "the selected folder"}.`)
        return
      }
      const result = await window.electronAPI.projectd.sessions.binaryConflicts(publicSessionId, request)
      if (current !== generation.current) return
      if (!result.success) throw new Error(result.error)
      if (request.action === "preview") {
        if (result.response.preview) setPreviews((prior) => ({
          ...Object.fromEntries(Object.entries(prior).filter(([id]) => id !== request.revisionId).slice(-3)),
          [request.revisionId]: result.response.preview!,
        }))
        return
      }
      if (request.action === "resolve") {
        setNotice("Version selected. Other versions remain in session history.")
        const refreshed = await window.electronAPI.projectd.sessions.binaryConflicts(publicSessionId, { action: "list" })
        if (current !== generation.current) return
        if (!refreshed.success) throw new Error(refreshed.error)
        setPage(refreshed.response)
      } else setPage(result.response)
      setChoices({})
      setPreviews({})
    } catch (failure) {
      if (current === generation.current) {
        setChoices({})
        setError(failure instanceof Error ? failure.message : "Could not review file versions.")
      }
    } finally {
      if (current === generation.current) { pending.current = false; setBusy(false) }
    }
  }, [publicSessionId])
  useEffect(() => {
    generation.current++
    pending.current = false
    setPage(null)
    setChoices({})
    setPreviews({})
    void run({ action: "list" })
    return () => { generation.current++; pending.current = false }
  }, [run])

  return <Dialog open onOpenChange={(open) => { if (!open && !pending.current) onClose() }}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Binary file conflicts</DialogTitle>
        <DialogDescription>Choose the version to use across this session. Other versions are retained in its history.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3" aria-busy={busy}>
        {error && <p role="alert" className="text-sm text-destructive">{error} Refresh to review current versions.</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {!canEdit && <p className="text-sm text-muted-foreground">Viewers can review versions. A collaborator with edit access must resolve them.</p>}
        {!page && busy && <p className="text-sm">Loading file versions…</p>}
        {page?.conflicts.length === 0 && <p className="text-sm">No binary conflicts on this page.</p>}
        <div className="max-h-80 space-y-4 overflow-auto">
          {page?.conflicts.map((conflict) => <fieldset key={conflict.fileId} disabled={busy} className="space-y-2 rounded-md border p-3">
            <legend className="break-all px-1 font-mono text-xs">{conflict.path}</legend>
            {conflict.variants.map((variant) => <div key={variant.revisionId} className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
              <input type="radio" disabled={!canEdit} name={`binary-${conflict.fileId}`} checked={choices[conflict.fileId] === variant.revisionId}
                onChange={() => setChoices((prior) => ({ ...prior, [conflict.fileId]: variant.revisionId }))} />
              <span>{new Date(variant.createdAt).toLocaleString()} · {variant.size.toLocaleString()} bytes
                <span className="block break-all font-mono text-xs text-muted-foreground">SHA-256 {variant.contentHash}</span>
              </span>
              </label>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void run({ action: "preview", fileId: conflict.fileId,
                revisionId: variant.revisionId, fingerprint: conflict.fingerprint })}>Preview version</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void run({ action: "export", fileId: conflict.fileId,
                revisionId: variant.revisionId, fingerprint: conflict.fingerprint })}>Export copy</Button>
              {previews[variant.revisionId] && <div className="rounded border p-2">
                {previews[variant.revisionId]!.imageDataUrl && <img className="max-h-48 max-w-full object-contain" src={previews[variant.revisionId]!.imageDataUrl!} alt={`Version of ${conflict.path}`} />}
                <p className="text-xs text-muted-foreground">{previews[variant.revisionId]!.truncated ? "First 256 bytes" : "File bytes"} · hexadecimal</p>
                <pre className="whitespace-pre-wrap break-all text-xs">{previews[variant.revisionId]!.hex}</pre>
              </div>}
            </div>)}
            <Button size="sm" disabled={busy || !canEdit || !choices[conflict.fileId] || Boolean(error)} onClick={() => void run({
              action: "resolve", fileId: conflict.fileId, revisionId: choices[conflict.fileId]!, fingerprint: conflict.fingerprint,
            })}>Use selected version</Button>
          </fieldset>)}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void run({ action: "list" })}>Refresh</Button>
          {page?.nextFileId && <Button variant="outline" disabled={busy} onClick={() => void run({ action: "list", afterFileId: page.nextFileId! })}>Next page</Button>}
          <Button variant="outline" disabled={busy} onClick={onClose}>Close</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
}
