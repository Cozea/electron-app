

import { cn } from "@/lib/utils"

import { HugeiconsIcon } from '@hugeicons/react'
import { Folder01Icon as __FolderClosedIconHugeIcon, Folder03Icon as __FolderOpenIconHugeIcon } from '@hugeicons/core-free-icons'

export interface NativeProjectFolderIconProps {
  /** Local project folder path; kept for compatibility with existing call sites. */

  folderPath: string | null | undefined
  isOpen?: boolean
  className?: string
  /** Reserved for a future safe native-icon variant. */
  imgClassName?: string
  /** Classes for the outline folder glyph. */
  fallbackClassName?: string
}

/**
 * Native folder icon lookup is disabled for now because the macOS file-resource path behind
 * Electron `app.getFileIcon` has been crashing the app. Keep this wrapper so the UI surface stays
 * stable while we redesign a safer icon strategy.
 */
export function NativeProjectFolderIcon({
  folderPath: _folderPath,
  isOpen = false,
  className,
  fallbackClassName = "size-3.5 text-muted-foreground/75",
}: NativeProjectFolderIconProps) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)}>
      <HugeiconsIcon
        icon={isOpen ? __FolderOpenIconHugeIcon : __FolderClosedIconHugeIcon}
        className={fallbackClassName}
      />
    </span>
  )
}
