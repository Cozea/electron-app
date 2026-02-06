import { useState, useCallback, useEffect, useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useCachedQuery } from '../../stores/useQueryCache'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'

const AUTH_SERVER_URL = import.meta.env.VITE_AUTH_SERVER_URL || 'https://crosscode-auth-gateway-production.up.railway.app'
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
  Loader2,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from 'lucide-react'

interface PlanInfo {
  id: string
  name: string
  price: string
  period: string
  credits: number
  features: string[]
}

const plans: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '/month',
    credits: 0,
    features: ['Use your own API keys', 'Unlimited projects', '2 team members', 'Basic support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$20',
    period: '/month',
    credits: 5000,
    features: ['5,000 AI credits/month', 'Unlimited projects', '10 team members', 'Priority support'],
  },
  {
    id: 'max',
    name: 'Max',
    price: '$50',
    period: '/month',
    credits: 15000,
    features: ['15,000 AI credits/month', 'Unlimited projects', '25 team members', 'Priority support'],
  },
  {
    id: 'team',
    name: 'Team',
    price: '$40',
    period: '/seat/month',
    credits: 10000,
    features: ['10,000 credits per seat', 'Unlimited projects', 'Unlimited members', 'Dedicated support'],
  },
]

const creditPacks = [
  { id: 'starter', name: 'Starter', credits: 1000, price: '$12' },
  { id: 'plus', name: 'Plus', credits: 5000, price: '$50' },
  { id: 'pro', name: 'Pro', credits: 15000, price: '$120' },
  { id: 'max', name: 'Max', credits: 50000, price: '$350' },
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

export function Billing() {
  const { user, logout, currentOrganization, accessToken } = useAuth()

  // Get Convex organization by WorkOS ID (with caching to prevent loading flash)
  const freshOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )
  const convexOrg = useCachedQuery(
    `billing-org-${currentOrganization?.organizationId}`,
    freshOrg
  )

  // Get members count
  const members = useQuery(
    api.organizations.getMembers,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )

  // Stripe invoices state
  const [stripeInvoices, setStripeInvoices] = useState<StripeInvoice[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)

  // Get credit lots (purchased credits)
  const creditLots = useQuery(
    api.billing.getCreditLots,
    convexOrg?._id ? { organizationId: convexOrg._id } : 'skip'
  )

  // Usage chart state
  const [usageTimeRange, setUsageTimeRange] = useState('30d')

  // Calculate date range for usage query
  const usageDateRange = useMemo(() => {
    const now = Date.now()
    const daysToSubtract = usageTimeRange === '7d' ? 7 : usageTimeRange === '30d' ? 30 : 90
    const startDate = now - daysToSubtract * 24 * 60 * 60 * 1000
    return { startDate, endDate: now }
  }, [usageTimeRange])

  // Get daily usage aggregates
  const usageAggregates = useQuery(
    api.aiUsage.getAggregates,
    convexOrg?._id ? {
      organizationId: convexOrg._id,
      period: 'daily' as const,
      startDate: usageDateRange.startDate,
      endDate: usageDateRange.endDate,
    } : 'skip'
  )

  // Transform usage data for chart
  const chartData = useMemo(() => {
    if (!usageAggregates) return []

    // Create a map of all dates in the range
    const daysToShow = usageTimeRange === '7d' ? 7 : usageTimeRange === '30d' ? 30 : 90
    const dates: { date: string; credits: number }[] = []
    const now = new Date()

    for (let i = daysToShow - 1; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      date.setHours(0, 0, 0, 0)
      dates.push({
        date: date.toISOString().split('T')[0],
        credits: 0,
      })
    }

    // Fill in actual usage data
    for (const aggregate of usageAggregates) {
      const dateStr = new Date(aggregate.periodStart).toISOString().split('T')[0]
      const found = dates.find(d => d.date === dateStr)
      if (found) {
        found.credits = aggregate.totalCreditsUsed
      }
    }

    return dates
  }, [usageAggregates, usageTimeRange])

  // Chart config
  const chartConfig: ChartConfig = {
    credits: {
      label: 'Credits Used',
      theme: {
        light: 'hsl(240 5% 34%)',
        dark: 'hsl(0 0% 85%)',
      },
    },
  }

  const [isUpgrading, setIsUpgrading] = useState(false)
  const [showUpgradeOptions, setShowUpgradeOptions] = useState(false)

  // Fetch Stripe invoices
  useEffect(() => {
    const fetchInvoices = async () => {
      if (!currentOrganization?.organizationId || !accessToken) return

      setInvoicesLoading(true)
      try {
        const response = await fetch(
          `${AUTH_SERVER_URL}/stripe/invoices?organizationId=${currentOrganization.organizationId}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )

        if (response.ok) {
          const data = await response.json()
          setStripeInvoices(data.invoices || [])
        }
      } catch (err) {
        console.error('Failed to fetch invoices:', err)
      } finally {
        setInvoicesLoading(false)
      }
    }

    fetchInvoices()
  }, [currentOrganization?.organizationId, accessToken])

  const subscription = convexOrg?.subscription
  const credits = convexOrg?.credits
  const currentPlan = subscription?.plan || 'free'
  const planInfo = plans.find(p => p.id === currentPlan)

  // Credit calculations
  const subscriptionCreditsRemaining = credits?.subscriptionCreditsRemaining ?? 0

  // Purchased credits from active lots
  const purchasedCreditsRemaining = creditLots
    ?.filter(lot => lot.status === 'active')
    .reduce((sum, lot) => sum + lot.remainingCredits, 0) ?? 0

  const totalCreditsRemaining = subscriptionCreditsRemaining + purchasedCreditsRemaining

  // Member counts
  const memberCount = members?.length ?? 0
  const memberLimit = currentPlan === 'free' ? 2 : currentPlan === 'pro' ? 10 : currentPlan === 'max' ? 25 : -1

  // Format date
  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '—'
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Handle Stripe portal for managing billing
  const handleManageBilling = useCallback(async () => {
    if (!currentOrganization?.organizationId || !accessToken) return

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/stripe/create-portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          organizationId: currentOrganization.organizationId,
          returnUrl: `${window.location.origin}/workspace/billing`,
        }),
      })

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

  // Handle plan upgrade via Stripe Checkout (redirect)
  const handleUpgrade = useCallback(async (planId: string) => {
    if (!currentOrganization?.organizationId || !accessToken) return

    // Free plan / downgrade - use portal
    if (planId === 'free') {
      handleManageBilling()
      return
    }

    setIsUpgrading(true)
    try {
      const response = await fetch(`${AUTH_SERVER_URL}/stripe/create-checkout`, {
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
      })

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

  // Handle credit pack purchase via Stripe Checkout (redirect)
  const handleBuyCredits = useCallback(async (packId: string) => {
    if (!currentOrganization?.organizationId || !accessToken) return

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/stripe/create-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          organizationId: currentOrganization.organizationId,
          type: 'credits',
          packType: packId,
          successUrl: 'cozea://billing/success?type=credits',
          cancelUrl: 'cozea://billing/canceled',
        }),
      })

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
    }
  }, [currentOrganization?.organizationId, accessToken])

  // Check for success/cancel query params from Stripe redirect
  const urlParams = new URLSearchParams(window.location.search)
  const successType = urlParams.get('success')
  const wasCanceled = urlParams.get('canceled')

  const isLoading = !convexOrg

  if (isLoading) {
    return (
      <DashboardLayout
        user={user}
        onLogout={logout}
        breadcrumbs={[{ label: 'Workspace' }, { label: 'Billing' }]}
      >
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Billing' }]}
    >
      {/* Success/Cancel Alerts */}
      {successType && (
        <Alert className="mb-6 border-green-500/50 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-500">
            {successType === 'subscription' ? 'Subscription Updated!' : 'Credits Purchased!'}
          </AlertTitle>
          <AlertDescription>
            {successType === 'subscription'
              ? 'Your subscription has been updated. Your new credits are now available.'
              : 'Your credits have been added to your account and are ready to use.'}
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

      <div className="space-y-4">
        {/* Current Plan */}
        <Card className="border-none shadow-none bg-transparent">
          <CardContent className="pt-0">
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">{planInfo?.name} plan</h3>
                {subscription?.status === 'active' && (
                  <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/20">
                    Active
                  </Badge>
                )}
              </div>
              <Button onClick={() => setShowUpgradeOptions(!showUpgradeOptions)}>
                {showUpgradeOptions ? 'Hide Plans' : 'Upgrade Plan'}
              </Button>
            </div>

            {/* Description */}
            <p className="text-sm text-muted-foreground mb-4">
              {planInfo?.features[0]}
            </p>

            {/* Price */}
            <div className="mb-6">
              <span className="text-3xl font-bold">{planInfo?.price}</span>
              <span className="text-muted-foreground">{planInfo?.period}</span>
            </div>

            {/* Team Usage */}
            {memberLimit > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Team Usage</span>
                  <span className="text-muted-foreground">{memberCount} of {memberLimit} seats</span>
                </div>
                <Progress value={(memberCount / memberLimit) * 100} className="h-2" />
                {/* Member Avatars */}
                {members && members.length > 0 && (
                  <div className="flex items-center rounded-full p-1 shadow-sm bg-background w-fit">
                    <div className="flex -space-x-2">
                      {members.slice(0, 4).map((member) => {
                        const displayName = member.user?.firstName
                          ? `${member.user.firstName} ${member.user.lastName || ''}`.trim()
                          : member.user?.email
                        return (
                          <Avatar key={member._id} className="ring-background ring-2">
                            <AvatarImage src={member.user?.profileImageUrl} alt={displayName} />
                            <AvatarFallback className="text-xs">
                              {(displayName || '?').slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )
                      })}
                    </div>
                    {members.length > 4 && (
                      <span className="text-muted-foreground hover:text-foreground flex items-center justify-center rounded-full bg-transparent px-2 text-xs">
                        +{members.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {memberLimit < 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Team Usage</span>
                  <span className="text-muted-foreground">{memberCount} members (unlimited)</span>
                </div>
                {/* Member Avatars */}
                {members && members.length > 0 && (
                  <div className="flex items-center rounded-full p-1 shadow-sm bg-background w-fit">
                    <div className="flex -space-x-2">
                      {members.slice(0, 4).map((member) => {
                        const displayName = member.user?.firstName
                          ? `${member.user.firstName} ${member.user.lastName || ''}`.trim()
                          : member.user?.email
                        return (
                          <Avatar key={member._id} className="ring-background ring-2">
                            <AvatarImage src={member.user?.profileImageUrl} alt={displayName} />
                            <AvatarFallback className="text-xs">
                              {(displayName || '?').slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )
                      })}
                    </div>
                    {members.length > 4 && (
                      <span className="text-muted-foreground hover:text-foreground flex items-center justify-center rounded-full bg-transparent px-2 text-xs">
                        +{members.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upgrade Options (collapsible with animation) */}
        <div
          className={`grid transition-all duration-300 ease-in-out ${showUpgradeOptions ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
        >
          <div className="overflow-hidden">
            <Card className="border-none shadow-none bg-transparent">
              <CardHeader className="pt-0">
                <CardTitle>Available Plans</CardTitle>
                <CardDescription>
                  Choose a plan that fits your needs
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {plans.map((plan, index) => {
                    const isCurrent = plan.id === currentPlan
                    const isDowngrade = plans.findIndex(p => p.id === plan.id) < plans.findIndex(p => p.id === currentPlan)

                    const descriptions: Record<string, string> = {
                      free: 'Use your own API keys with unlimited projects and basic support.',
                      pro: 'Get 5,000 AI credits monthly with priority support and more team members.',
                      max: 'Get 15,000 AI credits monthly with extended team size and priority support.',
                      team: 'Scale with 10,000 credits per seat, unlimited members, and dedicated support.',
                    }

                    return (
                      <div
                        key={plan.id}
                        className={`relative rounded-2xl bg-card p-5 flex flex-col transition-all duration-300 ${isCurrent ? 'shadow-md' : 'shadow-sm'
                          } ${showUpgradeOptions
                            ? 'opacity-100 translate-y-0'
                            : 'opacity-0 -translate-y-4'
                          }`}
                        style={{
                          transitionDelay: showUpgradeOptions ? `${index * 50}ms` : `${(plans.length - 1 - index) * 50}ms`,
                        }}
                      >
                        {isCurrent && (
                          <Badge className="absolute top-3 right-3">Current</Badge>
                        )}
                        <div className="flex items-baseline gap-2 mb-3">
                          <span className="text-lg font-semibold">{plan.name}</span>
                          <span className="text-muted-foreground">
                            {plan.price}{plan.period}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground flex-1 mb-4">
                          {descriptions[plan.id]}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-fit"
                          disabled={isCurrent || isUpgrading}
                          onClick={() => handleUpgrade(plan.id)}
                        >
                          {isCurrent ? 'Current Plan' : isDowngrade ? 'Downgrade' : `Upgrade to ${plan.name}`}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Credits & Usage */}
        <Card className="border-none shadow-none bg-transparent">
          <CardContent className="pt-0">
            {/* Usage Chart */}
            <div className="rounded-2xl bg-secondary/80 dark:bg-secondary/40 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-medium">Usage Over Time</p>
                  <p className="text-sm text-muted-foreground">
                    Daily credit consumption
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
                    <linearGradient id="fillCredits" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-credits)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-credits)" stopOpacity={0.1} />
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
                    dataKey="credits"
                    type="natural"
                    fill="url(#fillCredits)"
                    stroke="var(--color-credits)"
                  />
                </AreaChart>
              </ChartContainer>
            </div>

            {/* Total Credits Summary */}
            <div className="mt-6 pt-6 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Total Available Credits</p>
                  <p className="text-sm text-muted-foreground">
                    Subscription + purchased credits
                  </p>
                </div>
                <p className="text-3xl font-bold">{totalCreditsRemaining.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Buy Credits */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle>Buy Credits</CardTitle>
            <CardDescription>
              Purchase additional credits that never expire (valid for 12 months)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {creditPacks.map((pack) => (
                <Card key={pack.id} className="cursor-pointer hover:border-primary transition-colors">
                  <CardContent className="pt-4 text-center">
                    <p className="text-2xl font-bold">{pack.credits.toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground mb-3">credits</p>
                    <p className="text-lg font-semibold mb-3">{pack.price}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleBuyCredits(pack.id)}
                    >
                      Buy {pack.name}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Invoice History */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader className="pt-0">
            <CardTitle>Invoice History</CardTitle>
            <CardDescription>
              View and download your past invoices
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {invoicesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : stripeInvoices.length > 0 ? (
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
                    {stripeInvoices.map((invoice) => (
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
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No invoices yet</p>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  )
}
