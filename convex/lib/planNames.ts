export type WorkspacePlanId = 'free' | 'pro' | 'max' | 'startup' | 'team' | 'enterprise'

const PLAN_LABELS: Record<WorkspacePlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
  startup: 'Startup',
  // Legacy alias
  team: 'Startup',
  enterprise: 'Enterprise',
}

export function getWorkspacePlanLabel(plan?: string | null): string {
  if (!plan) return PLAN_LABELS.free
  if (plan in PLAN_LABELS) {
    return PLAN_LABELS[plan as WorkspacePlanId]
  }
  return PLAN_LABELS.free
}
