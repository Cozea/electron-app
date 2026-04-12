import { PlusIcon as Plus } from "@heroicons/react/24/outline"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

export interface SeamZone {
  id: string
  referenceTileId: string
  direction: "left" | "right" | "above" | "below"
  rect: { x: number; y: number; width: number; height: number }
}

interface WorkbenchSeamInsertionProps {
  armed?: boolean
  seamZones: SeamZone[]
  onSeamActivate: (referenceTileId: string, direction: SeamZone["direction"]) => void
}

const SEAM_TRIGGER_SEGMENT_LENGTH = 64

function getHandleClasses(direction: SeamZone["direction"], hovered: boolean): string {
  return cn(
    "absolute z-10 flex items-center justify-center bg-border text-foreground transition-opacity duration-150 ease-out",
    !hovered && "opacity-0",
    direction === "left" && "left-0 top-1/2 h-11 w-5 -translate-y-1/2 rounded-r-full",
    direction === "right" && "right-0 top-1/2 h-11 w-5 -translate-y-1/2 rounded-l-full",
    direction === "above" && "left-1/2 top-0 h-5 w-11 -translate-x-1/2 rounded-b-full",
    direction === "below" && "bottom-0 left-1/2 h-5 w-11 -translate-x-1/2 rounded-t-full",
  )
}

function getTriggerRect(zone: SeamZone): SeamZone["rect"] {
  if (zone.direction === "left" || zone.direction === "right") {
    const height = Math.min(zone.rect.height, SEAM_TRIGGER_SEGMENT_LENGTH)
    return {
      x: zone.rect.x,
      y: zone.rect.y + (zone.rect.height - height) / 2,
      width: zone.rect.width,
      height,
    }
  }

  const width = Math.min(zone.rect.width, SEAM_TRIGGER_SEGMENT_LENGTH)
  return {
    x: zone.rect.x + (zone.rect.width - width) / 2,
    y: zone.rect.y,
    width,
    height: zone.rect.height,
  }
}

export function WorkbenchSeamInsertion({
  armed = false,
  seamZones,
  onSeamActivate,
}: WorkbenchSeamInsertionProps) {
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null)

  useEffect(() => {
    if (armed) return
    setHoveredZoneId(null)
  }, [armed])

  useEffect(() => {
    if (hoveredZoneId && !seamZones.some((z) => z.id === hoveredZoneId)) {
      setHoveredZoneId(null)
    }
  }, [hoveredZoneId, seamZones])

  if (!armed || seamZones.length === 0) return null

  return (
    <>
      {seamZones.map((zone) => {
        const triggerRect = getTriggerRect(zone)
        const isHovered = hoveredZoneId === zone.id

        return (
          <div
            key={zone.id}
            className="absolute z-20"
            style={{
              left: triggerRect.x,
              top: triggerRect.y,
              width: triggerRect.width,
              height: triggerRect.height,
            }}
            onPointerEnter={() => {
              setHoveredZoneId(zone.id)
            }}
            onPointerLeave={() => {
              if (hoveredZoneId === zone.id) {
                setHoveredZoneId(null)
              }
            }}
            onClick={() => {
              onSeamActivate(zone.referenceTileId, zone.direction)
            }}
          >
            <div
              aria-hidden="true"
              data-workbench-browser-overlay="true"
              data-workbench-browser-overlay-reason="Add Tile controls"
              className={cn("pointer-events-none", getHandleClasses(zone.direction, isHovered))}
            >
              {isHovered ? <Plus className="h-3.5 w-3.5" /> : null}
            </div>
          </div>
        )
      })}
    </>
  )
}
