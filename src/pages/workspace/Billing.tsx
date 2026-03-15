import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import type { Id } from '../../../convex/_generated/dataModel'

import { api } from '../../../convex/_generated/api'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Progress } from '../../components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import {
  ExternalLink,
  Check,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react'
import { fetchWithAbort } from '@/lib/abort'
import { featureFlags } from '@/lib/featureFlags'
import { cn } from '@/lib/utils'
import { useScopedBillingData } from '@/hooks/useScopedBillingData'
import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'

const AUTH_SERVER_URL =
  import.meta.env.VITE_AUTH_SERVER_URL ||
  'https://api.cozea.app'
const ENTERPRISE_SALES_MAILTO = 'mailto:sales@cozea.com?subject=Enterprise%20Plan'
const STARTUP_MIN_SEATS = 2
const STARTUP_MAX_SEATS = 10
const MAX_TRIAL_INCLUDED_PERCENT = 5

type BillingCycle = 'monthly' | 'yearly'
type CheckoutPlan = 'pro' | 'max' | 'startup'
type SelfServePlan = CheckoutPlan
type PlanTierId = 'free' | CheckoutPlan | 'enterprise'

interface BillingProps {
  surface?: 'page' | 'drawer'
  route?: string
}

interface PlanFeature {
  text: string
  included: boolean
}

interface PlanCard {
  id: CheckoutPlan | 'free'
  name: string
  description: string
  price: string
  period: string
  priceSecondary?: string
  trial?: string
  yearlySavingsLabel?: string
  featuresHeading?: string
  features: PlanFeature[]
  conclusion: string
  footerText: string
}

interface StripeCatalogPrice {
  priceId?: string
  amountCents: number
  currency?: string
  trialDays: number | null
}

interface StripeCatalogResponse {
  source?: 'convex' | 'env' | 'mixed'
  plans?: Partial<Record<SelfServePlan, {
    monthly?: StripeCatalogPrice
    yearly?: StripeCatalogPrice
  }>>
}

interface SegmentedControlOption<Value extends string> {
  value: Value
  label: string
  ariaLabel?: string
  title?: string
}

interface SlidingSegmentedControlProps<Value extends string> {
  value: Value
  options: SegmentedControlOption<Value>[]
  onChange: (value: Value) => void
  ariaLabel: string
  className?: string
  indicatorClassName?: string
  buttonClassName?: string
}

const FALLBACK_CATALOG_AMOUNTS_CENTS: Record<SelfServePlan, Record<BillingCycle, number>> = {
  pro: { monthly: 2000, yearly: 21100 },
  max: { monthly: 4900, yearly: 51700 },
  startup: { monthly: 10000, yearly: 105600 },
}

const FALLBACK_TRIAL_DAYS: Partial<Record<SelfServePlan, number>> = {
  max: 7,
}

const BILLING_CYCLE_OPTIONS: SegmentedControlOption<BillingCycle>[] = [
  {
    value: 'monthly',
    label: 'M',
    ariaLabel: 'Monthly billing',
    title: 'Monthly billing',
  },
  {
    value: 'yearly',
    label: 'Y',
    ariaLabel: 'Yearly billing',
    title: 'Yearly billing',
  },
]

const INDIVIDUAL_PLAN_CARDS: PlanCard[] = [
  {
    id: 'free',
    name: 'Starter',
    description: 'For developers who want to explore Cozea locally.',
    price: 'Free',
    period: '',
    trial: 'No credit card required',
    featuresHeading: 'Includes:',
    features: [
      { text: 'Full access to the Cozea IDE', included: true },
      { text: 'Run coding agents locally', included: true },
      { text: 'Bring your own AI API keys', included: true },
      { text: 'Access to 20+ integrations', included: true },
      { text: 'Local project workspace', included: true },
      { text: 'Build and test projects on your machine', included: true },
    ],
    conclusion: '',
    footerText: '',
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For serious builders who want AI as a competitive edge.',
    price: '$20',
    period: '/ month',
    featuresHeading: 'Includes:',
    features: [
      { text: 'Unlimited real-time collaboration', included: true },
      { text: 'Hosted AI credits included', included: true },
      { text: 'All coding agents', included: true },
      { text: '20+ integrations', included: true },
      { text: 'Bring Your Own API Keys (optional)', included: true },
      { text: 'Usage & storage tracking', included: true },
      { text: 'Priority support', included: true },
    ],
    conclusion: '',
    footerText: '',
  },
  {
    id: 'max',
    name: 'Max',
    description: 'For power users pushing AI to the limit.',
    price: '$49',
    period: '/ month',
    trial: '7 day free trial',
    featuresHeading: 'Everything in Pro, plus:',
    features: [
      { text: '5× higher AI credits', included: true },
      { text: 'Faster priority support', included: true },
    ],
    conclusion: '',
    footerText: 'Trial starts with 5% of Max hosted usage. Activate paid Max anytime to unlock the rest.',
  },
]

const STARTUP_PLAN_CARD: PlanCard = {
  id: 'startup',
  name: 'Startup',
  description: 'For fast-moving teams shipping real products.',
  price: '$200',
  period: '/ 2 seats / month',
  priceSecondary: '$100 / seat / month',
  featuresHeading: 'Includes:',
  features: [
    { text: 'Unlimited real-time collaboration', included: true },
    { text: '10× higher AI credits per seat', included: true },
    { text: 'All coding agents', included: true },
    { text: 'Workspace AI Memory (Coming in Version 0.2.0)', included: true },
    { text: 'Auto documentation (Coming in Version 0.2.0)', included: true },
    { text: 'Centralized workspace billing', included: true },
    { text: 'Admin visibility & usage oversight', included: true },
    { text: '20+ integrations', included: true },
    { text: 'Bring Your Own API Keys (optional)', included: true },
    { text: 'Priority support', included: true },
  ],
  conclusion: '',
  footerText: '',
}

interface EnterprisePlanCard {
  name: string
  description: string
  priceLabel: string
  featuresHeading: string
  features: string[]
  footerText: string
}

const ENTERPRISE_PLAN_CARD: EnterprisePlanCard = {
  name: 'Custom Enterprise',
  description: 'For organizations with advanced security and AI integration needs.',
  priceLabel: 'Custom pricing',
  featuresHeading: 'Everything in Startup, plus:',
  features: [
    'Advanced security & compliance controls',
    'Dedicated onboarding',
    'Custom model connections',
    'Custom integrations',
    'SAML / OIDC',
    'SCIM provisioning',
    'Organization-wide access controls',
    'RAG pipelines',
    'Fine-tuning support',
  ],
  footerText: '',
}

interface StripeInvoice {
  id: string
  number: string | null
  date: number
  amountDue: number
  amountPaid: number
  status: string | null
  description: string
  hostedInvoiceUrl: string | null
  invoicePdf: string | null
}

interface ScheduledCycleChange {
  plan: CheckoutPlan
  cycle: BillingCycle
  effectiveAt: number
}

interface SeatWalletView {
  userId: Id<'users'>
  email: string
  firstName?: string
  lastName?: string
  profileImageUrl?: string
  isBillingOwner: boolean
  walletId: string | null
  balanceCents: number
  heldCents: number
  availableCents: number
  updatedAt: number | null
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatBillingCycleLabel(cycle: BillingCycle): string {
  return cycle === 'yearly' ? 'Yearly' : 'Monthly'
}

function formatCurrencyFromCents(cents: number, currency: string = 'USD'): string {
  const normalized = Number.isFinite(cents) ? cents : 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(normalized / 100)
}

function formatDisplayCurrencyFromCents(cents: number, currency: string = 'USD'): string {
  const normalized = Number.isFinite(cents) ? cents : 0
  const normalizedCurrency = currency?.trim() ? currency.toUpperCase() : 'USD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: normalizedCurrency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalized / 100)
}

function resolveCatalogPrice(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan,
  cycle: BillingCycle
): StripeCatalogPrice | undefined {
  if (cycle === 'yearly') {
    return catalog?.plans?.[plan]?.yearly
  }
  return catalog?.plans?.[plan]?.monthly
}

function resolvePlanAmountCents(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan,
  cycle: BillingCycle
): number {
  const catalogPrice = resolveCatalogPrice(catalog, plan, cycle)
  if (typeof catalogPrice?.amountCents === 'number' && Number.isFinite(catalogPrice.amountCents)) {
    return catalogPrice.amountCents
  }
  return FALLBACK_CATALOG_AMOUNTS_CENTS[plan][cycle]
}

function resolvePlanCurrency(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan,
  cycle: BillingCycle
): string {
  const catalogPrice = resolveCatalogPrice(catalog, plan, cycle)
  return catalogPrice?.currency?.toUpperCase() || 'USD'
}

function resolvePlanTrialDays(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan,
  cycle: BillingCycle
): number | null {
  if (plan !== 'max') {
    return null
  }

  const catalogPrice = resolveCatalogPrice(catalog, plan, cycle)
  if (catalogPrice) {
    if (
      typeof catalogPrice.trialDays === 'number' &&
      Number.isFinite(catalogPrice.trialDays) &&
      catalogPrice.trialDays > 0
    ) {
      return Math.floor(catalogPrice.trialDays)
    }
    return null
  }
  const fallbackTrialDays = FALLBACK_TRIAL_DAYS[plan]
  if (
    typeof fallbackTrialDays === 'number' &&
    Number.isFinite(fallbackTrialDays) &&
    fallbackTrialDays > 0
  ) {
    return Math.floor(fallbackTrialDays)
  }
  return null
}

function resolvePlanPeriodLabel(plan: SelfServePlan, cycle: BillingCycle): string {
  if (plan === 'startup') {
    return cycle === 'yearly' ? '/ seat / year' : '/ seat / month'
  }
  return cycle === 'yearly' ? '/ year' : '/ month'
}

function resolveYearlySavingsLabel(
  catalog: StripeCatalogResponse | null,
  plan: SelfServePlan
): string | undefined {
  const monthlyAmountCents = resolvePlanAmountCents(catalog, plan, 'monthly')
  const yearlyAmountCents = resolvePlanAmountCents(catalog, plan, 'yearly')
  const savingsCents = Math.max(0, monthlyAmountCents * 12 - yearlyAmountCents)
  if (savingsCents <= 0) return undefined

  const currency = resolvePlanCurrency(catalog, plan, 'yearly')
  return `Save ${formatDisplayCurrencyFromCents(savingsCents, currency)}`
}

function resolvePlanPricing(args: {
  catalog: StripeCatalogResponse | null
  plan: SelfServePlan
  cycle: BillingCycle
}): Pick<PlanCard, 'price' | 'period' | 'trial' | 'yearlySavingsLabel'> {
  const amountCents = resolvePlanAmountCents(args.catalog, args.plan, args.cycle)
  const currency = resolvePlanCurrency(args.catalog, args.plan, args.cycle)
  const trialDays = resolvePlanTrialDays(args.catalog, args.plan, args.cycle)

  return {
    price: formatDisplayCurrencyFromCents(amountCents, currency),
    period: resolvePlanPeriodLabel(args.plan, args.cycle),
    trial: trialDays ? `${trialDays} day free trial` : undefined,
    yearlySavingsLabel:
      args.cycle === 'yearly'
        ? resolveYearlySavingsLabel(args.catalog, args.plan)
        : undefined,
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return (error as { name?: string }).name === 'AbortError'
  }
  return false
}

function formatEntitlementStatus(status?: string): string {
  if (!status) return 'Unknown'
  if (status === 'trialing') return 'Trial'
  if (status === 'past_due') return 'Past Due'
  if (status === 'canceled') return 'Canceled'
  if (status === 'active') return 'Active'
  return status
}

function isSeatManagedEntitlement(args: {
  source?: 'account' | 'legacy' | 'trial' | 'free'
  plan?: string
  workspaceScoped?: boolean
}): boolean {
  if (args.workspaceScoped) {
    return args.source === 'trial' || args.plan === 'startup' || args.plan === 'enterprise'
  }
  return (
    args.source === 'trial' ||
    args.plan === 'startup' ||
    args.plan === 'enterprise' ||
    args.source === 'legacy'
  )
}

function planLabel(args: {
  source?: 'account' | 'legacy' | 'trial' | 'free'
  plan?: 'free' | 'pro' | 'max' | 'startup' | 'enterprise'
  workspaceScoped?: boolean
}): string {
  if (args.source === 'legacy') return 'Legacy Workspace'
  if (args.workspaceScoped) {
    if (args.plan === 'enterprise') return 'Enterprise'
    if (args.plan === 'startup' || args.plan === 'pro' || args.plan === 'max' || args.source === 'trial') {
      return 'Startup'
    }
    return 'Free'
  }
  if (args.plan === 'pro') return 'Pro'
  if (args.plan === 'max') return 'Max'
  if (args.plan === 'enterprise') return 'Enterprise'
  if (args.plan === 'startup' || args.source === 'trial') return 'Startup'
  return 'Free'
}

function normalizeSeatQuantity(value: number): number {
  if (!Number.isFinite(value)) return STARTUP_MIN_SEATS
  return Math.min(STARTUP_MAX_SEATS, Math.max(STARTUP_MIN_SEATS, Math.floor(value)))
}

function normalizeCurrentPlanForCards(
  source: 'account' | 'legacy' | 'trial' | 'free' | undefined,
  plan: string | undefined,
  workspaceScoped: boolean
): PlanTierId {
  if (workspaceScoped) {
    if (source === 'trial') return 'startup'
    if (
      plan === 'startup' ||
      plan === 'team' ||
      plan === 'pro' ||
      plan === 'max'
    ) {
      return 'startup'
    }
    if (plan === 'enterprise') return 'enterprise'
    return 'free'
  }
  if (source === 'trial') return 'startup'
  if (plan === 'team') return 'startup'
  if (plan === 'pro' || plan === 'max' || plan === 'startup' || plan === 'enterprise') {
    return plan
  }
  return 'free'
}

function normalizePlanFeatureText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function getPlanFeatureComparisonKey(feature: string): string {
  const normalized = normalizePlanFeatureText(feature)
  if (normalized.includes('ai credits')) return 'ai-credits'
  if (normalized.includes('integrations')) return 'integrations'
  if (normalized.includes('bring your own') && normalized.includes('api key')) return 'byo-api-keys'
  return normalized
}

function getAiCreditFeatureLevel(feature: string): number {
  const normalized = normalizePlanFeatureText(feature)
  if (!normalized.includes('ai credits')) return 0

  const multiplierMatch = normalized.match(/(\d+(?:\.\d+)?)\s*[x×]/i)
  if (multiplierMatch) {
    const parsed = Number(multiplierMatch[1])
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  // Any AI credits statement without an explicit multiplier is treated as baseline credits.
  return 1
}

function mergePlanFeatureLists(...featureLists: string[][]): string[] {
  const merged: string[] = []
  const indexByKey = new Map<string, number>()

  for (const features of featureLists) {
    for (const feature of features) {
      const key = getPlanFeatureComparisonKey(feature)
      const existingIndex = indexByKey.get(key)
      if (existingIndex === undefined) {
        indexByKey.set(key, merged.length)
        merged.push(feature)
      } else {
        // Keep the highest-tier phrasing for duplicate benefit categories (for example AI credits).
        merged[existingIndex] = feature
      }
    }
  }

  return merged
}

function getDirectPlanIncludedFeatures(planId: PlanTierId): string[] {
  if (planId === 'enterprise') {
    return ENTERPRISE_PLAN_CARD.features
  }

  if (planId === 'startup') {
    return STARTUP_PLAN_CARD.features
      .filter((feature) => feature.included)
      .map((feature) => feature.text)
  }

  const planCard = INDIVIDUAL_PLAN_CARDS.find((card) => card.id === planId)
  if (!planCard) return []
  return planCard.features.filter((feature) => feature.included).map((feature) => feature.text)
}

function getPlanIncludedFeatures(planId: PlanTierId): string[] {
  if (planId === 'max') {
    return mergePlanFeatureLists(
      getDirectPlanIncludedFeatures('pro'),
      getDirectPlanIncludedFeatures('max')
    )
  }

  if (planId === 'enterprise') {
    return mergePlanFeatureLists(
      getDirectPlanIncludedFeatures('startup'),
      getDirectPlanIncludedFeatures('enterprise')
    )
  }

  return getDirectPlanIncludedFeatures(planId)
}

function getPlanDisplayName(planId: PlanTierId): string {
  if (planId === 'enterprise') return ENTERPRISE_PLAN_CARD.name
  if (planId === 'startup') return STARTUP_PLAN_CARD.name
  return INDIVIDUAL_PLAN_CARDS.find((card) => card.id === planId)?.name ?? 'Plan'
}

const PLAN_TIER_RANK: Record<PlanTierId, number> = {
  free: 0,
  pro: 1,
  max: 2,
  startup: 3,
  enterprise: 4,
}

function SlidingSegmentedControl<Value extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  indicatorClassName,
  buttonClassName,
}: SlidingSegmentedControlProps<Value>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const updateIndicator = useCallback(() => {
    const selectedIndex = options.findIndex((option) => option.value === value)
    const selectedNode = selectedIndex >= 0 ? itemRefs.current[selectedIndex] : null
    const indicatorNode = indicatorRef.current

    if (!selectedNode || !indicatorNode) {
      if (indicatorNode) {
        indicatorNode.style.opacity = '0'
      }
      return
    }

    indicatorNode.style.width = `${selectedNode.offsetWidth}px`
    indicatorNode.style.transform = `translateX(${selectedNode.offsetLeft}px)`
    indicatorNode.style.opacity = '1'
  }, [options, value])

  useEffect(() => {
    updateIndicator()
  }, [updateIndicator])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(() => {
      updateIndicator()
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    itemRefs.current.forEach((node) => {
      if (node) {
        resizeObserver.observe(node)
      }
    })

    return () => {
      resizeObserver.disconnect()
    }
  }, [options.length, updateIndicator])

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-grid grid-flow-col auto-cols-fr items-center gap-1 overflow-hidden rounded-full border border-border/60 bg-muted/70 p-1',
        className
      )}
    >
      <div
        ref={indicatorRef}
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1 bottom-1 left-0 rounded-full border border-border/70 bg-background opacity-0 shadow-sm transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          indicatorClassName
        )}
      />
      {options.map((option, index) => {
        const selected = option.value === value

        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current[index] = node
            }}
            type="button"
            className={cn(
              'relative z-10 flex items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors duration-200 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0',
              selected && 'text-foreground',
              buttonClassName
            )}
            onClick={() => onChange(option.value)}
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            title={option.title ?? option.label}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function getPlanCtaLabel(
  targetPlanId: PlanTierId,
  currentPlanId: PlanTierId,
  targetPlanName: string
): string {
  if (targetPlanId === currentPlanId) {
    return targetPlanId === 'free' ? 'Download Free' : 'Current Plan'
  }

  const targetRank = PLAN_TIER_RANK[targetPlanId]
  const currentRank = PLAN_TIER_RANK[currentPlanId]

  if (targetRank > currentRank) {
    return `Upgrade to ${targetPlanName}`
  }

  return 'Downgrade'
}

function getPlanBadge(
  planId: PlanCard['id'],
  currentPlanId: 'free' | CheckoutPlan | 'enterprise'
): string | null {
  if (currentPlanId === 'free' && planId === 'pro') return 'Most Popular'
  if (currentPlanId === 'pro' && planId === 'max') return 'Recommended'
  return null
}

export function Billing({ surface = 'page', route }: BillingProps) {
  const {
    user,
    logout,
    convexUserId,
    accessToken,
    settingsPage,
    convexOrg,
    workspaceScoped,
    canManageWorkspaceBilling,
    billingOrganizationId,
    billingRoute,
    members,
    seatManagement,
    walletSummary,
    seatWallets,
  } = useScopedBillingData({ route })

  const setSeatAssignment = useMutation(api.billing.setSeatAssignment)

  const [stripeInvoices, setStripeInvoices] = useState<StripeInvoice[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [pricingCatalog, setPricingCatalog] = useState<StripeCatalogResponse | null>(null)
  const [scheduledCycleChange, setScheduledCycleChange] = useState<ScheduledCycleChange | null>(null)
  const [, setIsCatalogLoading] = useState(false)
  const [isCheckoutPending, setIsCheckoutPending] = useState(false)
  const [isCycleChangePending, setIsCycleChangePending] = useState(false)
  const [isCancelScheduledCycleChangePending, setIsCancelScheduledCycleChangePending] = useState(false)
  const [isActivatingPaidMax, setIsActivatingPaidMax] = useState(false)
  const [isPortalPending, setIsPortalPending] = useState(false)
  const [showUpgradeOptions, setShowUpgradeOptions] = useState(false)
  const [pendingDowngradeTargetPlanId, setPendingDowngradeTargetPlanId] = useState<PlanTierId | null>(null)
  const [seatMutationUserId, setSeatMutationUserId] = useState<string | null>(null)
  const [seatMutationError, setSeatMutationError] = useState<string | null>(null)

  const [checkoutCycle, setCheckoutCycle] = useState<BillingCycle>('monthly')
  const [checkoutSeatQuantity, setCheckoutSeatQuantity] = useState<number>(STARTUP_MIN_SEATS)
  const checkoutDefaultsInitializedRef = useRef(false)

  useEffect(() => {
    if (!seatManagement || checkoutDefaultsInitializedRef.current) return

    const cycle =
      seatManagement.accountSubscription?.cycle === 'yearly' ? 'yearly' : 'monthly'
    const subscriptionSeats =
      typeof seatManagement.accountSubscription?.seatQuantity === 'number'
        ? seatManagement.accountSubscription.seatQuantity
        : undefined
    const entitlementSeats =
      typeof seatManagement.entitlement?.seatCounts?.total === 'number'
        ? seatManagement.entitlement.seatCounts.total
        : undefined
    setCheckoutCycle(cycle)
    setCheckoutSeatQuantity(
      normalizeSeatQuantity(subscriptionSeats ?? entitlementSeats ?? STARTUP_MIN_SEATS)
    )
    checkoutDefaultsInitializedRef.current = true
  }, [seatManagement])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const fetchScheduledCycleChange = async () => {
      if (!billingOrganizationId || !accessToken) {
        if (!cancelled) {
          setScheduledCycleChange(null)
        }
        return
      }

      try {
        const response = await fetchWithAbort(
          `${AUTH_SERVER_URL}/stripe/scheduled-cycle-change?organizationId=${billingOrganizationId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          },
          { signal: controller.signal, timeoutMs: 15000 }
        )

        if (!response.ok) {
          if (!cancelled) {
            setScheduledCycleChange(null)
          }
          return
        }

        const data = (await response.json()) as {
          pendingChange?: ScheduledCycleChange | null
        }
        if (!cancelled) {
          setScheduledCycleChange(data.pendingChange ?? null)
        }
      } catch (err) {
        if (isAbortError(err)) return
        console.error('Failed to fetch scheduled cycle change:', err)
        if (!cancelled) {
          setScheduledCycleChange(null)
        }
      }
    }

    void fetchScheduledCycleChange()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [billingOrganizationId, accessToken])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const fetchCatalog = async () => {
      setIsCatalogLoading(true)
      try {
        const headers: Record<string, string> = {}
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`
        }

        const response = await fetchWithAbort(
          `${AUTH_SERVER_URL}/stripe/catalog`,
          {
            method: 'GET',
            headers,
            signal: controller.signal,
          },
          { signal: controller.signal, timeoutMs: 10000 }
        )

        if (!response.ok) return
        const data = (await response.json().catch(() => null)) as StripeCatalogResponse | null
        if (!cancelled && data) {
          setPricingCatalog(data)
        }
      } catch (err) {
        if (isAbortError(err)) return
        console.error('Failed to load Stripe catalog:', err)
      } finally {
        if (!cancelled) {
          setIsCatalogLoading(false)
        }
      }
    }

    void fetchCatalog()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [accessToken])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const fetchInvoices = async () => {
      if (!billingOrganizationId || !accessToken) return

      setInvoicesLoading(true)
      try {
        const response = await fetchWithAbort(
          `${AUTH_SERVER_URL}/stripe/invoices?organizationId=${billingOrganizationId}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          },
          { signal: controller.signal, timeoutMs: 15000 }
        )

        if (response.ok) {
          const data = (await response.json()) as { invoices?: StripeInvoice[] }
          if (!cancelled) {
            setStripeInvoices(data.invoices || [])
          }
        }
      } catch (err) {
        if (isAbortError(err)) return
        console.error('Failed to fetch invoices:', err)
      } finally {
        if (!cancelled) {
          setInvoicesLoading(false)
        }
      }
    }

    void fetchInvoices()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [billingOrganizationId, accessToken])

  const entitlement = seatManagement?.entitlement
  const currentPlanName = planLabel({
    source: entitlement?.source,
    plan: entitlement?.plan,
    workspaceScoped,
  })
  const entitlementStatusLabel = formatEntitlementStatus(entitlement?.status)
  const paidSeatTotal = entitlement?.seatCounts.total ?? 0
  const paidSeatAssigned = entitlement?.seatCounts.assigned ?? 0
  const paidSeatAvailable = entitlement?.seatCounts.available ?? 0
  const paidSeatProgress =
    paidSeatTotal > 0 ? Math.min((paidSeatAssigned / paidSeatTotal) * 100, 100) : 0

  const walletCurrency = walletSummary?.wallet?.currency ?? 'USD'
  const includedUsagePerCycleCents = Math.max(0, walletSummary?.includedCentsPerCycle ?? 0)
  const activeWalletAvailableCents = Math.max(0, walletSummary?.wallet?.availableCents ?? 0)
  const includedUsageLeftCents = Math.min(includedUsagePerCycleCents, activeWalletAvailableCents)
  const includedUsageLeftPercent =
    includedUsagePerCycleCents > 0
      ? Math.max(0, Math.min(100, (includedUsageLeftCents / includedUsagePerCycleCents) * 100))
      : 0

  const activeAssignmentsByUserId = useMemo(() => {
    const map = new Set<string>()
    for (const assignment of seatManagement?.seatAssignments ?? []) {
      map.add(String(assignment.assignedUserId))
    }
    return map
  }, [seatManagement?.seatAssignments])

  const billingOwnerId = seatManagement?.billingAccount?.billingUserId
    ? String(seatManagement.billingAccount.billingUserId)
    : null
  const canManageSeats = seatManagement?.canManageSeats ?? false
  const canOpenCheckout = workspaceScoped ? canManageWorkspaceBilling : true
  const hasPastDueEntitlement = entitlement?.status === 'past_due'
  const seatManagedEntitlement = isSeatManagedEntitlement({
    source: entitlement?.source,
    plan: entitlement?.plan,
    workspaceScoped,
  })
  const showPaidSeatSummary = seatManagedEntitlement || paidSeatTotal > 0
  const hasBillingOverviewContent =
    showPaidSeatSummary || (seatManagedEntitlement && Boolean(seatManagement?.billingUser))
  const currentPlanIdForCards = normalizeCurrentPlanForCards(
    entitlement?.source,
    entitlement?.plan,
    workspaceScoped
  )
  const currentSubscriptionCycle =
    seatManagement?.accountSubscription?.cycle === 'yearly' ? 'yearly' : 'monthly'
  const currentSelfServePlan =
    currentPlanIdForCards === 'pro' ||
    currentPlanIdForCards === 'max' ||
    currentPlanIdForCards === 'startup'
      ? currentPlanIdForCards
      : null
  const scheduledCycleChangeForCurrentPlan =
    currentSelfServePlan && scheduledCycleChange?.plan === currentSelfServePlan
      ? scheduledCycleChange
      : null
  const isPlanActionPending =
    isCheckoutPending || isCycleChangePending || isCancelScheduledCycleChangePending
  const shouldShowFreeTrialText = currentPlanIdForCards === 'free'
  const hasConsumedMaxTrial = Boolean(
    seatManagement?.accountSubscription?.trialStart &&
    seatManagement?.accountSubscription?.stripeSubscriptionId
  )
  const maxTrialEligible = shouldShowFreeTrialText && !hasConsumedMaxTrial
  const hasActiveMaxTrial = Boolean(
    entitlement?.source === 'account' &&
    entitlement?.plan === 'max' &&
    entitlement?.status === 'trialing' &&
    entitlement?.trialActive
  )
  const maxTrialEndsLabel =
    hasActiveMaxTrial && entitlement?.trialEndsAt
      ? formatDate(entitlement.trialEndsAt)
      : null
  const pendingDowngradeTargetPlanName = pendingDowngradeTargetPlanId
    ? getPlanDisplayName(pendingDowngradeTargetPlanId)
    : null
  const pendingDowngradeLostBenefits = useMemo(() => {
    if (!pendingDowngradeTargetPlanId) return []

    const currentFeatures = getPlanIncludedFeatures(currentPlanIdForCards)
    const targetFeatures = getPlanIncludedFeatures(pendingDowngradeTargetPlanId)
    const targetSet = new Set(targetFeatures.map(getPlanFeatureComparisonKey))
    const targetAiCreditLevel = targetFeatures.reduce((maxLevel, feature) => (
      Math.max(maxLevel, getAiCreditFeatureLevel(feature))
    ), 0)

    return currentFeatures.filter(
      (feature) => {
        const featureKey = getPlanFeatureComparisonKey(feature)
        if (featureKey === 'ai-credits') {
          return getAiCreditFeatureLevel(feature) > targetAiCreditLevel
        }

        return !targetSet.has(featureKey)
      }
    )
  }, [currentPlanIdForCards, pendingDowngradeTargetPlanId])
  const individualPlanCards = useMemo(() => {
    return INDIVIDUAL_PLAN_CARDS.map((card) => {
      if (card.id === 'free') return card
      const resolvedPricing = resolvePlanPricing({
        catalog: pricingCatalog,
        plan: card.id,
        cycle: checkoutCycle,
      })
      return {
        ...card,
        ...resolvedPricing,
        trial: resolvedPricing.trial ?? card.trial,
      }
    })
  }, [checkoutCycle, pricingCatalog])
  const startupPlanCtaLabel = getPlanCtaLabel('startup', currentPlanIdForCards, STARTUP_PLAN_CARD.name)
  const enterprisePlanCtaLabel = getPlanCtaLabel('enterprise', currentPlanIdForCards, ENTERPRISE_PLAN_CARD.name)

  const handleManageBilling = useCallback(async () => {
    if (!billingOrganizationId || !accessToken) return

    setIsPortalPending(true)
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/create-portal`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            organizationId: billingOrganizationId,
            returnUrl: `${window.location.origin}${billingRoute}`,
          }),
        },
        { timeoutMs: 15000 }
      )

      if (!response.ok) {
        const error = (await response.json()) as { error?: string }
        throw new Error(error.error || 'Failed to open billing portal')
      }

      const { url } = (await response.json()) as { url?: string }
      if (url) {
        await window.electronAPI.shell.openExternal(url)
      }
    } catch (err) {
      console.error('Billing portal error:', err)
      alert(err instanceof Error ? err.message : 'Failed to open billing portal')
    } finally {
      setIsPortalPending(false)
    }
  }, [accessToken, billingOrganizationId, billingRoute])

  const handleActivatePaidMax = useCallback(async () => {
    if (!billingOrganizationId || !accessToken) return

    setIsActivatingPaidMax(true)
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/activate-paid-max`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            organizationId: billingOrganizationId,
          }),
        },
        { timeoutMs: 15000 }
      )

      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { message?: string; error?: string } | null
        throw new Error(error?.message || error?.error || 'Failed to activate paid Max')
      }

      alert('Paid Max activated. Your full Max allocation is now available.')
    } catch (err) {
      console.error('Activate paid Max error:', err)
      alert(err instanceof Error ? err.message : 'Failed to activate paid Max')
    } finally {
      setIsActivatingPaidMax(false)
    }
  }, [accessToken, billingOrganizationId])

  const handleCheckout = useCallback(async (requestedPlan: CheckoutPlan) => {
    if (!billingOrganizationId || !accessToken) return

    const checkoutSeatManaged = requestedPlan === 'startup'
    const normalizedSeats = checkoutSeatManaged
      ? normalizeSeatQuantity(checkoutSeatQuantity)
      : 1
    const payload: {
      organizationId: string
      type: 'subscription'
      plan: CheckoutPlan
      cycle: BillingCycle
      seatQuantity?: number
      successUrl: string
      cancelUrl: string
    } = {
      organizationId: billingOrganizationId,
      type: 'subscription',
      plan: requestedPlan,
      cycle: checkoutCycle,
      successUrl: 'cozea://billing/success?type=subscription',
      cancelUrl: 'cozea://billing/canceled',
    }

    if (checkoutSeatManaged) {
      payload.seatQuantity = normalizedSeats
    }

    setIsCheckoutPending(true)
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/create-checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        },
        { timeoutMs: 15000 }
      )

      if (!response.ok) {
        const error = (await response.json()) as { error?: string }
        throw new Error(error.error || 'Failed to start checkout')
      }

      const { url } = (await response.json()) as { url?: string }
      if (url) {
        await window.electronAPI.shell.openExternal(url)
      }
    } catch (err) {
      console.error('Checkout error:', err)
      alert(err instanceof Error ? err.message : 'Failed to start checkout')
    } finally {
      setIsCheckoutPending(false)
    }
  }, [
    accessToken,
    checkoutCycle,
    checkoutSeatQuantity,
    billingOrganizationId,
  ])

  const handleScheduleCycleChange = useCallback(async (requestedPlan: CheckoutPlan) => {
    if (!billingOrganizationId || !accessToken) return

    setIsCycleChangePending(true)
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/schedule-cycle-change`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            organizationId: billingOrganizationId,
            plan: requestedPlan,
            cycle: checkoutCycle,
          }),
        },
        { timeoutMs: 15000 }
      )

      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          message?: string
          error?: string
        } | null
        if (response.status === 404) {
          throw new Error(
            `The billing server at ${AUTH_SERVER_URL} does not support scheduled cycle changes yet. Restart or deploy that auth gateway, then try again.`
          )
        }
        throw new Error(error?.message || error?.error || 'Failed to schedule billing cycle change')
      }

      const data = (await response.json()) as {
        pendingChange?: ScheduledCycleChange | null
      }
      const pendingChange = data.pendingChange ?? null
      setScheduledCycleChange(pendingChange)

      const effectiveAt =
        pendingChange?.effectiveAt ??
        seatManagement?.accountSubscription?.currentPeriodEnd
      const effectiveDateLabel = formatDate(effectiveAt)
      alert(
        `${getPlanDisplayName(requestedPlan)} will switch to ${formatBillingCycleLabel(checkoutCycle)} billing on ${effectiveDateLabel}.`
      )
    } catch (err) {
      console.error('Schedule cycle change error:', err)
      alert(err instanceof Error ? err.message : 'Failed to schedule billing cycle change')
    } finally {
      setIsCycleChangePending(false)
    }
  }, [
    accessToken,
    billingOrganizationId,
    checkoutCycle,
    seatManagement?.accountSubscription?.currentPeriodEnd,
  ])

  const handleCancelScheduledCycleChange = useCallback(async () => {
    if (!billingOrganizationId || !accessToken) return

    setIsCancelScheduledCycleChangePending(true)
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/cancel-scheduled-cycle-change`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            organizationId: billingOrganizationId,
          }),
        },
        { timeoutMs: 15000 }
      )

      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          message?: string
          error?: string
        } | null
        throw new Error(error?.message || error?.error || 'Failed to cancel scheduled billing cycle change')
      }

      setScheduledCycleChange(null)
      alert('Scheduled billing cycle change canceled. Your current plan will continue on its existing cycle.')
    } catch (err) {
      console.error('Cancel scheduled cycle change error:', err)
      alert(err instanceof Error ? err.message : 'Failed to cancel scheduled billing cycle change')
    } finally {
      setIsCancelScheduledCycleChangePending(false)
    }
  }, [accessToken, billingOrganizationId])

  const handlePlanCardCheckout = useCallback(
    (planId: CheckoutPlan) => {
      void handleCheckout(planId)
    },
    [handleCheckout]
  )

  const executePlanAction = useCallback(
    (targetPlanId: PlanTierId) => {
      if (targetPlanId === 'free') {
        void handleManageBilling()
        return
      }

      if (targetPlanId === 'enterprise') {
        void window.electronAPI.shell.openExternal(ENTERPRISE_SALES_MAILTO)
        return
      }

      if (
        (targetPlanId === 'pro' || targetPlanId === 'max' || targetPlanId === 'startup') &&
        currentSelfServePlan === targetPlanId &&
        currentSubscriptionCycle !== checkoutCycle
      ) {
        void handleScheduleCycleChange(targetPlanId)
        return
      }

      handlePlanCardCheckout(targetPlanId)
    },
    [
      checkoutCycle,
      currentSelfServePlan,
      currentSubscriptionCycle,
      handleManageBilling,
      handlePlanCardCheckout,
      handleScheduleCycleChange,
    ]
  )

  const handlePlanCtaClick = useCallback(
    (targetPlanId: PlanTierId) => {
      const isDowngradeFromPaidPlan =
        currentPlanIdForCards !== 'free' &&
        PLAN_TIER_RANK[targetPlanId] < PLAN_TIER_RANK[currentPlanIdForCards]

      if (isDowngradeFromPaidPlan) {
        setPendingDowngradeTargetPlanId(targetPlanId)
        return
      }

      executePlanAction(targetPlanId)
    },
    [currentPlanIdForCards, executePlanAction]
  )

  const handleConfirmDowngrade = useCallback(() => {
    if (!pendingDowngradeTargetPlanId) return
    const targetPlanId = pendingDowngradeTargetPlanId
    setPendingDowngradeTargetPlanId(null)
    executePlanAction(targetPlanId)
  }, [executePlanAction, pendingDowngradeTargetPlanId])

  const handleSeatToggle = useCallback(
    async (assignedUserId: Id<'users'>, nextActive: boolean) => {
      if (!convexOrg?._id || !convexUserId) return

      setSeatMutationError(null)
      setSeatMutationUserId(String(assignedUserId))
      try {
        await setSeatAssignment({
          organizationId: convexOrg._id,
          actorUserId: convexUserId,
          assignedUserId,
          active: nextActive,
        })
      } catch (err) {
        setSeatMutationError(
          err instanceof Error ? err.message : 'Failed to update seat assignment'
        )
      } finally {
        setSeatMutationUserId(null)
      }
    },
    [convexOrg?._id, convexUserId, setSeatAssignment]
  )

  const search =
    surface === 'drawer'
      ? route?.split('?')[1] ?? ''
      : typeof window !== 'undefined'
        ? window.location.search.replace(/^\?/, '')
        : ''

  const urlParams = new URLSearchParams(search)
  const successType = urlParams.get('success')
  const wasCanceled = urlParams.get('canceled')
  const shouldExpandPlansFromUrl = urlParams.get('plans') === '1'

  useEffect(() => {
    if (!shouldExpandPlansFromUrl) return
    setShowUpgradeOptions(true)
  }, [shouldExpandPlansFromUrl])

  const renderCycleToggle = () => (
    <SlidingSegmentedControl
      value={checkoutCycle}
      options={BILLING_CYCLE_OPTIONS}
      onChange={setCheckoutCycle}
      ariaLabel="Billing cycle"
      className="border-border/60 bg-background/70 p-0.5"
      indicatorClassName="top-0.5 bottom-0.5 border-border/60"
      buttonClassName="h-6 min-w-8 px-2.5 text-[11px] leading-none"
    />
  )

  const content = (
    <>
      {successType && (
        <Alert className="mb-6 border-green-500/50 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-500">Subscription Updated</AlertTitle>
          <AlertDescription>
            Billing details were updated successfully.
          </AlertDescription>
        </Alert>
      )}

      {wasCanceled && (
        <Alert className="mb-6 border-amber-500/50 bg-amber-500/10">
          <XCircle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-500">Checkout Canceled</AlertTitle>
          <AlertDescription>Your checkout was canceled. No charges were made.</AlertDescription>
        </Alert>
      )}

      {entitlement && entitlement.source === 'legacy' && (
        <Alert className="mb-6">
          <AlertTitle>Legacy workspace billing compatibility mode</AlertTitle>
          <AlertDescription>
            Legacy workspace subscriptions still work. Move to account subscriptions for canonical Pro,
            Max, and Startup billing.
          </AlertDescription>
        </Alert>
      )}

      {seatMutationError && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Seat assignment failed</AlertTitle>
          <AlertDescription>{seatMutationError}</AlertDescription>
        </Alert>
      )}

      {hasPastDueEntitlement && (
        <Alert variant="destructive" className="mb-6">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>
            Your latest Stripe payment was declined. Update your payment method in Manage Billing to
            restore hosted AI access and included usage.
          </AlertDescription>
        </Alert>
      )}

      {scheduledCycleChangeForCurrentPlan && (
        <Alert className="mb-6 border-sky-500/50 bg-sky-500/10">
          <AlertTitle className="text-sky-600 dark:text-sky-400">Billing cycle change scheduled</AlertTitle>
          <AlertDescription>
            {`${getPlanDisplayName(scheduledCycleChangeForCurrentPlan.plan)} stays on ${formatBillingCycleLabel(currentSubscriptionCycle).toLowerCase()} billing until ${formatDate(scheduledCycleChangeForCurrentPlan.effectiveAt)}, then switches to ${formatBillingCycleLabel(scheduledCycleChangeForCurrentPlan.cycle).toLowerCase()}.`}
          </AlertDescription>
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleCancelScheduledCycleChange()}
              disabled={isCancelScheduledCycleChangePending || isPortalPending || isCycleChangePending || isCheckoutPending}
            >
              {isCancelScheduledCycleChangePending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Cancel scheduled change
            </Button>
          </div>
        </Alert>
      )}

      <div
        className={[
          featureFlags.contentVisibility ? 'perf-contain-auto' : '',
          surface === 'drawer' ? 'space-y-6 px-6 py-6' : 'space-y-6',
        ]
          .join(' ')
          .trim()}
      >
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader className={hasBillingOverviewContent ? 'pt-0 px-0' : 'pt-0 px-0 pb-2'}>
            <div className="min-w-0 flex items-center gap-2">
              <CardTitle className="truncate text-3xl font-semibold tracking-tight">{currentPlanName} plan</CardTitle>
              <Badge variant="secondary">{entitlementStatusLabel}</Badge>
            </div>
            <CardDescription>
              {workspaceScoped
                ? 'Workspace billing is centralized and seat-based. Manage Startup or Enterprise access, seat assignment, and included AI usage for this workspace here.'
                : 'Billing is personal and account-scoped. Manage your plan, included AI usage, and invoices here.'}
            </CardDescription>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={handleManageBilling}
                disabled={!canOpenCheckout || isPortalPending}
              >
                {isPortalPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Manage Billing
              </Button>
              <Button variant="outline" onClick={() => setShowUpgradeOptions((current) => !current)}>
                {showUpgradeOptions ? 'Hide Plans' : 'Change Plan'}
              </Button>
            </div>
          </CardHeader>

          {hasBillingOverviewContent ? (
            <CardContent className="space-y-5 px-0">
              {showPaidSeatSummary && (
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2 rounded-2xl bg-secondary/80 p-4 dark:bg-secondary/40">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Paid seats</span>
                      <span>{`${paidSeatAssigned} / ${paidSeatTotal || '-'}`}</span>
                    </div>
                    {seatManagedEntitlement && paidSeatTotal > 0 ? (
                      <Progress value={paidSeatProgress} className="h-2" />
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {seatManagedEntitlement
                          ? 'No paid seat pool active'
                          : 'Seat assignment is only used for Startup and Enterprise'}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {seatManagedEntitlement
                        ? paidSeatTotal > 0
                          ? `${paidSeatAvailable} seats available`
                          : 'Assign seats after starting Startup'
                      : 'Pro and Max do not use seat assignments'}
                    </div>
                  </div>
                </div>
              )}

              {seatManagedEntitlement && seatManagement?.billingUser ? (
                <div className="flex w-fit items-center gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={seatManagement.billingUser.profileImageUrl || undefined} />
                    <AvatarFallback>
                      {(seatManagement.billingUser.email || '?').slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-xs text-muted-foreground">Billing owner</p>
                    <p className="text-sm font-medium">{seatManagement.billingUser.email}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          ) : null}
        </Card>

        {showUpgradeOptions && (
          <Card className="-mt-4 border-none bg-transparent shadow-none">
            <CardContent className="px-0 pt-0">
              {!workspaceScoped ? (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {individualPlanCards.map((planCard, index) => {
                    const isCurrentPlan = currentPlanIdForCards === planCard.id
                    const isSamePlanCycleSwitch =
                      currentSelfServePlan === planCard.id &&
                      currentSubscriptionCycle !== checkoutCycle
                    const isCycleSwitchScheduled =
                      scheduledCycleChange?.plan === planCard.id &&
                      scheduledCycleChange.cycle === checkoutCycle
                    const isExactCurrentSelection = isCurrentPlan && !isSamePlanCycleSwitch
                    const badge = getPlanBadge(planCard.id, currentPlanIdForCards)
                    const planCardCtaLabel =
                      isSamePlanCycleSwitch
                        ? isCycleSwitchScheduled
                          ? `${formatBillingCycleLabel(checkoutCycle)} Scheduled`
                          : `Switch to ${formatBillingCycleLabel(checkoutCycle)}`
                        : getPlanCtaLabel(planCard.id, currentPlanIdForCards, planCard.name)
                    const showTrialText = Boolean(planCard.trial) && (
                      planCard.id === 'free'
                        ? shouldShowFreeTrialText
                        : planCard.id === 'max'
                          ? maxTrialEligible
                          : false
                    )
                    const planCardFooterText =
                      planCard.id === 'max' && !(maxTrialEligible || hasActiveMaxTrial)
                        ? ''
                        : planCard.footerText

                    return (
                      <div
                        key={planCard.id}
                        className={`relative flex h-full flex-col rounded-2xl border border-transparent bg-secondary/80 p-5 transition-all duration-300 dark:bg-secondary/40 ${
                          isCurrentPlan ? 'border-primary/30' : ''
                        }`}
                        style={{ transitionDelay: `${index * 50}ms` }}
                      >
                        {badge ? (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                            {badge}
                          </div>
                        ) : null}

                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-lg font-semibold text-foreground">{planCard.name}</h3>
                          </div>
                          {planCard.id !== 'free' ? renderCycleToggle() : null}
                        </div>
                        {planCard.description ? (
                          <p className="mt-2 text-sm text-muted-foreground">{planCard.description}</p>
                        ) : null}
                        <div className="mt-4 flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-foreground">{planCard.price}</span>
                          {planCard.period ? <span className="text-muted-foreground">{planCard.period}</span> : null}
                        </div>
                        {planCard.yearlySavingsLabel ? (
                          <p className="mt-1 text-xs text-muted-foreground">{planCard.yearlySavingsLabel}</p>
                        ) : null}
                        {showTrialText ? (
                          <p className="mt-1 text-sm text-green-600 dark:text-green-400">{planCard.trial}</p>
                        ) : null}

                        {planCard.featuresHeading ? (
                          <p className="mt-4 text-sm font-medium text-foreground">{planCard.featuresHeading}</p>
                        ) : null}
                        <ul className="mt-5 flex-1 space-y-2.5">
                          {planCard.features.map((feature, featureIndex) => (
                            <li key={`${planCard.id}-${featureIndex}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                              {feature.included ? (
                                <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                              ) : (
                                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                              )}
                              <span>{feature.text}</span>
                            </li>
                          ))}
                        </ul>

                        {planCard.conclusion ? (
                          <p className="mt-4 text-sm text-muted-foreground">{planCard.conclusion}</p>
                        ) : null}

                        {planCardFooterText ? (
                          <p className="mt-5 text-center text-xs text-muted-foreground">{planCardFooterText}</p>
                        ) : null}

                        {planCard.id === 'free' ? (
                          <Button
                            className="mt-5 w-full rounded-lg"
                            variant="outline"
                            onClick={() => handlePlanCtaClick('free')}
                            disabled={!canOpenCheckout || isCurrentPlan || isPortalPending || isPlanActionPending}
                          >
                            {planCardCtaLabel}
                          </Button>
                        ) : (
                          <Button
                            className="mt-5 w-full rounded-full"
                            variant={isExactCurrentSelection || isCycleSwitchScheduled ? 'secondary' : 'default'}
                            onClick={() => handlePlanCtaClick(planCard.id)}
                            disabled={
                              !canOpenCheckout ||
                              isExactCurrentSelection ||
                              isPlanActionPending ||
                              isPortalPending ||
                              isCycleSwitchScheduled
                            }
                          >
                            {isPlanActionPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            {planCardCtaLabel}
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="relative flex h-full flex-col rounded-2xl bg-secondary/80 p-5 transition-all duration-300 dark:bg-secondary/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-foreground">{STARTUP_PLAN_CARD.name}</h3>
                      </div>
                      {renderCycleToggle()}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{STARTUP_PLAN_CARD.description}</p>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-foreground">
                        {resolvePlanPricing({
                          catalog: pricingCatalog,
                          plan: 'startup',
                          cycle: checkoutCycle,
                        }).price}
                      </span>
                      <span className="text-muted-foreground">
                        {resolvePlanPricing({
                          catalog: pricingCatalog,
                          plan: 'startup',
                          cycle: checkoutCycle,
                        }).period}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {STARTUP_PLAN_CARD.priceSecondary}
                    </p>
                    <p className="mt-4 text-sm font-medium text-foreground">{STARTUP_PLAN_CARD.featuresHeading}</p>
                    <ul className="mt-5 flex-1 space-y-2.5">
                      {STARTUP_PLAN_CARD.features.map((feature, featureIndex) => (
                        <li key={`${feature.text}-${featureIndex}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                          {feature.included ? (
                            <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                          ) : (
                            <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                          )}
                          <span>{feature.text}</span>
                        </li>
                      ))}
                    </ul>
                    {STARTUP_PLAN_CARD.footerText ? (
                      <p className="mt-6 text-center text-xs text-muted-foreground">{STARTUP_PLAN_CARD.footerText}</p>
                    ) : null}
                    <Button
                      className="mt-6 w-full rounded-lg"
                      variant={currentPlanIdForCards === 'startup' ? 'secondary' : 'default'}
                      onClick={() => handlePlanCtaClick('startup')}
                      disabled={currentPlanIdForCards === 'startup' || isPlanActionPending || isPortalPending}
                    >
                      {startupPlanCtaLabel}
                    </Button>
                  </div>
                  <div className="relative flex h-full flex-col rounded-2xl bg-secondary/80 p-5 transition-all duration-300 dark:bg-secondary/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-foreground">{ENTERPRISE_PLAN_CARD.name}</h3>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{ENTERPRISE_PLAN_CARD.description}</p>
                    <p className="mt-4 text-3xl font-bold text-foreground">{ENTERPRISE_PLAN_CARD.priceLabel}</p>
                    <p className="mt-4 text-sm font-medium text-foreground">{ENTERPRISE_PLAN_CARD.featuresHeading}</p>
                    <ul className="mt-5 flex-1 space-y-2.5">
                      {ENTERPRISE_PLAN_CARD.features.map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {ENTERPRISE_PLAN_CARD.footerText ? (
                      <p className="mt-6 text-center text-xs text-muted-foreground">{ENTERPRISE_PLAN_CARD.footerText}</p>
                    ) : null}
                    <Button
                      className="mt-6 w-full rounded-lg"
                      variant={currentPlanIdForCards === 'enterprise' ? 'secondary' : 'default'}
                      onClick={() => handlePlanCtaClick('enterprise')}
                      disabled={currentPlanIdForCards === 'enterprise' || isPlanActionPending || isPortalPending}
                    >
                      {enterprisePlanCtaLabel}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog
          open={pendingDowngradeTargetPlanId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPendingDowngradeTargetPlanId(null)
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>You will Lose access to:</DialogTitle>
              <DialogDescription>
                {pendingDowngradeTargetPlanName
                  ? `Downgrading from ${getPlanDisplayName(currentPlanIdForCards)} to ${pendingDowngradeTargetPlanName} will remove these benefits.`
                  : 'Downgrading will remove benefits from your current plan.'}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {pendingDowngradeLostBenefits.length > 0 ? (
                pendingDowngradeLostBenefits.map((benefit) => (
                  <div key={benefit} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>{benefit}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No specific feature differences were detected.</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setPendingDowngradeTargetPlanId(null)}
                disabled={isPlanActionPending || isPortalPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDowngrade}
                disabled={isPlanActionPending || isPortalPending}
              >
                {isPlanActionPending || isPortalPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Lose all my benefits
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {seatManagedEntitlement && (
          <Card className="border-none shadow-none bg-transparent">
          <CardHeader className="pt-0 px-0 pb-4">
            <CardTitle>Seat Assignments</CardTitle>
            <CardDescription>
              Purchased seats cap workspace access. Assign paid seats explicitly so members can use AI
              and sync.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40">
              <Table className="[&_th]:px-4 [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Seat</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                  {(members ?? []).length > 0 ? (
                    (members ?? []).map((member) => {
                      const isBillingOwner =
                        billingOwnerId !== null &&
                        billingOwnerId === String(member.userId)
                      const hasSeat =
                        entitlement?.source === 'legacy'
                          ? true
                          : isBillingOwner || activeAssignmentsByUserId.has(String(member.userId))
                      const isBusy = seatMutationUserId === String(member.userId)
                      const canToggle =
                        canManageSeats &&
                        entitlement?.source !== 'legacy' &&
                        !isBillingOwner

                      const displayName =
                        member.user?.firstName
                          ? `${member.user.firstName} ${member.user.lastName || ''}`.trim()
                          : member.user?.email || 'Unknown'

                      return (
                        <TableRow key={member._id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={member.user?.profileImageUrl || undefined} />
                                <AvatarFallback>
                                  {(displayName || '?').slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-sm font-medium">{displayName}</p>
                                <p className="text-xs text-muted-foreground">{member.user?.email || '-'}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className="border-0 bg-primary/10 text-primary">
                              {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {isBillingOwner ? (
                              <Badge variant="secondary">Owner Seat</Badge>
                            ) : hasSeat ? (
                              <Badge variant="secondary">Assigned</Badge>
                            ) : (
                              <Badge variant="outline">Not Assigned</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isBillingOwner ? (
                              <span className="text-xs text-muted-foreground">Always included</span>
                            ) : (
                              <Button
                                variant={hasSeat ? 'outline' : 'default'}
                                size="sm"
                                disabled={!canToggle || isBusy}
                                onClick={() => void handleSeatToggle(member.userId, !hasSeat)}
                              >
                                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : hasSeat ? 'Revoke' : 'Assign'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                        No workspace members found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {!canManageSeats && seatManagement?.billingUser && entitlement?.source !== 'legacy' && (
              <p className="mt-3 text-xs text-muted-foreground">
                Only the billing owner ({seatManagement.billingUser.email}) can assign or revoke paid seats.
              </p>
            )}
          </CardContent>
          </Card>
        )}

        {seatManagedEntitlement && seatWallets?.canManage && (
          <Card className="border-none shadow-none bg-transparent">
            <CardHeader className="pt-0 px-0 pb-4">
              <CardTitle>Seat Wallet Balances</CardTitle>
              <CardDescription>
                Each active seat keeps its own wallet. Wallets reset to the full included amount every billing cycle.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40">
                <Table className="[&_th]:px-4 [&_td]:px-4">
                  <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                    <TableRow>
                      <TableHead>Seat User</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead>Included / Cycle</TableHead>
                      <TableHead className="text-right">Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                    {seatWallets.wallets.length > 0 ? (
                      seatWallets.wallets.map((entry: SeatWalletView) => {
                        const displayName =
                          entry.firstName
                            ? `${entry.firstName} ${entry.lastName || ''}`.trim()
                            : entry.email

                        return (
                          <TableRow key={String(entry.userId)}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarImage src={entry.profileImageUrl || undefined} />
                                  <AvatarFallback>
                                    {(displayName || '?').slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-sm font-medium">
                                    {displayName}
                                    {entry.isBillingOwner ? ' (Owner)' : ''}
                                  </p>
                                  <p className="text-xs text-muted-foreground">{entry.email}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="font-medium">
                                {formatCurrencyFromCents(entry.availableCents, walletCurrency)}
                              </span>
                            </TableCell>
                            <TableCell>
                              {formatCurrencyFromCents(seatWallets.includedCentsPerCycle, walletCurrency)}
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {formatDate(entry.updatedAt ?? undefined)}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                          No active seat wallets yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-none shadow-none bg-transparent">
          <CardHeader className="pt-0 px-0 pb-4">
            <CardTitle>Included Usage</CardTitle>
            <CardDescription>
              Remaining hosted AI usage included with your current billing cycle.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            <div className="rounded-2xl bg-secondary/80 p-4 dark:bg-secondary/40">
              <div>
                <p className="text-sm font-medium">Usage left</p>
                <p className="text-xs text-muted-foreground">
                  {hasPastDueEntitlement
                    ? 'Your latest payment failed, so hosted AI usage is locked until Stripe confirms payment.'
                    : includedUsagePerCycleCents > 0
                    ? hasActiveMaxTrial
                      ? `${Math.round(includedUsageLeftPercent)}% of your trial allocation remains. Trial usage is capped at ${MAX_TRIAL_INCLUDED_PERCENT}% of the full Max allowance.`
                      : `${Math.round(includedUsageLeftPercent)}% remaining in this billing cycle.`
                    : 'Your current plan does not include hosted AI usage.'}
                </p>
                {hasPastDueEntitlement ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Update your payment method in Manage Billing to continue using Cozea-hosted AI.
                  </p>
                ) : null}
                {hasActiveMaxTrial ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {maxTrialEndsLabel
                      ? `Your Max trial ends on ${maxTrialEndsLabel}. Activate paid Max now to unlock the remaining 95% immediately.`
                      : 'Activate paid Max now to unlock the remaining 95% immediately.'}
                  </p>
                ) : null}
              </div>
              <Progress value={includedUsageLeftPercent} className="mt-3 h-2.5" />
              {hasActiveMaxTrial ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => void handleActivatePaidMax()}
                    disabled={isActivatingPaidMax || isPlanActionPending || isPortalPending}
                  >
                    {isActivatingPaidMax ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Activate Paid Max
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Charges the saved payment method now and switches this trial to normal Max billing.
                  </p>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-none bg-transparent">
          <CardHeader className="pt-0 px-0 pb-4">
            <CardTitle>Invoice History</CardTitle>
            <CardDescription>
              Review recent Stripe invoices for the active billing customer.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40">
              <Table className="[&_th]:px-4 [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                  {stripeInvoices.length > 0 ? (
                    stripeInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>{formatDate(invoice.date)}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{invoice.description}</TableCell>
                        <TableCell>${(invoice.amountPaid / 100).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={invoice.status === 'paid' ? 'secondary' : 'outline'}
                            className="capitalize"
                          >
                            {invoice.status || 'unknown'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {invoice.hostedInvoiceUrl ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1"
                              onClick={() =>
                                window.electronAPI.shell.openExternal(invoice.hostedInvoiceUrl!)
                              }
                            >
                              View
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                        {invoicesLoading ? 'Loading invoices...' : 'No invoices yet'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )

  if (surface === 'drawer') {
    return (
      <div className="mx-auto w-full max-w-6xl">
        {settingsPage.isWorkspaceAccessDenied ? (
          <WorkspaceAccessNotice
            title="Billing access required"
            description="You do not have permission to view workspace billing and usage for this workspace."
          />
        ) : (
          content
        )}
      </div>
    )
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={settingsPage.breadcrumbs}
    >
      {settingsPage.isWorkspaceAccessDenied ? (
        <WorkspaceAccessNotice
          title="Billing access required"
          description="You do not have permission to view workspace billing and usage for this workspace."
        />
      ) : (
        content
      )}
    </DashboardLayout>
  )
}
