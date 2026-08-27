import { useMemo } from "react"
import { useLocation } from '@/lib/router'

import { useAuth } from "@/contexts/AuthContext"
import { resolveScope, type ResolvedScope } from "@/lib/scope/resolveScope"

interface UseResolvedScopeOptions {
  route?: string
  ignoreLocation?: boolean
}

export function useResolvedScope(options: UseResolvedScopeOptions = {}): ResolvedScope {
  const location = useLocation()
  const { personalWorkspace } = useAuth()
  const routePath = options.route ?? (options.ignoreLocation ? undefined : location.pathname)

  return useMemo(
    () =>
      resolveScope({
        routePath,
        personalWorkspace,
      }),
    [personalWorkspace, routePath]
  )
}
