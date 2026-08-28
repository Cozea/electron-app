import { useEffect, useMemo, useState } from "react"

import { T3OrchestrationClient } from "@cozea/client-runtime"
import { ThreadId } from "@cozea/assistant-contracts"

import { fetchT3RpcSession } from "@/substrate/fetchT3RpcSession"

import type { ThreadImageArtifact } from "./threadArtifacts"

export interface ThreadArtifactMediaState {
  urlsById: Readonly<Record<string, string>>
  loadingIds: ReadonlySet<string>
  errorIds: ReadonlySet<string>
}

export function useThreadArtifactMedia(
  threadId: string | null | undefined,
  artifacts: ReadonlyArray<ThreadImageArtifact>,
  transport: { readonly active: boolean; readonly shadowBaseUrl: string | null },
): ThreadArtifactMediaState {
  const [urlsById, setUrlsById] = useState<Record<string, string>>({})
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(new Set())
  const [errorIds, setErrorIds] = useState<ReadonlySet<string>>(new Set())
  const [refreshRevision, setRefreshRevision] = useState(0)
  const availableIds = useMemo(
    () => artifacts.filter((artifact) => artifact.available).map((artifact) => artifact.id),
    [artifacts],
  )
  const availableKey = availableIds.join("\u001f")

  useEffect(() => {
    if (availableIds.length === 0) return
    const interval = window.setInterval(() => {
      setRefreshRevision((revision) => revision + 1)
    }, 50 * 60 * 1_000)
    return () => window.clearInterval(interval)
  }, [availableKey, availableIds.length])

  useEffect(() => {
    if (!threadId || !transport.active || !transport.shadowBaseUrl || availableIds.length === 0) {
      setUrlsById({})
      setLoadingIds(new Set())
      setErrorIds(new Set())
      return
    }

    let cancelled = false
    let client: T3OrchestrationClient | null = null
    setLoadingIds(new Set(availableIds))
    setErrorIds(new Set())

    void (async () => {
      try {
        const session = await fetchT3RpcSession(transport.shadowBaseUrl!)
        if (cancelled) return
        client = new T3OrchestrationClient({
          baseUrl: session.baseUrl,
          wsTicket: session.wsTicket,
        })
        const results = await Promise.allSettled(
          availableIds.map(async (artifactId) => {
            const result = await client!.createAssetUrl({
              _tag: "thread-artifact",
              threadId: ThreadId.makeUnsafe(threadId),
              artifactId,
            })
            return [artifactId, new URL(result.relativeUrl, session.baseUrl).toString()] as const
          }),
        )
        if (cancelled) return

        const nextUrls: Record<string, string> = {}
        const nextErrors = new Set<string>()
        for (let index = 0; index < results.length; index += 1) {
          const result = results[index]!
          if (result.status === "fulfilled") {
            nextUrls[result.value[0]] = result.value[1]
          } else {
            nextErrors.add(availableIds[index]!)
          }
        }
        setUrlsById(nextUrls)
        setErrorIds(nextErrors)
        setLoadingIds(new Set())
      } catch {
        if (!cancelled) {
          setUrlsById({})
          setErrorIds(new Set(availableIds))
          setLoadingIds(new Set())
        }
      }
    })()

    return () => {
      cancelled = true
      void client?.close().catch(() => {})
    }
  // `availableKey` is the stable identity list; using the array itself would
  // recreate signed URLs on every streamed activity object replacement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableKey, refreshRevision, threadId, transport.active, transport.shadowBaseUrl])

  return { urlsById, loadingIds, errorIds }
}
