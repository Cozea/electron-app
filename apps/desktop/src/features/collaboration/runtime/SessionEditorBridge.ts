/** View-independent IPC queue. Closing an editor never drops a rejected write. */
export class SessionEditorBridge {
  private readonly queues = new Map<string, Uint8Array[]>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly send: (sessionId: string, update: Uint8Array) => Promise<void>
  constructor(send: (sessionId: string, update: Uint8Array) => Promise<void>) { this.send = send }
  enqueue(sessionId: string, update: Uint8Array): Promise<void> {
    const queue = this.queues.get(sessionId) ?? []
    queue.push(update.slice()); this.queues.set(sessionId, queue)
    return this.flush(sessionId)
  }
  count(sessionId: string): number { return this.queues.get(sessionId)?.length ?? 0 }
  pendingCount(): number {
    let count = 0
    for (const queue of this.queues.values()) count += queue.length
    return count
  }
  async flushAll(): Promise<void> {
    await Promise.all([...this.queues.keys()].map(sessionId => this.flush(sessionId)))
  }
  flush(sessionId: string): Promise<void> {
    const active = this.running.get(sessionId)
    if (active) return active
    if (!this.count(sessionId)) return Promise.resolve()
    const run = (async () => {
      const queue = this.queues.get(sessionId)
      while (queue?.length) { await this.send(sessionId, queue[0]!); queue.shift() }
      this.queues.delete(sessionId)
    })().then(() => {
      this.running.delete(sessionId)
      if (this.count(sessionId)) return this.flush(sessionId)
    }, error => { this.running.delete(sessionId); throw error })
    this.running.set(sessionId, run)
    return run
  }
}

/** A rejected or in-flight IPC update is not yet main-process recovery data.
 * Keep the window alive until durable acceptance; a close attempt may retry the
 * queues, but never grants an unsafe "discard and close" path. */
export function installSessionEditorUnloadGuard(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  bridge: SessionEditorBridge,
): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (bridge.pendingCount() === 0) return
    event.preventDefault()
    event.returnValue = "Pending collaboration edits have not been durably accepted."
    void bridge.flushAll().catch(() => {})
  }
  target.addEventListener("beforeunload", onBeforeUnload)
  return () => target.removeEventListener("beforeunload", onBeforeUnload)
}

export const sessionEditorBridge = new SessionEditorBridge((sessionId, update) => window.electronAPI.collaboration.runtime.edit({ sessionId, update }))
if (typeof window !== "undefined") installSessionEditorUnloadGuard(window, sessionEditorBridge)
