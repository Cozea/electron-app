export type PersonalPlanId = 'free' | 'pro' | 'max' | 'startup' | 'team' | 'enterprise'
export type OrganizationPlanId = 'free' | 'startup' | 'team' | 'pro' | 'max' | 'enterprise'
export type WorkspacePlanId = PersonalPlanId
export type PersonalPricingPlanId = 'free' | 'pro' | 'max' | 'startup' | 'enterprise'
export type OrganizationPricingPlanId = 'free' | 'startup' | 'enterprise'
export type WorkspacePricingPlanId = PersonalPricingPlanId

export const NO_ACTIVE_PLAN_LABEL = 'No active plan'

export const PERSONAL_PLAN_LABELS: Record<PersonalPlanId, string> = {
  free: NO_ACTIVE_PLAN_LABEL,
  pro: 'Pro',
  max: 'Max',
  startup: 'Startup',
  team: 'Startup',
  enterprise: 'Enterprise',
}

export const ORGANIZATION_PLAN_LABELS: Record<OrganizationPlanId, string> = {
  free: NO_ACTIVE_PLAN_LABEL,
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

export function normalizeWorkspacePlanForPricing(plan?: string | null): WorkspacePricingPlanId {
  return normalizePersonalPlanForPricing(plan)
}

export function normalizePersonalPlanForPricing(plan?: string | null): PersonalPricingPlanId {
  if (plan === 'team') return 'startup'
  if (
    plan === 'free' ||
    plan === 'pro' ||
    plan === 'max' ||
    plan === 'startup' ||
    plan === 'enterprise'
  ) {
    return plan
  }
  return 'free'
}

export function normalizeOrganizationPlanForPricing(
  plan?: string | null
): OrganizationPricingPlanId {
  if (plan === 'enterprise') return 'enterprise'
  if (plan === 'startup' || plan === 'team' || plan === 'pro' || plan === 'max') {
    return 'startup'
  }
  return 'free'
}
