import * as Y from "yjs"

export interface CollaborationCommitSnapshot {
  sequence: number
  files: Array<{ path: string; content: string }>
}

export interface CollaborationTransportHandle {
  requestBarrier(timeoutMs?: number): Promise<number>
  captureCommitState(): Promise<{ sequence: number; update: Uint8Array }>
  sendMediaSignal(targetClientId: string, signal: unknown): void
  setMediaState(state: { audio: boolean; screenShare: boolean }): void
}

export interface CollaborationRuntimeEntry {
  projectId: string
  sessionId: string
  provider: CollaborationTransportHandle
  document: Y.Doc
}

const entries = new Map<string, CollaborationRuntimeEntry>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function registerCollaborationRuntime(entry: CollaborationRuntimeEntry): () => void {
  entries.set(entry.projectId, entry)
  emit()
  return () => {
    if (entries.get(entry.projectId)?.provider === entry.provider) {
      entries.delete(entry.projectId)
      emit()
    }
  }
}

export function getCollaborationRuntime(projectId: string): CollaborationRuntimeEntry | null {
  return entries.get(projectId) ?? null
}

export function subscribeCollaborationRuntime(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function captureCollaborationCommitSnapshot(
  projectId: string,
): Promise<CollaborationCommitSnapshot> {
  const entry = entries.get(projectId)
  if (!entry) throw new Error("The live collaboration runtime is not connected")

  const { sequence, update } = await entry.provider.captureCommitState()
  const snapshot = new Y.Doc()
  try {
    Y.applyUpdate(snapshot, update)
    const files = [...snapshot.getMap<Y.Text>("files").entries()]
      .map(([path, text]) => ({ path, content: text.toString() }))
      .sort((left, right) => left.path.localeCompare(right.path))
    return { sequence, files }
  } finally {
    snapshot.destroy()
  }
}

export function sendCollaborationMediaSignal(
  projectId: string,
  targetClientId: string,
  signal: unknown,
): void {
  entries.get(projectId)?.provider.sendMediaSignal(targetClientId, signal)
}

export function setCollaborationMediaState(
  projectId: string,
  state: { audio: boolean; screenShare: boolean },
): void {
  entries.get(projectId)?.provider.setMediaState(state)
}
