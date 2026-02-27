import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useCachedQuery } from '../../stores/useQueryCache'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { AI_BASE_URL } from '../../lib/ai/apiEndpoints'
import { getProviderLogoUrl } from '../../lib/ai/providerLogos'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { Input } from '../../components/ui/input'
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
  Key,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Loader2,
  History,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

type ConnectableProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'github-copilot' | 'gitlab'
const DEFAULT_ALLOWED_PROVIDERS = ['openai', 'anthropic', 'google', 'xai'] as const

const RECOMMENDED_PROVIDER_ORDER: ConnectableProvider[] = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'github-copilot',
  'gitlab',
]

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
  | 'device'
  | 'manual_code'
  | 'vertex'
  | 'gemini'
  | 'gemini_api_key'

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

export function AI() {
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

  // Get usage summary
  const usageSummary = useQuery(
    api.organizations.getUsageSummary,
    convexOrg?._id ? { orgId: convexOrg._id, period: 'monthly' } : 'skip'
  )

  // Get recent usage history (fetch more for pagination)
  const recentUsage = useQuery(
    api.aiUsage.getRecentForOrganization,
    convexOrg?._id ? { organizationId: convexOrg._id, limit: 50 } : 'skip'
  )

  // Mutations
  const updateAiSettings = useMutation(api.organizations.updateAiSettings)

  // Dialog state for provider connection
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [openaiMethod, setOpenaiMethod] = useState<'oauth' | 'device' | 'api_key'>('oauth')
  const [anthropicMethod, setAnthropicMethod] = useState<'oauth' | 'api_key'>('api_key')
  const [googleMethod, setGoogleMethod] = useState<'vertex' | 'gemini' | 'gemini_api_key'>('gemini')
  const [providerApiKey, setProviderApiKey] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [manualAuthUrl, setManualAuthUrl] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [providerStatuses, setProviderStatuses] = useState<Record<string, LocalProviderStatus>>({})
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogRow[]>([])
  const [availableProviderMethods, setAvailableProviderMethods] = useState<Record<string, ProviderAuthMethod[]>>({})
  const [providersError, setProvidersError] = useState<string | null>(null)

  // Settings state
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false)

  // Usage history pagination
  const [usagePage, setUsagePage] = useState(0)
  const usagePageSize = 5

  // Provider table pagination
  const [providerPage, setProviderPage] = useState(0)
  const providerPageSize = 6

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
    setManualCode('')
    setManualAuthUrl(null)
    setSaveError(null)
    setConnectDialogOpen(true)
  }

  const connectProvider = async (
    provider: ConnectableProvider,
    method?: ProviderAuthMethod,
    authorizationCode?: string,
    apiKey?: string
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
      })
      if (!result.success) {
        setManualAuthUrl(result.authorizationUrl || null)
        throw new Error(result.error || 'Provider connection failed')
      }
      await refreshProviderStatuses()
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
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to disconnect provider')
    } finally {
      setIsSaving(null)
    }
  }

  // Get aggregate usage data
  const aggregate = usageSummary?.aggregate
  const totalTokens = aggregate?.totalTokens || 0
  const now = Date.now()
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
    })
  }, [providerCatalog])
  const selectedProviderInfo = selectedProvider
    ? providerRows.find((provider) => provider.id === selectedProvider)
    : undefined
  const selectedProviderMethods = selectedProvider
    ? availableProviderMethods[selectedProvider] ?? []
    : []

  const providerSupportsMethod = (method: ProviderAuthMethod): boolean => {
    if (selectedProviderMethods.length === 0) return true
    return selectedProviderMethods.includes(method)
  }

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

  const connectedProviders = providerRows.reduce((count, provider) => {
    const status = providerStatuses[provider.id]
    const effectiveConnected =
      (status?.connected ?? false) && (status?.expiresAt == null || status.expiresAt > now)
    return count + (effectiveConnected ? 1 : 0)
  }, 0)
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

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'AI' }]}
    >
      <div className="space-y-6 pb-10">
        {/* Usage Overview */}
        <div className="px-4">
          <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-border w-full">
            {/* Requests MTD */}
            <div className="sm:flex-1 px-6 py-2">
              <p className="text-sm text-muted-foreground mb-1">Requests (MTD)</p>
              <p className="text-2xl font-semibold">
                {(aggregate?.requestCount || 0).toLocaleString()}
              </p>
            </div>

            {/* Tokens MTD */}
            <div className="sm:flex-1 px-6 py-2">
              <p className="text-sm text-muted-foreground mb-1">Tokens (MTD)</p>
              <p className="text-2xl font-semibold">
                {formatTokens(totalTokens)}
              </p>
            </div>

            {/* Connected Providers */}
            <div className="sm:flex-1 px-6 py-2">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Connected Providers</p>
                  <p className="text-2xl font-semibold">{connectedProviders}/{providerRows.length}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Provider Credentials */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Local Provider Connections
            </CardTitle>
            <CardDescription>
              Provider auth is stored only on this device. No provider secrets are saved to workspace/server storage.
            </CardDescription>
            {providersError && (
              <p className="text-sm text-amber-600 dark:text-amber-400">{providersError}</p>
            )}
          </CardHeader>
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
                    const isPolicyManagedProvider =
                      provider.id === 'openai' ||
                      provider.id === 'anthropic' ||
                      provider.id === 'google' ||
                      provider.id === 'xai'
                    const isAllowed =
                      !isPolicyManagedProvider ||
                      (convexOrg?.aiSettings?.allowedProviders?.includes(provider.id as 'openai' | 'anthropic' | 'google' | 'xai') ?? true)

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
                            ) : isConnectable ? (
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
        </Card>

        {/* Usage History */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Usage History
            </CardTitle>
            <CardDescription>
              Recent AI usage across your organization
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 py-0 overflow-hidden">
            <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
              <Table className="w-full [&_th]:px-4 [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[12%]">Date</TableHead>
                    <TableHead className="w-[18%]">Provider</TableHead>
                    <TableHead className="w-[44%]">Model</TableHead>
                    <TableHead className="w-[14%] text-right">Requests</TableHead>
                    <TableHead className="w-[14%] text-right">Tokens</TableHead>
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
                        </TableRow>
                      ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                        {recentUsage === undefined
                          ? 'Loading usage history...'
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

        {/* AI Settings (Admin only) */}
        {currentOrganization?.role === 'admin' && (
          <div className="px-6">
            <h2 className="text-lg font-semibold">AI Settings</h2>
            <p className="text-sm text-muted-foreground mb-4">Configure AI features for your workspace</p>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Web Search</p>
                  <p className="text-xs text-muted-foreground">
                    Allow AI to search the web for information
                  </p>
                </div>
                <Switch
                  checked={convexOrg?.aiSettings?.allowWebSearch ?? false}
                  disabled={isUpdatingSettings}
                  onCheckedChange={async (checked) => {
                    if (!convexOrg || !convexUserId) return
                    setIsUpdatingSettings(true)
                    try {
                      await updateAiSettings({
                        orgId: convexOrg._id,
                        userId: convexUserId,
                        aiSettings: {
                          ...convexOrg.aiSettings,
                          allowedProviders: convexOrg.aiSettings?.allowedProviders || [...DEFAULT_ALLOWED_PROVIDERS],
                          allowWebSearch: checked,
                        },
                      })
                    } finally {
                      setIsUpdatingSettings(false)
                    }
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Provider Tools</p>
                  <p className="text-xs text-muted-foreground">
                    Allow AI to use provider-specific tools (code interpreter, etc.)
                  </p>
                </div>
                <Switch
                  checked={convexOrg?.aiSettings?.allowProviderTools ?? false}
                  disabled={isUpdatingSettings}
                  onCheckedChange={async (checked) => {
                    if (!convexOrg || !convexUserId) return
                    setIsUpdatingSettings(true)
                    try {
                      await updateAiSettings({
                        orgId: convexOrg._id,
                        userId: convexUserId,
                        aiSettings: {
                          ...convexOrg.aiSettings,
                          allowedProviders: convexOrg.aiSettings?.allowedProviders || [...DEFAULT_ALLOWED_PROVIDERS],
                          allowProviderTools: checked,
                        },
                      })
                    } finally {
                      setIsUpdatingSettings(false)
                    }
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Reasoning Depth</p>
                  <p className="text-xs text-muted-foreground">
                    Maximum reasoning depth for AI models
                  </p>
                </div>
                <Select
                  value={convexOrg?.aiSettings?.maxReasoningDepth || 'high'}
                  disabled={isUpdatingSettings}
                  onValueChange={async (value) => {
                    if (!convexOrg || !convexUserId) return
                    setIsUpdatingSettings(true)
                    try {
                      await updateAiSettings({
                        orgId: convexOrg._id,
                        userId: convexUserId,
                        aiSettings: {
                          ...convexOrg.aiSettings,
                          allowedProviders: convexOrg.aiSettings?.allowedProviders || [...DEFAULT_ALLOWED_PROVIDERS],
                          maxReasoningDepth: value as 'low' | 'medium' | 'high',
                        },
                      })
                    } finally {
                      setIsUpdatingSettings(false)
                    }
                  }}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
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
            {((selectedProvider === 'openai' && openaiMethod === 'api_key') ||
              (selectedProvider === 'google' && googleMethod === 'gemini_api_key') ||
              (selectedProvider === 'anthropic' && anthropicMethod === 'api_key') ||
              selectedProvider === 'xai') && (
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
                const isCustomProvider = !['openai', 'anthropic', 'google', 'xai', 'github-copilot', 'gitlab'].includes(selectedProvider)
                if (isCustomProvider) {
                  void connectProvider(selectedProvider as any, 'api_key', undefined, providerApiKey.trim())
                  return
                }
                void connectProvider(selectedProvider as any, 'oauth')
              }}
              disabled={
                !selectedProvider ||
                isSaving === selectedProvider ||
                (selectedProvider === 'openai' && openaiMethod === 'api_key' && providerApiKey.trim().length === 0) ||
                (selectedProvider === 'anthropic' && anthropicMethod === 'api_key' && providerApiKey.trim().length === 0) ||
                (selectedProvider === 'anthropic' && anthropicMethod === 'oauth' && !!manualAuthUrl && manualCode.trim().length === 0) ||
                (selectedProvider === 'xai' && providerApiKey.trim().length === 0) ||
                (!['openai', 'anthropic', 'google', 'xai', 'github-copilot', 'gitlab'].includes(selectedProvider) && providerApiKey.trim().length === 0) ||
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
    </DashboardLayout>
  )
}
