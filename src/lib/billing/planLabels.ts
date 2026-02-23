export type WorkspacePlanId = 'free' | 'pro' | 'max' | 'team' | 'enterprise'
export type WorkspacePricingPlanId = 'free' | 'pro' | 'max' | 'team'

export const WORKSPACE_PLAN_LABELS: Record<WorkspacePlanId, 'Starter' | 'Founders Plan' | 'Team Scale' | 'Custom Enterprise'> = {
  free: 'Starter',
  pro: 'Founders Plan',
  max: 'Team Scale',
  team: 'Custom Enterprise',
  enterprise: 'Custom Enterprise',
}

export function getWorkspacePlanLabel(plan?: string | null): string {
  if (!plan) return WORKSPACE_PLAN_LABELS.free
  if (plan in WORKSPACE_PLAN_LABELS) {
    return WORKSPACE_PLAN_LABELS[plan as WorkspacePlanId]
  }
  return WORKSPACE_PLAN_LABELS.free
}

export function normalizeWorkspacePlanForPricing(plan?: string | null): WorkspacePricingPlanId {
  if (plan === 'enterprise') return 'team'
  if (plan === 'free' || plan === 'pro' || plan === 'max' || plan === 'team') {
    return plan
  }
  return 'free'
}
