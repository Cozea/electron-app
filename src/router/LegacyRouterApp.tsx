import { useRoutes } from 'react-router-dom'

import { appRoutes } from '@/router/routes'

export function LegacyRouterApp() {
  return useRoutes(appRoutes)
}
