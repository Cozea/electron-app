import { type ComponentProps } from "react"
import { DockviewReact } from "dockview"

import "dockview/dist/styles/dockview.css"

import { WORKBENCH_DOCK_COMPONENTS } from "@/features/projects/components/workbench/WorkbenchDockPanels"
import { cn } from "@/lib/utils"

interface WorkbenchDockviewCanvasProps {
  dockviewKey: string
  className?: string
  onReady: ComponentProps<typeof DockviewReact>["onReady"]
}

export function WorkbenchDockviewCanvas({
  dockviewKey,
  className,
  onReady,
}: WorkbenchDockviewCanvasProps) {
  return (
    <DockviewReact
      key={dockviewKey}
      className={cn("cozea-workbench-dockview h-full w-full min-w-0", className)}
      components={WORKBENCH_DOCK_COMPONENTS}
      disableFloatingGroups
      tabAnimation="smooth"
      singleTabMode="default"
      onReady={onReady}
    />
  )
}
