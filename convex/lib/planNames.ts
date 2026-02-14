export type WorkspacePlanId = 'free' | 'pro' | 'max' | 'team' | 'enterprise'

const PLAN_LABELS: Record<WorkspacePlanId, 'Free' | 'Power Duo' | 'Winning Team' | 'Custom'> = {
  free: 'Free',
  pro: 'Power Duo',
  max: 'Winning Team',
  team: 'Custom',
  enterprise: 'Custom',
}

export function getWorkspacePlanLabel(plan?: string | null): string {
  if (!plan) return PLAN_LABELS.free
  if (plan in PLAN_LABELS) {
    return PLAN_LABELS[plan as WorkspacePlanId]
  }
  return PLAN_LABELS.free
}
