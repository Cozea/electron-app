/** Tracks accepted work separately from whether a new command may enter.
 * Fencing is synchronous. Accepted callbacks retain their original runtime;
 * draining observes completion, not a claim that rejected work was saved.
 */
export class SessionCommandAdmission {
  private readonly pending = new Map<string, Set<Promise<unknown>>>()
  private readonly fenced = new Set<string>()
  private halted = false

  run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    if (this.isFenced(sessionId)) return Promise.reject(new Error("Session is leaving or recovery is being saved; no new commands are accepted"))
    const entries = this.pending.get(sessionId) ?? new Set<Promise<unknown>>()
    if (entries.size >= 1024) return Promise.reject(new Error("Session command queue is full; retry after accepted work completes"))
    const result = Promise.resolve().then(operation)
    entries.add(result); this.pending.set(sessionId, entries)
    const release = () => {
      entries.delete(result)
      if (!entries.size && this.pending.get(sessionId) === entries) this.pending.delete(sessionId)
    }
    void result.then(release, release)
    return result
  }

  isFenced(sessionId: string): boolean { return this.halted || this.fenced.has(sessionId) }
  fence(sessionId: string): void { this.fenced.add(sessionId) }
  fenceAll(): void { this.halted = true }
  allowAfterShutdownFailure(): void { this.halted = false }

  resume(sessionId: string): void {
    if (this.halted || this.pending.get(sessionId)?.size) throw new Error("Drain the previous session owner before resuming")
    this.fenced.delete(sessionId)
  }

  async drain(sessionId: string): Promise<void> {
    // Callers fence before draining. Individual errors remain attached to their
    // original requests; runtime.stop() independently flushes durable recovery.
    while (this.pending.get(sessionId)?.size) await Promise.allSettled([...this.pending.get(sessionId)!])
  }

  async drainAll(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending.keys()].map(id => this.drain(id)))
  }
}
