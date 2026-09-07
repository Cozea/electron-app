#!/usr/bin/env python3
from pathlib import Path
import subprocess


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def source(path: str) -> str:
    return subprocess.check_output(["git", "show", f"origin/codex/collaboration-v2-complete:{path}"], text=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"{label}: anchor missing")
    return text.replace(old, new, 1)


# Port the mature generation-3 recovery/editor/review components. They speak only to the safe preload API.
for path in [
    "apps/desktop/src/features/collaboration/CollaborationCommitReview.tsx",
    "apps/desktop/src/features/collaboration/CollaborationRecoveryPanel.tsx",
    "apps/desktop/src/features/collaboration/RecoveredOfflineEdits.tsx",
    "apps/desktop/src/features/collaboration/SharedSessionEditor.tsx",
    "apps/desktop/src/features/collaboration/runtime/SessionEditorBridge.ts",
]:
    write(path, source(path).replace("userId", "principalId").replace("UserId", "PrincipalId"))

# Current-main Live control: project.repo is canonical and repository setup is not duplicated here.
write("apps/desktop/src/features/collaboration/ProjectCollaborationControl.tsx", '''import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
''')

# Legacy renderer runtime remains local-only for ordinary Git lanes; it can no longer open the live WebSocket path.
runtime_path = "apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx"
runtime = read(runtime_path)
runtime = runtime.replace("  const sharedCollaborationEnabled = canSync && collaborationEnabled\n", "  const sharedCollaborationEnabled = false\n")
runtime = runtime.replace('  const collaborationMode: "shared" | "local" = sharedCollaborationEnabled ? "shared" : "local"\n', '  const collaborationMode: "shared" | "local" = "local"\n')
write(runtime_path, runtime)

# Workspace runtime store keeps its stable consumer boundary while session:<id> is backed by the Electron owner.
hosts_path = "apps/desktop/src/features/workspace/WorkspaceRuntimeHosts.tsx"
hosts = read(hosts_path)
if "CollaborationWorkspaceRuntimeHost" not in hosts:
    hosts = hosts.replace('import { memo, useEffect, useMemo } from "react"', 'import { memo, useEffect, useMemo, useState } from "react"', 1)
    hosts = hosts.replace('  useYjsProject,\n} from "@/contexts/YjsProjectContextValue"', '  EMPTY_YJS_PROJECT_CONTEXT_VALUE,\n  useYjsProject,\n  YjsProjectContextBridgeProvider,\n} from "@/contexts/YjsProjectContextValue"', 1)
    hosts = hosts.replace('import { ProjectSyncProviderRuntime } from "@/contexts/project/ProjectSyncProviderRuntime"\n', 'import { ProjectSyncProviderRuntime } from "@/contexts/project/ProjectSyncProviderRuntime"\nimport { IDLE_SYNC_PROGRESS, ProjectSyncContext } from "@/contexts/project/projectSyncShared"\n', 1)
    bridge = '''
function CollaborationWorkspaceRuntimeHost({ record, sessionId }: { record: WorkspaceRuntimeRecord; sessionId: string }) {
  const { runtimeId, workspaceId, config } = record
  const publishSyncContext = useWorkspaceRuntimeStore(state => state.actions.publishSyncContext)
  const publishYjsContext = useWorkspaceRuntimeStore(state => state.actions.publishYjsContext)
  const clearPublishedContexts = useWorkspaceRuntimeStore(state => state.actions.clearPublishedContexts)
  const [snapshot, setSnapshot] = useState<import("@shared/collaborationRuntime").SessionRuntimeSnapshot | null>(null)
  const runtime = window.electronAPI.collaboration.runtime
  useEffect(() => {
    let alive = true
    const refresh = () => void runtime.snapshot(sessionId).then(value => { if (alive) setSnapshot(value) }).catch(() => { if (alive) setSnapshot(null) })
    refresh(); const unsubscribe = runtime.onChanged(changed => { if (changed === sessionId) refresh() })
    return () => { alive = false; unsubscribe() }
  }, [runtime, sessionId])
  const syncContext = useMemo(() => snapshot ? {
    isSynced: true, cloudSyncBlocked: false, lastSyncAt: Date.now(), workspaceId, gitCwd: config.gitCwd,
    collaborationEnabled: true, collaborationMode: "shared" as const, activeBranch: config.activeBranch,
    sharedBranch: config.sharedBranch, collabSessionStatus: snapshot.error ? "error" as const : "ready" as const,
    collabSessionError: snapshot.error, collabEncryptionStatus: "ready" as const,
    triggerSync: async () => { await runtime.retry(sessionId) }, syncProgress: IDLE_SYNC_PROGRESS,
  } : null, [config.activeBranch, config.gitCwd, config.sharedBranch, runtime, sessionId, snapshot, workspaceId])
  useEffect(() => {
    publishSyncContext(runtimeId, syncContext); publishYjsContext(runtimeId, EMPTY_YJS_PROJECT_CONTEXT_VALUE)
    return () => clearPublishedContexts(runtimeId)
  }, [clearPublishedContexts, publishSyncContext, publishYjsContext, runtimeId, syncContext])
  return <ProjectSyncContext.Provider value={syncContext}><YjsProjectContextBridgeProvider value={EMPTY_YJS_PROJECT_CONTEXT_VALUE}>
    <WorkspaceRuntimeObserver runtimeId={runtimeId} /></YjsProjectContextBridgeProvider></ProjectSyncContext.Provider>
}

'''
    hosts = hosts.replace('// Memoized so a write to one runtime record does not re-render every other\n', bridge + '// Memoized so a write to one runtime record does not re-render every other\n', 1)
    hosts = hosts.replace('''  if (!config.projectId || !config.principalId || !config.workspaceId) {
    return null
  }

  return (
''', '''  if (!config.projectId || !config.principalId || !config.workspaceId) return null
  const sessionId = config.laneId?.startsWith("session:") ? config.laneId.slice("session:".length) : null
  if (sessionId) return <CollaborationWorkspaceRuntimeHost record={record} sessionId={sessionId} />

  return (
''', 1)
write(hosts_path, hosts)

# ProjectLayout: only a catalog-owned generation-3 session binding can activate collaboration.
layout_path = "apps/desktop/src/features/projects/layouts/ProjectLayout.tsx"
layout = read(layout_path)
layout = layout.replace('import { lazy, Suspense, type ReactNode, useCallback, useEffect, useMemo } from "react";', 'import { lazy, Suspense, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";')
if "ProjectCollaborationControl" not in layout:
    layout = layout.replace('import { downloadAuthorizedProjectRepository } from "@/features/collaboration/api/downloadAuthorizedProjectRepository";\n', 'import { downloadAuthorizedProjectRepository } from "@/features/collaboration/api/downloadAuthorizedProjectRepository";\nimport { ProjectCollaborationControl } from "@/features/collaboration/ProjectCollaborationControl";\n', 1)
if "const [activeCollaborationBinding" not in layout:
    layout = replace_once(layout, '  const runtimeWorkspaceId = activeWorkspaceId;\n', '''  const runtimeWorkspaceId = activeWorkspaceId;
  const [activeCollaborationBinding, setActiveCollaborationBinding] = useState<import("@shared/collaborationDesktop").SessionWorkspaceBinding | null>(null);
  useEffect(() => {
    let alive = true;
    if (!activeWorkspaceId) { setActiveCollaborationBinding(null); return; }
    const refresh = () => void window.electronAPI.collaboration.bindingForWorkspace(activeWorkspaceId)
      .then(binding => { if (alive) setActiveCollaborationBinding(binding && ["active", "joining"].includes(binding.state) ? binding : null); })
      .catch(() => { if (alive) setActiveCollaborationBinding(null); });
    refresh(); const unsubscribe = window.electronAPI.collaboration.runtime.onChanged(refresh);
    return () => { alive = false; unsubscribe(); };
  }, [activeWorkspaceId]);
''', "layout session binding")
old = '''  const activeBranch = activeLane?.branch ?? collabBranch;
  const collaborationEnabled =
    shouldEnableProjectRuntime && Boolean(runtimeWorkspaceId) && Boolean(project?._id) && activeBranch === collabBranch;
  const documentScopeId = useMemo(() => {
'''
new = '''  const sessionLane = useMemo(() => activeCollaborationBinding ? ({
    id: `session:${activeCollaborationBinding.sessionId}`, name: "Live", branch: activeCollaborationBinding.sessionBranch,
    workspaceId: activeCollaborationBinding.workspaceId, isCollab: true, createdAt: activeCollaborationBinding.joinedAt,
    updatedAt: activeCollaborationBinding.joinedAt,
  }) : null, [activeCollaborationBinding]);
  const effectiveActiveLane = sessionLane ?? activeLane;
  const activeBranch = effectiveActiveLane?.branch ?? collabBranch;
  const collaborationEnabled = Boolean(shouldEnableProjectRuntime && runtimeWorkspaceId && project?._id && activeCollaborationBinding);
  const documentScopeId = useMemo(() => {
'''
layout = replace_once(layout, old, new, "explicit collaboration lane")
layout = layout.replace('''    if (!activeLane || activeLane.isCollab) {
      return routeProjectIdentity;
    }

    return `${routeProjectIdentity}:${buildBranchSessionLaneId(activeLane.branch, collabBranch)}`;
  }, [activeLane, collabBranch, routeProjectIdentity]);
''', '''    if (activeCollaborationBinding) return `session:${activeCollaborationBinding.sessionId}`;
    if (!activeLane || activeLane.isCollab) return routeProjectIdentity;
    return `${routeProjectIdentity}:${buildBranchSessionLaneId(activeLane.branch, collabBranch)}`;
  }, [activeCollaborationBinding, activeLane, collabBranch, routeProjectIdentity]);
''', 1)
old_presence = '''  const presenceHeaderAddon = useMemo(
    () => (
      <ProjectPresenceHeaderAddon
        projectId={presenceGateOpen ? project?._id ?? null : null}
        principalId={presenceGateOpen ? principalId ?? null : null}
        isWorkbenchView={isWorkbenchView}
        projectBasePath={projectBasePath}
      />
    ),
'''
new_presence = '''  const presenceHeaderAddon = useMemo(
    () => (
      <div className="flex items-center gap-1">
        <ProjectPresenceHeaderAddon projectId={presenceGateOpen ? project?._id ?? null : null}
          principalId={presenceGateOpen ? principalId ?? null : null} isWorkbenchView={isWorkbenchView} projectBasePath={projectBasePath} />
        {project?._id && activeWorkspaceId ? <ProjectCollaborationControl projectId={String(project._id)}
          sourceWorkspaceId={activeCollaborationBinding?.sourceWorkspaceId ?? activeWorkspaceId} defaultBranch={collabBranch} /> : null}
      </div>
    ),
'''
layout = replace_once(layout, old_presence, new_presence, "live header control")
# Dependency list for that memo.
layout = layout.replace('''      projectBasePath,
    ],
  );
''', '''      projectBasePath,
      activeWorkspaceId,
      activeCollaborationBinding,
      collabBranch,
    ],
  );
''', 1)
layout = layout.replace('          laneId={activeLane?.id ?? laneState?.activeLaneId ?? laneState?.collabLaneId ?? null}\n', '          laneId={effectiveActiveLane?.id ?? laneState?.activeLaneId ?? null}\n', 1)
write(layout_path, layout)

# Hard architectural guardrails.
write("tests/architecture/collaborationGeneration3Cutover.test.ts", '''import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
const root = path.resolve(__dirname, "../..")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("generation-3 collaboration ownership", () => {
  it("registers main ownership and preload", () => {
    const main = read("apps/desktop/electron/main.ts"); const preload = read("apps/desktop/electron/preload.ts")
    expect(main).toContain("registerCollaborationHandlers(ipcMain, app.getPath('userData'))")
    expect(main).toContain("shutdownCollaboration()")
    expect(preload).toContain("collaboration: collaborationBridge")
  })
  it("does not infer live collaboration from a Git branch", () => {
    const layout = read("apps/desktop/src/features/projects/layouts/ProjectLayout.tsx")
    expect(layout).not.toContain("activeBranch === collabBranch")
    expect(layout).toContain("activeCollaborationBinding")
    expect(layout).toContain("session:${activeCollaborationBinding.sessionId}")
  })
  it("keeps legacy renderer transport local-only", () => {
    expect(read("apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx")).toContain("const sharedCollaborationEnabled = false")
  })
  it("registers the full generation-3 gateway", () => {
    const worker = read("cloudflare/worker/src/index.ts")
    for (const route of ["/collab/v2/control", "/collab/v2/keys", "/collab/v2/checkpoint", "/collab/v2/workspace-context", "/collab/repository/resolve"]) expect(worker).toContain(route)
  })
})
''')

print("PR141 renderer finalization transform applied")
