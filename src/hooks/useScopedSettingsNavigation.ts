import { useCallback } from 'react'

import { useViewTransitionNavigate } from '@/lib/navigation'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import { resolveScopedSettingsHref } from '@/lib/workspaces/settingsRoutes'
import { useSettingsDrawerStore } from '@/stores/useSettingsDrawerStore'

interface UseScopedSettingsNavigationOptions {
  route?: string
}

export function useScopedSettingsNavigation(
  options: UseScopedSettingsNavigationOptions = {},
) {
  const navigate = useViewTransitionNavigate()
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)
  const { workspaceScoped } = useScopedAppContext({ route: options.route })

  const resolveHref = useCallback(
    (href: string) => resolveScopedSettingsHref(href, workspaceScoped),
    [workspaceScoped],
  )

  const openScopedHref = useCallback(
    (href: string) => {
      const resolvedHref = resolveHref(href)
      if (resolvedHref.startsWith('/settings/') || resolvedHref.startsWith('/workspace/')) {
        openSettingsDrawer(resolvedHref)
        return
      }
      if (/^https?:\/\//i.test(resolvedHref)) {
        window.open(resolvedHref, '_blank', 'noopener,noreferrer')
        return
      }
      navigate(resolvedHref)
    },
    [navigate, openSettingsDrawer, resolveHref],
  )

  return {
    workspaceScoped,
    resolveScopedHref: resolveHref,
    openScopedHref,
  }
}
