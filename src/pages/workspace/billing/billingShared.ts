import { NO_ACTIVE_PLAN_LABEL } from "@/lib/billing/planLabels";

export const AUTH_SERVER_URL =
  import.meta.env.VITE_AUTH_SERVER_URL ||
  "https://api.cozea.app";
export const ENTERPRISE_SALES_MAILTO = "mailto:sales@cozea.com?subject=Enterprise%20Plan";
export const STARTUP_MIN_SEATS = 2;
export const STARTUP_MAX_SEATS = 10;
export const SEAT_ASSIGNMENTS_PAGE_SIZE = 5;
export const INACTIVE_PLAN_STATUS_LABEL = "Inactive";
export const INVOICE_CACHE_MAX_AGE_MS = 15 * 60 * 1000;

export type BillingCycle = "monthly" | "yearly";
export type CheckoutPlan = "pro" | "max" | "startup";
export type SelfServePlan = CheckoutPlan;
export type PlanTierId = "free" | CheckoutPlan | "enterprise";

export interface PlanFeature {
  text: string;
  included: boolean;
}

export interface PlanCard {
  id: CheckoutPlan;
  name: string;
  description: string;
  price: string;
  period: string;
  priceSecondary?: string;
  trial?: string;
  yearlySavingsLabel?: string;
  featuresHeading?: string;
  features: PlanFeature[];
  conclusion: string;
  footerText: string;
}

export interface StripeCatalogPrice {
  priceId?: string;
  amountCents: number;
  currency?: string;
  trialDays: number | null;
}

export interface StripeCatalogResponse {
  source?: "convex" | "env" | "mixed";
  plans?: Partial<Record<SelfServePlan, {
    monthly?: StripeCatalogPrice;
    yearly?: StripeCatalogPrice;
  }>>;
}

export interface SegmentedControlOption<Value extends string> {
  value: Value;
  label: string;
  ariaLabel?: string;
  title?: string;
}

export interface EnterprisePlanCard {
  name: string;
  description: string;
  priceLabel: string;
  featuresHeading: string;
  features: string[];
  footerText: string;
}

export interface StripeInvoice {
  id: string;
  number: string | null;
  date: number;
  amountDue: number;
  amountPaid: number;
  status: string | null;
  description: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface ScheduledCycleChange {
  plan: CheckoutPlan;
  cycle: BillingCycle;
  effectiveAt: number;
}

const FALLBACK_CATALOG_AMOUNTS_CENTS: Record<SelfServePlan, Record<BillingCycle, number>> = {
  pro: { monthly: 2000, yearly: 21100 },
  max: { monthly: 4900, yearly: 51700 },
  startup: { monthly: 10000, yearly: 105600 },
};

const FALLBACK_TRIAL_DAYS: Partial<Record<SelfServePlan, number>> = {
  max: 7,
};

export const BILLING_CYCLE_OPTIONS: SegmentedControlOption<BillingCycle>[] = [
  {
    value: "monthly",
    label: "M",
    ariaLabel: "Monthly billing",
    title: "Monthly billing",
  },
  {
    value: "yearly",
    label: "Y",
    ariaLabel: "Yearly billing",
    title: "Yearly billing",
  },
];

export const INDIVIDUAL_PLAN_CARDS: PlanCard[] = [
  {
    id: "pro",
    name: "Pro",
    description: "Single-user plan with hosted AI usage.",
    price: "$20",
    period: "/ month",
    featuresHeading: "Includes:",
    features: [
      { text: "Unlimited real-time collaboration", included: true },
      { text: "Hosted AI credits included", included: true },
      { text: "All coding agents", included: true },
      { text: "20+ integrations", included: true },
      { text: "Bring Your Own API Keys (optional)", included: true },
      { text: "Usage & storage tracking", included: true },
      { text: "Priority support", included: true },
    ],
    conclusion: "",
    footerText: "",
  },
  {
    id: "max",
    name: "Max",
    description: "Single-user plan with higher hosted AI usage.",
    price: "$49",
    period: "/ month",
    trial: "7 day free trial",
    featuresHeading: "Everything in Pro, plus:",
    features: [
      { text: "5× higher AI credits", included: true },
      { text: "Faster priority support", included: true },
    ],
    conclusion: "",
    footerText:
      "Trial starts with 5% of Max hosted usage. Activate paid Max anytime to unlock the rest.",
  },
];

export const STARTUP_PLAN_CARD: PlanCard = {
  id: "startup",
  name: "Startup",
  description: "Workspace plan with seat-based billing.",
  price: "$200",
  period: "/ 2 seats / month",
  priceSecondary: "$100 / seat / month",
  featuresHeading: "Includes:",
  features: [
    { text: "Unlimited real-time collaboration", included: true },
    { text: "10× higher AI credits per seat", included: true },
    { text: "All coding agents", included: true },
    { text: "Workspace AI Memory (Coming in Version 0.2.0)", included: true },
    { text: "Auto documentation (Coming in Version 0.2.0)", included: true },
    { text: "Centralized workspace billing", included: true },
    { text: "Admin visibility & usage oversight", included: true },
    { text: "20+ integrations", included: true },
    { text: "Bring Your Own API Keys (optional)", included: true },
    { text: "Priority support", included: true },
  ],
  conclusion: "",
  footerText: "",
};

export const ENTERPRISE_PLAN_CARD: EnterprisePlanCard = {
  name: "Custom Enterprise",
  description: "Custom workspace plan for larger deployments.",
  priceLabel: "Custom pricing",
  featuresHeading: "Everything in Startup, plus:",
  features: [
    "Advanced security & compliance controls",
    "Dedicated onboarding",
    "Custom model connections",
    "Custom integrations",
    "SAML / OIDC",
    "SCIM provisioning",
    "Organization-wide access controls",
    "RAG pipelines",
    "Fine-tuning support",
  ],
  footerText: "",
};

export function formatDate(timestamp?: number): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatBillingCycleLabel(cycle: BillingCycle): string {
  return cycle === "yearly" ? "Yearly" : "Monthly";
}

export function formatDisplayCurrencyFromCents(cents: number, currency = "USD"): string {
  const normalized = Number.isFinite(cents) ? cents : 0;
  const normalizedCurrency = currency?.trim() ? currency.toUpperCase() : "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalized / 100);
}

export function resolveCatalogPrice(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan,
  cycle: BillingCycle,
): StripeCatalogPrice | undefined {
  if (cycle === "yearly") {
    return catalog?.plans?.[plan]?.yearly;
  }
  return catalog?.plans?.[plan]?.monthly;
}

export function resolvePlanAmountCents(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan,
  cycle: BillingCycle,
): number {
  const catalogPrice = resolveCatalogPrice(catalog, plan, cycle);
  if (typeof catalogPrice?.amountCents === "number" && Number.isFinite(catalogPrice.amountCents)) {
    return catalogPrice.amountCents;
  }
  return FALLBACK_CATALOG_AMOUNTS_CENTS[plan][cycle];
}

export function resolvePlanCurrency(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan,
  cycle: BillingCycle,
): string {
  const catalogPrice = resolveCatalogPrice(catalog, plan, cycle);
  return catalogPrice?.currency?.toUpperCase() || "USD";
}

export function resolvePlanTrialDays(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan,
  cycle: BillingCycle,
): number | null {
  if (plan !== "max") {
    return null;
  }

  const catalogPrice = resolveCatalogPrice(catalog, plan, cycle);
  if (catalogPrice) {
    if (
      typeof catalogPrice.trialDays === "number" &&
      Number.isFinite(catalogPrice.trialDays) &&
      catalogPrice.trialDays > 0
    ) {
      return Math.floor(catalogPrice.trialDays);
    }
    return null;
  }
  const fallbackTrialDays = FALLBACK_TRIAL_DAYS[plan];
  if (
    typeof fallbackTrialDays === "number" &&
    Number.isFinite(fallbackTrialDays) &&
    fallbackTrialDays > 0
  ) {
    return Math.floor(fallbackTrialDays);
  }
  return null;
}

export function resolvePlanPeriodLabel(plan: SelfServePlan, cycle: BillingCycle): string {
  if (plan === "startup") {
    return cycle === "yearly" ? "/ seat / year" : "/ seat / month";
  }
  return cycle === "yearly" ? "/ year" : "/ month";
}

export function resolveYearlySavingsLabel(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan,
): string | undefined {
  const monthlyAmountCents = resolvePlanAmountCents(catalog, plan, "monthly");
  const yearlyAmountCents = resolvePlanAmountCents(catalog, plan, "yearly");
  const savingsCents = Math.max(0, monthlyAmountCents * 12 - yearlyAmountCents);
  if (savingsCents <= 0) return undefined;

  const currency = resolvePlanCurrency(catalog, plan, "yearly");
  return `Save ${formatDisplayCurrencyFromCents(savingsCents, currency)}`;
}

export function resolvePlanPricing(args: {
  catalog: StripeCatalogResponse | null;
  plan: SelfServePlan;
  cycle: BillingCycle;
}): Pick<PlanCard, "price" | "period" | "trial" | "yearlySavingsLabel"> {
  const amountCents = resolvePlanAmountCents(args.catalog, args.plan, args.cycle);
  const currency = resolvePlanCurrency(args.catalog, args.plan, args.cycle);
  const trialDays = resolvePlanTrialDays(args.catalog, args.plan, args.cycle);

  return {
    price: formatDisplayCurrencyFromCents(amountCents, currency),
    period: resolvePlanPeriodLabel(args.plan, args.cycle),
    trial: trialDays ? `${trialDays} day free trial` : undefined,
    yearlySavingsLabel:
      args.cycle === "yearly"
        ? resolveYearlySavingsLabel(args.catalog, args.plan)
        : undefined,
  };
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === "AbortError";
  if (typeof error === "object" && error !== null && "name" in error) {
    return (error as { name?: string }).name === "AbortError";
  }
  return false;
}

export function formatEntitlementStatus(status?: string): string {
  if (!status) return "Unknown";
  if (status === "trialing") return "Trial";
  if (status === "past_due") return "Past Due";
  if (status === "canceled") return "Canceled";
  if (status === "active") return "Active";
  return status;
}

export function isSeatManagedEntitlement(args: {
  source?: "account" | "legacy" | "trial" | "free";
  plan?: string;
  workspaceScoped?: boolean;
}): boolean {
  if (args.workspaceScoped) {
    return args.source === "trial" || args.plan === "startup" || args.plan === "enterprise";
  }
  return (
    args.source === "trial" ||
    args.plan === "startup" ||
    args.plan === "enterprise" ||
    args.source === "legacy"
  );
}

export function planLabel(args: {
  source?: "account" | "legacy" | "trial" | "free";
  plan?: "free" | "pro" | "max" | "startup" | "enterprise";
  workspaceScoped?: boolean;
}): string {
  if (args.source === "legacy") return "Legacy Workspace";
  if (args.workspaceScoped) {
    if (args.plan === "enterprise") return "Enterprise";
    if (args.plan === "startup" || args.plan === "pro" || args.plan === "max" || args.source === "trial") {
      return "Startup";
    }
    return NO_ACTIVE_PLAN_LABEL;
  }
  if (args.plan === "pro") return "Pro";
  if (args.plan === "max") return "Max";
  if (args.plan === "enterprise") return "Enterprise";
  if (args.plan === "startup" || args.source === "trial") return "Startup";
  return NO_ACTIVE_PLAN_LABEL;
}

export function normalizeSeatQuantity(value: number): number {
  if (!Number.isFinite(value)) return STARTUP_MIN_SEATS;
  return Math.min(STARTUP_MAX_SEATS, Math.max(STARTUP_MIN_SEATS, Math.floor(value)));
}

export function getPageNumbers(currentPage: number, totalPages: number): Array<number | "..."> {
  const pages: Array<number | "..."> = [];

  if (totalPages <= 7) {
    for (let page = 1; page <= totalPages; page += 1) {
      pages.push(page);
    }
    return pages;
  }

  if (currentPage <= 3) {
    return [1, 2, 3, "...", totalPages];
  }

  if (currentPage >= totalPages - 2) {
    return [1, "...", totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
}

export function normalizeCurrentPlanForCards(
  source: "account" | "legacy" | "trial" | "free" | undefined,
  plan: string | undefined,
  workspaceScoped: boolean,
): PlanTierId {
  if (workspaceScoped) {
    if (source === "trial") return "startup";
    if (plan === "startup" || plan === "team" || plan === "pro" || plan === "max") {
      return "startup";
    }
    if (plan === "enterprise") return "enterprise";
    return "free";
  }
  if (source === "trial") return "startup";
  if (plan === "team") return "startup";
  if (plan === "pro" || plan === "max" || plan === "startup" || plan === "enterprise") {
    return plan;
  }
  return "free";
}

function normalizePlanFeatureText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getPlanFeatureComparisonKey(feature: string): string {
  const normalized = normalizePlanFeatureText(feature);
  if (normalized.includes("ai credits")) return "ai-credits";
  if (normalized.includes("integrations")) return "integrations";
  if (normalized.includes("bring your own") && normalized.includes("api key")) return "byo-api-keys";
  return normalized;
}

function mergePlanFeatureLists(...featureLists: string[][]): string[] {
  const merged: string[] = [];
  const indexByKey = new Map<string, number>();

  for (const features of featureLists) {
    for (const feature of features) {
      const key = getPlanFeatureComparisonKey(feature);
      const existingIndex = indexByKey.get(key);
      if (existingIndex === undefined) {
        indexByKey.set(key, merged.length);
        merged.push(feature);
      } else {
        merged[existingIndex] = feature;
      }
    }
  }

  return merged;
}

function getDirectPlanIncludedFeatures(planId: PlanTierId): string[] {
  if (planId === "enterprise") {
    return ENTERPRISE_PLAN_CARD.features;
  }

  if (planId === "startup") {
    return STARTUP_PLAN_CARD.features
      .filter((feature) => feature.included)
      .map((feature) => feature.text);
  }

  const planCard = INDIVIDUAL_PLAN_CARDS.find((card) => card.id === planId);
  if (!planCard) return [];
  return planCard.features.filter((feature) => feature.included).map((feature) => feature.text);
}

export function getPlanIncludedFeatures(planId: PlanTierId): string[] {
  if (planId === "max") {
    return mergePlanFeatureLists(
      getDirectPlanIncludedFeatures("pro"),
      getDirectPlanIncludedFeatures("max"),
    );
  }

  if (planId === "enterprise") {
    return mergePlanFeatureLists(
      getDirectPlanIncludedFeatures("startup"),
      getDirectPlanIncludedFeatures("enterprise"),
    );
  }

  return getDirectPlanIncludedFeatures(planId);
}

export function getPlanDisplayName(planId: PlanTierId): string {
  if (planId === "enterprise") return ENTERPRISE_PLAN_CARD.name;
  if (planId === "startup") return STARTUP_PLAN_CARD.name;
  if (planId === "free") return NO_ACTIVE_PLAN_LABEL;
  return INDIVIDUAL_PLAN_CARDS.find((card) => card.id === planId)?.name ?? "Plan";
}

export const PLAN_TIER_RANK: Record<PlanTierId, number> = {
  free: 0,
  pro: 1,
  max: 2,
  startup: 3,
  enterprise: 4,
};

export function getPlanCtaLabel(
  targetPlanId: PlanTierId,
  currentPlanId: PlanTierId,
  targetPlanName: string,
  currentStatus?: string,
): string {
  if (targetPlanId === currentPlanId) {
    if (targetPlanId === "enterprise") {
      return currentStatus === "canceled" ? "Contact Sales" : "Current Plan";
    }
    if (currentStatus === "canceled" && targetPlanId !== "free") {
      return `Reactivate ${targetPlanName}`;
    }
    return targetPlanId === "free" ? NO_ACTIVE_PLAN_LABEL : "Current Plan";
  }

  if (targetPlanId === "enterprise") {
    return "Contact Sales";
  }

  const targetRank = PLAN_TIER_RANK[targetPlanId];
  const currentRank = PLAN_TIER_RANK[currentPlanId];

  if (targetRank > currentRank) {
    if (currentPlanId === "free") {
      return `Start ${targetPlanName}`;
    }
    return `Upgrade to ${targetPlanName}`;
  }

  return "Downgrade";
}

export function getPlanBadge(
  planId: CheckoutPlan,
  currentPlanId: "free" | CheckoutPlan | "enterprise",
): string | null {
  if (currentPlanId === "free" && planId === "pro") return "Most Popular";
  if (currentPlanId === "pro" && planId === "max") return "Recommended";
  return null;
}
