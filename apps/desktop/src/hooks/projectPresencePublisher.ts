export interface PresencePublisherPorts {
  heartbeat(): Promise<unknown>
  leave(): Promise<unknown>
  isVisible(): boolean
  onVisibilityChange(callback: () => void): () => void
  setInterval(callback: () => void, milliseconds: number): unknown
  clearInterval(timer: unknown): void
  onError(error: unknown): void
}

interface PublicationChannel { owner: symbol; tail: Promise<void>; users: number }
const channels = new Map<string, PublicationChannel>()

/** One serialized foreground publisher. No heartbeat can overtake a leave. */
export function createProjectPresencePublisher(ports: PresencePublisherPorts, scope?: string) {
  const token = Symbol("presence")
  const channel = scope ? channels.get(scope) ?? { owner: token, tail: Promise.resolve(), users: 0 } : null
  if (channel && scope) { channel.owner = token; channel.users++; channels.set(scope, channel) }
  const send = async (action: () => Promise<unknown>) => {
    if (!channel) { await action(); return }
    const next = channel.tail.then(async () => { if (channel.owner === token) await action() })
    channel.tail = next.catch(() => {})
    await next
  }
  let stopped = false
  let visible = ports.isVisible()
  let published = false
  let requested = false
  let draining = false
  let lastTransitionAt = 0
  const drain = async () => {
    if (draining) return
    draining = true
    try {
      while (requested) {
        requested = false
        try {
          if (!stopped && visible) {
            await send(ports.heartbeat)
            published = true
          } else if (published) {
            await send(ports.leave)
            published = false
          }
        } catch (error) { ports.onError(error) }
      }
    } finally { draining = false }
  }
  const request = () => { requested = true; void drain() }
  const unsubscribe = ports.onVisibilityChange(() => {
    visible = ports.isVisible()
    request()
  })
  const timer = ports.setInterval(() => { if (visible && !stopped) request() }, 30_000)
  request()
  return {
    update(now = Date.now()) {
      if (stopped || !visible || now - lastTransitionAt < 1_000) return
      lastTransitionAt = now
      request()
    },
    stop() {
      if (stopped) return
      stopped = true
      unsubscribe()
      ports.clearInterval(timer)
      request()
      if (channel && scope) {
        channel.users--
        // Keep the shared queue until any preceding write/leave has settled.
        const retire = async () => {
          while (draining || requested) await new Promise<void>((resolve) => setTimeout(resolve, 0))
          await channel.tail
          if (channel.users === 0 && channels.get(scope) === channel) channels.delete(scope)
        }
        void retire()
      }
    },
  }
}
