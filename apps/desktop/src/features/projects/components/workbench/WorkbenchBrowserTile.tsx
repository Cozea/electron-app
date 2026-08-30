import type { DockviewApi, DockviewPanelApi } from "dockview-react"

import {
  BrowserUnavailableSurface,
  isExternallyOpenableBrowserUrl,
} from "@/features/projects/components/workbench/BrowserUnavailableSurface"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import type { WorkbenchBrowserTile as WorkbenchBrowserTileRecord } from "@/stores/useProjectWorkbenchStore"

interface WorkbenchBrowserTileProps {
  projectId: string
  laneId: string
  tile: WorkbenchBrowserTileRecord
  workspaceId: string | null
  workbenchSessionKey: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

export function WorkbenchBrowserTile({
  tile,
  panelApi,
  containerApi,
}: WorkbenchBrowserTileProps) {
  const externalUrl = isExternallyOpenableBrowserUrl(tile.url) ? tile.url : null

  return (
    <div className="h-full min-h-0" data-workbench-browser-tile="true">
      <WorkbenchTileChrome
        title={tile.title || "Browser"}
        panelApi={panelApi}
        containerApi={containerApi}
        hideTitlePill
        tileType="browser"
      >
        <BrowserUnavailableSurface
          url={tile.url || null}
          onOpenExternal={externalUrl
            ? async () => {
                await window.electronAPI.shell.openExternal(externalUrl)
              }
            : undefined}
        />
      </WorkbenchTileChrome>
    </div>
  )
}
