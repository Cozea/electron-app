import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The title block every page opens with. One size and weight everywhere, so
 * moving between the Store, Skills, Inbox, Tasks, Team and settings reads as
 * one app.
 *
 * Page-level actions do not go here: they go in the top bar through
 * `useProjectHeader({ rightAddon })`, where every page already puts them.
 */
export function PageHeader({
  title,
  description,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("shrink-0 space-y-1", className)}>
      <h1 className="text-page-title text-foreground">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </header>
  )
}
