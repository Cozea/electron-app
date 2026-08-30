import { useState } from "react"

import { Button } from "@/components/ui/button"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Copy01Icon as __CopyHugeIcon,
  Globe02Icon as __GlobeHugeIcon,
  LinkSquare02Icon as __ExternalLinkHugeIcon,
} from "@hugeicons/core-free-icons"

export function isExternallyOpenableBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

interface BrowserUnavailableSurfaceProps {
  url?: string | null
  description?: string
  onOpenExternal?: () => void | Promise<void>
}

export function BrowserUnavailableSurface({
  url,
  description = "The legacy embedded browser has been removed. A direct port of the T3 browser is the next migration phase.",
  onOpenExternal,
}: BrowserUnavailableSurfaceProps) {
  const [copied, setCopied] = useState(false)
  const displayUrl = url?.trim() || null

  const copyUrl = async () => {
    if (!displayUrl) return
    await navigator.clipboard.writeText(displayUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <div
      className="flex h-full min-h-0 w-full items-center justify-center bg-content-surface p-6 text-center"
      data-browser-unavailable-surface="true"
    >
      <div className="flex max-w-lg flex-col items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-muted/45 text-muted-foreground">
          <HugeiconsIcon icon={__GlobeHugeIcon} className="size-5" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-sm font-medium text-foreground">Embedded browser temporarily unavailable</h2>
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        {displayUrl ? (
          <div className="w-full max-w-md rounded-md border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            <span className="block truncate" title={displayUrl}>{displayUrl}</span>
          </div>
        ) : null}
        {displayUrl ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyUrl()}>
              <HugeiconsIcon icon={__CopyHugeIcon} className="mr-1.5 size-3.5" />
              {copied ? "Copied" : "Copy URL"}
            </Button>
            {onOpenExternal ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => void onOpenExternal()}>
                <HugeiconsIcon icon={__ExternalLinkHugeIcon} className="mr-1.5 size-3.5" />
                Open externally
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
