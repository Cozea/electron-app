import type { ReactNode } from "react"

import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import type { DevAppManifest } from "@/features/devapps/registry/types"
import { cn } from "@/lib/utils"

const ICON_SIZE_PX = 40
/** macOS squircle ratio, matching the icon tiles elsewhere in the workbench. */
const SQUIRCLE_RATIO = 0.22265625

export interface DevAppStoreRowProps {
  app: Pick<DevAppManifest, "name" | "description" | "icon" | "store">
  /** Qualifier ahead of the description: a category label, or `v3 · Vite`. */
  meta: string
  /** Inline chip after the name. Organization rows only. */
  badge?: ReactNode
  /** Right cell: a button for organization rows, muted status text for built-ins. */
  action?: ReactNode
  /** Overflow trigger, right of `action`. */
  menu?: ReactNode
  highlighted?: boolean
  className?: string
}

/**
 * A row is a `div`, not a button: `/projects/store` has no project, lane or
 * workspace, so there is no whole-row action to attach. Only the right cell
 * is interactive.
 */
export function DevAppStoreRow({
  app,
  meta,
  badge,
  action,
  menu,
  highlighted,
  className,
}: DevAppStoreRowProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors",
        highlighted ? "bg-secondary/60 ring-1 ring-ring/40" : "hover:bg-secondary/40",
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br",
          app.store.accentClassName,
        )}
        style={{
          height: ICON_SIZE_PX,
          width: ICON_SIZE_PX,
          borderRadius: ICON_SIZE_PX * SQUIRCLE_RATIO,
        }}
      >
        <DevAppIcon app={app} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-[13px] leading-5 font-medium text-foreground">{app.name}</p>
          {badge}
        </div>
        <p className="truncate text-[12px] leading-5 text-muted-foreground">
          {meta}
          <span aria-hidden className="px-1.5 text-muted-foreground/50">
            ·
          </span>
          {app.description}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {action}
        {menu}
      </div>
    </div>
  )
}
