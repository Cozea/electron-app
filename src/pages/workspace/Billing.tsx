import { useState, useCallback, useEffect, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'

import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../../convex/_generated/api'
import { useCachedQuery } from '../../stores/useQueryCache'
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
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../../components/ui/chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  Check,
} from 'lucide-react'
import { normalizeWorkspacePlanForPricing, type WorkspacePricingPlanId } from '@/lib/billing/planLabels'
import { scheduleTask } from '@/lib/scheduler'
import { fetchWithAbort } from '@/lib/abort'
import { featureFlags } from '@/lib/featureFlags'

const AUTH_SERVER_URL = import.meta.env.VITE_AUTH_SERVER_URL || 'https://crosscode-auth-gateway-production.up.railway.app'

type PlanId = WorkspacePricingPlanId

interface PlanFeature {
  text: string
  included: boolean
}

interface StandardPlanInfo {
  id: PlanId
  name: string
  description: string
  price: string
  period: string
  trial?: string
  features: PlanFeature[]
  conclusion: string
  buttonLabel: string
  footerText: string
}

interface EnterprisePlanInfo {
  id: 'team'
  name: string
  description: string
  priceLabel: string
  features: PlanFeature[]
  buttonLabel: string
  footerText: string
}

const standardPlans: StandardPlanInfo[] = [
  {
    id: 'free',
    name: 'Starter',
    description: 'For builders testing ideas locally.',
    price: 'Free',
    period: '',
    features: [
      { text: '1 user', included: true },
      { text: 'Local-only projects', included: true },
      { text: '25 tool integrations', included: true },
      { text: 'Connect OpenAI, Gemini, and more', included: true },
      { text: 'No cloud sync', included: false },
      { text: 'No collaboration', included: false },
    ],
    conclusion: 'Build alone. Upgrade when you\'re ready to ship with others.',
    buttonLabel: 'Download Free',
    footerText: 'Upgrade anytime to collaborate with your team.',
  },
  {
    id: 'pro',
    name: 'Founders Plan',
    description: 'For founders who want to ship fast.',
    price: '15 USD',
    period: '/ month',
    trial: '7 day free trial',
    features: [
      { text: 'Up to 2 users', included: true },
      { text: '5 GB cloud workspace', included: true },
      { text: '5 shared projects', included: true },
      { text: '25 tool integrations', included: true },
      { text: 'Live Collaboration', included: true },
      { text: 'Connect OpenAI, Gemini, and more', included: true },
      { text: 'Built-in AI version control', included: true },
      { text: 'Priority support', included: true },
    ],
    conclusion: 'Go from idea to product without friction.',
    buttonLabel: 'Start Free Trial',
    footerText: 'Cancel anytime.',
  },
  {
    id: 'max',
    name: 'Team Scale',
    description: 'For teams building at serious speed.',
    price: '49 USD',
    period: '/ month',
    trial: '7 day free trial',
    features: [
      { text: 'Up to 10 users', included: true },
      { text: '30 GB cloud workspace', included: true },
      { text: '20 shared projects', included: true },
      { text: '25+ tool integrations', included: true },
      { text: 'Advanced collaboration', included: true },
      { text: 'Connect any AI provider available', included: true },
      { text: 'Advanced AI traffic control', included: true },
      { text: 'Priority support', included: true },
    ],
    conclusion: 'Ship faster than teams 10x your size.',
    buttonLabel: 'Start Free Trial',
    footerText: 'Upgrade anytime as your team grows.',
  },
]

/** Badge shown on a plan card based on current user plan. Starter: Founders = Most Popular; Founders: Team Scale = Recommended; Team Scale: Team Scale = Keep Going. */
function getPlanBadge(planId: PlanId, currentPlan: PlanId): string | null {
  if (currentPlan === 'free' && planId === 'pro') return 'Most Popular'
  if (currentPlan === 'pro' && planId === 'max') return 'Recommended'
  if (currentPlan === 'max' && planId === 'max') return 'Keep Going'
  return null
}

const enterprisePlan: EnterprisePlanInfo = {
  id: 'team',
  name: 'Custom Enterprise',
  description: 'Built for scale, security, and flexibility.',
  priceLabel: 'Custom Pricing',
  features: [
    { text: 'Custom number of users', included: true },
    { text: 'Flexible storage options', included: true },
    { text: 'Dedicated onboarding', included: true },
    { text: 'Priority support', included: true },
    { text: 'Advanced security options', included: true },
    { text: 'Private deployment options', included: true },
    { text: 'Connect OpenAI, Gemini, or custom models', included: true },
  ],
  buttonLabel: 'Contact Sales',
  footerText: "We tailor pricing to your team's needs.",
}

/** Legacy shape for current plan display and upgrade logic */
const plans: { id: PlanId; name: string; price: string; period: string; description: string }[] = [
  { id: 'free', name: 'Starter', price: '', period: '', description: standardPlans[0].description },
  { id: 'pro', name: 'Founders Plan', price: '15 USD', period: '/ month', description: standardPlans[1].description },
  { id: 'max', name: 'Team Scale', price: '49 USD', period: '/ month', description: standardPlans[2].description },
  { id: 'team', name: 'Custom Enterprise', price: 'Custom', period: '', description: enterprisePlan.description },
]

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

interface UsagePoint {
  date: string
  tokens: number
  requests: number
}

export function Billing() {
  const { user, logout, currentOrganization, accessToken } = useAuth()

  const freshOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )
  const convexOrg = useCachedQuery(
    `billing-org-${currentOrganization?.organizationId}`,
    freshOrg
  )

  const members = useQuery(
    api.organizations.getMembers,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )

  const usageLimits = useQuery(
    api.organizations.getUsageLimits,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )

  const [usageTimeRange, setUsageTimeRange] = useState('30d')
  const usageDateRange = useMemo(() => {
    const now = Date.now()
    const daysToSubtract = usageTimeRange === '7d' ? 7 : usageTimeRange === '30d' ? 30 : 90
    const startDate = now - daysToSubtract * 24 * 60 * 60 * 1000
    return { startDate, endDate: now }
  }, [usageTimeRange])

  const usageAggregates = useQuery(
    api.aiUsage.getAggregates,
    convexOrg?._id ? {
      organizationId: convexOrg._id,
      period: 'daily' as const,
      startDate: usageDateRange.startDate,
      endDate: usageDateRange.endDate,
    } : 'skip'
  )

  const [chartData, setChartData] = useState<UsagePoint[]>([])

  useEffect(() => {
    let cancelled = false
    void scheduleTask(() => {
      if (!usageAggregates) {
        if (!cancelled) setChartData([])
        return
      }

      const daysToShow = usageTimeRange === '7d' ? 7 : usageTimeRange === '30d' ? 30 : 90
      const dates: UsagePoint[] = []
      const now = new Date()

      for (let i = daysToShow - 1; i >= 0; i -= 1) {
        const date = new Date(now)
        date.setDate(date.getDate() - i)
        date.setHours(0, 0, 0, 0)
        dates.push({
          date: date.toISOString().split('T')[0],
          tokens: 0,
          requests: 0,
        })
      }

      const indexByDate = new Map(dates.map((point, index) => [point.date, index]))
      for (const aggregate of usageAggregates) {
        const dateStr = new Date(aggregate.periodStart).toISOString().split('T')[0]
        const index = indexByDate.get(dateStr)
        if (index === undefined) continue
        dates[index] = {
          ...dates[index],
          tokens: aggregate.totalTokens,
          requests: aggregate.requestCount,
        }
      }

      if (!cancelled) {
        setChartData(dates)
      }
    }, 'user-visible')

    return () => {
      cancelled = true
    }
  }, [usageAggregates, usageTimeRange])

  const chartTotals = useMemo(() => {
    return chartData.reduce(
      (acc, point) => {
        acc.tokens += point.tokens
        acc.requests += point.requests
        return acc
      },
      { tokens: 0, requests: 0 }
    )
  }, [chartData])

  const chartConfig: ChartConfig = {
    tokens: {
      label: 'Tokens',
      color: 'var(--chart-1)',
    },
  }

  const [stripeInvoices, setStripeInvoices] = useState<StripeInvoice[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [isUpgrading, setIsUpgrading] = useState(false)
  const [showUpgradeOptions, setShowUpgradeOptions] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const isAbortError = (error: unknown): boolean => {
      if (error instanceof DOMException) return error.name === 'AbortError'
      if (typeof error === 'object' && error !== null && 'name' in error) {
        return (error as { name?: string }).name === 'AbortError'
      }
      return false
    }

    const fetchInvoices = async () => {
      if (!currentOrganization?.organizationId || !accessToken) return

      setInvoicesLoading(true)
      try {
        const response = await fetchWithAbort(
          `${AUTH_SERVER_URL}/stripe/invoices?organizationId=${currentOrganization.organizationId}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          },
          { signal: controller.signal, timeoutMs: 15000 }
        )

        if (response.ok) {
          const data = await response.json()
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
  }, [currentOrganization?.organizationId, accessToken])

  const subscription = convexOrg?.subscription
  const currentPlan = normalizeWorkspacePlanForPricing(subscription?.plan)
  const planInfo = plans.find((p) => p.id === currentPlan) || plans[0]

  const memberCount = usageLimits?.seats.current ?? members?.length ?? 0
  const memberLimit = usageLimits?.seats.limit ?? (currentPlan === 'free' ? 1 : currentPlan === 'pro' ? 2 : currentPlan === 'max' ? 10 : -1)
  const visibleMembers = (members ?? []).slice(0, 5)
  const overflowMembers = Math.max((members?.length ?? 0) - 5, 0)

  const projectCurrent = usageLimits?.projects.current ?? 0
  const projectLimit = usageLimits?.projects.limit ?? (currentPlan === 'free' ? 1 : currentPlan === 'pro' ? 5 : currentPlan === 'max' ? 20 : -1)

  const storageCurrent = usageLimits?.storage.currentFormatted ?? '0 B'
  const storageLimit = usageLimits?.storage.limitFormatted ?? '0 B'
  const storagePercent = usageLimits?.storage.usagePercent ?? 0

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '-'
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const handleManageBilling = useCallback(async () => {
    if (!currentOrganization?.organizationId || !accessToken) return

    try {
      const response = await fetchWithAbort(`${AUTH_SERVER_URL}/stripe/create-portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          organizationId: currentOrganization.organizationId,
          returnUrl: `${window.location.origin}/workspace/billing`,
        }),
      }, { timeoutMs: 15000 })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to open billing portal')
      }

      const { url } = await response.json()
      if (url) {
        await window.electronAPI.shell.openExternal(url)
      }
    } catch (err) {
      console.error('Billing portal error:', err)
      alert(err instanceof Error ? err.message : 'Failed to open billing portal')
    }
  }, [currentOrganization?.organizationId, accessToken])

  const handleUpgrade = useCallback(async (planId: PlanId) => {
    if (!currentOrganization?.organizationId || !accessToken) return

    if (planId === 'free') {
      handleManageBilling()
      return
    }

    if (planId === 'team') {
      await window.electronAPI.shell.openExternal('https://cozea.app/contact?topic=custom-pricing')
      return
    }

    setIsUpgrading(true)
    try {
      const response = await fetchWithAbort(`${AUTH_SERVER_URL}/stripe/create-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          organizationId: currentOrganization.organizationId,
          type: 'subscription',
          plan: planId,
          successUrl: 'cozea://billing/success?type=subscription',
          cancelUrl: 'cozea://billing/canceled',
        }),
      }, { timeoutMs: 15000 })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create checkout')
      }

      const { url } = await response.json()
      if (url) {
        await window.electronAPI.shell.openExternal(url)
      }
    } catch (err) {
      console.error('Checkout error:', err)
      alert(err instanceof Error ? err.message : 'Failed to start checkout')
    } finally {
      setIsUpgrading(false)
    }
  }, [currentOrganization?.organizationId, accessToken, handleManageBilling])

  const urlParams = new URLSearchParams(window.location.search)
  const successType = urlParams.get('success')
  const wasCanceled = urlParams.get('canceled')
  const isWorkspaceLoading = !convexOrg

  const currentPlanIndex = plans.findIndex((p) => p.id === currentPlan)

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Billing' }]}
    >
      {successType && (
        <Alert className="mb-6 border-green-500/50 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-500">Subscription Updated</AlertTitle>
          <AlertDescription>
            Workspace infrastructure billing was updated. AI usage billing continues through each connected provider subscription.
          </AlertDescription>
        </Alert>
      )}

      {wasCanceled && (
        <Alert className="mb-6 border-amber-500/50 bg-amber-500/10">
          <XCircle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-500">Checkout Canceled</AlertTitle>
          <AlertDescription>
            Your checkout was canceled. No charges were made.
          </AlertDescription>
        </Alert>
      )}

      {isWorkspaceLoading && (
        <Alert className="mb-6">
          <AlertTitle>Loading billing details</AlertTitle>
          <AlertDescription>
            Workspace billing profile is still loading. Cached values remain visible.
          </AlertDescription>
        </Alert>
      )}

      <div className={[featureFlags.contentVisibility ? 'perf-contain-auto' : '', 'space-y-4'].join(' ').trim()}>
        <Card className="border-none shadow-none bg-transparent">
          <CardContent className="pt-0 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">{planInfo.name} plan</h3>
                {subscription?.status === 'active' && (
                  <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/20">
                    Active
                  </Badge>
                )}
              </div>
              <Button onClick={() => setShowUpgradeOptions(!showUpgradeOptions)}>
                {showUpgradeOptions ? 'Hide Plans' : 'Change Plan'}
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">{planInfo.description}</p>

            {(planInfo.price || planInfo.period) && (
              <div>
                <span className="text-3xl font-bold">{planInfo.price}</span>
                {planInfo.period && <span className="text-muted-foreground">{planInfo.period}</span>}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-secondary/80 dark:bg-secondary/40 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Workspace members</span>
                  <span>{memberLimit < 0 ? `${memberCount} / Unlimited` : `${memberCount} / ${memberLimit}`}</span>
                </div>
                {memberLimit > 0 && (
                  <Progress value={Math.min(100, (memberCount / Math.max(memberLimit, 1)) * 100)} className="h-2" />
                )}
              </div>

              <div className="rounded-2xl bg-secondary/80 dark:bg-secondary/40 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Projects</span>
                  <span>{projectLimit < 0 ? `${projectCurrent} / Unlimited` : `${projectCurrent} / ${projectLimit}`}</span>
                </div>
                {projectLimit > 0 && (
                  <Progress value={Math.min(100, (projectCurrent / Math.max(projectLimit, 1)) * 100)} className="h-2" />
                )}
              </div>

              <div className="rounded-2xl bg-secondary/80 dark:bg-secondary/40 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Cloud storage</span>
                  <span>{storageCurrent} / {storageLimit}</span>
                </div>
                {!usageLimits?.storage.isUnlimited && (
                  <Progress value={Math.min(100, storagePercent)} className="h-2" />
                )}
              </div>
            </div>

            <div className="flex items-center rounded-full p-1 bg-secondary/80 dark:bg-secondary/40 w-fit min-h-10">
              <div className="flex -space-x-2">
                {Array.from({ length: 5 }).map((_, index) => {
                  const memberSlot = visibleMembers[index]
                  if (!memberSlot) {
                    return (
                      <Avatar key={`placeholder-${index}`} className="ring-2 ring-border shrink-0">
                        <AvatarFallback className="text-xs font-medium bg-muted text-muted-foreground">--</AvatarFallback>
                      </Avatar>
                    )
                  }

                  const displayName = memberSlot.user?.firstName
                    ? `${memberSlot.user.firstName} ${memberSlot.user.lastName || ''}`.trim()
                    : memberSlot.user?.email

                  return (
                    <Avatar key={memberSlot._id} className="ring-2 ring-border shrink-0">
                      <AvatarImage src={memberSlot.user?.profileImageUrl} alt={displayName} />
                      <AvatarFallback className="text-xs font-medium bg-muted text-muted-foreground">
                        {(displayName || '?').slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )
                })}
              </div>
              <span
                className={[
                  'flex items-center justify-center rounded-full bg-transparent text-xs transition-all',
                  overflowMembers > 0
                    ? 'ml-1 px-2 min-w-[2rem] text-muted-foreground hover:text-foreground'
                    : 'w-0 min-w-0 px-0 overflow-hidden text-transparent select-none',
                ].join(' ')}
              >
                {overflowMembers > 0 ? `+${overflowMembers}` : '--'}
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              AI tokens are tracked for visibility only. AI provider charges are billed directly by each connected provider account.
            </p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-none bg-transparent">
          <CardContent className="pt-0">
            <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
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
                        <TableCell className="max-w-[200px] truncate">
                          {invoice.description}
                        </TableCell>
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
                          {invoice.hostedInvoiceUrl && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1"
                              onClick={() => window.electronAPI.shell.openExternal(invoice.hostedInvoiceUrl!)}
                            >
                              View
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          )}
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

        <div
          className={`grid transition-all duration-300 ease-in-out ${showUpgradeOptions ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
        >
          <div className="overflow-hidden">
            <Card className="border-none shadow-none bg-transparent">
              <CardHeader className="pt-0">
                <CardTitle>Available Plans</CardTitle>
                <CardDescription>
                  Pricing is for shared infrastructure: cloud storage, project capacity, sync, and collaboration.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Tabs defaultValue="standard" className="w-full">
                  <TabsList className="mb-6 h-10 rounded-lg bg-muted p-1 w-fit">
                    <TabsTrigger value="standard" className="rounded-md px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      Standard Plans
                    </TabsTrigger>
                    <TabsTrigger value="enterprise" className="rounded-md px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      Enterprise
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="standard" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {standardPlans.map((plan, index) => {
                        const isCurrent = plan.id === currentPlan
                        const isDowngrade = plans.findIndex((p) => p.id === plan.id) < currentPlanIndex
                        const badge = getPlanBadge(plan.id, currentPlan)
                        return (
                          <div
                            key={plan.id}
                            className={`relative flex flex-col rounded-xl border border-border bg-card p-6 shadow-sm transition-all duration-300 ${showUpgradeOptions ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'} ${badge ? 'ring-2 ring-primary/20' : ''}`}
                            style={{
                              transitionDelay: showUpgradeOptions ? `${index * 50}ms` : `${(standardPlans.length - 1 - index) * 50}ms`,
                            }}
                          >
                            {badge && (
                              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                                {badge}
                              </div>
                            )}
                            <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                            <div className="mt-4 flex items-baseline gap-1">
                              <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                              {plan.period && <span className="text-muted-foreground">{plan.period}</span>}
                            </div>
                            {plan.trial && (
                              <p className="mt-1 text-sm text-green-600 dark:text-green-400">{plan.trial}</p>
                            )}
                            <ul className="mt-5 flex-1 space-y-2.5">
                              {plan.features.map((f, i) => (
                                <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                                  {f.included ? (
                                    <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                                  ) : (
                                    <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                                  )}
                                  <span>{f.text}</span>
                                </li>
                              ))}
                            </ul>
                            <p className="mt-4 text-sm text-muted-foreground">{plan.conclusion}</p>
                            <Button
                              className="mt-5 w-full rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                              disabled={isCurrent || isUpgrading}
                              onClick={() => handleUpgrade(plan.id)}
                            >
                              {isCurrent ? 'Current Plan' : isDowngrade ? 'Downgrade' : plan.buttonLabel}
                            </Button>
                            <p className="mt-2 text-center text-xs text-muted-foreground">{plan.footerText}</p>
                          </div>
                        )
                      })}
                    </div>
                  </TabsContent>

                  <TabsContent value="enterprise" className="mt-0">
                    <div className="flex justify-center">
                      <div
                        className={`relative flex w-full max-w-md flex-col rounded-xl border border-border bg-card p-6 shadow-sm transition-all duration-300 ${showUpgradeOptions ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}
                        style={{ transitionDelay: showUpgradeOptions ? '0ms' : '0ms' }}
                      >
                        <h3 className="text-lg font-semibold text-foreground">{enterprisePlan.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{enterprisePlan.description}</p>
                        <p className="mt-4 text-3xl font-bold text-foreground">{enterprisePlan.priceLabel}</p>
                        <ul className="mt-5 flex-1 space-y-2.5">
                          {enterprisePlan.features.map((f, i) => (
                            <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                              <span>{f.text}</span>
                            </li>
                          ))}
                        </ul>
                        <Button
                          className="mt-6 w-full rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                          disabled={isUpgrading}
                          onClick={() => handleUpgrade(enterprisePlan.id)}
                        >
                          {enterprisePlan.buttonLabel}
                        </Button>
                        <p className="mt-2 text-center text-xs text-muted-foreground">{enterprisePlan.footerText}</p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="border-none shadow-none bg-transparent">
          <CardContent className="pt-0">
            <div className="rounded-2xl bg-secondary/80 dark:bg-secondary/40 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-medium">AI Token Usage</p>
                  <p className="text-sm text-muted-foreground">
                    Daily token consumption across the workspace
                  </p>
                </div>
                <Select value={usageTimeRange} onValueChange={setUsageTimeRange}>
                  <SelectTrigger className="w-[140px]" aria-label="Select time range">
                    <SelectValue placeholder="Last 30 days" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="90d" className="rounded-lg">Last 3 months</SelectItem>
                    <SelectItem value="30d" className="rounded-lg">Last 30 days</SelectItem>
                    <SelectItem value="7d" className="rounded-lg">Last 7 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ChartContainer config={chartConfig} className="aspect-auto h-[200px] w-full">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="fillTokens" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-tokens)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-tokens)" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={32}
                    tickFormatter={(value) => {
                      const date = new Date(value)
                      return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    }}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => {
                          return new Date(value).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        }}
                        indicator="dot"
                      />
                    }
                  />
                  <Area
                    dataKey="tokens"
                    type="natural"
                    fill="url(#fillTokens)"
                    stroke="var(--color-tokens)"
                  />
                </AreaChart>
              </ChartContainer>
            </div>

            <div className="mt-6 pt-6 border-t grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="font-medium">Tokens in Selected Range</p>
                <p className="text-sm text-muted-foreground">Tracking only, not billed by Cozea</p>
                <p className="text-3xl font-bold mt-1">{chartTotals.tokens.toLocaleString()}</p>
              </div>
              <div>
                <p className="font-medium">Requests in Selected Range</p>
                <p className="text-sm text-muted-foreground">All workspace AI requests</p>
                <p className="text-3xl font-bold mt-1">{chartTotals.requests.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
