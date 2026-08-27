export interface PageRoute {
  name: string
  path: string
  file: string
  type: 'static' | 'dynamic'
  status: 'active' | 'error' | 'drained'
  description?: string
}

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error' | 'unhealthy'
