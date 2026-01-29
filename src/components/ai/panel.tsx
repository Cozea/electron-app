"use client"

/**
 * @title React AI Panel
 * @credit {"name":"Vercel","url":"https://ai-sdk.dev/elements","license":{"name":"Apache License 2.0","url":"https://www.apache.org/licenses/LICENSE-2.0"}}
 * @description ReactFlow overlay panel with shadcn-friendly styling.
 */

import { Panel as ReactFlowPanel, type PanelProps as ReactFlowPanelProps } from "@xyflow/react"
import { cn } from "@/lib/utils"

export type PanelProps = ReactFlowPanelProps

export const Panel = ({ className, ...props }: PanelProps) => (
  <ReactFlowPanel
    className={cn(
      "rounded-xl border border-border/60 bg-background/80 p-2 shadow-sm backdrop-blur-md",
      className
    )}
    {...props}
  />
)

