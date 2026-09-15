import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { SIDEBAR_TRANSITION_CLASS_NAME } from "@/components/ui/sidebar"
import { HeaderOverflowContext } from "./HeaderOverflowContext"
import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon as __MoreHorizontalHugeIcon } from "@hugeicons/core-free-icons"
import "./responsiveHeader.css"

export interface HeaderActionGroup {
  id: string
  label: string
  priority: number
  content: ReactNode
  placement?: "leading" | "trailing"
}

interface ResponsiveHeaderRowProps {
  leading: ReactNode
  title?: ReactNode
  center?: ReactNode
  groups: readonly HeaderActionGroup[]
  style?: CSSProperties
  trailingWidth?: number
  compact?: boolean
  collapseThreshold?: number
}

export function ResponsiveHeaderRow({
  leading,
  title,
  center,
  groups,
  style,
  trailingWidth = 0,
  compact = true,
  collapseThreshold = 800,
}: ResponsiveHeaderRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [open, setOpen] = useState(false)

  const leadingGroups = groups.filter((group) => group.placement === "leading")
  const trailingGroups = groups.filter((group) => group.placement !== "leading")
  const hasTrailing = trailingGroups.length > 0

  useLayoutEffect(() => {
    const checkWidth = () => {
      if (typeof window !== "undefined") {
        setIsCollapsed(window.innerWidth < collapseThreshold)
      }
    }

    checkWidth()

    window.addEventListener("resize", checkWidth)
    return () => window.removeEventListener("resize", checkWidth)
  }, [collapseThreshold])

  useEffect(() => {
    if (!isCollapsed) {
      setOpen(false)
    }
  }, [isCollapsed])

  const dismiss = useCallback(() => setOpen(false), [])
  const overflowContextValue = useMemo(
    () => ({
      dismiss,
      returnFocus: () => triggerRef.current ?? true,
    }),
    [dismiss],
  )

  return (
    <HeaderOverflowContext.Provider value={overflowContextValue}>
      <div
        ref={rowRef}
        className={cn(
          "responsive-header-row h-10 transition-[padding]",
          SIDEBAR_TRANSITION_CLASS_NAME,
        )}
        style={style}
      >
        <div className="responsive-header-leading titlebar-no-drag">{leading}</div>
        <div className={cn("responsive-header-title titlebar-no-drag", compact && "shared-header-action-pills")}>
          {title}
        </div>
        {leadingGroups.map((group) => (
          <div key={group.id} className="responsive-header-group titlebar-no-drag" data-header-group={group.id}>
            {group.content}
          </div>
        ))}
        <div className="responsive-header-center titlebar-no-drag" data-unified-header-center="true">
          {center}
        </div>
        <div
          className="responsive-header-actions relative flex items-center justify-end titlebar-no-drag"
          data-unified-header-actions="true"
        >
          {isCollapsed && hasTrailing ? (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  ref={triggerRef}
                  variant="ghost"
                  size="icon"
                  aria-label="More header actions"
                  title="More header actions"
                  className="responsive-header-overflow h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 ml-1.5 titlebar-no-drag"
                >
                  <HugeiconsIcon icon={__MoreHorizontalHugeIcon} className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="bottom"
                sideOffset={6}
                className="responsive-header-popup flex items-center gap-1.5 p-1.5 bg-popover rounded-lg border shadow-md titlebar-no-drag"
                aria-label="More header actions"
              >
                {trailingGroups.map((group) => (
                  <div
                    key={group.id}
                    className="responsive-header-group titlebar-no-drag"
                    data-header-group={group.id}
                  >
                    {group.content}
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          ) : (
            trailingGroups.map((group) => (
              <div key={group.id} className="responsive-header-group titlebar-no-drag" data-header-group={group.id}>
                {group.content}
              </div>
            ))
          )}
        </div>
        {trailingWidth > 0 && <div className="shrink-0" aria-hidden="true" style={{ width: trailingWidth }} />}
      </div>
    </HeaderOverflowContext.Provider>
  )
}
