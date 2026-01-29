"use client"

/**
 * @title React AI Canvas
 * @credit {"name":"Vercel","url":"https://ai-sdk.dev/elements","license":{"name":"Apache License 2.0","url":"https://www.apache.org/licenses/LICENSE-2.0"}}
 * @description Node-based visual canvas wrapper using ReactFlow with AI/workflow-friendly defaults.
 */

import { Background, ReactFlow, type Edge, type Node, type ReactFlowProps } from "@xyflow/react"
import type { ReactNode } from "react"
import "@xyflow/react/dist/style.css"

export type CanvasProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> = ReactFlowProps<
  NodeType,
  EdgeType
> & {
  children?: ReactNode
  bgColor?: string
}

export const Canvas = <NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  children,
  bgColor = "var(--sidebar)",
  ...props
}: CanvasProps<NodeType, EdgeType>) => (
  <ReactFlow<NodeType, EdgeType>
    deleteKeyCode={["Backspace", "Delete"]}
    fitView
    panOnDrag={false}
    panOnScroll
    selectionOnDrag
    zoomOnDoubleClick={false}
    {...props}
  >
    <Background bgColor={bgColor} />
    {children}
  </ReactFlow>
)
