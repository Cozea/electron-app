export interface ModelOption {
  id: string
  name: string
  chef: string
  chefSlug: string
  tier: string
  providers: string[]
  limit?: { context?: number; output?: number }
}
