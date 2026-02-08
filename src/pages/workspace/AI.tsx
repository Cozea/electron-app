import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useCachedQuery } from '../../stores/useQueryCache'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Badge } from '../../components/ui/badge'
import { Switch } from '../../components/ui/switch'
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
  Sparkles,
  Loader2,
  History,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

type Provider = 'anthropic' | 'openai' | 'google'

const providerInfo: Record<Provider, { name: string; description: string; placeholder: string; models: number }> = {
  anthropic: {
    name: 'Anthropic',
    description: 'Claude 4.5 Opus, Sonnet, Haiku',
    placeholder: 'sk-ant-...',
    models: 3,
  },
  openai: {
    name: 'OpenAI',
    description: 'GPT-5.1, GPT-5.2',
    placeholder: 'sk-...',
    models: 2,
  },
  google: {
    name: 'Google AI',
    description: 'Gemini 3 Pro, Flash',
    placeholder: 'AIza...',
    models: 2,
  },
}

// Provider icons
const ProviderIcon = ({ provider, className }: { provider: Provider; className?: string }) => {
  switch (provider) {
    case 'anthropic':
      return (
        <svg viewBox="0 0 256 176" className={className} fill="currentColor">
          <path d="M147.487 0 256 176h-51.627l-22.593-38.652H123.51L147.487 0ZM66.41 0h46.592l77.166 176h-52.142L66.409 0ZM0 176 66.41 0l27.024 61.746L41.1 176H0Z" />
        </svg>
      )
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
        </svg>
      )
    case 'google':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
      )
    default:
      return <Sparkles className={className} />
  }
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
  const { user, logout, currentOrganization, convexUserId } = useAuth()

  // Get Convex organization by WorkOS ID (with caching to prevent loading flash)
  const freshOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )
  const convexOrg = useCachedQuery(
    `ai-org-${currentOrganization?.organizationId}`,
    freshOrg
  )

  // Get AI credentials status
  const credentialsStatus = useQuery(
    api.organizations.getAiCredentialsStatus,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
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
  const updateAiCredentials = useMutation(api.organizations.updateAiCredentials)
  const updateAiSettings = useMutation(api.organizations.updateAiSettings)

  // Dialog state for adding/updating keys
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Settings state
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false)

  // Usage history pagination
  const [usagePage, setUsagePage] = useState(0)
  const usagePageSize = 5

  const handleOpenKeyDialog = (provider: Provider) => {
    setSelectedProvider(provider)
    setKeyInput('')
    setSaveError(null)
    setKeyDialogOpen(true)
  }

  const handleSaveKey = async () => {
    if (!convexOrg || !convexUserId || !selectedProvider) return

    setIsSaving(true)
    setSaveError(null)

    try {
      await updateAiCredentials({
        orgId: convexOrg._id,
        userId: convexUserId,
        [selectedProvider === 'anthropic' ? 'anthropicKey' : selectedProvider === 'openai' ? 'openaiKey' : 'googleKey']: keyInput || undefined,
      })
      setKeyDialogOpen(false)
      setKeyInput('')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save API key')
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemoveKey = async (provider: Provider) => {
    if (!convexOrg || !convexUserId) return

    setIsSaving(true)
    try {
      await updateAiCredentials({
        orgId: convexOrg._id,
        userId: convexUserId,
        [provider === 'anthropic' ? 'anthropicKey' : provider === 'openai' ? 'openaiKey' : 'googleKey']: '',
      })
    } catch (err) {
      console.error('Failed to remove key:', err)
    } finally {
      setIsSaving(false)
    }
  }

  // Calculate credit usage
  const credits = convexOrg?.credits
  const subscription = convexOrg?.subscription
  const totalCredits = credits?.subscriptionCreditsTotal || 0
  const remainingCredits = credits?.subscriptionCreditsRemaining || 0
  const usedCredits = totalCredits - remainingCredits
  const usagePercent = totalCredits > 0 ? (usedCredits / totalCredits) * 100 : 0

  // Get aggregate usage data
  const aggregate = usageSummary?.aggregate
  const totalTokens = aggregate?.totalTokens || 0
  const totalCreditsUsed = aggregate?.totalCreditsUsed || 0

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'AI' }]}
    >
      <div className="space-y-6">
        {/* Subscription Status Banner */}
        {subscription?.plan === 'free' && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Free Plan</p>
                    <p className="text-sm text-muted-foreground">
                      Add your own API keys to use AI features, or upgrade for included credits.
                    </p>
                  </div>
                </div>
                <Button variant="default" size="sm" onClick={() => window.location.href = '/workspace/billing'}>
                  Upgrade to Pro
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Usage Overview */}
        <div className="px-4">
          <div className="flex flex-wrap md:flex-nowrap divide-x divide-border w-full">
            {/* Requests MTD */}
            <div className="w-1/2 md:w-auto md:flex-1 px-6 py-2">
              <p className="text-sm text-muted-foreground mb-1">Requests (MTD)</p>
              <p className="text-2xl font-semibold">
                {(aggregate?.requestCount || 0).toLocaleString()}
              </p>
            </div>

            {/* Tokens MTD */}
            <div className="w-1/2 md:w-auto md:flex-1 px-6 py-2">
              <p className="text-sm text-muted-foreground mb-1">Tokens (MTD)</p>
              <p className="text-2xl font-semibold">
                {formatTokens(totalTokens)}
              </p>
            </div>

            {/* Estimated Cost MTD */}
            <div className="w-1/2 md:w-auto md:flex-1 px-6 py-2">
              <p className="text-sm text-muted-foreground mb-1">Cost (MTD)</p>
              <p className="text-2xl font-semibold">
                {totalCreditsUsed.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">cr</span>
              </p>
            </div>

            {/* Budget Usage */}
            <div className="w-1/2 md:w-auto md:flex-1 px-6 py-2">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Budget</p>
                  <p className="text-2xl font-semibold">{Math.round(usagePercent)}%</p>
                </div>
                {/* Circular Progress */}
                <div className="relative h-10 w-10">
                  <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
                    <circle
                      cx="18" cy="18" r="16"
                      fill="none"
                      className="stroke-muted"
                      strokeWidth="3"
                    />
                    <circle
                      cx="18" cy="18" r="16"
                      fill="none"
                      className="stroke-primary"
                      strokeWidth="3"
                      strokeDasharray={`${usagePercent} 100`}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* API Keys */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Keys
            </CardTitle>
            <CardDescription>
              Connect your AI provider accounts. Keys are encrypted at rest.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 py-0 overflow-hidden">
            <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
              <Table className="w-full [&_th]:px-4 [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-1/4">Provider</TableHead>
                    <TableHead className="w-1/4">Status</TableHead>
                    <TableHead className="w-1/4">Models</TableHead>
                    <TableHead className="w-1/4 text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                  {(Object.keys(providerInfo) as Provider[]).map((provider) => {
                    const info = providerInfo[provider]
                    const status = credentialsStatus?.[provider]
                    const isConnected = status?.connected || false
                    const isAllowed = convexOrg?.aiSettings?.allowedProviders?.includes(provider) ?? true

                    return (
                      <TableRow key={provider}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                              <ProviderIcon provider={provider} className="h-4 w-4" />
                            </div>
                            <span className="font-medium">{info.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {isConnected ? (
                              <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                                <span className="h-2 w-2 rounded-full bg-green-500" />
                                Connected
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                                Not connected
                              </span>
                            )}
                            {!isAllowed && (
                              <Badge variant="outline" className="text-amber-500 ml-2">
                                Disabled
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground">{info.models} models</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isConnected && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleRemoveKey(provider)}
                                disabled={isSaving}
                              >
                                Remove
                              </Button>
                            )}
                            <Button
                              variant={isConnected ? 'outline' : 'default'}
                              size="sm"
                              onClick={() => handleOpenKeyDialog(provider)}
                            >
                              {isConnected ? 'Update' : 'Connect'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
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
            {recentUsage === undefined ? (
              <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
                <Table className="w-full [&_th]:px-4 [&_td]:px-4">
                  <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[12%]">Date</TableHead>
                      <TableHead className="w-[18%]">Provider</TableHead>
                      <TableHead className="w-[30%]">Model</TableHead>
                      <TableHead className="w-[13%] text-right">Requests</TableHead>
                      <TableHead className="w-[13%] text-right">Tokens</TableHead>
                      <TableHead className="w-[14%] text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                    {Array.from({ length: usagePageSize }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><div className="h-4 w-16 bg-muted rounded animate-pulse" /></TableCell>
                        <TableCell><div className="h-4 w-24 bg-muted rounded animate-pulse" /></TableCell>
                        <TableCell><div className="h-4 w-32 bg-muted rounded animate-pulse" /></TableCell>
                        <TableCell className="text-right"><div className="h-4 w-8 bg-muted rounded animate-pulse ml-auto" /></TableCell>
                        <TableCell className="text-right"><div className="h-4 w-12 bg-muted rounded animate-pulse ml-auto" /></TableCell>
                        <TableCell className="text-right"><div className="h-4 w-16 bg-muted rounded animate-pulse ml-auto" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : recentUsage && recentUsage.length > 0 ? (
              <>
                <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
                  <Table className="w-full [&_th]:px-4 [&_td]:px-4">
                    <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[12%]">Date</TableHead>
                        <TableHead className="w-[18%]">Provider</TableHead>
                        <TableHead className="w-[30%]">Model</TableHead>
                        <TableHead className="w-[13%] text-right">Requests</TableHead>
                        <TableHead className="w-[13%] text-right">Tokens</TableHead>
                        <TableHead className="w-[14%] text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                      {recentUsage
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
                                  provider={usage.provider as Provider}
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
                            <TableCell className="text-right">
                              <span className="text-muted-foreground">
                                {(usage.creditsUsed || 0).toFixed(2)} cr
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
                {recentUsage.length > usagePageSize && (
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
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">No usage history yet</p>
                <p className="text-sm">
                  AI usage will appear here as your team uses AI features.
                </p>
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
                          allowedProviders: convexOrg.aiSettings?.allowedProviders || ['anthropic', 'openai', 'google'],
                          byokPolicy: convexOrg.aiSettings?.byokPolicy || 'required',
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
                          allowedProviders: convexOrg.aiSettings?.allowedProviders || ['anthropic', 'openai', 'google'],
                          byokPolicy: convexOrg.aiSettings?.byokPolicy || 'required',
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
                          allowedProviders: convexOrg.aiSettings?.allowedProviders || ['anthropic', 'openai', 'google'],
                          byokPolicy: convexOrg.aiSettings?.byokPolicy || 'required',
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

      {/* API Key Dialog */}
      <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedProvider && credentialsStatus?.[selectedProvider]?.connected
                ? `Update ${providerInfo[selectedProvider]?.name} API Key`
                : `Connect ${selectedProvider ? providerInfo[selectedProvider]?.name : ''}`}
            </DialogTitle>
            <DialogDescription>
              Enter your API key. It will be encrypted and stored securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                placeholder={selectedProvider ? providerInfo[selectedProvider].placeholder : ''}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
              />
            </div>
            {saveError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {saveError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveKey} disabled={!keyInput || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
