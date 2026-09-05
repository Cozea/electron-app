import { useEffect } from 'react'

let pending: { destination: string; start: number } | null = null

export function beginLocalNavigation(destination: string): void {
  // Only static surface names are recorded, never project IDs, search or paths.
  pending = { destination, start: performance.now() }
}

export function LocalNavigationReady({ destination }: { destination: string }) {
  useEffect(() => {
    const started = pending
    if (!started || started.destination !== destination) return
    const frame = requestAnimationFrame(() => {
      if (pending !== started) return
      performance.measure(`cozea:navigation:${destination}:content-frame`, {
        start: started.start,
        end: performance.now(),
      })
      pending = null
      // Bound browser performance entries during long desktop sessions.
      const entries = performance.getEntriesByName(`cozea:navigation:${destination}:content-frame`)
      if (entries.length > 100) performance.clearMeasures(`cozea:navigation:${destination}:content-frame`)
    })
    return () => cancelAnimationFrame(frame)
  }, [destination])
  return null
}

export function navigationSurface(pathname: string): string | null {
  if (pathname === '/projects/store') return 'store'
  if (pathname === '/projects/skills') return 'agentSkills'
  const match = pathname.match(/^\/projects\/settings\/(account|appearance|devapps|organizations|tooling)$/)
  return match?.[1] ?? null
}
