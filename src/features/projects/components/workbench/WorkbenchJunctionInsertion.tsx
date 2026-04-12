import { PlusIcon as Plus } from "@heroicons/react/24/outline"
import { useEffect, useState } from "react"

import type {
  WorkbenchInsertionEdge,
  WorkbenchJunctionTarget,
} from "@/features/projects/lib/workbenchDockview"
import { cn } from "@/lib/utils"

interface WorkbenchJunctionInsertionProps {
  armed?: boolean
  targets: WorkbenchJunctionTarget[]
  onJunctionActivate: (targetId: string) => void
}

function getHandleClasses(edge: WorkbenchInsertionEdge, hovered: boolean): string {
  return cn(
    "absolute z-10 flex items-center justify-center bg-border text-foreground transition-opacity duration-150 ease-out",
    !hovered && "opacity-0",
    edge === "left" && "left-0 top-1/2 h-11 w-5 -translate-y-1/2 rounded-r-full",
    edge === "right" && "right-0 top-1/2 h-11 w-5 -translate-y-1/2 rounded-l-full",
    edge === "top" && "left-1/2 top-0 h-5 w-11 -translate-x-1/2 rounded-b-full",
    edge === "bottom" && "bottom-0 left-1/2 h-5 w-11 -translate-x-1/2 rounded-t-full",
  )
}

export function WorkbenchJunctionInsertion({
  armed = false,
  targets,
  onJunctionActivate,
}: WorkbenchJunctionInsertionProps) {
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null)

  useEffect(() => {
    if (armed) return
    setHoveredTargetId(null)
  }, [armed])

  useEffect(() => {
    if (hoveredTargetId && !targets.some((target) => target.id === hoveredTargetId)) {
      setHoveredTargetId(null)
    }
  }, [hoveredTargetId, targets])

  if (!armed || targets.length === 0) return null

  return (
    <>
      {targets.map((target) => {
        const isHovered = hoveredTargetId === target.id

        return (
          <div
            key={target.id}
            className="absolute z-[80] cursor-pointer"
            style={{
              left: target.triggerRect.x,
              top: target.triggerRect.y,
              width: target.triggerRect.width,
              height: target.triggerRect.height,
            }}
            onPointerEnter={() => {
              setHoveredTargetId(target.id)
            }}
            onPointerLeave={() => {
              if (hoveredTargetId === target.id) {
                setHoveredTargetId(null)
              }
            }}
            onClick={() => {
              onJunctionActivate(target.id)
            }}
          >
            <div
              aria-hidden="true"
              data-workbench-browser-overlay="true"
              data-workbench-browser-overlay-reason="Add Tile controls"
              className={cn("pointer-events-none absolute z-[90]", getHandleClasses(target.edge, isHovered))}
            >
              {isHovered ? <Plus className="h-3.5 w-3.5" /> : null}
            </div>
          </div>
        )
      })}
    </>
  )
}
