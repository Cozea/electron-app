import { useEffect, useMemo, useState } from "react"
import { FolderIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const loadedProjectFaviconSrcs = new Set<string>()

function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return ""
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.()
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined
  const wsCandidate =
    typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
      ? bridgeWsUrl
      : typeof envWsUrl === "string" && envWsUrl.length > 0
        ? envWsUrl
        : null
  if (!wsCandidate) return window.location.origin
  try {
    const wsUrl = new URL(wsCandidate)
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol
    return `${protocol}//${wsUrl.host}`
  } catch {
    return window.location.origin
  }
}

const PROJECT_FAVICON_HTTP_ORIGIN = resolveWsHttpOrigin()

interface ProjectFaviconProps {
  cwd: string | null
  className?: string
  imageClassName?: string
}

export function ProjectFavicon({ cwd, className, imageClassName: imageClassNameProp }: ProjectFaviconProps) {
  const iconClassName = className ?? "size-3.5"
  const imageClassName = imageClassNameProp ?? className ?? "h-3.5 w-auto max-w-8"
  const src = useMemo(() => {
    if (!cwd) return null
    return `${PROJECT_FAVICON_HTTP_ORIGIN}/api/project-favicon?cwd=${encodeURIComponent(cwd)}`
  }, [cwd])
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    src && loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  )

  useEffect(() => {
    if (!src) {
      setStatus("error")
      return
    }
    setStatus(loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading")
  }, [src])

  if (!src || status === "error") {
    return <FolderIcon className={cn(iconClassName, "shrink-0 text-muted-foreground/55")} />
  }

  return (
    <img
      src={src}
      alt=""
      className={cn(imageClassName, "shrink-0 object-contain", status === "loading" && "hidden")}
      onLoad={() => {
        loadedProjectFaviconSrcs.add(src)
        setStatus("loaded")
      }}
      onError={() => setStatus("error")}
    />
  )
}
