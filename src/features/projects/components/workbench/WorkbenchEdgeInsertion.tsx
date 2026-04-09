import { PlusIcon as Plus } from "@heroicons/react/24/outline"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

export type WorkbenchInsertionEdge = "left" | "right" | "top" | "bottom"

interface WorkbenchEdgeInsertionProps {
  armed?: boolean
  disabledEdges?: WorkbenchInsertionEdge[]
  onEdgeActivate: (edge: WorkbenchInsertionEdge) => void
}

const EDGE_ORDER: WorkbenchInsertionEdge[] = ["left", "right", "top", "bottom"]

function getZoneClasses(edge: WorkbenchInsertionEdge): string {
  switch (edge) {
    case "left":
      return "inset-y-0 left-0 w-8"
    case "right":
      return "inset-y-0 right-0 w-8"
    case "top":
      return "inset-x-0 top-0 h-8"
    case "bottom":
      return "inset-x-0 bottom-0 h-8"
  }
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
  disabledEdges = [],
  onEdgeActivate,
}: WorkbenchEdgeInsertionProps) {
  const [hoveredEdge, setHoveredEdge] = useState<WorkbenchInsertionEdge | null>(null)

  useEffect(() => {
    if (armed) return
    setHoveredEdge(null)
  }, [armed])

  return (
    <>
      {EDGE_ORDER.map((edge) => {
        if (disabledEdges.includes(edge)) return null

        return (
          <div
            key={edge}
            className={cn(
              "absolute z-20",
              getZoneClasses(edge),
              // When disarmed these strips must not steal clicks from controls
              // (tabs, close buttons, etc.) along the window edge.
              !armed && "pointer-events-none",
            )}
            onPointerEnter={() => {
              if (!armed) return
              setHoveredEdge(edge)
            }}
            onPointerLeave={() => {
              if (hoveredEdge === edge) {
                setHoveredEdge(null)
              }
            }}
            onClick={() => {
              if (!armed) return
              onEdgeActivate(edge)
            }}
          >
            {armed && hoveredEdge === edge ? (
              <div
                aria-hidden="true"
                data-workbench-browser-overlay="true"
                data-workbench-browser-overlay-reason="Add Tile controls"
                className={cn(
                  "pointer-events-none absolute z-10 flex items-center justify-center bg-border text-foreground",
                  getBandClasses(edge),
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
