import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { CollaborationSessionDescriptor, CollaborationParticipantDescriptor } from "@shared/collaborationSession"
import type { PreparedCollaborationCommit } from "@shared/collaborationDesktop"
import type { SessionRuntimeSnapshot } from "@shared/collaborationRuntime"
import type { CollaborationBinaryCandidate } from "@shared/collaborationCommitReview"
import { CollaborationCommitReview } from "./CollaborationCommitReview"
import { CollaborationRecoveryPanel } from "./CollaborationRecoveryPanel"
import { RecoveredOfflineEdits } from "./RecoveredOfflineEdits"

interface Props { projectId: string; sourceWorkspaceId: string; defaultBranch?: string | null }

export function ProjectCollaborationControl({ projectId, sourceWorkspaceId, defaultBranch }: Props) {
  const runtime = window.electronAPI.collaboration.runtime
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<CollaborationSessionDescriptor[]>([])
  const [participants, setParticipants] = useState<CollaborationParticipantDescriptor[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<SessionRuntimeSnapshot | null>(null)
  const [prepared, setPrepared] = useState<PreparedCollaborationCommit | null>(null)
  const [branch, setBranch] = useState(defaultBranch?.trim() || "main")
  const [role, setRole] = useState<"editor" | "observer">("editor")
  const [message, setMessage] = useState("")
  const [authorName, setAuthorName] = useState("")
  const [authorEmail, setAuthorEmail] = useState("")
  const [binaryCandidates, setBinaryCandidates] = useState<CollaborationBinaryCandidate[]>([])
  const [selectedBinaryPaths, setSelectedBinaryPaths] = useState<string[]>([])
  const creationToken = useRef(crypto.randomUUID())

  const control = useCallback(<T,>(operation: string, args: Record<string, unknown>) =>
    runtime.control({ operation, args }) as Promise<T>, [runtime])

  const refresh = useCallback(async () => {
    const [active, rooms] = await Promise.all([
      runtime.active(projectId),
      control<CollaborationSessionDescriptor[]>("listForProject", { projectId }),
    ])
    setActiveId(active); setSessions(rooms)
    if (!active) {
      setParticipants([]); setSnapshot(null); setPrepared(null); setBinaryCandidates([])
      return
    }
    const [nextSnapshot, nextPrepared, nextParticipants, binaries] = await Promise.all([
      runtime.snapshot(active), runtime.prepared(active),
      control<CollaborationParticipantDescriptor[]>("listParticipants", { sessionId: active }),
      runtime.binaryCandidates(active),
    ])
    setSnapshot(nextSnapshot); setPrepared(nextPrepared); setParticipants(nextParticipants); setBinaryCandidates(binaries)
  }, [control, projectId, runtime])

  useEffect(() => {
    void refresh().catch(() => {})
    return runtime.onChanged(sessionId => {
      if (!activeId || sessionId === activeId) void refresh().catch(() => {})
    })
  }, [activeId, refresh, runtime])

  useEffect(() => {
    if (!open) return
    void refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Collaboration unavailable"))
    const timer = window.setInterval(() => void refresh().catch(() => {}), 15_000)
    return () => window.clearInterval(timer)
  }, [open, refresh])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await operation(); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Collaboration action failed") }
    finally { setBusy(false) }
  }

  const start = () => run(async () => {
    const session = await control<CollaborationSessionDescriptor>("startSession", {
      projectId, targetBranch: branch, creationToken: creationToken.current,
    })
    await control("activateSession", { sessionId: session.id })
    if (!await runtime.open({ sessionId: session.id, sourceWorkspaceId })) {
      throw new Error("Waiting for an authorized editor to initialize the encrypted session")
    }
    creationToken.current = crypto.randomUUID()
  })

  const join = (sessionId: string) => run(async () => {
    await control("joinSession", { sessionId, requestedRole: role })
    const retained = await window.electronAPI.collaboration.getBinding(sessionId)
    if (!await runtime.open({ sessionId, sourceWorkspaceId: retained?.sourceWorkspaceId ?? sourceWorkspaceId })) {
      throw new Error("Waiting for an editor to share the encrypted session key")
    }
  })

  const commit = () => run(async () => {
    if (!activeId || snapshot?.role !== "editor") return
    const binaryReviews = binaryCandidates.filter(candidate => selectedBinaryPaths.includes(candidate.path))
      .map(candidate => ({ path: candidate.path, reviewHash: candidate.reviewHash }))
    await runtime.commit({ sessionId: activeId, binaryPaths: selectedBinaryPaths, binaryReviews,
      message, authorName, authorEmail })
  })

  const activeSession = useMemo(() => sessions.find(session => session.id === activeId) ?? null, [activeId, sessions])
  const activeCount = participants.filter(participant => participant.leftAt === null).length

  return <>
    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>
      {snapshot ? `${Math.max(1, activeCount)} · ${snapshot.connection}` : "Live"}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Live collaboration</DialogTitle><DialogDescription>
          Shared edits use an isolated session workspace. Commit and Push remain explicit.
        </DialogDescription></DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <CollaborationRecoveryPanel sessionId={activeId} disabled={busy} />
        {!activeId ? <div className="space-y-3">
          <div className="flex gap-2"><Input aria-label="Target branch" value={branch} onChange={event => setBranch(event.target.value)} />
            <Button disabled={busy || !branch.trim()} onClick={() => void start()}>Start live</Button></div>
          <label className="flex items-center gap-2 text-sm">Join as <select className="rounded border bg-background p-1" value={role}
            onChange={event => setRole(event.target.value as "editor" | "observer")}><option value="editor">Editor</option><option value="observer">Observer</option></select></label>
          {sessions.filter(session => !["closed", "failed"].includes(session.status)).map(session =>
            <div key={session.id} className="flex items-center justify-between rounded border p-2 text-xs">
              <span>{session.targetBranch} · {session.status}</span><Button size="sm" variant="outline" disabled={busy || session.status === "opening"}
                onClick={() => void join(session.id)}>Join / Resume</Button></div>)}
        </div> : snapshot ? <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{snapshot.role} · {snapshot.connection} · acknowledged update {snapshot.sequence}
            {activeSession ? ` · ${activeSession.sessionBranch}` : ""}</p>
          <div className="flex flex-wrap gap-1">{participants.filter(p => p.leftAt === null).map(p =>
            <span key={p.principalId} className="rounded bg-muted px-2 py-1 text-xs">{p.principalId.slice(0, 12)} · {p.role}</span>)}</div>
          <RecoveredOfflineEdits sessionId={activeId} readOnly={snapshot.role !== "editor"} />
          {binaryCandidates.length ? <div className="space-y-1"><p className="text-sm font-medium">Git-only files</p>
            {binaryCandidates.map(candidate => <label key={candidate.path} className="flex items-center gap-2 text-xs"><input type="checkbox"
              disabled={snapshot.role !== "editor" || busy} checked={selectedBinaryPaths.includes(candidate.path)} onChange={event =>
                setSelectedBinaryPaths(current => event.target.checked ? [...current, candidate.path] : current.filter(path => path !== candidate.path))} />{candidate.path}</label>)}</div> : null}
          {snapshot.role === "editor" ? <div className="grid gap-2"><Input placeholder="Commit message" value={message} onChange={event => setMessage(event.target.value)} />
            <div className="grid grid-cols-2 gap-2"><Input placeholder="Git author name" value={authorName} onChange={event => setAuthorName(event.target.value)} />
              <Input placeholder="Git author email" value={authorEmail} onChange={event => setAuthorEmail(event.target.value)} /></div>
            {!prepared ? <Button disabled={busy || !message.trim() || !authorName.trim() || !authorEmail.trim()} onClick={() => void commit()}>Commit</Button> :
              <CollaborationCommitReview sessionId={activeId} prepared={prepared} disabled={busy}
                onPush={commitSha => void run(async () => { await runtime.push({ sessionId: activeId, commitSha }) })}
                onDiscard={() => void run(() => runtime.discard(activeId))} />}</div> : null}
          <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void run(() => runtime.retry(activeId))}>Retry sync</Button>
            <Button variant="outline" disabled={busy} onClick={() => void run(() => runtime.leave({ sessionId: activeId }))}>Leave</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void run(() => runtime.leave({ sessionId: activeId, end: true }))}>End session</Button></div>
        </div> : null}
      </DialogContent>
    </Dialog>
  </>
}
