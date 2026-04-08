import { useEffect, useMemo, useState } from "react"
import { FolderIcon } from "lucide-react"

import { resolveWsHttpOrigin } from "@/lib/desktopBridgeClient"
import { cn } from "@/lib/utils"

const loadedProjectFaviconSrcs = new Set<string>()

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
