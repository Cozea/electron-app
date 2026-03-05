type AsyncWork<T> = () => Promise<T>

export class RuntimeLockManager {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  async withLock<T>(key: string, work: AsyncWork<T>): Promise<T> {
    const existing = this.inFlight.get(key)
    if (existing) {
      await existing
    }

    const current = work()
    this.inFlight.set(key, current)

    try {
      return await current
    } finally {
      this.inFlight.delete(key)
    }
  }
}

export const runtimeLocks = new RuntimeLockManager()

