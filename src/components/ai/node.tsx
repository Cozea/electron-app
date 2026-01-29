"use client"

/**
 * @title React AI Node
 * @credit {"name":"Vercel","url":"https://ai-sdk.dev/elements","license":{"name":"Apache License 2.0","url":"https://www.apache.org/licenses/LICENSE-2.0"}}
 * @description Styled ReactFlow node primitives for workflow/diagram UIs.
 */

import { Handle, Position } from "@xyflow/react"
import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

export type NodeHandles = {
  target?: boolean
  source?: boolean
}

export type NodeProps = ComponentProps<"div"> & {
  handles?: NodeHandles
}

export const Node = ({ className, children, handles, ...props }: NodeProps) => (
  <div
    className={cn(
      "relative rounded-xl border border-border/60 bg-background/80 text-foreground shadow-sm backdrop-blur-md",
      "min-w-[180px]",
      className
    )}
    {...props}
  >
    {handles?.target && (
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-2 !border-background !bg-primary/80"
      />
    )}
    {handles?.source && (
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-2 !border-background !bg-primary/80"
      />
    )}
    {children}
  </div>
)

export type NodeHeaderProps = ComponentProps<"div">
export const NodeHeader = ({ className, ...props }: NodeHeaderProps) => (
  <div
    className={cn("flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2", className)}
    {...props}
  />
)

export type NodeTitleProps = ComponentProps<"div">
export const NodeTitle = ({ className, ...props }: NodeTitleProps) => (
  <div className={cn("text-xs font-medium leading-none", className)} {...props} />
)

export type NodeSubtitleProps = ComponentProps<"div">
export const NodeSubtitle = ({ className, ...props }: NodeSubtitleProps) => (
  <div className={cn("text-[10px] text-muted-foreground leading-tight", className)} {...props} />
)

export type NodeContentProps = ComponentProps<"div">
export const NodeContent = ({ className, ...props }: NodeContentProps) => (
  <div className={cn("px-3 py-2 text-xs text-muted-foreground", className)} {...props} />
)

export type NodeSectionProps = ComponentProps<"div"> & { label?: ReactNode }
export const NodeSection = ({ className, label, children, ...props }: NodeSectionProps) => (
  <div className={cn("px-3 py-2", className)} {...props}>
    {label ? <div className="mb-1 text-[10px] font-medium text-muted-foreground">{label}</div> : null}
    {children}
  </div>
)

