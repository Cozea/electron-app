import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { RecoveredOfflineEdits } from "./RecoveredOfflineEdits"
import { SharedSessionEditor } from "./SharedSessionEditor"
import { CollaborationBinaryPicker } from "./CollaborationBinaryPicker"
import { CollaborationRecoveryPanel } from "./CollaborationRecoveryPanel"
import { CollaborationCommitReview } from "./CollaborationCommitReview"
import type { CollaborationBinarySelection } from "@shared/collaborationCommitReview"
import { sessionEditorBridge } from "./runtime/SessionEditorBridge"
import type { CollaborationSessionDescriptor, CollaborationParticipantDescriptor } from "@shared/collaborationSession"
import type { CollaborationRepositoryBindingDescriptor } from "@shared/collaborationRepository"
import type { CollaborationImportCandidate, PreparedCollaborationCommit } from "@shared/collaborationDesktop"
import type { SessionRuntimeSnapshot } from "@shared/collaborationRuntime"

// Enable only after the complete deployed packaged acceptance gate passes.
export const GITHUB_COLLABORATION_RELEASE_ENABLED = import.meta.env.VITE_GITHUB_COLLABORATION_RELEASE === "1"
interface ProjectCollaborationControlProps { projectId: string; organizationId?: string | null; sourceWorkspaceId: string }
interface VerifiedRepository { repositoryNumericId: string; installationId: string; owner: string; name: string; defaultBranch: string }

export function ProjectCollaborationControl({ projectId, organizationId, sourceWorkspaceId }: ProjectCollaborationControlProps) {
  const api = window.electronAPI.collaboration.runtime
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [binding, setBinding] = useState<CollaborationRepositoryBindingDescriptor | null>(null)
  const [repositories, setRepositories] = useState<VerifiedRepository[]>([])
  const [sessions, setSessions] = useState<CollaborationSessionDescriptor[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [waitingId, setWaitingId] = useState<string | null>(null)
  const [retainedId, setRetainedId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<SessionRuntimeSnapshot | null>(null)
  const [participants, setParticipants] = useState<CollaborationParticipantDescriptor[]>([])
  const [branch, setBranch] = useState("")
  const [branches, setBranches] = useState<string[]>([])
  const [role, setRole] = useState<"editor" | "observer">("editor")
  const [imports, setImports] = useState<CollaborationImportCandidate[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [filePath, setFilePath] = useState("")
  const [editorPath, setEditorPath] = useState("")
  const [message, setMessage] = useState("")
  const [authorName, setAuthorName] = useState("")
  const [authorEmail, setAuthorEmail] = useState("")
  const [binarySelection, setBinarySelection] = useState<{ sessionId: string | null; files: CollaborationBinarySelection[] }>({ sessionId: null, files: [] })
  const selectedBinaries = binarySelection.sessionId === sessionId ? binarySelection.files : []
  const [prepared, setPrepared] = useState<PreparedCollaborationCommit | null>(null)
  const creationToken = useRef(crypto.randomUUID())
  const control = useCallback(<T,>(operation: string, args: Record<string, unknown>) => api.control({ operation, args }) as Promise<T>, [api])
  const refreshLocal = useCallback(async () => {
    const active = await api.active(projectId)
    const retained = await window.electronAPI.collaboration.bindingForWorkspace(sourceWorkspaceId)
    setSessionId(active)
    setRetainedId(retained?.projectId === projectId && retained.state !== "ended" ? retained.sessionId : null)
    if (active) {
      const [next, commit] = await Promise.all([api.snapshot(active), api.prepared(active)])
      setSnapshot(next); setPrepared(commit)
    } else { setSnapshot(null); setPrepared(null) }
  }, [api, projectId, sourceWorkspaceId])
  const refreshRemote = useCallback(async () => {
    if (!open) return
    const active = await api.active(projectId)
    const [repository, rooms, people] = await Promise.all([
      control<CollaborationRepositoryBindingDescriptor | null>("repository.getBinding", { projectId }),
      control<CollaborationSessionDescriptor[]>("listForProject", { projectId }),
      active ? control<CollaborationParticipantDescriptor[]>("listParticipants", { sessionId: active }) : Promise.resolve([]),
    ])
    setBinding(repository); setSessions(rooms); setParticipants(people)
    setBranch(value => value || repository?.defaultBranch || "")
  }, [api, control, open, projectId])
  const refresh = useCallback(async () => { await refreshLocal(); await refreshRemote() }, [refreshLocal, refreshRemote])
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      if (timer) return
      timer = setTimeout(() => { timer = undefined; if (alive) void refreshLocal().catch(() => {}) }, 80)
    }
    update()
    const unsubscribe = api.onChanged(update)
    return () => { alive = false; if (timer) clearTimeout(timer); unsubscribe() }
  }, [api, refreshLocal])
  useEffect(() => {
    if (!open) return
    let alive = true
    const update = () => { void refreshRemote().catch(error => { if (alive) setError(error instanceof Error ? error.message : "Session controls are offline; local recovery remains available") }) }
    update()
    const timer = setInterval(update, 15_000)
    return () => { alive = false; clearInterval(timer) }
  }, [open, refreshRemote])
  const run = async (operation: () => Promise<void>, flush = true) => {
    setBusy(true); setError(null)
    try { if (sessionId && flush) await sessionEditorBridge.flush(sessionId); await operation(); await refresh() }
    catch (error) { setError(error instanceof Error ? error.message : "Collaboration action failed") }
    finally { setBusy(false) }
  }
  const join = async (id: string) => {
    const local = await window.electronAPI.collaboration.getBinding(id)
    try { await control("joinSession", { sessionId: id, requestedRole: role }) }
    catch (error) { if (!local) throw error }
    const ready = await api.open({ sessionId: id, sourceWorkspaceId: local?.sourceWorkspaceId ?? sourceWorkspaceId })
    setWaitingId(ready ? null : id)
  }
  const start = async () => {
    const resolved = await api.resolve({ projectId, ...(branch ? { branch } : {}) })
    const created = await control<CollaborationSessionDescriptor>("createSession", { generation: 3, projectId, repositoryId: resolved.repositoryId, targetBranch: resolved.branch,
      baseCommitSha: resolved.commitSha, resolutionId: resolved.resolutionId, creationToken: creationToken.current })
    setWaitingId(created.id)
    await control("activateSession", { sessionId: created.id })
    if (!await api.open({ sessionId: created.id, sourceWorkspaceId })) return
    if (selected.length) await api.importChanges({ sessionId: created.id, selected: imports.filter(file => selected.includes(file.path)).map(({ path, reviewHash }) => ({ path, reviewHash })) })
    creationToken.current = crypto.randomUUID(); setWaitingId(null); setImports([]); setSelected([])
  }
  return <>
    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>
      {snapshot ? `${participants.filter(p => p.leftAt === null).length} · ${snapshot.connection}` : "Collaborate"}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-y-auto">
        <DialogHeader><DialogTitle>Code collaboration</DialogTitle><DialogDescription>Work together in an isolated GitHub session. Your ordinary workspace stays separate.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <CollaborationRecoveryPanel sessionId={sessionId ?? retainedId} disabled={busy} />
        {snapshot?.error && <p role="alert" className="text-sm text-destructive">{snapshot.error}</p>}
        {!sessionId && <div className="space-y-3">
          {retainedId && <Button disabled={busy} onClick={() => void run(() => join(retainedId))}>Resume retained session</Button>}
          {!binding?.enabled ? <>
            <p className="text-sm">An organization administrator must connect GitHub and select this project’s repository.</p>
            <div className="flex gap-2">
              <Button disabled={busy || !organizationId} onClick={() => void run(async () => { const setup = await api.setup(organizationId!); await window.electronAPI.shell.openExternal(setup.authorizationUrl) })}>Connect GitHub</Button>
              <Button variant="outline" disabled={busy || !organizationId} onClick={() => void run(async () => { setRepositories(await control("repository.listVerifiedRepositories", { organizationId })) })}>Refresh repositories</Button>
            </div>
            {repositories.map(repo => <Button key={repo.repositoryNumericId} variant="outline" disabled={busy} onClick={() => void run(async () => { await control("repository.upsertBinding", { projectId, repositoryNumericId: repo.repositoryNumericId, installationId: repo.installationId, owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch, accessPolicy: "organization", enabled: true }) })}>{repo.owner}/{repo.name}</Button>)}
          </> : <>
            <p className="text-sm">{binding.fullName}</p>
            <div className="flex gap-2"><Input aria-label="Starting branch" value={branch} onChange={event => setBranch(event.target.value)} list="collaboration-branches" />
              <datalist id="collaboration-branches">{branches.map(name => <option key={name} value={name} />)}</datalist>
              <Button variant="outline" disabled={busy} onClick={() => void run(async () => { const resolved = await api.resolve({ projectId }); setBranches(resolved.branches) })}>Branches</Button>
            </div>
            <Button variant="outline" disabled={busy} onClick={() => void run(async () => { setImports(await window.electronAPI.collaboration.inspectImportableChanges(sourceWorkspaceId)) })}>Review local text to copy</Button>
            {imports.map(file => <details key={file.path} className="rounded border p-2 text-xs"><summary><label><input type="checkbox" checked={selected.includes(file.path)} onChange={event => setSelected(values => event.target.checked ? [...values, file.path] : values.filter(value => value !== file.path))} /> {file.path}{file.content === null ? " (delete)" : ""}</label></summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{file.content ?? "This file is deleted locally."}</pre></details>)}
            <Button disabled={busy || Boolean(waitingId)} onClick={() => void run(start)}>Start session</Button>
            <div className="flex items-center gap-2 text-sm"><label htmlFor="collaboration-role">Join as</label><select id="collaboration-role" className="rounded border bg-background p-1" value={role} onChange={event => setRole(event.target.value as "editor" | "observer")}><option value="editor">Editor</option><option value="observer">Observer</option></select></div>
            {sessions.map(room => <div key={room.id} className="flex items-center justify-between gap-2 rounded border p-2 text-xs"><span>{room.targetBranch} · {room.status}</span><Button variant="outline" size="sm" disabled={busy || room.status === "opening"} onClick={() => void run(() => join(room.id))}>Join / Resume</Button></div>)}
          </>}
          {waitingId && <div role="status" className="space-y-2 text-sm"><p>Waiting for an authorized editor to supply this device’s encrypted session key.</p><Button disabled={busy} onClick={() => void run(() => join(waitingId))}>Retry joining</Button></div>}
        </div>}
        {sessionId && snapshot && <div className="space-y-3">
          <RecoveredOfflineEdits sessionId={sessionId} readOnly={snapshot.role !== "editor"} />
          <div className="flex flex-wrap gap-2 text-xs"><span>{snapshot.role} · {snapshot.connection} · acknowledged update {snapshot.sequence}</span>{participants.filter(p => p.leftAt === null).map(p => <span key={p.userId} className="rounded bg-muted px-2 py-1" title={p.userId}>{p.userId.slice(0, 12)} · {p.role}</span>)}</div>
          <div className="flex gap-2"><Input aria-label="Session file path" placeholder="src/example.ts" value={filePath} onChange={event => setFilePath(event.target.value)} /><Button disabled={busy || !filePath} onClick={() => { setEditorPath(filePath) }}>Open</Button><Button variant="outline" disabled={busy || snapshot.role !== "editor" || !filePath} onClick={() => void run(async () => { await api.createFile({ sessionId, path: filePath }); setEditorPath(filePath) })}>New file</Button></div>
          <div className="flex flex-wrap gap-1">{snapshot.files.map(file => <Button variant="ghost" size="sm" key={file.id} onClick={() => file.deleted ? void run(() => api.restoreFile({ sessionId, fileId: file.id })) : setEditorPath(file.path)} disabled={file.deleted && snapshot.role !== "editor"}>{file.path}{file.deleted ? " · Restore" : ""}</Button>)}</div>
          {snapshot.gitOnlyPaths.length > 0 && <p className="text-xs text-muted-foreground">Git-only files: {snapshot.gitOnlyPaths.join(", ")}</p>}
          {snapshot.conflicts.map(conflict => <div key={conflict.path} role="alert" className="space-y-1 text-sm text-destructive"><p>Path collision: {conflict.path}. Enter a new path above and choose the file to rename.</p>{conflict.fileIds.map(fileId => <Button key={fileId} variant="outline" size="sm" disabled={busy || snapshot.role !== "editor" || !filePath} onClick={() => void run(() => api.renameFile({ sessionId, fileId, path: filePath }))}>Rename file {fileId.slice(0, 8)}</Button>)}</div>)}
          {editorPath && <div className="h-72"><SharedSessionEditor key={`${sessionId}:${editorPath}`} sessionId={sessionId} path={editorPath} readOnly={snapshot.role === "observer"} /></div>}
          {editorPath && snapshot.role === "editor" && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || !filePath} onClick={() => void run(async () => { const file = snapshot.files.find(file => file.path === editorPath); if (!file) return; await api.renameFile({ sessionId, fileId: file.id, path: filePath }); setEditorPath(filePath) })}>Rename to path above</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { const file = snapshot.files.find(file => file.path === editorPath); if (file) await api.deleteFile({ sessionId, fileId: file.id }); setEditorPath("") })}>Delete shared file</Button></div>}
          {snapshot.role === "editor" && <div className="space-y-2 border-t pt-3">
            <Input aria-label="Commit message" placeholder="Commit message" value={message} onChange={event => setMessage(event.target.value)} />
            <div className="flex gap-2"><Input aria-label="Git author name" placeholder="Git author name" value={authorName} onChange={event => setAuthorName(event.target.value)} /><Input aria-label="Git author email" placeholder="Git author email" value={authorEmail} onChange={event => setAuthorEmail(event.target.value)} /></div>
            <CollaborationBinaryPicker key={sessionId} sessionId={sessionId} disabled={busy} value={selectedBinaries} onChange={files => setBinarySelection({ sessionId, files })} />
            <p className="text-xs text-muted-foreground">Commit includes all acknowledged shared text and only the local binary paths you select. Push publishes the prepared commit to the session branch.</p>
            <div className="space-y-3"><Button disabled={busy || !message || !authorName || !authorEmail || Boolean(prepared && !["published", "discarded"].includes(prepared.state))} onClick={() => void run(async () => { setPrepared(await api.commit({ sessionId, message, authorName, authorEmail, binaryPaths: selectedBinaries.map(file => file.path), binaryReviews: selectedBinaries })) })}>Commit shared snapshot</Button>
              {prepared && !["published", "discarded"].includes(prepared.state) && <CollaborationCommitReview key={prepared.commitSha} sessionId={sessionId} prepared={prepared} disabled={busy} onPush={commitSha => void run(async () => { setPrepared(await api.push({ sessionId, commitSha })) })} onDiscard={() => void run(() => api.discard(sessionId))} />}
            </div>
            {prepared && <p className="text-xs">Commit {prepared.commitSha.slice(0, 12)} · {prepared.state} · through update {prepared.throughSequence}</p>}
          </div>}
          <div className="flex gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={() => void run(async () => { await api.retry(sessionId); await sessionEditorBridge.flush(sessionId) }, false)}>Retry sync</Button><Button variant="outline" disabled={busy} onClick={() => void run(async () => { await api.leave({ sessionId }); setEditorPath("") })}>Leave</Button>{snapshot.role === "editor" && <Button variant="destructive" disabled={busy} onClick={() => void run(async () => { await api.leave({ sessionId, end: true }); setEditorPath("") })}>End for everyone</Button>}</div>
        </div>}
      </DialogContent>
    </Dialog>
  </>
}
