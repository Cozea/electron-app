import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ConvexHttpClient } from "convex/browser"
import type { FunctionReference } from "convex/server"
import {
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node as ReactFlowNode,
  type NodeProps,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react"
import { useProjectHeader } from "@/hooks/useProjectHeader"
import { useOptionalProjectSyncContext } from "../contexts/ProjectSyncContext"
import { buildBackendStudioGraph, type StudioGraphNodeData } from "../studio/graphBuilder"
import { Canvas } from "@/components/ai/canvas"
import { Controls } from "@/components/ai/controls"
import { Node, NodeContent, NodeHeader, NodeSubtitle, NodeTitle } from "@/components/ai/node"
import { Panel } from "@/components/ai/panel"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { scanForRoutes, type ScannedRoute } from "@/utils/routeScanner"
import { cn } from "@/lib/utils"
import {
  Braces,
  Database,
  FileCode2,
  GitBranch,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Server,
  Table2,
  Zap,
} from "lucide-react"
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject"
import { openProjectFileInExternalEditor } from "@/features/projects/lib/externalEditorPreference"

type StudioNode = ReactFlowNode<StudioGraphNodeData, "studio">

const StudioFlowNode = ({ data, selected }: NodeProps<StudioNode>) => {
  const Icon =
    data.kind === "convex"
      ? Zap
      : data.kind === "ui"
        ? FileCode2
        : data.kind === "db"
          ? Table2
          : data.kind === "api"
            ? Server
            : GitBranch

  return (
    <Node
      handles={{ target: true, source: true }}
      className={cn(
        "w-[220px]",
        selected && "ring-2 ring-primary/50 shadow-md"
      )}
    >
      <NodeHeader>
        <div className="flex items-start gap-2 min-w-0">
          <div
            className={cn(
              "mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-muted/30",
              data.kind === "convex" && "bg-emerald-500/10 border-emerald-500/20",
              data.kind === "ui" && "bg-sky-500/10 border-sky-500/20",
              data.kind === "db" && "bg-violet-500/10 border-violet-500/20",
              data.kind === "api" && "bg-amber-500/10 border-amber-500/20"
            )}
          >
            <Icon
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground",
                data.kind === "convex" && "text-emerald-500",
                data.kind === "ui" && "text-sky-500",
                data.kind === "db" && "text-violet-500",
                data.kind === "api" && "text-amber-500"
              )}
            />
          </div>
          <div className="min-w-0">
            <NodeTitle className="truncate">{data.label}</NodeTitle>
            {data.subtitle ? (
              <NodeSubtitle className="truncate">{data.subtitle}</NodeSubtitle>
            ) : null}
          </div>
        </div>
        {data.operation ? (
          <span className="ml-2 shrink-0 rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {data.operation}
          </span>
        ) : null}
        {data.kind === "convex" && data.isInternal ? (
          <span className="ml-2 shrink-0 rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            internal
          </span>
        ) : null}
      </NodeHeader>

      {data.details?.length ? (
        <NodeContent className="space-y-1">
          {data.details.slice(0, 3).map((line) => (
            <div key={line} className="truncate text-[11px]">
              {line}
            </div>
          ))}
        </NodeContent>
      ) : (
        <NodeContent className="text-[11px] text-muted-foreground/70">
          {data.kind === "convex"
            ? "Convex function"
            : data.kind === "ui"
              ? "UI component"
              : data.kind === "db"
                ? "Data model"
                : data.kind === "api"
                  ? "HTTP API"
                  : "Custom node"}
        </NodeContent>
      )}
    </Node>
  )
}

function convexFunctionNameFromApiPath(apiPath: string): string {
  const parts = apiPath.split(".").filter(Boolean)
  const fn = parts.pop()
  const modulePath = parts.join("/")
  return fn ? `${modulePath}:${fn}` : modulePath
}

function toFunctionReference<T extends "query" | "mutation" | "action">(
  name: string
): FunctionReference<T> {
  return name as unknown as FunctionReference<T>
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  const lines = content.split("\n")

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const idx = line.indexOf("=")
    if (idx <= 0) continue

    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")
    if (key) env[key] = value
  }

  return env
}

async function detectProjectConvexUrl(projectPath: string): Promise<string | null> {
  const candidates = [
    ".env.local",
    ".env",
    ".env.development.local",
    ".env.development",
    ".env.production.local",
    ".env.production",
  ]

  for (const filePath of candidates) {
    const result = await window.electronAPI.project.readFile({ projectPath, filePath })
    if (!result.success || !result.content) continue

    const env = parseEnvFile(result.content)
    const url =
      env.VITE_CONVEX_URL ||
      env.NEXT_PUBLIC_CONVEX_URL ||
      env.CONVEX_URL ||
      null

    if (typeof url === "string" && url.trim().length > 0) {
      return url.trim()
    }
  }

  return null
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/")
}

export function ProjectBackendStudioPage() {
  const { project } = useAccessibleProject()
  const syncContext = useOptionalProjectSyncContext()
  const projectPath = syncContext?.projectPath ?? null

  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [shouldFitView, setShouldFitView] = useState(false)
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<StudioNode, Edge> | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const nodeTypes = useMemo(() => ({ studio: StudioFlowNode }), [])

  const [selection, setSelection] = useState<{ nodeId: string | null }>({ nodeId: null })

  const [pageRoutes, setPageRoutes] = useState<ScannedRoute[]>([])
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false)
  const [routesError, setRoutesError] = useState<string | null>(null)
  const [selectedPageFile, setSelectedPageFile] = useState<string | null>(null)

  const [runnerArgs, setRunnerArgs] = useState<string>("{}")
  const [runnerOutput, setRunnerOutput] = useState<string>("")
  const [isRunning, setIsRunning] = useState(false)
  const [convexUrl, setConvexUrl] = useState<string>("")

  const convexHttpClient = useMemo(() => {
    if (!convexUrl.trim()) return null
    try {
      return new ConvexHttpClient(convexUrl.trim())
    } catch {
      return null
    }
  }, [convexUrl])

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
            animated: false,
          },
          eds
        )
      ),
    [setEdges]
  )

  const onSelectionChange = useCallback((params: OnSelectionChangeParams<StudioNode, Edge>) => {
    const nodeId = params.nodes?.[0]?.id ?? null
    setSelection({ nodeId })
    setRunnerOutput("")
    setRunnerArgs("{}")
  }, [])

  const selectedNode = useMemo(() => {
    if (!selection.nodeId) return null
    return nodes.find((n) => n.id === selection.nodeId) ?? null
  }, [nodes, selection.nodeId])

  const selectedData = selectedNode?.data ?? null

  const selectedPage = useMemo(() => {
    if (!selectedPageFile) return null
    const normalized = normalizePath(selectedPageFile)
    return pageRoutes.find((r) => normalizePath(r.file) === normalized) ?? null
  }, [pageRoutes, selectedPageFile])

  const adjacency = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const edge of edges) {
      const list = map.get(edge.source) ?? []
      list.push(edge.target)
      map.set(edge.source, list)
    }
    return map
  }, [edges])

  const visibleNodeIds = useMemo(() => {
    if (!selectedPageFile) return null

    const startId = `ui:${normalizePath(selectedPageFile)}`
    if (!nodes.some((n) => n.id === startId)) {
      return null
    }
    const visible = new Set<string>()
    const queue: string[] = [startId]

    while (queue.length) {
      const id = queue.pop()
      if (!id) continue
      if (visible.has(id)) continue
      visible.add(id)

      const next = adjacency.get(id)
      if (!next) continue
      for (const target of next) {
        if (!visible.has(target)) queue.push(target)
      }
    }

    // Include manual nodes connected to the visible subgraph
    for (const edge of edges) {
      const sourceVisible = visible.has(edge.source)
      const targetVisible = visible.has(edge.target)
      if (!sourceVisible && !targetVisible) continue
      if (edge.source.startsWith("manual:")) visible.add(edge.source)
      if (edge.target.startsWith("manual:")) visible.add(edge.target)
    }

    return visible
  }, [adjacency, edges, nodes, selectedPageFile])

  const displayedNodes = useMemo(() => {
    if (!visibleNodeIds) return nodes
    return nodes.map((n) => ({
      ...n,
      hidden: !visibleNodeIds.has(n.id),
    }))
  }, [nodes, visibleNodeIds])

  const displayedEdges = useMemo(() => {
    if (!visibleNodeIds) return edges
    return edges.map((e) => ({
      ...e,
      hidden: !visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target),
    }))
  }, [edges, visibleNodeIds])

  const visibleCounts = useMemo(() => {
    if (!visibleNodeIds) {
      return { filtered: false, nodes: nodes.length, edges: edges.length, totalNodes: nodes.length, totalEdges: edges.length }
    }

    const visibleNodeCount = nodes.reduce((acc, n) => acc + (visibleNodeIds.has(n.id) ? 1 : 0), 0)
    const visibleEdgeCount = edges.reduce(
      (acc, e) => acc + (visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target) ? 1 : 0),
      0
    )
    return { filtered: true, nodes: visibleNodeCount, edges: visibleEdgeCount, totalNodes: nodes.length, totalEdges: edges.length }
  }, [edges, nodes, visibleNodeIds])

  const addManualNode = useCallback(() => {
    const id = `manual:${Date.now()}`
    const newNode: StudioNode = {
      id,
      type: "studio",
      position: { x: 120, y: 120 },
      data: {
        kind: "custom",
        label: "Note",
        subtitle: "Manual node",
        details: ["Double-click to rename (coming soon)."],
      },
    }
    setNodes((nds) => [...nds, newNode])
    setShouldFitView(true)
  }, [setNodes])

  useEffect(() => {
    if (!shouldFitView || !flowInstance) return

    requestAnimationFrame(() => {
      flowInstance.fitView({ padding: 0.2, duration: 200 })
      setShouldFitView(false)
    })
  }, [flowInstance, shouldFitView])

  const runScan = useCallback(async (options?: { preserveManual?: boolean; preservePositions?: boolean }) => {
    if (!projectPath) return
    const preserveManual = options?.preserveManual ?? true
    const preservePositions = options?.preservePositions ?? true
    setIsScanning(true)
    setScanError(null)

    try {
      const graph = await buildBackendStudioGraph({ projectPath, routes: pageRoutes })

      setNodes((prev) => {
        const prevById = new Map(prev.map((n) => [n.id, n]))
        const manualNodes = preserveManual ? prev.filter((n) => n.id.startsWith("manual:")) : []
        const nextScannedNodes = graph.nodes.map((n) => {
          if (!preservePositions) return n
          const existing = prevById.get(n.id)
          if (!existing) return n
          return {
            ...n,
            position: existing.position,
          }
        })
        return [...nextScannedNodes, ...manualNodes]
      })

      setEdges((prev) => {
        const manualEdges = preserveManual
          ? prev.filter(
              (e) =>
                (e.source.startsWith("manual:") || e.target.startsWith("manual:"))
            )
          : []
        return [...graph.edges, ...manualEdges]
      })

      setShouldFitView(true)
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Failed to scan project")
    } finally {
      setIsScanning(false)
    }
  }, [pageRoutes, projectPath, setEdges, setNodes])

  const lastAutoScannedProjectPathRef = useRef<string | null>(null)
  const lastRoutesKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!projectPath) return

    if (lastAutoScannedProjectPathRef.current !== projectPath) {
      lastAutoScannedProjectPathRef.current = projectPath
      lastRoutesKeyRef.current = null
      setSelectedPageFile(null)
      setSelection({ nodeId: null })
      void runScan({ preserveManual: false, preservePositions: false })
      return
    }

    const routesKey = pageRoutes
      .map((r) => normalizePath(r.file))
      .sort()
      .join("|")

    if (lastRoutesKeyRef.current === routesKey) return
    lastRoutesKeyRef.current = routesKey
    void runScan({ preserveManual: true, preservePositions: true })
  }, [pageRoutes, projectPath, runScan])

  const lastDetectedConvexUrlProjectPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!projectPath) return
    if (lastDetectedConvexUrlProjectPathRef.current === projectPath) return
    lastDetectedConvexUrlProjectPathRef.current = projectPath
    setConvexUrl("")

    void detectProjectConvexUrl(projectPath).then((url) => {
      if (url) setConvexUrl(url)
    })
  }, [projectPath])

  const handleOpenSource = useCallback(() => {
    const filePath = selectedData?.filePath
    if (!filePath) return
    void openProjectFileInExternalEditor({
      filePath,
      projectPath,
    }).then((result) => {
      if (!result.success) {
        console.error('[ProjectBackendStudioPage] Failed to open source in external editor', result.error)
      }
    })
  }, [projectPath, selectedData?.filePath])

  const handleRunSelected = useCallback(async () => {
    if (!selectedData || selectedData.kind !== "convex" || !selectedData.apiPath || !selectedData.operation) {
      return
    }
    if (selectedData.isInternal) {
      setRunnerOutput("Error: Internal Convex functions cannot be run from the client.")
      return
    }

    setIsRunning(true)
    setRunnerOutput("")

    try {
      if (!convexHttpClient) {
        throw new Error("Set a Convex URL to run this function.")
      }

      const args = runnerArgs.trim().length ? JSON.parse(runnerArgs) : {}
      const functionName = convexFunctionNameFromApiPath(selectedData.apiPath)

      const result =
        selectedData.operation === "query"
          ? await convexHttpClient.query(toFunctionReference<"query">(functionName), args)
          : selectedData.operation === "mutation"
            ? await convexHttpClient.mutation(toFunctionReference<"mutation">(functionName), args)
            : await convexHttpClient.action(toFunctionReference<"action">(functionName), args)

      setRunnerOutput(JSON.stringify(result, null, 2))
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to run function"
      setRunnerOutput(`Error: ${message}`)
    } finally {
      setIsRunning(false)
    }
  }, [convexHttpClient, runnerArgs, selectedData])

  const headerControls = useMemo(
    () => (
      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 max-w-[40vw] gap-1.5 rounded-full px-2.5 text-xs"
              disabled={!projectPath || isLoadingRoutes}
            >
              {isLoadingRoutes ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileCode2 className="h-3.5 w-3.5" />
              )}
              <span className="truncate">
                {selectedPage ? selectedPage.name : "All pages"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Page focus
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setSelectedPageFile(null)
                setSelection({ nodeId: null })
                setRunnerOutput("")
                setShouldFitView(true)
              }}
            >
              All pages
              {!selectedPageFile && <CheckCircle2 className="h-3 w-3 ml-auto text-green-500" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {routesError ? (
              <div className="px-2 py-2 text-xs text-destructive">
                {routesError}
              </div>
            ) : pageRoutes.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                No pages detected yet.
              </div>
            ) : (
              pageRoutes.map((route) => (
                <DropdownMenuItem
                  key={route.file}
                  onClick={() => {
                    setSelectedPageFile(route.file)
                    setSelection({ nodeId: null })
                    setRunnerOutput("")
                    setShouldFitView(true)
                  }}
                  className="flex items-start gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{route.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{route.path}</div>
                  </div>
                  {selectedPageFile && normalizePath(selectedPageFile) === normalizePath(route.file) ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
          onClick={() => {
            void runScan({ preserveManual: true, preservePositions: true })
          }}
          disabled={!projectPath || isScanning}
        >
          {isScanning ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Scan
        </Button>

        <Button
          size="sm"
          className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
          onClick={addManualNode}
          aria-label="Add node"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Node
        </Button>
      </div>
    ),
    [
      addManualNode,
      isLoadingRoutes,
      isScanning,
      pageRoutes,
      projectPath,
      routesError,
      runScan,
      selectedPage,
      selectedPageFile,
    ]
  )

  useProjectHeader(headerControls)

  const storedFrameworkInfo = useMemo(() => {
    const info = project?.frameworkInfo
    if (!info) return null
    return {
      framework: info.framework,
      devCommand: info.devCommand,
      devPort: info.devPort,
    }
  }, [project?.frameworkInfo])

  useEffect(() => {
    if (!projectPath) return

    let cancelled = false
    setIsLoadingRoutes(true)
    setRoutesError(null)

    void scanForRoutes(projectPath, storedFrameworkInfo)
      .then((result) => {
        if (cancelled) return
        setPageRoutes(result.routes)
      })
      .catch((e) => {
        if (cancelled) return
        setRoutesError(e instanceof Error ? e.message : "Failed to scan routes")
        setPageRoutes([])
      })
      .finally(() => {
        if (cancelled) return
        setIsLoadingRoutes(false)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, storedFrameworkInfo])

  useEffect(() => {
    if (!selectedPageFile) return
    const exists = pageRoutes.some((r) => normalizePath(r.file) === normalizePath(selectedPageFile))
    if (!exists) {
      setSelectedPageFile(null)
      setShouldFitView(true)
    }
  }, [pageRoutes, selectedPageFile])

  if (project === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100%+2.5rem)] -mt-10 bg-background">
      {/* Content */}
      <div className="flex-1 min-h-0 pt-10">
        <ResizablePanelGroup orientation="horizontal" className="h-[calc(100%-2.5rem)]">
          <ResizablePanel defaultSize="72" minSize="45" className="min-w-0">
            <ReactFlowProvider>
              <Canvas
                nodes={displayedNodes}
                edges={displayedEdges}
                nodeTypes={nodeTypes}
                bgColor="var(--background)"
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onSelectionChange={onSelectionChange}
                onInit={setFlowInstance}
                proOptions={{ hideAttribution: true }}
              >
                <Controls position="bottom-left" />
                <Panel position="top-right" className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Database className="h-3.5 w-3.5" />
                    <span className="tabular-nums">
                      {visibleCounts.filtered ? `${visibleCounts.nodes}/${visibleCounts.totalNodes}` : visibleCounts.nodes}
                    </span>
                    <span>nodes</span>
                  </div>
                  <div className="h-4 w-px bg-border/60" />
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <GitBranch className="h-3.5 w-3.5" />
                    <span className="tabular-nums">
                      {visibleCounts.filtered ? `${visibleCounts.edges}/${visibleCounts.totalEdges}` : visibleCounts.edges}
                    </span>
                    <span>links</span>
                  </div>
                </Panel>

                {scanError ? (
                  <Panel position="bottom-right" className="max-w-sm">
                    <div className="text-xs text-destructive">{scanError}</div>
                  </Panel>
                ) : null}

                {!projectPath ? (
                  <Panel position="top-left" className="max-w-sm">
                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Server className="h-4 w-4 mt-0.5" />
                      <div>
                        <div className="font-medium text-foreground">Local project not ready</div>
                        <div className="mt-0.5">
                          Sync the project first so Backend Studio can scan local files.
                        </div>
                      </div>
                    </div>
                  </Panel>
                ) : null}
              </Canvas>
            </ReactFlowProvider>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="28" minSize="20" maxSize="45" className="min-w-0">
            <div className="relative h-full bg-content-surface border-l border-border">
              <div className="h-9 px-3 flex items-center justify-between bg-background/60 backdrop-blur-sm">
                <div className="text-sm font-medium">Inspector</div>
              </div>

              <div className="app-scrollbar h-[calc(100%-2.25rem)] overflow-auto p-4">
                {!selectedData ? (
                  <Card className="p-4 bg-background/70">
                    <div className="text-sm font-medium mb-1">Select a node</div>
                    <p className="text-xs text-muted-foreground">
                      Click a node to see its source, callers, and (for Convex) run it with custom arguments.
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <Card className="p-4 bg-background/70">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-md border border-border/60 bg-muted/30 p-2">
                          {selectedData.kind === "convex" ? (
                            <Zap className="h-4 w-4 text-emerald-500" />
                          ) : selectedData.kind === "db" ? (
                            <Table2 className="h-4 w-4 text-violet-500" />
                          ) : selectedData.kind === "ui" ? (
                            <FileCode2 className="h-4 w-4 text-sky-500" />
                          ) : selectedData.kind === "api" ? (
                            <Server className="h-4 w-4 text-amber-500" />
                          ) : (
                            <GitBranch className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{selectedData.label}</div>
                          {selectedData.subtitle ? (
                            <div className="text-xs text-muted-foreground truncate">
                              {selectedData.subtitle}
                            </div>
                          ) : null}
                          {selectedData.filePath ? (
                            <div className="mt-2 text-[11px] text-muted-foreground break-all">
                              <span className="font-medium">File:</span> {selectedData.filePath}
                            </div>
                          ) : null}
                          {selectedData.apiPath ? (
                            <div className="mt-1 text-[11px] text-muted-foreground break-all">
                              <span className="font-medium">API:</span> api.{selectedData.apiPath}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={handleOpenSource} disabled={!selectedData.filePath}>
                          <FileCode2 className="h-4 w-4 mr-2" />
                          Open source
                        </Button>
                      </div>
                    </Card>

                    {selectedData.kind === "convex" ? (
                      <Card className="p-4 bg-background/70">
                        <div className="flex items-center gap-2 mb-2">
                          <Braces className="h-4 w-4 text-muted-foreground" />
                          <div className="text-sm font-medium">Run</div>
                          {selectedData.operation ? (
                            <span className="ml-auto rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {selectedData.operation}
                            </span>
                          ) : null}
                          {selectedData.isInternal ? (
                            <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              internal
                            </span>
                          ) : null}
                        </div>

                        <div className="text-[11px] text-muted-foreground mb-2">
                          Convex URL
                        </div>
                        <Input
                          value={convexUrl}
                          onChange={(e) => setConvexUrl(e.target.value)}
                          placeholder="https://your-deployment.convex.cloud"
                          className="font-mono text-xs"
                          spellCheck={false}
                        />

                        <div className="mt-3 text-[11px] text-muted-foreground mb-2">
                          Arguments (JSON)
                        </div>
                        <Textarea
                          value={runnerArgs}
                          onChange={(e) => setRunnerArgs(e.target.value)}
                          className="font-mono text-xs min-h-24"
                          spellCheck={false}
                        />

                        <div className="mt-3 flex items-center gap-2">
                          <Button
                            size="sm"
                            className="gap-2"
                            onClick={handleRunSelected}
                            disabled={isRunning || selectedData.isInternal}
                          >
                            {isRunning ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                            Run
                          </Button>
                        </div>
                        {selectedData.isInternal ? (
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            Internal Convex functions are server-only and cannot be invoked from this panel.
                          </div>
                        ) : null}

                        {runnerOutput ? (
                          <div className="mt-3">
                            <div className="text-[11px] text-muted-foreground mb-2">
                              Output
                            </div>
                            <pre className="app-scrollbar max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
                              {runnerOutput}
                            </pre>
                          </div>
                        ) : null}
                      </Card>
                    ) : null}

                    {selectedData.details?.length ? (
                      <Card className="p-4 bg-background/70">
                        <div className="text-sm font-medium mb-2">Details</div>
                        <div className="space-y-1">
                          {selectedData.details.map((line) => (
                            <div key={line} className="text-xs text-muted-foreground break-words">
                              {line}
                            </div>
                          ))}
                        </div>
                      </Card>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
