import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ProjectMemoryNodeState } from "@shared/electronApiTypes"

import { Button } from "@/components/ui/button"
import {
  buildMemoryLayout,
  hitTestMemoryLayout,
  type MemoryLayout,
  type MemoryLayoutNode,
} from "@/features/project-memory/memoryGraphLayout"
import {
  refreshProjectMemory,
  selectProjectMemoryNode,
} from "@/features/project-memory/projectMemoryStore"
import { useMemoryControls } from "@/features/project-memory/useMemoryControls"
import { useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  BrainCircuitIcon as __BrainCircuitHugeIcon,
  Cancel01Icon as __XHugeIcon,
} from "@hugeicons/core-free-icons"

interface WorkbenchMemoryTileProps {
  projectId: string
  workspaceId: string | null
  laneId: string | null
}

/**
 * Colour is the whole point of this surface: it answers "what moved?" at a glance.
 *
 * One cool, equal-luminance family so the map reads as a single living network
 * rather than three unrelated legends — cobalt is the resting substrate, violet
 * is a memory that moved, mint is new growth. Each node is drawn as a soft halo
 * under a crisp core, which is what gives the synaptic glow.
 */
const STATE_COLORS: Record<ProjectMemoryNodeState, string> = {
  new: "#3DE6A8",
  changed: "#B072FF",
  unchanged: "#4C8DFF",
}

/**
 * Documentation, decks and notes are drawn as diamonds; code stays circular.
 *
 * Shape rather than tone, because a darker fill reads as "de-emphasised" and
 * would collide with dimming, which means something else. Shape is orthogonal
 * to both hue and brightness: state still says what changed, and the silhouette
 * says what kind of memory it is.
 *
 * One map rather than two — a pitch deck's value here is precisely what it
 * links to in the code, and splitting the graph would throw those edges away.
 */

/** A graph with no file_type is code; only an explicit other type is not. */
function isCodeNode(fileType: string | null): boolean {
  return fileType === null || fileType === "code"
}

const CODE_TYPE_KEY = "code"

/** Collapses null and "code" onto one key so the facet has no empty duplicate. */
function typeKeyOf(fileType: string | null): string {
  return isCodeNode(fileType) ? CODE_TYPE_KEY : fileType!
}

/** What a filtered-out memory fades to. */
const DIMMED_ALPHA = 0.09

/** Wider, dimmer disc behind each core. Cheaper than shadowBlur at this node count. */
const STATE_HALO_COLORS: Record<ProjectMemoryNodeState, string> = {
  new: "rgba(61, 230, 168, 0.22)",
  changed: "rgba(176, 114, 255, 0.22)",
  unchanged: "rgba(76, 141, 255, 0.14)",
}

/**
 * Hover colour, deliberately outside the state palette.
 *
 * Amber is the one warm hue here, so it cannot be mistaken for "new" or
 * "changed" — it only ever means "this is the one under your cursor". Marking
 * the hovered node instead of dimming the other ~1300 keeps the map calm; the
 * old dim-everything approach made the whole surface flicker on every mouse
 * move.
 */
const FOCUS_COLOR = "#FFC53D"
const FOCUS_HALO_COLOR = "rgba(255, 197, 61, 0.26)"
const FOCUS_EDGE_COLOR = "rgba(255, 197, 61, 0.58)"
/**
 * Connected memories get a ring, not a fill. Recolouring them would throw away
 * the thing the palette exists to say — whether each one is new, changed, or
 * untouched — so the state stays in the core and the connection rides on the
 * border.
 */
const FOCUS_NEIGHBOR_RING_COLOR = "rgba(255, 201, 64, 0.95)"

const STATE_EDGE_COLORS: Record<ProjectMemoryNodeState, string> = {
  new: "rgba(61, 230, 168, 0.34)",
  changed: "rgba(176, 114, 255, 0.30)",
  unchanged: "rgba(76, 141, 255, 0.16)",
}

/** Explicit map: TranslationKey is a strict union, so template keys do not typecheck. */
const STATE_LABEL_KEYS = {
  new: "workbench.memory.state.new",
  changed: "workbench.memory.state.changed",
  unchanged: "workbench.memory.state.unchanged",
} as const

/** Below this, names are unreadable overlap rather than information. */
const LABEL_MIN_SCALE = 1.5

const MIN_SCALE = 0.12
const MAX_SCALE = 4

export function WorkbenchMemoryTile({ projectId, workspaceId, laneId }: WorkbenchMemoryTileProps) {
  const { t } = useTranslation()
  const { key, run, defaultAgent, requestUpdate, settings } = useMemoryControls({
    projectId,
    workspaceId,
    laneId,
  })

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasObserverRef = useRef<ResizeObserver | null>(null)
  const rootObserverRef = useRef<ResizeObserver | null>(null)
  const [tileWidth, setTileWidth] = useState(0)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  /*
   * Two independent facets. Selecting nothing shows everything; selecting
   * within a facet narrows it, and the facets combine — "changed docs" is the
   * intersection, which is the question people actually ask of a map.
   */
  const [activeStates, setActiveStates] = useState<ReadonlySet<ProjectMemoryNodeState>>(
    () => new Set(),
  )
  const [activeTypes, setActiveTypes] = useState<ReadonlySet<string>>(() => new Set())

  const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0, initialized: false })
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [, forceRender] = useState(0)

  useEffect(() => {
    if (!key || !workspaceId) return
    viewRef.current.initialized = false
    void refreshProjectMemory(key, workspaceId, laneId)
  }, [key, workspaceId, laneId])

  const memoryTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of run.graph?.nodes ?? []) {
      const key = typeKeyOf(node.fileType)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    // Biggest first, but code leads when present: it is the spine of the map.
    return Array.from(counts.entries())
      .sort((a, b) => {
        if (a[0] !== b[0] && (a[0] === CODE_TYPE_KEY || b[0] === CODE_TYPE_KEY)) {
          return a[0] === CODE_TYPE_KEY ? -1 : 1
        }
        return b[1] - a[1]
      })
      .map(([type, count]) => ({ type, count }))
  }, [run.graph])

  const filtering = activeStates.size > 0 || activeTypes.size > 0

  const matchesFilter = useCallback(
    (node: { state: ProjectMemoryNodeState; fileType: string | null }) => {
      if (activeStates.size > 0 && !activeStates.has(node.state)) return false
      if (activeTypes.size > 0 && !activeTypes.has(typeKeyOf(node.fileType))) return false
      return true
    },
    [activeStates, activeTypes],
  )

  const layout: MemoryLayout | null = useMemo(
    () => (run.graph ? buildMemoryLayout(run.graph) : null),
    [run.graph],
  )

  // Only the focused id matters now: neighbours are no longer treated
  // differently from the rest of the map.
  const focusId = hoveredId ?? run.selectedNodeId ?? null

  /** Fit the whole map on first paint so nothing opens on an empty viewport. */
  const fitToView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !layout) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width <= 0 || height <= 0) return
    const { minX, minY, maxX, maxY } = layout.bounds
    const spanX = Math.max(maxX - minX, 1)
    const spanY = Math.max(maxY - minY, 1)
    const scale = Math.min(width / (spanX * 1.12), height / (spanY * 1.12), MAX_SCALE)
    viewRef.current = {
      scale,
      offsetX: width / 2 - ((minX + maxX) / 2) * scale,
      offsetY: height / 2 - ((minY + maxY) / 2) * scale,
      initialized: true,
    }
    forceRender((value) => value + 1)
  }, [layout])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !layout) return
    const context = canvas.getContext("2d")
    if (!context) return

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)

    const { scale, offsetX, offsetY } = viewRef.current
    const toScreenX = (x: number) => x * scale + offsetX
    const toScreenY = (y: number) => y * scale + offsetY

    const focus = focusId

    /** Every link is bowed perpendicular to its midpoint: straight lines read
     * as scratches across the map, an arc reads as a dendrite. */
    /** Diamonds carry less area than a circle of the same radius, so nudge up. */
    const traceNode = (x: number, y: number, radius: number, code: boolean) => {
      context.beginPath()
      if (code) {
        context.arc(x, y, radius, 0, Math.PI * 2)
        return
      }
      const reach = radius * 1.2
      context.moveTo(x, y - reach)
      context.lineTo(x + reach, y)
      context.lineTo(x, y + reach)
      context.lineTo(x - reach, y)
      context.closePath()
    }

    const strokeEdge = (edge: (typeof layout.edges)[number]) => {
      const x1 = toScreenX(edge.sourceX)
      const y1 = toScreenY(edge.sourceY)
      const x2 = toScreenX(edge.targetX)
      const y2 = toScreenY(edge.targetY)
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2
      const dx = x2 - x1
      const dy = y2 - y1
      const bow = 0.12
      context.beginPath()
      context.moveTo(x1, y1)
      context.quadraticCurveTo(midX - dy * bow, midY + dx * bow, x2, y2)
      context.stroke()
    }

    // The map is drawn at full strength regardless of hover. Nothing recedes.
    context.lineWidth = Math.max(0.4, 0.7 * scale)
    for (const edge of layout.edges) {
      if (filtering) {
        const source = layout.byId.get(edge.sourceId)
        const target = layout.byId.get(edge.targetId)
        const bothSurvive =
          source && target && matchesFilter(source.node) && matchesFilter(target.node)
        context.globalAlpha = bothSurvive ? 1 : DIMMED_ALPHA
      }
      context.strokeStyle = STATE_EDGE_COLORS[edge.state]
      strokeEdge(edge)
    }
    context.globalAlpha = 1

    for (const entry of layout.nodes) {
      const radius = Math.max(1, entry.radius * scale)
      const screenX = toScreenX(entry.x)
      const screenY = toScreenY(entry.y)

      const code = isCodeNode(entry.node.fileType)
      context.globalAlpha = filtering && !matchesFilter(entry.node) ? DIMMED_ALPHA : 1

      context.fillStyle = STATE_HALO_COLORS[entry.node.state]
      traceNode(screenX, screenY, radius * 2.4, code)
      context.fill()

      context.fillStyle = STATE_COLORS[entry.node.state]
      traceNode(screenX, screenY, radius, code)
      context.fill()
    }
    context.globalAlpha = 1

    // The hovered memory is added on top rather than carved out of the rest.
    const focusEntry = focus ? layout.byId.get(focus) : null
    if (focusEntry) {
      context.lineWidth = Math.max(1, 1.4 * scale)
      context.strokeStyle = FOCUS_EDGE_COLOR
      for (const edge of layout.edges) {
        if (edge.sourceId !== focus && edge.targetId !== focus) continue
        strokeEdge(edge)
      }

      // Ring every directly connected memory, keeping its own colour inside.
      const neighbors = focus ? layout.adjacency.get(focus) : null
      if (neighbors) {
        context.strokeStyle = FOCUS_NEIGHBOR_RING_COLOR
        context.lineWidth = Math.max(1.5, 1.2 * scale)
        for (const neighborId of neighbors) {
          const neighbor = layout.byId.get(neighborId)
          if (!neighbor) continue
          const neighborRadius = Math.max(1, neighbor.radius * scale)
          traceNode(
            toScreenX(neighbor.x),
            toScreenY(neighbor.y),
            neighborRadius + Math.max(1.4, 0.9 * scale),
            isCodeNode(neighbor.node.fileType),
          )
          context.stroke()
        }
      }

      const radius = Math.max(2, focusEntry.radius * scale * 1.5)
      const haloRadius = radius * 3
      const screenX = toScreenX(focusEntry.x)
      const screenY = toScreenY(focusEntry.y)

      const focusIsCode = isCodeNode(focusEntry.node.fileType)

      context.fillStyle = FOCUS_HALO_COLOR
      traceNode(screenX, screenY, haloRadius, focusIsCode)
      context.fill()

      context.fillStyle = FOCUS_COLOR
      traceNode(screenX, screenY, radius, focusIsCode)
      context.fill()

      context.strokeStyle = "rgba(255,255,255,0.85)"
      context.lineWidth = 1.4
      context.stroke()
    }

    /*
     * Labels are drawn with a dark outline under a light fill, because they can
     * land on anything: the dark canvas, a bright node, or the amber focus
     * glow. Light-on-light was invisible wherever the highlight fell.
     */
    const drawLabel = (text: string, x: number, y: number, fill: string) => {
      context.lineJoin = "round"
      context.lineWidth = 3
      context.strokeStyle = "rgba(8, 8, 10, 0.9)"
      context.strokeText(text, x, y)
      context.fillStyle = fill
      context.fillText(text, x, y)
    }

    /*
     * Names arrive progressively. Showing every hub at once produced a wall of
     * overlapping text long before it was readable, so the bar starts high and
     * drops as the user zooms in and there is room for more.
     */
    if (scale > LABEL_MIN_SCALE) {
      const degreeFloor = scale > 3.2 ? 2 : scale > 2.2 ? 6 : 12
      context.font = "500 11px Inter, system-ui, sans-serif"
      context.textAlign = "center"
      context.textBaseline = "middle"
      context.globalAlpha = 0.9

      // Hubs clustered inside one island would still stack their names, so
      // claim space greedily: the most connected memory wins the spot and any
      // name that would collide is dropped rather than drawn on top.
      const placed: Array<{ left: number; right: number; top: number; bottom: number }> = []
      const candidates = layout.nodes
        .filter((entry) => entry.node.degree >= degreeFloor && entry.node.id !== focus)
        .sort((a, b) => b.node.degree - a.node.degree)

      for (const entry of candidates) {
        if (filtering && !matchesFilter(entry.node)) continue
        const text = entry.node.label.slice(0, 28)
        const x = toScreenX(entry.x)
        const y = toScreenY(entry.y) - entry.radius * scale - 7
        const halfWidth = context.measureText(text).width / 2 + 2
        const box = { left: x - halfWidth, right: x + halfWidth, top: y - 11, bottom: y + 11 }
        const collides = placed.some(
          (other) =>
            box.left < other.right &&
            box.right > other.left &&
            box.top < other.bottom &&
            box.bottom > other.top,
        )
        if (collides) continue
        placed.push(box)
        drawLabel(text, x, y, "#e5e7eb")
      }
      context.globalAlpha = 1
    }

    // The hovered name is always shown, at any zoom, since it is what the
    // pointer is asking about.
    if (focusEntry) {
      context.font = "600 12px Inter, system-ui, sans-serif"
      context.textAlign = "center"
      context.textBaseline = "middle"
      // Sit on the solid core, not out past the halo: anchored to the halo the
      // name drifted far from the node it belongs to. The dark outline keeps it
      // readable against the amber it now overlaps.
      drawLabel(
        focusEntry.node.label.slice(0, 40),
        toScreenX(focusEntry.x),
        toScreenY(focusEntry.y) - Math.max(2, focusEntry.radius * scale * 1.5) - 9,
        FOCUS_COLOR,
      )
    }
  }, [layout, focusId, filtering, matchesFilter])

  useEffect(() => {
    if (!layout) return
    if (!viewRef.current.initialized) fitToView()
    draw()
  }, [layout, draw, fitToView])

  // `draw` changes identity on every hover, so the observer reads the latest
  // through refs instead of being torn down and rebuilt each time.
  const drawRef = useRef(draw)
  drawRef.current = draw
  const fitToViewRef = useRef(fitToView)
  fitToViewRef.current = fitToView

  /*
   * The legend has to earn its share of a tile the user may have made small.
   *
   * A callback ref rather than useRef plus an effect: this component early
   * returns to an empty state when there is no graph, which unmounts the root.
   * An effect with empty deps would keep observing that detached node forever
   * and never see the remounted one, leaving the width stuck at zero.
   */
  const attachRoot = useCallback((node: HTMLDivElement | null) => {
    rootObserverRef.current?.disconnect()
    rootObserverRef.current = null
    if (!node) return

    const measure = () => {
      const next = node.getBoundingClientRect().width
      setTileWidth((current) => (Math.abs(current - next) > 1 ? next : current))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    rootObserverRef.current = observer
  }, [])

  useEffect(() => () => rootObserverRef.current?.disconnect(), [])

  // Same remount hazard as the root: this subtree is replaced by the empty
  // state whenever the graph goes away.
  const attachCanvasContainer = useCallback((node: HTMLDivElement | null) => {
    canvasObserverRef.current?.disconnect()
    canvasObserverRef.current = null
    if (!node) return

    const observer = new ResizeObserver(() => {
      if (!viewRef.current.initialized) fitToViewRef.current()
      drawRef.current()
    })
    observer.observe(node)
    canvasObserverRef.current = observer
  }, [])

  useEffect(() => () => canvasObserverRef.current?.disconnect(), [])

  const toGraphSpace = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { scale, offsetX, offsetY } = viewRef.current
    return {
      x: (clientX - rect.left - offsetX) / scale,
      y: (clientY - rect.top - offsetY) / scale,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      const dx = event.clientX - dragRef.current.x
      const dy = event.clientY - dragRef.current.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true
      viewRef.current.offsetX += dx
      viewRef.current.offsetY += dy
      dragRef.current.x = event.clientX
      dragRef.current.y = event.clientY
      draw()
      return
    }
    if (!layout) return
    const point = toGraphSpace(event.clientX, event.clientY)
    if (!point) return
    const hit = hitTestMemoryLayout(layout, point.x, point.y, 6 / viewRef.current.scale)
    const nextId = hit?.node.id ?? null
    if (nextId !== hoveredId) setHoveredId(nextId)
  }

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.moved) return
    if (!layout || !key || !workspaceId) return
    const point = toGraphSpace(event.clientX, event.clientY)
    if (!point) return
    const hit: MemoryLayoutNode | null = hitTestMemoryLayout(
      layout,
      point.x,
      point.y,
      6 / viewRef.current.scale,
    )
    void selectProjectMemoryNode(key, workspaceId, laneId, hit?.node.id ?? null)
  }

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!layout) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const view = viewRef.current
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * Math.exp(-event.deltaY * 0.0016)))
    // Zoom about the cursor rather than the origin.
    view.offsetX = pointerX - ((pointerX - view.offsetX) / view.scale) * next
    view.offsetY = pointerY - ((pointerY - view.offsetY) / view.scale) * next
    view.scale = next
    draw()
  }

  const counts = run.graph?.counts
  const detail = run.detail

  const toggle = <T,>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
    const next = new Set(set)
    if (!next.delete(value)) next.add(value)
    return next
  }

  const legendPosition = settings.legendPosition
  const vertical = legendPosition === "left" || legendPosition === "right"

  /*
   * A rail takes a share of the tile rather than a fixed 176px, which on a
   * narrow tile crowded out the map it is meant to describe. Below the point
   * where a label fits, chips fall back to marker and count with the name in
   * the tooltip.
   */
  const railWidth = vertical
    ? Math.round(Math.min(176, Math.max(76, tileWidth * 0.2)))
    : null
  const compactChips = vertical
    ? railWidth !== null && railWidth < 124
    : tileWidth > 0 && tileWidth < 420

  const legend = (
    <div
      className={cn(
        "flex gap-1 text-[11px]",
        vertical
          ? "h-full flex-col items-stretch overflow-y-auto"
          : "items-center overflow-x-auto",
      )}
    >
      {(["new", "changed", "unchanged"] as const).map((state) => {
        const active = activeStates.has(state)
        return (
          <button
            key={state}
            type="button"
            aria-pressed={active}
            title={`${t(STATE_LABEL_KEYS[state])} · ${t("workbench.memory.legend.filterHint")}`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors",
              vertical && "w-full justify-start",
              active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60",
            )}
            onClick={() => setActiveStates((current) => toggle(current, state))}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                // A ring rather than a colour change: the swatch has to keep
                // meaning what it means while also showing it is selected.
                active && "ring-2 ring-foreground/70 ring-offset-1 ring-offset-content-surface",
              )}
              style={{ backgroundColor: STATE_COLORS[state] }}
              aria-hidden
            />
            {!compactChips ? <span className="truncate">{t(STATE_LABEL_KEYS[state])}</span> : null}
            {counts ? <span className="tabular-nums text-foreground/70">{counts[state]}</span> : null}
          </button>
        )
      })}

      {memoryTypes.length > 1 ? (
        <span
          className={cn(
            "shrink-0 bg-border/60",
            vertical ? "my-1 h-px w-full" : "mx-1 h-4 w-px",
          )}
          aria-hidden
        />
      ) : null}

      {memoryTypes.length > 1
        ? memoryTypes.map(({ type, count }) => {
            const active = activeTypes.has(type)
            const code = type === CODE_TYPE_KEY
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                title={`${type} · ${t("workbench.memory.legend.filterHint")}`}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors",
                  vertical && "w-full justify-start",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
                onClick={() => setActiveTypes((current) => toggle(current, type))}
              >
                {/* Uncoloured on purpose: shape carries the type, so the marker
                    behaves as a checkbox in that shape rather than a swatch. */}
                <span
                  className={cn(
                    "size-[7px] border",
                    code ? "rounded-full" : "rotate-45",
                    active
                      ? "border-foreground bg-foreground"
                      : "border-muted-foreground/70 bg-transparent",
                  )}
                  aria-hidden
                />
                {!compactChips ? <span className="truncate capitalize">{type}</span> : null}
                <span className="tabular-nums text-foreground/70">{count}</span>
              </button>
            )
          })
        : null}

      {filtering ? (
        <button
          type="button"
          className={cn(
            "shrink-0 rounded-md px-1.5 py-1 text-left text-muted-foreground underline-offset-2 hover:bg-secondary/60 hover:underline",
            vertical ? "w-full" : "ml-1",
          )}
          onClick={() => {
            setActiveStates(new Set())
            setActiveTypes(new Set())
          }}
        >
          {compactChips ? "×" : t("workbench.memory.legend.clear")}
        </button>
      ) : null}
    </div>
  )

  if (!workspaceId) {
    return <MemoryEmptyState title={t("workbench.memory.noWorkspace")} />
  }

  if (run.status && !run.status.available) {
    // Nothing to remember yet is a different situation from a map not built.
    if (!run.status.projectHasSource) {
      return (
        <MemoryEmptyState
          title={t("workbench.memory.noProject.title")}
          description={t("workbench.memory.noProject.description")}
        />
      )
    }

    return (
      <MemoryEmptyState
        title={t("workbench.memory.empty.title")}
        description={
          defaultAgent
            ? t("workbench.memory.empty.description")
            : t("workbench.memory.empty.needsAgent")
        }
        action={
          run.error && !run.updating ? (
            <div className="space-y-2">
              <p className="text-[12px] leading-5 text-destructive">{run.error}</p>
              {defaultAgent ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => requestUpdate(defaultAgent, "build")}
                >
                  {t("workbench.memory.build.retry")}
                </Button>
              ) : null}
            </div>
          ) : run.updating ? (
            <div className="flex items-center justify-center gap-2">
              <span className="cozea-loader size-3.5" aria-hidden />
              <span className="text-[12px] text-muted-foreground">
                {run.updating.agentName} {t("workbench.memory.update.working")}
              </span>
            </div>
          ) : defaultAgent ? (
            <Button
              type="button"
              size="sm"
              onClick={() => requestUpdate(defaultAgent, "build")}
            >
              <HugeiconsIcon icon={__BrainCircuitHugeIcon} className="size-4" />
              {t("workbench.memory.build.action")}
            </Button>
          ) : null
        }
      />
    )
  }

  return (
    <div
      ref={attachRoot}
      className={cn(
        "flex h-full min-h-0 bg-content-surface",
        legendPosition === "top" && "flex-col",
        legendPosition === "bottom" && "flex-col-reverse",
        legendPosition === "left" && "flex-row",
        legendPosition === "right" && "flex-row-reverse",
      )}
    >
      <div
        className={cn(
          "shrink-0 border-border/60",
          // The border always faces the map, whichever edge the rail is on.
          vertical ? "overflow-hidden px-1.5 py-2" : "flex h-10 items-center px-2",
          legendPosition === "top" && "border-b",
          legendPosition === "bottom" && "border-t",
          legendPosition === "left" && "border-r",
          legendPosition === "right" && "border-l",
        )}
        style={vertical && railWidth ? { width: railWidth } : undefined}
      >
        {legend}
      </div>

      <div className="relative min-h-0 flex-1" ref={attachCanvasContainer}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 size-full cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => {
            dragRef.current = { x: event.clientX, y: event.clientY, moved: false }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId)
            window.setTimeout(() => {
              dragRef.current = null
            }, 0)
          }}
          onPointerMove={handlePointerMove}
          onClick={handleClick}
          onWheel={handleWheel}
        />

        {run.updating ? (
          <div
            className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-b from-violet-500/[0.07] via-transparent to-sky-500/[0.07]"
            aria-hidden
          />
        ) : null}

        {run.loading ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="rounded-full bg-background/80 px-3 py-1 text-[11px] text-muted-foreground">
              {t("workbench.memory.loading")}
            </span>
          </div>
        ) : null}

        {detail ? (
          <aside className="absolute inset-y-0 right-0 flex w-80 flex-col border-l border-border/60 bg-background/95 backdrop-blur">
            <div className="flex items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {detail.node.label}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: STATE_COLORS[detail.node.state] }}
                    aria-hidden
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {t(STATE_LABEL_KEYS[detail.node.state])}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={t("workbench.memory.detail.close")}
                onClick={() =>
                  key && void selectProjectMemoryNode(key, workspaceId, laneId, null)
                }
              >
                <HugeiconsIcon icon={__XHugeIcon} className="size-3.5" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[12px]">
              {detail.node.sourceFile ? (
                <DetailRow label={t("workbench.memory.detail.source")}>
                  <span className="font-mono text-[11px] break-all text-foreground/85">
                    {detail.node.sourceFile}
                    {detail.node.sourceLocation ? `:${detail.node.sourceLocation}` : ""}
                  </span>
                </DetailRow>
              ) : null}

              {detail.node.communityName ? (
                <DetailRow label={t("workbench.memory.detail.community")}>
                  {detail.node.communityName}
                </DetailRow>
              ) : null}

              {detail.node.fileType && !isCodeNode(detail.node.fileType) ? (
                <DetailRow label={t("workbench.memory.detail.kind")}>
                  <span className="capitalize">{detail.node.fileType}</span>
                </DetailRow>
              ) : null}

              {detail.changes.length > 0 ? (
                <DetailRow label={t("workbench.memory.detail.changes")}>
                  <div className="space-y-2">
                    {detail.changes.map((change) => (
                      <div key={change.field} className="rounded-md border border-border/60 p-2">
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {change.field}
                        </div>
                        <div className="font-mono text-[11px] text-rose-300/80 line-through break-all">
                          {change.before ?? "—"}
                        </div>
                        <div className="font-mono text-[11px] text-emerald-300/90 break-all">
                          {change.after ?? "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                </DetailRow>
              ) : detail.node.state === "new" ? (
                <DetailRow label={t("workbench.memory.detail.changes")}>
                  <span className="text-muted-foreground">
                    {t("workbench.memory.detail.isNew")}
                  </span>
                </DetailRow>
              ) : null}

              <DetailRow
                label={`${t("workbench.memory.detail.connections")} (${detail.neighbors.length})`}
              >
                <div className="space-y-1">
                  {detail.neighbors.map((neighbor) => (
                    <button
                      key={`${neighbor.direction}-${neighbor.id}`}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-secondary/60"
                      onClick={() =>
                        key && void selectProjectMemoryNode(key, workspaceId, laneId, neighbor.id)
                      }
                    >
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {neighbor.direction === "out" ? "→" : "←"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{neighbor.label}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {neighbor.relation}
                      </span>
                    </button>
                  ))}
                </div>
              </DetailRow>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-foreground/90">{children}</div>
    </div>
  )
}

function MemoryEmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center bg-content-surface p-8 text-center">
      <div className="max-w-sm space-y-3">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-secondary/70">
          <HugeiconsIcon icon={__BrainCircuitHugeIcon} className="size-6 text-muted-foreground" />
        </div>
        <div className="text-[15px] font-medium text-foreground">{title}</div>
        {description ? (
          <p className="text-[12px] leading-5 text-muted-foreground">{description}</p>
        ) : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  )
}

export default WorkbenchMemoryTile
