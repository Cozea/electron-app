import { useEffect, useMemo, useState } from "react"

import { T3OrchestrationClient } from "@cozea/client-runtime"
import { ThreadId } from "@cozea/assistant-contracts"

import { fetchT3RpcSession } from "@/substrate/fetchT3RpcSession"

import { artifactMediaRefreshDelay } from "./artifactMediaRefresh"
import type { ThreadImageArtifact } from "./threadArtifacts"

export interface ThreadArtifactMediaState {
  urlsById: Readonly<Record<string, string>>
  loadingIds: ReadonlySet<string>
  errorIds: ReadonlySet<string>
}

interface ArtifactMediaEntry {
  url: string
  expiresAt: number
}

interface ArtifactMediaCache {
  scope: string
  entriesById: Readonly<Record<string, ArtifactMediaEntry>>
  errorIds: ReadonlySet<string>
  retryAtById: Readonly<Record<string, number>>
}

const EMPTY_CACHE: ArtifactMediaCache = {
  scope: "",
  entriesById: {},
  errorIds: new Set(),
  retryAtById: {},
}

export function useThreadArtifactMedia(
  threadId: string | null | undefined,
  artifacts: ReadonlyArray<ThreadImageArtifact>,
  transport: { readonly active: boolean; readonly shadowBaseUrl: string | null },
): ThreadArtifactMediaState {
  const [cache, setCache] = useState<ArtifactMediaCache>(EMPTY_CACHE)
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(new Set())
  const [refreshRevision, setRefreshRevision] = useState(0)
  const availableIds = useMemo(
    () => artifacts.filter((artifact) => artifact.available).map((artifact) => artifact.id),
    [artifacts],
  )
  const availableKey = availableIds.join("\u001f")
  const scope = threadId && transport.shadowBaseUrl
    ? `${transport.shadowBaseUrl}\u001f${threadId}`
    : ""
  const activeCache = cache.scope === scope ? cache : EMPTY_CACHE

  useEffect(() => {
    if (!threadId || !transport.active || !transport.shadowBaseUrl || availableIds.length === 0) {
      if (cache !== EMPTY_CACHE) setCache(EMPTY_CACHE)
      if (loadingIds.size > 0) setLoadingIds(new Set())
      return
    }

    const now = Date.now()
    const refreshDelay = (artifactId: string) => artifactMediaRefreshDelay(
      activeCache.entriesById[artifactId]?.expiresAt,
      activeCache.retryAtById[artifactId],
      now,
    )
    const missingIds = availableIds.filter((artifactId) => refreshDelay(artifactId) === 0)
    if (missingIds.length === 0) {
      const nextDelay = Math.max(
        1_000,
        Math.min(2_147_000_000, ...availableIds.map(refreshDelay)),
      )
      const timer = window.setTimeout(
        () => setRefreshRevision((revision) => revision + 1),
        nextDelay,
      )
      return () => window.clearTimeout(timer)
    }

    let cancelled = false
    let client: T3OrchestrationClient | null = null
    setLoadingIds(new Set(missingIds))

    void (async () => {
      try {
        const session = await fetchT3RpcSession(transport.shadowBaseUrl!)
        if (cancelled) return
        client = new T3OrchestrationClient({
          baseUrl: session.baseUrl,
          wsTicket: session.wsTicket,
        })
        const results = await Promise.allSettled(
          missingIds.map(async (artifactId) => {
            const result = await client!.createAssetUrl({
              _tag: "thread-artifact",
              threadId: ThreadId.makeUnsafe(threadId),
              artifactId,
            })
            return [
              artifactId,
              {
                url: new URL(result.relativeUrl, session.baseUrl).toString(),
                expiresAt: result.expiresAt,
              },
            ] as const
          }),
        )
        if (cancelled) return

        setCache((current) => {
          const baseEntries = current.scope === scope ? current.entriesById : {}
          const baseErrors = current.scope === scope ? current.errorIds : new Set<string>()
          const baseRetries = current.scope === scope ? current.retryAtById : {}
          const entriesById = { ...baseEntries }
          const errorIds = new Set(baseErrors)
          const retryAtById = { ...baseRetries }
          for (let index = 0; index < results.length; index += 1) {
            const result = results[index]!
            const artifactId = missingIds[index]!
            if (result.status === "fulfilled") {
              entriesById[artifactId] = result.value[1]
              errorIds.delete(artifactId)
              delete retryAtById[artifactId]
            } else {
              errorIds.add(artifactId)
              retryAtById[artifactId] = Date.now() + 30_000
            }
          }
          return { scope, entriesById, errorIds, retryAtById }
        })
        setLoadingIds(new Set())
      } catch {
        if (!cancelled) {
          setCache((current) => ({
            scope,
            entriesById: current.scope === scope ? current.entriesById : {},
            errorIds: new Set([
              ...(current.scope === scope ? current.errorIds : []),
              ...missingIds,
            ]),
            retryAtById: {
              ...(current.scope === scope ? current.retryAtById : {}),
              ...Object.fromEntries(
                missingIds.map((artifactId) => [artifactId, Date.now() + 30_000]),
              ),
            },
          }))
          setLoadingIds(new Set())
        }
      }
    })()

    return () => {
      cancelled = true
      void client?.close().catch(() => {})
    }
  // `availableKey` is the stable identity list; activity objects change while streaming.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeCache,
    availableKey,
    refreshRevision,
    scope,
    threadId,
    transport.active,
    transport.shadowBaseUrl,
  ])

  const availableSet = useMemo(() => new Set(availableIds), [availableKey])
  const urlsById = useMemo(
    () => Object.fromEntries(
      Object.entries(activeCache.entriesById)
        .filter(([artifactId]) => availableSet.has(artifactId))
        .map(([artifactId, entry]) => [artifactId, entry.url]),
    ),
    [activeCache.entriesById, availableSet],
  )
  const errorIds = useMemo(
    () => new Set([...activeCache.errorIds].filter((artifactId) => availableSet.has(artifactId))),
    [activeCache.errorIds, availableSet],
  )

  return { urlsById, loadingIds, errorIds }
}
