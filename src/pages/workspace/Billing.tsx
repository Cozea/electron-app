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
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { normalizeWorkspacePlanForPricing, type WorkspacePricingPlanId } from '@/lib/billing/planLabels'
import { scheduleTask } from '@/lib/scheduler'
import { fetchWithAbort } from '@/lib/abort'
import { featureFlags } from '@/lib/featureFlags'

const AUTH_SERVER_URL = import.meta.env.VITE_AUTH_SERVER_URL || 'https://crosscode-auth-gateway-production.up.railway.app'

type PlanId = WorkspacePricingPlanId

interface PlanInfo {
  id: PlanId
  name: string
  price: string
  period: string
  description: string
  features: string[]
}

const plans: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    price: '',
    period: '',
    description: 'Solo usage with your own connected AI provider accounts.',
    features: [
      '1 member, 1 GB cloud storage, 1 project.',
      'Realtime collaboration and auto-sync not included.',
    ],
  },
  {
    id: 'pro',
    name: 'Power Duo',
    price: '$15',
    period: '/month',
    description: 'Infrastructure plan for a 2-person workspace.',
    features: [
      'Up to 2 members, 5 GB cloud storage, up to 5 projects.',
      'Unlimited realtime collaboration and auto sync (Git engine).',
    ],
  },
  {
    id: 'max',
    name: 'Winning Team',
    price: '$49',
    period: '/month',
    description: 'Scaled collaborative workspace for teams up to 10.',
    features: [
      'Up to 10 members, 30 GB cloud storage, up to 20 projects.',
      'Unlimited realtime collaboration, auto sync, and premium support.',
    ],
  },
  {
    id: 'team',
    name: 'Custom',
    price: 'Custom',
    period: '',
    description: 'Custom limits and infrastructure terms for larger workspaces.',
    features: [
      'Custom member, storage, and project limits.',
      'Priority onboarding and support SLA.',
    ],
  },
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
      theme: {
        light: 'hsl(217 91% 60%)',
        dark: 'hsl(217 91% 70%)',
      },
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
      await window.electronAPI.shell.openExternal('mailto:sales@cozea.com?subject=Custom%20Workspace%20Plan')
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
                      <Avatar key={`placeholder-${index}`} className="ring-secondary/80 dark:ring-secondary/40 ring-2">
                        <AvatarFallback className="text-xs font-medium bg-zinc-200 dark:bg-zinc-700 text-foreground">--</AvatarFallback>
                      </Avatar>
                    )
                  }

                  const displayName = memberSlot.user?.firstName
                    ? `${memberSlot.user.firstName} ${memberSlot.user.lastName || ''}`.trim()
                    : memberSlot.user?.email

                  return (
                    <Avatar key={memberSlot._id} className="ring-secondary/80 dark:ring-secondary/40 ring-2">
                      <AvatarImage src={memberSlot.user?.profileImageUrl} alt={displayName} />
                      <AvatarFallback className="text-xs font-medium bg-zinc-200 dark:bg-zinc-700 text-foreground">
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {plans.map((plan, index) => {
                    const isCurrent = plan.id === currentPlan
                    const isDowngrade = plans.findIndex((p) => p.id === plan.id) < currentPlanIndex

                    return (
                      <div
                        key={plan.id}
                        className={`relative rounded-2xl bg-secondary/80 dark:bg-secondary/40 p-5 flex flex-col transition-all duration-300 shadow-none ${showUpgradeOptions
                          ? 'opacity-100 translate-y-0'
                          : 'opacity-0 -translate-y-4'
                          }`}
                        style={{
                          transitionDelay: showUpgradeOptions ? `${index * 50}ms` : `${(plans.length - 1 - index) * 50}ms`,
                        }}
                      >
                        <div className="flex items-baseline gap-2 mb-3">
                          <span className="text-lg font-semibold">{plan.name}</span>
                          {(plan.price || plan.period) && (
                            <span className="text-muted-foreground">
                              {plan.price}{plan.period}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          {plan.description}
                        </p>
                        <div className="text-xs text-muted-foreground space-y-1.5 mb-4 flex-1">
                          {plan.features.map((feature) => (
                            <p key={feature}>{feature}</p>
                          ))}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-fit bg-foreground/14 hover:bg-foreground/18 disabled:opacity-100 disabled:bg-foreground/14"
                          disabled={isCurrent || isUpgrading}
                          onClick={() => handleUpgrade(plan.id)}
                        >
                          {isCurrent
                            ? 'Current Plan'
                            : plan.id === 'team'
                              ? 'Contact Sales'
                              : isDowngrade
                                ? 'Downgrade'
                                : `Upgrade to ${plan.name}`}
                        </Button>
                      </div>
                    )
                  })}
                </div>
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

        <Card className="border-none shadow-none bg-transparent">
          <CardHeader className="pt-0">
            <CardTitle>Invoice History</CardTitle>
            <CardDescription>
              View and download your past invoices
            </CardDescription>
          </CardHeader>
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
      </div>
    </DashboardLayout>
  )
}
