import { createBrowserRouter } from 'react-router-dom'

import { appRoutes } from '@/router/routes'

export const appRouter = createBrowserRouter(appRoutes, {
  future: {
    v7_startTransition: true,
    v7_relativeSplatPath: true,
  },
})
