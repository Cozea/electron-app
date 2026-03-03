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

function resolvePlanYearlyOverrideCents(
  plan: AccountSubscriptionPlan
): number | undefined {
  switch (plan) {
    case "pro":
      return readEnvInt("AI_WALLET_INCLUDED_PRO_YEARLY_CENTS")
    case "max":
      return readEnvInt("AI_WALLET_INCLUDED_MAX_YEARLY_CENTS")
    case "startup":
      return (
        readEnvInt("AI_WALLET_INCLUDED_STARTUP_YEARLY_CENTS") ??
        readEnvInt("AI_WALLET_INCLUDED_STARTUP_SEAT_YEARLY_CENTS")
      )
    case "enterprise":
      return (
        readEnvInt("AI_WALLET_INCLUDED_ENTERPRISE_YEARLY_CENTS") ??
        readEnvInt("AI_WALLET_INCLUDED_ENTERPRISE_SEAT_YEARLY_CENTS")
      )
    case "free":
    default:
      return undefined
  }
}

export function resolveIncludedWalletCents(args: {
  plan: AccountSubscriptionPlan
  cycle?: AccountBillingCycle
}): number {
  const monthlyCents = resolvePlanMonthlyCents(args.plan)
  if (args.cycle === "yearly") {
    const yearlyOverrideCents = resolvePlanYearlyOverrideCents(args.plan)
    if (typeof yearlyOverrideCents === "number") {
      return Math.max(0, yearlyOverrideCents)
    }
    return Math.max(0, monthlyCents * 12)
  }
  return Math.max(0, monthlyCents)
}

export function isSeatManagedWalletPlan(plan: AccountSubscriptionPlan): boolean {
  return plan === "startup" || plan === "enterprise"
}
