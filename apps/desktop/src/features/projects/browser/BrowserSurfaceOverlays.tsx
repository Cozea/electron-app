import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore"
import { AgentBrowserCursor } from "./AgentBrowserCursor"
import { ZoomIndicator } from "./ZoomIndicator"

export function BrowserSurfaceOverlays({ runtimeTabId }: { readonly runtimeTabId: string }) {
  const state = useBrowserSurfaceStateStore((store) => store.byTabId[runtimeTabId])
  if (!state) return null
  return (
    <>
      <ZoomIndicator zoomFactor={state.zoomFactor} />
      <AgentBrowserCursor
        tabId={runtimeTabId}
        zoomFactor={state.zoomFactor}
        controller={state.controller}
      />
      {state.controller !== "none" ? (
        <div className="pointer-events-none absolute left-3 top-3 z-40 rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur">
          {state.controller === "agent" ? "Agent controlling browser" : "Human control"}
        </div>
      ) : null}
    </>
  )
}
