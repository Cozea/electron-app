import type { CollabWsProvider } from "@/features/collaboration/runtime/CollaborationTransport"
import type { YjsProjectDoc } from "@/lib/yjs/YjsProjectDoc"

export interface CollaborationCommitSnapshot {
  sequence: number
  files: Array<{ path: string; content: string }>
}

export interface CollaborationRuntimeEntry {
  projectId: string
  sessionId: string
  provider: CollabWsProvider
  document: YjsProjectDoc
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

  const sequence = await entry.provider.requestBarrier()
  const files = [...entry.document.files.entries()]
    .map(([path, text]) => ({ path, content: text.toString() }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return { sequence, files }
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
