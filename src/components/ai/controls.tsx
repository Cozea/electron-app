"use client"

/**
 * @title React AI Controls
 * @credit {"name":"Vercel","url":"https://ai-sdk.dev/elements","license":{"name":"Apache License 2.0","url":"https://www.apache.org/licenses/LICENSE-2.0"}}
 * @description Styled ReactFlow controls for zoom/pan.
 */

import { Controls as ReactFlowControls, type ControlProps as ReactFlowControlProps } from "@xyflow/react"
import { cn } from "@/lib/utils"

export type ControlsProps = ReactFlowControlProps

export const Controls = ({ className, ...props }: ControlsProps) => (
  <ReactFlowControls
    className={cn(
      "overflow-hidden rounded-xl border border-border/60 bg-background/80 !shadow-sm backdrop-blur-md",
      "[&>button]:!bg-transparent [&>button]:!text-foreground [&>button:hover]:!bg-accent/60",
      "[&>button]:!border-b [&>button]:!border-border/60 [&>button:last-child]:!border-b-0",
      "[&.horizontal>button]:!border-b-0 [&.horizontal>button]:!border-r [&.horizontal>button:last-child]:!border-r-0",
      className
    )}
    {...props}
  />
)
