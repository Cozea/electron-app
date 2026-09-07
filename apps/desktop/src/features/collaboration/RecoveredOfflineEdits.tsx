import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { sessionEditorBridge } from "./runtime/SessionEditorBridge"
import { Input } from "@/components/ui/input"
import type { RecoveredOfflineEntry, RecoveredOfflineFile } from "@shared/collaborationRuntime"

export function RecoveredOfflineEdits({ sessionId, readOnly }: { sessionId: string; readOnly: boolean }) {
  const api = window.electronAPI.collaboration.runtime
  const [entries, setEntries] = useState<RecoveredOfflineEntry[]>([])
  const [renames, setRenames] = useState<Array<{ fileId: string; paths: string[] }>>([])
  const [files, setFiles] = useState<RecoveredOfflineFile[]>([])
  const [paths, setPaths] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = () => { void Promise.all([api.recoveredFiles(sessionId), api.recoveryEntries(sessionId), api.snapshot(sessionId)]).then(([files, entries, snapshot]) => { if (alive) { setFiles(files); setEntries(entries); setRenames(snapshot.renameConflicts ?? []) } }).catch(error => { if (alive) setError(String(error)) }) }
    refresh()
    const unsubscribe = api.onChanged(id => { if (id === sessionId) refresh() })
    return () => { alive = false; unsubscribe() }
  }, [api, sessionId])
  const resolve = async (file: RecoveredOfflineFile, action: "save" | "discard") => {
    setBusy(true); setError(null)
    try {
      await api.resolveRecovered({ sessionId, recoveryId: file.recoveryId, fileId: file.id, action, ...(action === "save" ? { path: file.savingPath ?? paths[`${file.recoveryId}:${file.id}`] ?? "" } : {}) })
      const [files, entries] = await Promise.all([api.recoveredFiles(sessionId), api.recoveryEntries(sessionId)])
      setFiles(files); setEntries(entries)
    } catch (error) { setError(error instanceof Error ? error.message : "Recovery action failed. Your offline edits remain saved.") }
    finally { setBusy(false) }
  }
  if (!files.length && !entries.length && !renames.length && !error) return null
  return <section className="space-y-3 rounded border p-3">
    <h3 className="text-sm font-medium">Recovered offline edits</h3>
    <p className="text-xs text-muted-foreground">Conflicting offline or external file changes are saved separately. You can keep working in the session while reviewing it.</p>
    {renames.map(conflict => <div key={conflict.fileId} className="space-y-2">
      <p className="text-xs">Concurrent renames need a shared path choice. Filesystem synchronization is paused; all target names remain saved.</p>
      <div className="flex flex-wrap gap-2">{conflict.paths.map(target => <Button key={target} size="sm" disabled={busy || readOnly} onClick={() => {
        setBusy(true); setError(null)
        void sessionEditorBridge.flush(sessionId).then(() => api.renameFile({ sessionId, fileId: conflict.fileId, path: target })).catch(error => setError(String(error))).finally(() => setBusy(false))
      }}>Use {target}</Button>)}</div>
    </div>)}
    {entries.filter(entry => entry.reason).map(entry => <p key={entry.id} role="status" className="text-xs">{entry.reason}</p>)}
    {entries.filter(entry => entry.incomplete).map(entry => <p key={entry.id} role="status" className="text-xs">Some older offline history could not be fully reconstructed. {entry.retainedRecords} encrypted records remain saved. Reconstructed files are available below; incomplete history will not be discarded automatically.</p>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {files.map(file => {
      const key = `${file.recoveryId}:${file.id}`
      return <details key={key} className="space-y-2 text-sm">
        <summary className="cursor-pointer">{file.path}{file.deleted ? " · deleted offline" : ""}{file.originalPath && file.path !== file.originalPath ? ` · renamed from ${file.originalPath}` : ""}</summary>
        <div className="grid gap-2 md:grid-cols-2">
          <div><p className="text-xs font-medium">Current session</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{file.canonicalContent ?? "No current shared file"}</pre></div>
          <div><p className="text-xs font-medium">Saved offline version</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{file.content}</pre></div>
        </div>
        <Input aria-label={`New path for recovered ${file.path}`} placeholder="Choose an unused path" disabled={busy || readOnly || Boolean(file.savingPath)} value={file.savingPath ?? paths[key] ?? ""} onChange={event => setPaths(previous => ({ ...previous, [key]: event.target.value }))} />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || readOnly || !(file.savingPath ?? paths[key])} onClick={() => void resolve(file, "save")}>{file.savingPath ? "Retry saving recovered file" : "Save as new shared file"}</Button>
          <Button size="sm" variant="outline" disabled={busy || Boolean(file.savingPath)} onClick={() => { if (window.confirm(`Discard the saved offline version of ${file.path}? The current session file will stay unchanged.`)) void resolve(file, "discard") }}>Discard saved version</Button>
        </div>
        {readOnly && <p className="text-xs text-muted-foreground">Observer access allows review. Editor access is required to save a shared file.</p>}
      </details>
    })}
  </section>
}
