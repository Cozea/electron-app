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

export const sessionEditorBridge = new SessionEditorBridge((sessionId, update) => window.electronAPI.collaboration.runtime.edit({ sessionId, update }))
