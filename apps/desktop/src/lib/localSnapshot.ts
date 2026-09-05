export interface LocalSnapshot<T> {
  data: T | null
  error: string | null
  refreshing: boolean
}

/** Device presentation cache. Events/mutations always win over older reads. */
export function createLocalSnapshot<T>(options: {
  read: () => Promise<T>
  connect?: (publish: (value: T) => void) => () => void
  maxAgeMs?: number
}) {
  let state: LocalSnapshot<T> = { data: null, error: null, refreshing: false }
  let revision = 0
  let updatedAt = 0
  let pending: Promise<T> | null = null
  let disconnect: (() => void) | null = null
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  const publish = (data: T) => {
    revision += 1
    updatedAt = Date.now()
    state = { data, error: null, refreshing: state.refreshing }
    notify()
  }
  const connect = () => {
    if (!disconnect && options.connect) disconnect = options.connect(publish)
  }
  const refresh = (): Promise<T> => {
    connect()
    if (pending) return pending
    const startedAtRevision = revision
    state = { ...state, error: null, refreshing: true }
    pending = Promise.resolve().then(options.read).then((data) => {
      if (revision === startedAtRevision) publish(data)
      return state.data ?? data
    }).catch((error: unknown) => {
      if (revision === startedAtRevision) {
        state = { ...state, error: error instanceof Error ? error.message : 'Unable to refresh local data.' }
      }
      throw error
    }).finally(() => {
      pending = null
      state = { ...state, refreshing: false }
      notify()
    })
    notify()
    return pending
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      connect()
      return () => { listeners.delete(listener) }
    },
    publish,
    refresh,
    ensure: () => state.data !== null && Date.now() - updatedAt < (options.maxAgeMs ?? 30_000)
      ? Promise.resolve(state.data)
      : refresh(),
    dispose: () => { disconnect?.(); disconnect = null; listeners.clear() },
  }
}
