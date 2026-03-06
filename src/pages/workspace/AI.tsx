import { useEffect, useMemo, useState } from 'react'
import {
  isManagedProviderInApp,
  isProviderEnabledInApp,
} from '@shared/aiProviderAvailability'
import type { ProviderCloudCredentials } from '@shared/electronApiTypes'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import { useAuth } from '../../contexts/AuthContext'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useCachedQuery } from '../../stores/useQueryCache'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { AI_BASE_URL } from '../../lib/ai/apiEndpoints'
import { clearModelCatalogCache } from '../../lib/ai/modelCatalogClient'
import { getProviderLogoUrl } from '../../lib/ai/providerLogos'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../../components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import {
  Key,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Loader2,
  History,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

type ConnectableProvider = string

const RECOMMENDED_PROVIDER_ORDER: ConnectableProvider[] = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'github-copilot',
  'gitlab',
]

const BUILTIN_PROVIDER_IDS = ['openai', 'anthropic', 'google', 'xai', 'github-copilot', 'gitlab'] as const

function isBuiltinProvider(providerId: string): providerId is (typeof BUILTIN_PROVIDER_IDS)[number] {
  return BUILTIN_PROVIDER_IDS.includes(providerId as (typeof BUILTIN_PROVIDER_IDS)[number])
}

const RECOMMENDED_PROVIDER_RANK = new Map<string, number>(
  RECOMMENDED_PROVIDER_ORDER.map((providerId, index) => [providerId, index])
)
interface LocalProviderStatus {
  provider: string
  connected: boolean
  expiresAt?: number
  accountId?: string
  googleMode?: 'vertex' | 'gemini'
  googleProjectId?: string
  googleLocation?: string
  cloudKind?: string
  lastError?: string
}

interface ProviderCatalogRow {
  id: string
  name: string
  logoUrl?: string
  modelCount: number
  envKeys: string[]
  authStrategies: Array<'api_key' | 'oauth' | 'cloud_credentials'>
  localConnectSupported: boolean
  description: string
}

interface ProvidersApiResponse {
  providers: ProviderCatalogRow[]
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  source?: 'models.dev' | 'cache' | 'fallback'
  updatedAt?: number
}

type ProviderAuthMethod =
  | 'oauth'
  | 'api_key'
  | 'cloud_credentials'
  | 'device'
  | 'manual_code'
  | 'vertex'
  | 'gemini'
  | 'gemini_api_key'

interface AIProps {
  surface?: 'page' | 'drawer'
}

type UsageRange = '7d' | '30d' | '90d'

interface UsagePoint {
  date: string
  tokens: number
  requests: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const UTC_DAY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const UTC_DAY_TOOLTIP_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function getUtcDayStart(value: number): number {
  const date = new Date(value)
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  )
}

function formatUtcDayKey(value: number): string {
  const date = new Date(value)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseUtcDayKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function formatCurrencyFromCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

const FALLBACK_PROVIDER_ROWS: ProviderCatalogRow[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    logoUrl: getProviderLogoUrl('openai'),
    modelCount: 0,
    envKeys: ['OPENAI_API_KEY'],
    authStrategies: ['oauth', 'api_key'],
    localConnectSupported: true,
    description: 'OAuth + API key',
  },
  {
    id: 'google',
    name: 'Google',
    logoUrl: getProviderLogoUrl('google'),
    modelCount: 0,
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
    authStrategies: ['api_key'],
    localConnectSupported: true,
    description: 'API key / Gemini OAuth / Vertex token',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    logoUrl: getProviderLogoUrl('anthropic'),
    modelCount: 0,
    envKeys: ['ANTHROPIC_API_KEY'],
    authStrategies: ['api_key'],
    localConnectSupported: true,
    description: 'API key',
  },
  {
    id: 'xai',
    name: 'xAI',
    logoUrl: getProviderLogoUrl('xai'),
    modelCount: 0,
    envKeys: ['XAI_API_KEY'],
    authStrategies: ['api_key'],
    localConnectSupported: true,
    description: 'API key',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    logoUrl: getProviderLogoUrl('github-copilot'),
    modelCount: 0,
    envKeys: [],
    authStrategies: ['oauth'],
    localConnectSupported: true,
    description: 'OAuth',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    logoUrl: getProviderLogoUrl('gitlab'),
    modelCount: 0,
    envKeys: [],
    authStrategies: ['oauth'],
    localConnectSupported: true,
    description: 'OAuth',
  },
]

function formatAuthStrategies(strategies: Array<'api_key' | 'oauth' | 'cloud_credentials'>): string {
  if (strategies.length === 0) return 'Unknown'
  return strategies
    .map((strategy) => {
      if (strategy === 'api_key') return 'API key'
      if (strategy === 'oauth') return 'OAuth'
      return 'Cloud credentials'
    })
    .join(' + ')
}

const ProviderIcon = ({
  provider,
  logoUrl,
  className,
}: {
  provider: string
  logoUrl?: string
  className?: string
}) => {
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [provider, logoUrl])

  if (imageFailed) {
    return <Sparkles className={className} />
  }

  return (
    <img
      alt={`${provider} logo`}
      className={className}
      loading="lazy"
      onError={() => setImageFailed(true)}
      src={logoUrl || getProviderLogoUrl(provider)}
    />
  )
}

// Format tokens as K/M
const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return tokens.toString()
}

const usageChartConfig: ChartConfig = {
  tokens: {
    label: 'Tokens',
    color: 'var(--chart-1)',
  },
}

export function AI({ surface = 'page' }: AIProps) {
  const { user, logout, currentOrganization, convexUserId, accessToken } = useAuth()

  // Get Convex organization by WorkOS ID (with caching to prevent loading flash)
  const freshOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )
  const convexOrg = useCachedQuery(
    `ai-org-${currentOrganization?.organizationId}`,
    freshOrg
  )

  // Get recent usage history (fetch more for pagination)
  const recentUsage = useQuery(
    api.aiUsage.getRecentForOrganization,
    convexOrg?._id ? { organizationId: convexOrg._id, limit: 50 } : 'skip'
  )

  const walletSummary = useQuery(
    api.aiWallets.getWalletForViewer,
    convexOrg?._id && convexUserId
      ? { organizationId: convexOrg._id, userId: convexUserId }
      : 'skip'
  )

  const [usageTimeRange, setUsageTimeRange] = useState<UsageRange>('30d')
  const usageDaysToShow =
    usageTimeRange === '7d' ? 7 : usageTimeRange === '30d' ? 30 : 90
  const usageDateRange = useMemo(() => {
    const currentDayStart = getUtcDayStart(Date.now())
    return {
      startDate: currentDayStart - (usageDaysToShow - 1) * DAY_MS,
      endDate: currentDayStart + DAY_MS - 1,
    }
  }, [usageDaysToShow])

  const usageAggregates = useQuery(
    api.aiUsage.getAggregates,
    convexOrg?._id
      ? {
          organizationId: convexOrg._id,
          period: 'daily' as const,
          startDate: usageDateRange.startDate,
          endDate: usageDateRange.endDate,
        }
      : 'skip'
  )

  // Dialog state for provider connection
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [openaiMethod, setOpenaiMethod] = useState<'oauth' | 'device' | 'api_key'>('oauth')
  const [anthropicMethod, setAnthropicMethod] = useState<'oauth' | 'api_key'>('api_key')
  const [googleMethod, setGoogleMethod] = useState<'vertex' | 'gemini' | 'gemini_api_key'>('gemini')
  const [providerApiKey, setProviderApiKey] = useState('')
  const [cloudCredentials, setCloudCredentials] = useState<ProviderCloudCredentials>({})
  const [manualCode, setManualCode] = useState('')
  const [manualAuthUrl, setManualAuthUrl] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [providerStatuses, setProviderStatuses] = useState<Record<string, LocalProviderStatus>>({})
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogRow[]>([])
  const [availableProviderMethods, setAvailableProviderMethods] = useState<Record<string, ProviderAuthMethod[]>>({})
  const now = Date.now()
  const [providersError, setProvidersError] = useState<string | null>(null)
  const [isManualProvidersOpen, setIsManualProvidersOpen] = useState(false)

  // Usage history pagination
  const [usagePage, setUsagePage] = useState(0)
  const usagePageSize = 5

  // Provider table pagination
  const [providerPage, setProviderPage] = useState(0)
  const providerPageSize = 6

  const setCloudCredentialField = (key: keyof ProviderCloudCredentials, value: string) => {
    setCloudCredentials((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const refreshProviderStatuses = async () => {
    if (!window.electronAPI?.providerAuth) return
    try {
      const statuses = await window.electronAPI.providerAuth.getStatus()
      const next: Record<string, LocalProviderStatus> = {}
      for (const status of statuses) {
        next[status.provider] = status as LocalProviderStatus
      }
      setProviderStatuses(next)
    } catch (err) {
      console.error('Failed to load provider status:', err)
    }
  }

  useEffect(() => {
    if (!accessToken) return

    const controller = new AbortController()
    setProvidersError(null)

    fetch(`${AI_BASE_URL}/providers?page=1&pageSize=500`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load providers (${response.status})`)
        }
        return (await response.json()) as ProvidersApiResponse
      })
      .then((payload) => {
        if (!payload?.providers?.length) {
          setProviderCatalog(FALLBACK_PROVIDER_ROWS)
          return
        }
        setProviderCatalog(payload.providers)
      })
      .catch((error) => {
        if ((error as { name?: string }).name === 'AbortError') return
        console.warn('Failed to fetch provider catalog:', error)
        setProvidersError(error instanceof Error ? error.message : 'Failed to load provider catalog')
        setProviderCatalog(FALLBACK_PROVIDER_ROWS)
      })

    return () => controller.abort()
  }, [accessToken])

  useEffect(() => {
    if (!window.electronAPI?.providerAuth) return

    window.electronAPI.providerAuth
      .listProviders()
      .then((providers) => {
        const next: Record<string, ProviderAuthMethod[]> = {}
        for (const provider of providers) {
          next[provider.provider] = provider.methods as ProviderAuthMethod[]
        }
        setAvailableProviderMethods(next)
      })
      .catch((error) => {
        console.warn('Failed to load provider auth methods:', error)
      })
  }, [])

  useEffect(() => {
    void refreshProviderStatuses()
  }, [])

  // Refresh status on focus so expired tokens show as disconnected (matches useConnectedProviders used by chat)
  useEffect(() => {
    const onFocus = () => void refreshProviderStatuses()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const handleOpenConnectDialog = (provider: string) => {
    if (!provider) return
    setSelectedProvider(provider)
    setOpenaiMethod('oauth')
    setAnthropicMethod('api_key')
    setGoogleMethod('gemini')
    setProviderApiKey('')
    setCloudCredentials({})
    setManualCode('')
    setManualAuthUrl(null)
    setSaveError(null)
    setConnectDialogOpen(true)
  }

  const invalidateModelCatalog = () => {
    if (!currentOrganization?.organizationId) return
    clearModelCatalogCache(currentOrganization.organizationId)
  }

  const connectProvider = async (
    provider: ConnectableProvider,
    method?: ProviderAuthMethod,
    authorizationCode?: string,
    apiKey?: string,
    cloudCredentialsInput?: ProviderCloudCredentials
  ) => {
    if (!window.electronAPI?.providerAuth) return
    setIsSaving(provider)
    setSaveError(null)
    try {
      const result = await window.electronAPI.providerAuth.connect({
        provider,
        method,
        authorizationCode,
        apiKey,
        cloudCredentials: cloudCredentialsInput,
      })
      if (!result.success) {
        setManualAuthUrl(result.authorizationUrl || null)
        throw new Error(result.error || 'Provider connection failed')
      }
      await refreshProviderStatuses()
      invalidateModelCatalog()
      setConnectDialogOpen(false)
      setManualCode('')
      setManualAuthUrl(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to connect provider')
    } finally {
      setIsSaving(null)
    }
  }

  const handleDisconnect = async (provider: ConnectableProvider) => {
    if (!window.electronAPI?.providerAuth) return
    setIsSaving(provider)
    setSaveError(null)
    try {
      await window.electronAPI.providerAuth.disconnect(provider)
      await refreshProviderStatuses()
      invalidateModelCatalog()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to disconnect provider')
    } finally {
      setIsSaving(null)
    }
  }

  const walletTotalDebitedCents = walletSummary?.wallet?.totalDebitedCents ?? 0
  const chartData = useMemo<UsagePoint[]>(() => {
    const dates: UsagePoint[] = []

    for (let i = 0; i < usageDaysToShow; i += 1) {
      const dayStart = usageDateRange.startDate + i * DAY_MS
      dates.push({
        date: formatUtcDayKey(dayStart),
        tokens: 0,
        requests: 0,
      })
    }

    if (!usageAggregates) {
      return dates
    }

    const indexByDate = new Map(dates.map((point, index) => [point.date, index]))
    for (const aggregate of usageAggregates) {
      const dateStr = formatUtcDayKey(aggregate.periodStart)
      const index = indexByDate.get(dateStr)
      if (index === undefined) continue
      dates[index] = {
        ...dates[index],
        tokens: aggregate.totalTokens,
        requests: aggregate.requestCount,
      }
    }

    return dates
  }, [usageAggregates, usageDateRange.startDate, usageDaysToShow])
  const usageTotals = useMemo(() => {
    return chartData.reduce(
      (totals, point) => ({
        tokens: totals.tokens + point.tokens,
        requests: totals.requests + point.requests,
      }),
      { tokens: 0, requests: 0 }
    )
  }, [chartData])
  const providerRows = useMemo(() => {
    const rows = providerCatalog.length > 0 ? providerCatalog : FALLBACK_PROVIDER_ROWS

    return [...rows].sort((a, b) => {
      const aRank = RECOMMENDED_PROVIDER_RANK.get(a.id)
      const bRank = RECOMMENDED_PROVIDER_RANK.get(b.id)
      const aIsRecommended = aRank !== undefined
      const bIsRecommended = bRank !== undefined

      if (aIsRecommended && bIsRecommended) {
        return aRank - bRank
      }
      if (aIsRecommended) return -1
      if (bIsRecommended) return 1

      return a.name.localeCompare(b.name)
    }).filter((provider) => {
      if (!isProviderEnabledInApp(provider.id)) return false
      return !isManagedProviderInApp(provider.id)
    })
  }, [providerCatalog])
  const selectedProviderInfo = selectedProvider
    ? providerRows.find((provider) => provider.id === selectedProvider)
    : undefined
  const selectedProviderMethods = selectedProvider
    ? availableProviderMethods[selectedProvider] ?? []
    : []
  const selectedProviderAuthStrategies = selectedProviderInfo?.authStrategies ?? []
  const selectedProviderUsesCloudCredentials =
    selectedProviderAuthStrategies.includes('cloud_credentials') ||
    selectedProviderMethods.includes('cloud_credentials') ||
    selectedProvider === 'amazon-bedrock' ||
    selectedProvider === 'google-vertex' ||
    selectedProvider === 'google-vertex-anthropic' ||
    selectedProvider === 'azure' ||
    selectedProvider === 'azure-cognitive-services' ||
    selectedProvider === 'sap-ai-core'
  const isCustomSelectedProvider = selectedProvider ? !isBuiltinProvider(selectedProvider) : false
  const requiresApiKeyInput =
    (isCustomSelectedProvider && !selectedProviderUsesCloudCredentials) ||
    (selectedProvider === 'xai') ||
    (selectedProvider === 'openai' && openaiMethod === 'api_key') ||
    (selectedProvider === 'google' && googleMethod === 'gemini_api_key') ||
    (selectedProvider === 'anthropic' && anthropicMethod === 'api_key')

  const requiresCloudCredentialInput = selectedProviderUsesCloudCredentials
  const hasCloudValue = (value?: string) => typeof value === 'string' && value.trim().length > 0
  const hasCloudCredentialsInput =
    hasCloudValue(cloudCredentials.projectId) ||
    hasCloudValue(cloudCredentials.region) ||
    hasCloudValue(cloudCredentials.profile) ||
    hasCloudValue(cloudCredentials.baseUrl) ||
    hasCloudValue(cloudCredentials.apiKey) ||
    hasCloudValue(cloudCredentials.apiToken) ||
    hasCloudValue(cloudCredentials.token) ||
    hasCloudValue(cloudCredentials.accessKeyId) ||
    hasCloudValue(cloudCredentials.secretAccessKey) ||
    hasCloudValue(cloudCredentials.serviceKey)

  const providerSupportsMethod = (method: ProviderAuthMethod): boolean => {
    if (selectedProviderMethods.length === 0) return true
    return selectedProviderMethods.includes(method)
  }

  useEffect(() => {
    if (!selectedProvider) return
    if (!isProviderEnabledInApp(selectedProvider) || isManagedProviderInApp(selectedProvider)) {
      setSelectedProvider(null)
      setConnectDialogOpen(false)
    }
  }, [selectedProvider])

  useEffect(() => {
    if (selectedProvider === 'openai') {
      const fallback: Array<typeof openaiMethod> = ['oauth', 'device', 'api_key']
      const supported = fallback.filter((item) => providerSupportsMethod(item))
      if (supported.length > 0 && !supported.includes(openaiMethod)) {
        setOpenaiMethod(supported[0])
      }
    }

    if (selectedProvider === 'anthropic') {
      const fallback: Array<typeof anthropicMethod> = ['api_key', 'oauth']
      const supported = fallback.filter((item) => providerSupportsMethod(item))
      if (supported.length > 0 && !supported.includes(anthropicMethod)) {
        setAnthropicMethod(supported[0])
      }
    }

    if (selectedProvider === 'google') {
      const fallback: Array<typeof googleMethod> = ['gemini', 'gemini_api_key', 'vertex']
      const supported = fallback.filter((item) => providerSupportsMethod(item))
      if (supported.length > 0 && !supported.includes(googleMethod)) {
        setGoogleMethod(supported[0])
      }
    }
  }, [anthropicMethod, googleMethod, openaiMethod, selectedProvider, selectedProviderMethods])

  const pagedProviderRows = providerRows.slice(
    providerPage * providerPageSize,
    (providerPage + 1) * providerPageSize
  )

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(providerRows.length / providerPageSize) - 1)
    if (providerPage > maxPage) {
      setProviderPage(maxPage)
    }
  }, [providerPage, providerRows.length])

  const content = (
    <>
      <div
        className={
        surface === 'drawer'
          ? 'mx-auto w-full max-w-6xl space-y-6 px-6 py-6'
          : 'space-y-6 pb-10'
      }
    >
        <Card className="border-none shadow-none bg-transparent">
          <CardContent className="pt-0 px-0">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="font-medium">AI Token Usage</p>
                <p className="text-sm text-muted-foreground">
                  Daily token consumption across this workspace
                </p>
              </div>
              <Select
                value={usageTimeRange}
                onValueChange={(value) =>
                  setUsageTimeRange(value === '7d' || value === '90d' ? value : '30d')
                }
              >
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

            <div className="rounded-2xl bg-secondary/80 dark:bg-secondary/40 p-5">

              <ChartContainer config={usageChartConfig} className="aspect-auto h-[200px] w-full">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="fillAiTokens" x1="0" y1="0" x2="0" y2="1">
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
                    tickFormatter={(value) =>
                      UTC_DAY_LABEL_FORMATTER.format(parseUtcDayKey(String(value)))
                    }
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) =>
                          UTC_DAY_TOOLTIP_FORMATTER.format(parseUtcDayKey(String(value)))
                        }
                        indicator="dot"
                      />
                    }
                  />
                  <Area
                    dataKey="tokens"
                    type="natural"
                    fill="url(#fillAiTokens)"
                    stroke="var(--color-tokens)"
                  />
                </AreaChart>
              </ChartContainer>

              <div className="mt-4 flex justify-end">
                <div className="flex w-full max-w-md items-center justify-end text-right">
                  <div className="flex items-baseline gap-2 pr-4">
                    <p className="text-xl font-semibold tabular-nums">
                      {usageTotals.requests.toLocaleString()}
                    </p>
                    <p className="text-sm font-medium text-muted-foreground">
                      Requests
                    </p>
                  </div>
                  <div className="flex items-baseline gap-2 border-l border-border/60 pl-4">
                    <p className="text-xl font-semibold tabular-nums">
                      {formatTokens(usageTotals.tokens)}
                    </p>
                    <p className="text-sm font-medium text-muted-foreground">
                      Tokens
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Usage History */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader className="px-0">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Usage History
            </CardTitle>
            <CardDescription>
              Recent AI usage across your organization
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 py-0 overflow-hidden">
            <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
              <Table className="w-full [&_th]:px-4 [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[12%]">Date</TableHead>
                    <TableHead className="w-[18%]">Provider</TableHead>
                    <TableHead className="w-[36%]">Model</TableHead>
                    <TableHead className="w-[10%] text-right">Requests</TableHead>
                    <TableHead className="w-[12%] text-right">Tokens</TableHead>
                    <TableHead className="w-[12%] text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                  {(recentUsage ?? []).length > 0 ? (
                    (recentUsage ?? [])
                      .slice(usagePage * usagePageSize, (usagePage + 1) * usagePageSize)
                      .map((usage) => (
                        <TableRow key={usage._id}>
                          <TableCell className="text-muted-foreground">
                            {new Date(usage.timestamp).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <ProviderIcon
                                provider={usage.provider}
                                className="h-4 w-4"
                              />
                              <span className="capitalize">{usage.provider}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-sm">{usage.model}</span>
                          </TableCell>
                          <TableCell className="text-right">1</TableCell>
                          <TableCell className="text-right">
                            {(usage.totalTokens || 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {typeof usage.debitCents === 'number'
                              ? formatCurrencyFromCents(usage.debitCents)
                              : usage.keySource === 'provider_auth'
                                ? 'BYO'
                                : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                        {recentUsage === undefined
                          ? 'Loading usage history...'
                          : walletTotalDebitedCents > 0
                            ? 'Wallet charges exist but usage rows are missing. The AI usage ingestion route may not be deployed on your server yet.'
                            : 'No usage history yet. AI usage will appear here as your team uses AI features.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {recentUsage && recentUsage.length > usagePageSize && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border/60">
                <span className="text-sm text-muted-foreground">
                  {usagePage * usagePageSize + 1}-{Math.min((usagePage + 1) * usagePageSize, recentUsage.length)} of {recentUsage.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => setUsagePage(p => p - 1)}
                    disabled={usagePage === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => setUsagePage(p => p + 1)}
                    disabled={(usagePage + 1) * usagePageSize >= recentUsage.length}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {providerRows.length > 0 && (
        <Collapsible open={isManualProvidersOpen} onOpenChange={setIsManualProvidersOpen}>
          <Card className="border-none shadow-none bg-transparent">
            <CardHeader>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="group flex w-full items-start justify-between gap-4 text-left"
                >
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      <Key className="h-5 w-5" />
                      Manual Provider Connections
                    </CardTitle>
                    <CardDescription className="mt-2">
                      Connect non-managed providers with your own credentials. Cozea-managed providers are handled automatically.
                    </CardDescription>
                    {providersError && (
                      <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">{providersError}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors group-hover:border-border group-hover:text-foreground">
                    <span>{isManualProvidersOpen ? 'Hide' : 'Show'}</span>
                    <span>{providerRows.length}</span>
                    <ChevronRight
                      className={`h-3.5 w-3.5 transition-transform duration-200 ${isManualProvidersOpen ? 'rotate-90' : ''}`}
                    />
                  </div>
                </button>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
              <CardContent className="px-4 py-0 overflow-hidden">
                <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
              <Table className="w-full [&_th]:px-4 [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-1/5">Provider</TableHead>
                    <TableHead className="w-1/5">Status</TableHead>
                    <TableHead className="w-1/5">Models</TableHead>
                    <TableHead className="w-1/5">Auth Options</TableHead>
                    <TableHead className="w-1/5 text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-border/60 [&_tr:last-child]:border-b-0">
                  {pagedProviderRows.map((provider) => {
                    const status = providerStatuses[provider.id]
                    const isConnectable = provider.localConnectSupported
                    // Use same logic as useConnectedProviders: connected only if not expired (so AI page matches chat model list)
                    const isConnected =
                      isConnectable &&
                      (status?.connected ?? false) &&
                      (status?.expiresAt == null || status.expiresAt > now)
                    const isPolicyManagedProvider = isManagedProviderInApp(provider.id)
                    const isAllowed =
                      !isPolicyManagedProvider ||
                      (
                        convexOrg?.aiSettings?.allowedProviders?.includes(
                          provider.id as 'openai' | 'anthropic' | 'google' | 'xai' | 'moonshotai'
                        ) ?? true
                      )

                    return (
                      <TableRow key={provider.id} className="last:border-b-0">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                              <ProviderIcon provider={provider.id} logoUrl={provider.logoUrl} className="h-4 w-4" />
                            </div>
                            <span className="font-medium">{provider.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 flex-wrap">
                            {isConnected ? (
                              <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Connected
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                                Not connected
                              </span>
                            )}
                          </div>
                          {status?.lastError && (
                            <p className="text-xs text-amber-500 mt-1">{status.lastError}</p>
                          )}
                          {status?.cloudKind && (
                            <p className="text-xs text-muted-foreground mt-1">Cloud: {status.cloudKind}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-muted-foreground">
                            <p>{provider.modelCount.toLocaleString()} models</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-muted-foreground">
                            <p>{formatAuthStrategies(provider.authStrategies)}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {!isAllowed ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled
                              >
                                Disabled
                              </Button>
                            ) : isPolicyManagedProvider ? null : isConnectable ? (
                              isConnected ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => void handleDisconnect(provider.id as ConnectableProvider)}
                                  disabled={isSaving === provider.id}
                                >
                                  Disconnect
                                </Button>
                              ) : (
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => handleOpenConnectDialog(provider.id)}
                                  disabled={isSaving === provider.id}
                                >
                                  Connect
                                </Button>
                              )
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled
                              >
                                Coming soon
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {providerRows.length > providerPageSize && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  {providerPage * providerPageSize + 1}-
                  {Math.min((providerPage + 1) * providerPageSize, providerRows.length)} of {providerRows.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => setProviderPage((p) => p - 1)}
                    disabled={providerPage === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => setProviderPage((p) => p + 1)}
                    disabled={(providerPage + 1) * providerPageSize >= providerRows.length}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

      </div>

      {/* Provider Connection Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Connect {selectedProviderInfo?.name || 'Provider'}
            </DialogTitle>
            <DialogDescription>
              Auth is stored locally on this device using OS-backed encryption.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedProvider === 'openai' && (
              <div className="space-y-2">
                <p className="text-sm font-medium">OpenAI method</p>
                <Select
                  value={openaiMethod}
                  onValueChange={(value) => setOpenaiMethod(value as 'oauth' | 'device' | 'api_key')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providerSupportsMethod('oauth') && (
                      <SelectItem value="oauth">OAuth (ChatGPT account)</SelectItem>
                    )}
                    {providerSupportsMethod('device') && (
                      <SelectItem value="device">Device code (no callback)</SelectItem>
                    )}
                    {providerSupportsMethod('api_key') && (
                      <SelectItem value="api_key">API key (local)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
            {selectedProvider === 'anthropic' && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Anthropic method</p>
                <Select
                  value={anthropicMethod}
                  onValueChange={(value) => setAnthropicMethod(value as 'oauth' | 'api_key')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providerSupportsMethod('api_key') && (
                      <SelectItem value="api_key">API key (local)</SelectItem>
                    )}
                    {providerSupportsMethod('oauth') && (
                      <SelectItem value="oauth">OAuth</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
            {selectedProvider === 'google' && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Google source</p>
                <Select
                  value={googleMethod}
                  onValueChange={(value) =>
                    setGoogleMethod(value as 'vertex' | 'gemini' | 'gemini_api_key')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providerSupportsMethod('gemini') && (
                      <SelectItem value="gemini">Gemini OAuth (Google account)</SelectItem>
                    )}
                    {providerSupportsMethod('gemini_api_key') && (
                      <SelectItem value="gemini_api_key">API key (local)</SelectItem>
                    )}
                    {providerSupportsMethod('vertex') && (
                      <SelectItem value="vertex">Vertex local token source</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
            {requiresApiKeyInput && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">API key</p>
                <p className="text-xs text-muted-foreground pb-1">
                  Stored only on this device with OS-backed encryption.
                </p>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="Paste API key"
                  className="bg-secondary/60 border-border/50"
                  value={providerApiKey}
                  onChange={(e) => setProviderApiKey(e.target.value)}
                />
              </div>
            )}
            {requiresCloudCredentialInput && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Cloud credentials</p>
                {selectedProvider === 'amazon-bedrock' && (
                  <>
                    <Input
                      placeholder="AWS region (for example us-east-1)"
                      value={cloudCredentials.region || ''}
                      onChange={(event) => setCloudCredentialField('region', event.target.value)}
                    />
                    <Input
                      placeholder="AWS profile (optional)"
                      value={cloudCredentials.profile || ''}
                      onChange={(event) => setCloudCredentialField('profile', event.target.value)}
                    />
                    <Input
                      placeholder="AWS access key id (optional)"
                      value={cloudCredentials.accessKeyId || ''}
                      onChange={(event) => setCloudCredentialField('accessKeyId', event.target.value)}
                    />
                    <Input
                      type="password"
                      placeholder="AWS secret access key (optional)"
                      value={cloudCredentials.secretAccessKey || ''}
                      onChange={(event) => setCloudCredentialField('secretAccessKey', event.target.value)}
                    />
                    <Input
                      type="password"
                      placeholder="AWS bearer token (optional)"
                      value={cloudCredentials.token || ''}
                      onChange={(event) => setCloudCredentialField('token', event.target.value)}
                    />
                  </>
                )}
                {(selectedProvider === 'google-vertex' || selectedProvider === 'google-vertex-anthropic') && (
                  <>
                    <Input
                      placeholder="Google Cloud project ID"
                      value={cloudCredentials.projectId || ''}
                      onChange={(event) => setCloudCredentialField('projectId', event.target.value)}
                    />
                    <Input
                      placeholder="Location (optional, for example us-east5)"
                      value={cloudCredentials.location || ''}
                      onChange={(event) => setCloudCredentialField('location', event.target.value)}
                    />
                  </>
                )}
                {(selectedProvider === 'azure' || selectedProvider === 'azure-cognitive-services') && (
                  <>
                    <Input
                      placeholder="Azure base URL"
                      value={cloudCredentials.baseUrl || ''}
                      onChange={(event) => setCloudCredentialField('baseUrl', event.target.value)}
                    />
                    <Input
                      type="password"
                      placeholder="Azure API key"
                      value={cloudCredentials.apiKey || ''}
                      onChange={(event) => setCloudCredentialField('apiKey', event.target.value)}
                    />
                    <Input
                      type="password"
                      placeholder="Azure bearer token (optional)"
                      value={cloudCredentials.token || ''}
                      onChange={(event) => setCloudCredentialField('token', event.target.value)}
                    />
                    <Input
                      placeholder="API version (optional)"
                      value={cloudCredentials.apiVersion || ''}
                      onChange={(event) => setCloudCredentialField('apiVersion', event.target.value)}
                    />
                  </>
                )}
                {selectedProvider === 'sap-ai-core' && (
                  <>
                    <Input
                      placeholder="SAP AI Core base URL (optional)"
                      value={cloudCredentials.baseUrl || ''}
                      onChange={(event) => setCloudCredentialField('baseUrl', event.target.value)}
                    />
                    <Input
                      placeholder="SAP AI Core service key JSON"
                      value={cloudCredentials.serviceKey || ''}
                      onChange={(event) => setCloudCredentialField('serviceKey', event.target.value)}
                    />
                  </>
                )}
              </div>
            )}
            {(selectedProvider === 'google' || (selectedProvider === 'anthropic' && anthropicMethod === 'oauth')) && manualAuthUrl && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Manual code fallback</p>
                <p className="text-xs text-muted-foreground">
                  Automatic callback failed. Open the auth page, then paste the authorization code.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void window.electronAPI.shell.openExternal(manualAuthUrl)}
                >
                  Open {selectedProvider === 'google' ? 'Google' : 'Anthropic'} Auth Page
                </Button>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="Paste authorization code"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                />
              </div>
            )}
            {saveError && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {saveError}
                </div>
                {selectedProvider === 'openai' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void connectProvider('openai', 'device')}
                    disabled={isSaving === 'openai'}
                  >
                    Try OpenAI Device Auth
                  </Button>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedProvider) return
                if (selectedProvider === 'openai') {
                  if (openaiMethod === 'api_key') {
                    void connectProvider('openai', 'api_key', undefined, providerApiKey.trim())
                    return
                  }
                  void connectProvider('openai', openaiMethod)
                  return
                }
                if (selectedProvider === 'google') {
                  if (googleMethod === 'gemini_api_key') {
                    void connectProvider('google', 'gemini_api_key', undefined, providerApiKey.trim())
                    return
                  }
                  if (manualAuthUrl && manualCode.trim()) {
                    void connectProvider('google', 'gemini', manualCode.trim())
                    return
                  }
                  void connectProvider('google', googleMethod)
                  return
                }
                if (selectedProvider === 'anthropic') {
                  if (anthropicMethod === 'api_key') {
                    void connectProvider('anthropic', 'api_key', undefined, providerApiKey.trim())
                    return
                  }
                  if (manualAuthUrl && manualCode.trim()) {
                    void connectProvider('anthropic', 'manual_code', manualCode.trim())
                    return
                  }
                  void connectProvider('anthropic', 'oauth')
                  return
                }
                if (selectedProvider === 'xai') {
                  void connectProvider('xai', 'api_key', undefined, providerApiKey.trim())
                  return
                }
                if (selectedProviderUsesCloudCredentials) {
                  void connectProvider(selectedProvider, 'cloud_credentials', undefined, undefined, cloudCredentials)
                  return
                }
                const isCustomProvider = !isBuiltinProvider(selectedProvider)
                if (isCustomProvider) {
                  void connectProvider(selectedProvider, 'api_key', undefined, providerApiKey.trim())
                  return
                }
                void connectProvider(selectedProvider, 'oauth')
              }}
              disabled={
                !selectedProvider ||
                isSaving === selectedProvider ||
                (requiresApiKeyInput && providerApiKey.trim().length === 0) ||
                (requiresCloudCredentialInput && !hasCloudCredentialsInput) ||
                (selectedProvider === 'anthropic' && anthropicMethod === 'oauth' && !!manualAuthUrl && manualCode.trim().length === 0) ||
                (selectedProvider === 'google' &&
                  googleMethod === 'gemini_api_key' &&
                  providerApiKey.trim().length === 0) ||
                (selectedProvider === 'google' &&
                  !!manualAuthUrl &&
                  manualCode.trim().length === 0)
              }
            >
              {isSaving === selectedProvider ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  if (surface === 'drawer') {
    return content
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Settings' }, { label: 'AI' }]}
    >
      {content}
    </DashboardLayout>
  )
}
