import { useEffect, useState } from "react"

import type { OrgDevAppRuntimeState } from "@shared/orgDevAppRuntime"

export interface OrgDevAppRuntimeIdentity {
  contentHash: string
  publicationId: string
}

export interface OrgDevAppRuntimeObservation {
  state: OrgDevAppRuntimeState | null
  error: string | null
}

type Listener = (snapshot: OrgDevAppRuntimeObservation) => void
type RuntimeStateLoader = (
  identity: OrgDevAppRuntimeIdentity,
) => Promise<{ success: true; state: OrgDevAppRuntimeState } | { success: false; error: string }>

interface ObserverEntry {
  identity: OrgDevAppRuntimeIdentity
  snapshot: OrgDevAppRuntimeObservation
  consumers: Map<Listener, boolean>
  timer: ReturnType<typeof setTimeout> | null
  inFlight: Promise<void> | null
}

function identityKey(identity: OrgDevAppRuntimeIdentity): string {
  return `${identity.contentHash}\u001f${identity.publicationId}`
}

export class OrgDevAppRuntimeObserver {
  private readonly entries = new Map<string, ObserverEntry>()
  private readonly load: RuntimeStateLoader

  constructor(load: RuntimeStateLoader) {
    this.load = load
  }

  private getOrCreate(identity: OrgDevAppRuntimeIdentity): ObserverEntry {
    const key = identityKey(identity)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        identity,
        snapshot: { state: null, error: null },
        consumers: new Map(),
        timer: null,
        inFlight: null,
      }
      this.entries.set(key, entry)
    }
    return entry
  }

  private publishEntry(entry: ObserverEntry, snapshot: OrgDevAppRuntimeObservation): void {
    entry.snapshot = snapshot
    for (const listener of entry.consumers.keys()) listener(snapshot)
  }

  private schedule(entry: ObserverEntry, delay?: number): void {
    if (entry.consumers.size === 0 || entry.timer) return
    const interval = delay ?? ([...entry.consumers.values()].some(Boolean) ? 1_000 : 2_500)
    entry.timer = setTimeout(() => {
      entry.timer = null
      void this.refresh(entry)
    }, interval)
  }

  private refresh(entry: ObserverEntry): Promise<void> {
    if (entry.inFlight) return entry.inFlight
    const key = identityKey(entry.identity)
    const attempt = this.load(entry.identity)
      .then((result) => {
        if (this.entries.get(key) !== entry || entry.consumers.size === 0) return
        this.publishEntry(
          entry,
          result.success
            ? { state: result.state, error: null }
            : { state: entry.snapshot.state, error: result.error },
        )
      })
      .catch((error: unknown) => {
        if (this.entries.get(key) !== entry || entry.consumers.size === 0) return
        this.publishEntry(entry, {
          state: entry.snapshot.state,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        if (entry.inFlight === attempt) entry.inFlight = null
        if (this.entries.get(key) === entry) {
          if (entry.consumers.size > 0) this.schedule(entry)
          else this.entries.delete(key)
        }
      })
    entry.inFlight = attempt
    return attempt
  }

  acquire(
    identity: OrgDevAppRuntimeIdentity,
    detailed: boolean,
    listener: Listener,
  ): () => void {
    const entry = this.getOrCreate(identity)
    entry.consumers.set(listener, detailed)
    listener(entry.snapshot)
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    this.schedule(entry, 0)

    return () => {
      entry.consumers.delete(listener)
      if (entry.consumers.size > 0) {
        if (entry.timer) {
          clearTimeout(entry.timer)
          entry.timer = null
        }
        this.schedule(entry)
        return
      }
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = null
      if (!entry.inFlight) this.entries.delete(identityKey(identity))
    }
  }

  publish(identity: OrgDevAppRuntimeIdentity, state: OrgDevAppRuntimeState): void {
    this.publishEntry(this.getOrCreate(identity), { state, error: null })
  }
}

export const orgDevAppRuntimeObserver = new OrgDevAppRuntimeObserver((identity) =>
  window.electronAPI.orgDevApp.getRuntimeState(identity),
)

const EMPTY_OBSERVATION: OrgDevAppRuntimeObservation = { state: null, error: null }

export function useOrgDevAppRuntimeObservation(
  identity: OrgDevAppRuntimeIdentity | null,
  enabled: boolean,
  detailed: boolean,
): OrgDevAppRuntimeObservation {
  const scope = identity ? identityKey(identity) : ""
  const [observed, setObserved] = useState<{
    scope: string
    snapshot: OrgDevAppRuntimeObservation
  }>({ scope: "", snapshot: EMPTY_OBSERVATION })

  useEffect(() => {
    if (!identity || !enabled) return
    return orgDevAppRuntimeObserver.acquire(identity, detailed, (snapshot) => {
      setObserved({ scope, snapshot })
    })
  }, [detailed, enabled, identity?.contentHash, identity?.publicationId, scope])

  return enabled && observed.scope === scope ? observed.snapshot : EMPTY_OBSERVATION
}
