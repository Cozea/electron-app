export type PersonalPlanId = 'free' | 'pro' | 'max' | 'startup' | 'team' | 'enterprise'
export type OrganizationPlanId = 'free' | 'startup' | 'team' | 'pro' | 'max' | 'enterprise'
export type WorkspacePlanId = PersonalPlanId

const PERSONAL_PLAN_LABELS: Record<PersonalPlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
  startup: 'Startup',
  team: 'Startup',
  enterprise: 'Enterprise',
}

const ORGANIZATION_PLAN_LABELS: Record<OrganizationPlanId, string> = {
  free: 'Free',
  startup: 'Startup',
  team: 'Startup',
  pro: 'Startup',
  max: 'Startup',
  enterprise: 'Enterprise',
}

export function getPersonalPlanLabel(plan?: string | null): string {
  if (!plan) return PERSONAL_PLAN_LABELS.free
  if (plan in PERSONAL_PLAN_LABELS) {
    return PERSONAL_PLAN_LABELS[plan as PersonalPlanId]
  }
  return PERSONAL_PLAN_LABELS.free
}

export function getOrganizationPlanLabel(plan?: string | null): string {
  if (!plan) return ORGANIZATION_PLAN_LABELS.free
  if (plan in ORGANIZATION_PLAN_LABELS) {
    return ORGANIZATION_PLAN_LABELS[plan as OrganizationPlanId]
  }
  return ORGANIZATION_PLAN_LABELS.free
}

export function getWorkspacePlanLabel(plan?: string | null): string {
  return getPersonalPlanLabel(plan)
}
