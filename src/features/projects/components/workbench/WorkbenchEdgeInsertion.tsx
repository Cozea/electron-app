import { PlusIcon as Plus } from "@heroicons/react/24/outline"
import { useEffect, useState } from "react"

import type {
  WorkbenchEdgeTarget,
  WorkbenchInsertionEdge,
} from "@/features/projects/lib/workbenchDockview"
import { cn } from "@/lib/utils"

interface WorkbenchEdgeInsertionProps {
  armed?: boolean
  targets: WorkbenchEdgeTarget[]
  disabledEdges?: WorkbenchInsertionEdge[]
  onEdgeActivate: (targetId: string) => void
}

function getBandClasses(edge: WorkbenchInsertionEdge): string {
  switch (edge) {
    case "left":
      return "left-0 top-1/2 h-11 w-5 -translate-y-1/2 rounded-r-full"
    case "right":
      return "right-0 top-1/2 h-11 w-5 -translate-y-1/2 rounded-l-full"
    case "top":
      return "left-1/2 top-0 h-5 w-11 -translate-x-1/2 rounded-b-full"
    case "bottom":
      return "bottom-0 left-1/2 h-5 w-11 -translate-x-1/2 rounded-t-full"
  }
}

export function WorkbenchEdgeInsertion({
  armed = false,
  targets,
  disabledEdges = [],
  onEdgeActivate,
}: WorkbenchEdgeInsertionProps) {
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

  if (!armed || targets.length === 0) {
    return null
  }

  return (
    <>
      {targets.map((target) => {
        if (disabledEdges.includes(target.edge)) return null
        const isHovered = hoveredTargetId === target.id

        return (
          <div
            key={target.id}
            className="absolute z-[60] cursor-pointer"
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
              onEdgeActivate(target.id)
            }}
          >
            {isHovered ? (
              <div
                aria-hidden="true"
                data-workbench-browser-overlay="true"
                data-workbench-browser-overlay-reason="Add Tile controls"
                className={cn(
                  "pointer-events-none absolute z-[70] flex items-center justify-center bg-border text-foreground",
                  getBandClasses(target.edge),
                )}
              >
                <Plus className="h-3.5 w-3.5" />
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
