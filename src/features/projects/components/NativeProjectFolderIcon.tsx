
import { cn } from "@/lib/utils"
import { useTheme } from "@/contexts/ThemeContext"
import { resolveAppliedTheme } from "@/lib/theme"
import projectSidebarIconLight from "@/assets/project-icons/project-sidebar-icon-light.png"
import projectSidebarIconDark from "@/assets/project-icons/project-sidebar-icon-dark.png"

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
  imgClassName,
  fallbackClassName = "size-4 text-muted-foreground/75",
}: NativeProjectFolderIconProps) {
  const { theme } = useTheme()
  const appliedTheme = resolveAppliedTheme(theme)
  const projectSidebarIcon = appliedTheme === "light" ? projectSidebarIconLight : projectSidebarIconDark

  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)}>
      {isOpen ? (
        <svg viewBox="0 0 24 24" className={cn("fill-current", fallbackClassName)}>
          <path d="M2 7l10 10 10-10z" />
        </svg>
      ) : (
        <img
          src={projectSidebarIcon}
          alt=""
          aria-hidden
          className={cn("size-4 shrink-0 object-contain", imgClassName ?? fallbackClassName)}
        />
      )}
    </span>
  )
}
