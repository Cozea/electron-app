import { useMemo } from "react"
import { useLocation } from '@tanstack/react-router'

import { useAuth } from "@/contexts/AuthContext"
import { resolveScope, type ResolvedScope } from "@/lib/scope/resolveScope"

interface UseResolvedScopeOptions {
  route?: string
  ignoreLocation?: boolean
}

export function useResolvedScope(options: UseResolvedScopeOptions = {}): ResolvedScope {
  const location = useLocation()
  const { currentOrganizationWorkspace, currentPersonalWorkspace, personalWorkspace } = useAuth()
  const routePath = options.route ?? (options.ignoreLocation ? undefined : location.pathname)

  return useMemo(
    () =>
      resolveScope({
        routePath,
        currentOrganizationWorkspace,
        currentPersonalWorkspace,
        personalWorkspace,
      }),
    [currentOrganizationWorkspace, currentPersonalWorkspace, personalWorkspace, routePath]
  )
}
