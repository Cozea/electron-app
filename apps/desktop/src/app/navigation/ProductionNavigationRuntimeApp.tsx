import { useEffect, useMemo } from 'react'

import { ConvexProvider } from '@/contexts/ConvexProvider'
import { AuthContext, type AuthContextType } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { LanguageProvider } from '@/lib/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/features/assistant/ui/toast'
import { ProjectLayout } from '@/features/projects/layouts/ProjectLayout'
import { ProjectWorkbenchPage } from '@/features/projects/pages/ProjectWorkbenchPage'
import {
  invalidateProjectLaneState,
  invalidateProjectWorkspaceResolution,
} from '@/app/resources/workspaceResources'
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@/lib/router'
import { createMemoryHistory } from '@tanstack/react-router'

type Destination = 'store' | 'inbox' | 'a' | 'b' | 'c' | 'd'

const testAuth: AuthContextType = {
  user: {
    principalId: 'navigation-test-principal',
    identityKey: 'navigation-test-device',
    displayName: 'Navigation Test',
    presentationConfigured: true,
    avatarUrl: null,
    platform: 'linux',
  },
  principalId: null,
  accessToken: null,
  personalWorkspace: null,
  isAuthenticated: true,
  isConvexAuthReady: false,
  isLoading: false,
  isRevalidating: false,
  authError: null,
  needsOnboarding: false,
  retryDeviceSession: async () => {},
  refreshToken: async () => 'retryable',
}

function TestRoot() {
  return (
    <ConvexProvider>
      <ToastProvider>
        <LanguageProvider>
          <ThemeProvider>
            <TooltipProvider>
              <AuthContext.Provider value={testAuth}>
                <Outlet />
              </AuthContext.Provider>
            </TooltipProvider>
          </ThemeProvider>
        </LanguageProvider>
      </ToastProvider>
    </ConvexProvider>
  )
}

function OrdinaryRoute({ name }: { name: 'store' | 'inbox' }) {
  return <div data-production-route={name}>{name}</div>
}

function createNavigationTestRouter() {
  const rootRoute = createRootRoute({ component: TestRoot })
  const projectsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects',
    component: ProjectLayout,
  })
  const storeRoute = createRoute({
    getParentRoute: () => projectsRoute,
    path: '/store',
    component: () => <OrdinaryRoute name="store" />,
  })
  const inboxRoute = createRoute({
    getParentRoute: () => projectsRoute,
    path: '/inbox',
    component: () => <OrdinaryRoute name="inbox" />,
  })
  const projectRoute = createRoute({
    getParentRoute: () => projectsRoute,
    path: '/p/$projectId',
    component: Outlet,
  })
  const workbenchRoute = createRoute({
    getParentRoute: () => projectRoute,
    path: '/workbench',
    component: ProjectWorkbenchPage,
  })
  const routeTree = rootRoute.addChildren([
    projectsRoute.addChildren([
      storeRoute,
      inboxRoute,
      projectRoute.addChildren([workbenchRoute]),
    ]),
  ])
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/projects/store'] }),
  })
}

export function ProductionNavigationRuntimeApp() {
  const router = useMemo(createNavigationTestRouter, [])

  useEffect(() => {
    const api = {
      async attachProject(projectId: string, folderPath: string) {
        const result = await window.electronAPI.workspace?.attachExistingFolder({
          projectId,
          folderPath,
          setActive: true,
        })
        if (!result?.success || !result.workspace) {
          throw new Error(result?.error ?? `Unable to attach ${projectId}`)
        }
        invalidateProjectWorkspaceResolution(projectId)
        invalidateProjectLaneState(projectId)
        return result.workspace
      },
      async reattachProject(projectId: string, workspaceId: string, folderPath: string) {
        await window.electronAPI.workspace?.forget(workspaceId)
        return await api.attachProject(projectId, folderPath)
      },
      async navigate(destination: Destination) {
        if (destination === 'store' || destination === 'inbox') {
          await router.navigate({ to: `/projects/${destination}` })
          return
        }
        await router.navigate({
          to: '/projects/p/$projectId/workbench',
          params: { projectId: `project-${destination}` },
          state: {
            projectId: `project-${destination}`,
            projectName: destination.toUpperCase(),
          } as never,
        })
      },
      async snapshot() {
        const surface = document.querySelector<HTMLElement>('[data-workbench-persistent-surface="true"]')
        return {
          destination: router.state.location.pathname,
          ordinarySurface: document.querySelector('[data-production-route]')?.getAttribute('data-production-route') ?? null,
          shellPresent: Boolean(document.querySelector('[data-project-layout-shell="true"]')),
          surfaceVisible: surface?.dataset.workbenchVisible ?? null,
          sessionKey: surface?.dataset.workbenchSessionKey ?? null,
          lifecycle: surface?.dataset.workbenchLifecycle ?? null,
          residentCount: Number(document.querySelector('[data-testid="workbench-presentation-host"]')?.getAttribute('data-resident-count') ?? 0),
          dockviewCount: document.querySelectorAll('.cozea-workbench-dockview-host').length,
          sessions: await window.electronAPI.workbenchSession.listSessions(),
        }
      },
    }
    ;(window as unknown as { __navigationProductionRuntime?: typeof api }).__navigationProductionRuntime = api
    document.documentElement.dataset.navigationProductionReady = 'true'
    return () => {
      delete (window as unknown as { __navigationProductionRuntime?: typeof api }).__navigationProductionRuntime
      delete document.documentElement.dataset.navigationProductionReady
    }
  }, [router])

  return <RouterProvider router={router} />
}
