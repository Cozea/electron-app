import { useEffect, useState } from "react"

import { parseNativeDevAppModuleUrl } from "@shared/nativeDevAppModuleProtocol"

interface StyleRecord {
  link: HTMLLinkElement
  references: number
  ready: Promise<void>
}

const styles = new Map<string, StyleRecord>()

export interface NativeDevAppStyleLease {
  ready: Promise<void>
  dispose(): void
}

export function acquireNativeDevAppStyle(
  styleUrl: string,
  documentRef: Document = document,
): NativeDevAppStyleLease {
  if (!parseNativeDevAppModuleUrl(styleUrl)) {
    throw new Error("The native DevApp stylesheet URL is invalid or untrusted.")
  }
  const existing = styles.get(styleUrl)
  if (existing) {
    existing.references += 1
    return {
      ready: existing.ready,
      dispose: () => releaseNativeDevAppStyle(styleUrl),
    }
  }

  const link = documentRef.createElement("link")
  link.rel = "stylesheet"
  link.href = styleUrl
  link.crossOrigin = "anonymous"
  link.dataset.cozeaNativeDevAppStyle = styleUrl
  const ready = new Promise<void>((resolve, reject) => {
    link.addEventListener("load", () => resolve(), { once: true })
    link.addEventListener("error", () => reject(new Error("The native DevApp stylesheet failed to load.")), {
      once: true,
    })
  })
  styles.set(styleUrl, { link, references: 1, ready })
  documentRef.head.append(link)
  return { ready, dispose: () => releaseNativeDevAppStyle(styleUrl) }
}

function releaseNativeDevAppStyle(styleUrl: string): void {
  const record = styles.get(styleUrl)
  if (!record) return
  record.references -= 1
  if (record.references > 0) return
  styles.delete(styleUrl)
  record.link.remove()
}

export function useNativeDevAppStyle(styleUrl: string | null): Error | null {
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => {
    setError(null)
    if (!styleUrl) return
    let lease: NativeDevAppStyleLease
    try {
      lease = acquireNativeDevAppStyle(styleUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
      return
    }
    let active = true
    void lease.ready.catch((cause) => {
      if (active) setError(cause instanceof Error ? cause : new Error(String(cause)))
    })
    return () => {
      active = false
      lease.dispose()
    }
  }, [styleUrl])
  return error
}
