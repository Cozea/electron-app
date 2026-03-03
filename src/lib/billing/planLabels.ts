export type WorkspacePlanId =
  | 'free'
  | 'pro'
  | 'max'
  | 'startup'
  | 'team'
  | 'enterprise'
export type WorkspacePricingPlanId = 'free' | 'pro' | 'max' | 'startup' | 'enterprise'

export const WORKSPACE_PLAN_LABELS: Record<WorkspacePlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
  startup: 'Startup',
  // Legacy alias
  team: 'Startup',
  enterprise: 'Enterprise',
}

export function getWorkspacePlanLabel(plan?: string | null): string {
  if (!plan) return WORKSPACE_PLAN_LABELS.free
  if (plan in WORKSPACE_PLAN_LABELS) {
    return WORKSPACE_PLAN_LABELS[plan as WorkspacePlanId]
  }
  return WORKSPACE_PLAN_LABELS.free
}

export function normalizeWorkspacePlanForPricing(plan?: string | null): WorkspacePricingPlanId {
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
