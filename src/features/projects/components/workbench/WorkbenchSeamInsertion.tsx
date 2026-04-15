
import { useEffect, useState } from "react"

import type {

  WorkbenchSeamDirection,
  WorkbenchSeamTarget,
} from "@/features/projects/lib/workbenchDockview"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon as __PlusHugeIcon } from '@hugeicons/core-free-icons'

interface WorkbenchSeamInsertionProps {
  armed?: boolean
  targets: WorkbenchSeamTarget[]
  onSeamActivate: (targetId: string) => void
}

function getHandleClasses(direction: WorkbenchSeamDirection, hovered: boolean): string {
  return cn(
    "absolute z-10 flex items-center justify-center bg-border text-foreground transition-opacity duration-150 ease-out",
    !hovered && "opacity-0",
    direction === "left" && "left-0 top-1/2 h-11 w-5 -translate-y-1/2 rounded-r-full",
    direction === "right" && "right-0 top-1/2 h-11 w-5 -translate-y-1/2 rounded-l-full",
    direction === "above" && "left-1/2 top-0 h-5 w-11 -translate-x-1/2 rounded-b-full",
    direction === "below" && "bottom-0 left-1/2 h-5 w-11 -translate-x-1/2 rounded-t-full",
  )
}

export function WorkbenchSeamInsertion({
  armed = false,
  targets,
  onSeamActivate,
}: WorkbenchSeamInsertionProps) {
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null)

  useEffect(() => {
    if (armed) return
    setHoveredZoneId(null)
  }, [armed])

  useEffect(() => {
    if (hoveredZoneId && !targets.some((target) => target.id === hoveredZoneId)) {
      setHoveredZoneId(null)
    }
  }, [hoveredZoneId, targets])

  if (!armed || targets.length === 0) return null

  return (
    <>
      {targets.map((target) => {
        const isHovered = hoveredZoneId === target.id

        return (
          <div
            key={target.id}
            className="absolute z-[60]"
            style={{
              left: target.triggerRect.x,
              top: target.triggerRect.y,
              width: target.triggerRect.width,
              height: target.triggerRect.height,
            }}
            onPointerEnter={() => {
              setHoveredZoneId(target.id)
            }}
            onPointerLeave={() => {
              if (hoveredZoneId === target.id) {
                setHoveredZoneId(null)
              }
            }}
            onClick={() => {
              onSeamActivate(target.id)
            }}
          >
            <div
              aria-hidden="true"
              data-workbench-browser-overlay="true"
              data-workbench-browser-overlay-reason="Add Tile controls"
              className={cn("pointer-events-none absolute z-[70]", getHandleClasses(target.direction, isHovered))}
            >
              {isHovered ? <HugeiconsIcon icon={__PlusHugeIcon} className="h-3.5 w-3.5" /> : null}
            </div>
          </div>
        )
      })}
    </>
  )
}

