import { memo, useCallback, useMemo, useState } from 'react'

import { ProjectPreviewGridCard } from './ProjectPreviewGridCard'
import { type PreviewRouteViewModel } from './types'

const MAX_GRID_LIVE_PREVIEWS = 4

interface ProjectPreviewGridProps {
  credentiallessAttribute?: '' | undefined
  onOpenCode: (file: string) => void
  onOpenRoute: (index: number) => void
  previewEmbedMode: 'credentialless' | 'standard'
  previewReloadToken: number
  routeViewModels: PreviewRouteViewModel[]
  serverRunning: boolean
}

export const ProjectPreviewGrid = memo(function ProjectPreviewGrid({
  credentiallessAttribute,
  onOpenCode,
  onOpenRoute,
  previewEmbedMode,
  previewReloadToken,
  routeViewModels,
  serverRunning,
}: ProjectPreviewGridProps) {
  const [visibleRoutePaths, setVisibleRoutePaths] = useState<Record<string, boolean>>({})

  const handleVisibilityChange = useCallback((routePath: string, visible: boolean) => {
    setVisibleRoutePaths((current) => {
      if ((current[routePath] ?? false) === visible) {
        return current
      }
      return {
        ...current,
        [routePath]: visible,
      }
    })
  }, [])

  const liveRoutePathSet = useMemo(() => {
    const activeRoutePaths = routeViewModels
      .filter((routeViewModel) => visibleRoutePaths[routeViewModel.route.path])
      .slice(0, MAX_GRID_LIVE_PREVIEWS)
      .map((routeViewModel) => routeViewModel.route.path)

    return new Set(activeRoutePaths)
  }, [routeViewModels, visibleRoutePaths])

  return (
    <div className="grid [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] gap-6">
      {routeViewModels.map((routeViewModel, index) => (
        <ProjectPreviewGridCard
          key={routeViewModel.route.path}
          credentiallessAttribute={credentiallessAttribute}
          livePreviewEnabled={serverRunning && liveRoutePathSet.has(routeViewModel.route.path)}
          onOpenCode={onOpenCode}
          onOpenRoute={onOpenRoute}
          onVisibilityChange={handleVisibilityChange}
          previewEmbedMode={previewEmbedMode}
          previewReloadToken={previewReloadToken}
          routeIndex={index}
          routeViewModel={routeViewModel}
          serverRunning={serverRunning}
        />
      ))}
    </div>
  )
})
