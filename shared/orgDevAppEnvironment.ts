export interface OrgDevAppEnvironmentRequirementStatus {
  name: string
  required: boolean
  secret: boolean
  description?: string
  configured: boolean
}

export interface OrgDevAppEnvironmentStatus {
  requirements: OrgDevAppEnvironmentRequirementStatus[]
  missingRequired: string[]
}
