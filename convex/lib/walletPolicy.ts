import type { AccountBillingCycle, AccountSubscriptionPlan } from "./accountEntitlements"

interface PlanDefaults {
  // Included wallet value in USD cents per month.
  monthlyCents: number
}

const PLAN_DEFAULTS: Record<AccountSubscriptionPlan, PlanDefaults> = {
  free: { monthlyCents: 0 },
  pro: { monthlyCents: 1500 },
  max: { monthlyCents: 4000 },
  startup: { monthlyCents: 3000 },
  enterprise: { monthlyCents: 10000 },
}

function readEnvInt(key: string): number | undefined {
  const raw = process.env[key]
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}

function monthsForCycle(cycle: AccountBillingCycle | undefined): number {
  return cycle === "yearly" ? 12 : 1
}

function resolvePlanMonthlyCents(plan: AccountSubscriptionPlan): number {
  switch (plan) {
    case "pro":
      return readEnvInt("AI_WALLET_INCLUDED_PRO_MONTHLY_CENTS") ?? PLAN_DEFAULTS.pro.monthlyCents
    case "max":
      return readEnvInt("AI_WALLET_INCLUDED_MAX_MONTHLY_CENTS") ?? PLAN_DEFAULTS.max.monthlyCents
    case "startup":
      return (
        readEnvInt("AI_WALLET_INCLUDED_STARTUP_CENTS") ??
        readEnvInt("AI_WALLET_INCLUDED_STARTUP_SEAT_MONTHLY_CENTS") ??
        PLAN_DEFAULTS.startup.monthlyCents
      )
    case "enterprise":
      return (
        readEnvInt("AI_WALLET_INCLUDED_ENTERPRISE_CENTS") ??
        readEnvInt("AI_WALLET_INCLUDED_ENTERPRISE_SEAT_MONTHLY_CENTS") ??
        PLAN_DEFAULTS.enterprise.monthlyCents
      )
    case "free":
    default:
      return PLAN_DEFAULTS.free.monthlyCents
  }
}

export function resolveIncludedWalletCents(args: {
  plan: AccountSubscriptionPlan
  cycle?: AccountBillingCycle
}): number {
  const monthlyCents = resolvePlanMonthlyCents(args.plan)
  return Math.max(0, monthlyCents * monthsForCycle(args.cycle))
}

export function isSeatManagedWalletPlan(plan: AccountSubscriptionPlan): boolean {
  return plan === "startup" || plan === "enterprise"
}
