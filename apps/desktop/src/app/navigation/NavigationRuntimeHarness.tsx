import { useEffect, useMemo, useState } from 'react'
import { WorkbenchKeepAliveHost } from '@/features/workbench/WorkbenchKeepAliveHost'
import type { WorkbenchKeepAliveSession } from '@/features/workbench/workbenchKeepAlive'
import { buildPresentationInstanceKey } from '@shared/navigationRuntimeTypes'

type Destination = 'store' | 'inbox' | 'a' | 'a2' | 'b' | 'c' | 'd'
const mounts = new Map<string, number>()
const unmounts = new Map<string, number>()

function descriptor(destination: Exclude<Destination, 'store' | 'inbox'>): WorkbenchKeepAliveSession {
  const name = destination === 'a2' ? 'a' : destination
  const workspaceRevision = destination === 'a2' ? 2 : 1
  const identity = { projectId: `project-${name}`, workspaceId: `workspace-${name}`, workspaceRevision, laneId: 'collab' }
  return {
    instanceKey: buildPresentationInstanceKey(identity), scopeKey: `${identity.projectId}::collab::${identity.workspaceId}::v2`,
    projectId: identity.projectId, activeLaneId: 'collab', workspaceId: identity.workspaceId,
    workspaceRevision, projectRootPath: `/fixture/${name}`, gitRootPath: `/fixture/${name}`,
    projectName: name.toUpperCase(), framework: null, storedDevCommand: null, storedDevPort: null,
    workbenchSessionKey: `${identity.projectId}::collab::${identity.workspaceId}`,
    themeScheme: 'dark', lastActiveAt: performance.now(),
  }
}

function InstrumentedWorkbench({ session, active }: { session: WorkbenchKeepAliveSession; active: boolean }) {
  useEffect(() => {
    mounts.set(session.instanceKey, (mounts.get(session.instanceKey) ?? 0) + 1)
    return () => { unmounts.set(session.instanceKey, (unmounts.get(session.instanceKey) ?? 0) + 1) }
  }, [session.instanceKey])
  return <div data-fixture-session={session.instanceKey} data-fixture-active={active}>{session.projectName}</div>
}

export function NavigationRuntimeHarness() {
  const [destination, setDestination] = useState<Destination>('a')
  const current = useMemo(
    () => destination === 'store' || destination === 'inbox' ? null : descriptor(destination),
    [destination],
  )

  useEffect(() => {
    const api = {
      navigate: (next: Destination) => setDestination(next),
      snapshot: () => ({
        destination,
        ordinarySurface: document.querySelector('[data-fixture-surface]')?.getAttribute('data-fixture-surface') ?? null,
        residents: Array.from(document.querySelectorAll('[data-fixture-session]')).map(node => node.getAttribute('data-fixture-session')),
        active: document.querySelector('[data-fixture-active="true"]')?.getAttribute('data-fixture-session') ?? null,
        mounts: Object.fromEntries(mounts),
        unmounts: Object.fromEntries(unmounts),
      }),
    }
    ;(window as unknown as { __navigationRuntimeHarness?: typeof api }).__navigationRuntimeHarness = api
    document.documentElement.dataset.navigationHarnessReady = 'true'
  }, [destination])

  return (
    <main data-testid="navigation-runtime-harness" className="h-screen w-screen bg-background">
      <div data-fixture-route={destination} />
      {!current ? <div data-fixture-surface={destination}>{destination}</div> : null}
      <WorkbenchKeepAliveHost
        current={current}
        getWorkbenchSession={() => null}
        fallback={null}
        renderSession={(session, active) => <InstrumentedWorkbench session={session} active={active} />}
      />
    </main>
  )
}
