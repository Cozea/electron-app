/**
 * Integrations Page
 *
 * Allows users to connect and manage external service integrations
 * for their workspace. Agents can use these integrations to build
 * production-grade applications.
 */

import { useState, useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IntegrationConnectDialog } from '@/components/integrations'
import { IntegrationIcon } from '@/components/integrations/IntegrationIcon'
import { useIntegrations } from '@/hooks/useIntegrations'
import {
  INTEGRATIONS,
  getIntegrationsGroupedByCategory,
  CATEGORY_INFO,
} from '@/lib/integrations/registry'
import type {
  IntegrationDefinition,
  IntegrationCategory,
  IntegrationCredentials,
} from '@/lib/integrations/types'
import { Plus, Loader2, Filter, Plug } from 'lucide-react'

type FilterType = 'all' | 'connected' | 'disconnected'

export function Integrations() {
  const { user, logout } = useAuth()
  const {
    integrations: connectedIntegrations,
    isLoading,
    connect,
    disconnect,
    startOAuth,
    connectingProvider,
    connectError,
    clearConnectError,
  } = useIntegrations()

  const [filter, setFilter] = useState<FilterType>('all')
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationDefinition | null>(null)
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false)

  // Group integrations by category
  const groupedIntegrations = useMemo(() => getIntegrationsGroupedByCategory(), [])

  // Get connected integration for a provider
  const getConnectedIntegration = (providerId: string) => {
    return connectedIntegrations.find((i) => i.provider === providerId)
  }

  // Filter integrations based on connection status
  const filterIntegrations = (integrations: IntegrationDefinition[]) => {
    if (filter === 'connected') {
      return integrations.filter((i) => getConnectedIntegration(i.id))
    }
    if (filter === 'disconnected') {
      return integrations.filter((i) => !getConnectedIntegration(i.id))
    }
    return integrations
  }

  // Handle connect click
  const handleConnectClick = (integration: IntegrationDefinition) => {
    setSelectedIntegration(integration)
    clearConnectError()
    setIsConnectDialogOpen(true)
  }

  // Handle toggle
  const handleToggle = (integration: IntegrationDefinition, checked: boolean) => {
    if (checked) {
      handleConnectClick(integration)
    } else {
      const conn = getConnectedIntegration(integration.id)
      if (conn) disconnect(conn._id)
    }
  }

  // Handle connect submit
  const handleConnect = async (credentials: IntegrationCredentials) => {
    if (!selectedIntegration) return

    await connect(selectedIntegration.id, credentials)

    // Close dialog on success (no error)
    if (!connectError) {
      setIsConnectDialogOpen(false)
      setSelectedIntegration(null)
    }
  }

  // Handle OAuth start
  const handleStartOAuth = async () => {
    if (!selectedIntegration) return
    await startOAuth(selectedIntegration.id)
  }

  // Handle dialog close
  const handleDialogClose = (open: boolean) => {
    if (!open) {
      setSelectedIntegration(null)
      clearConnectError()
    }
    setIsConnectDialogOpen(open)
  }

  const categories = Object.keys(CATEGORY_INFO) as IntegrationCategory[]

  // Check if there are any integrations to show after filtering
  const hasFilteredIntegrations = categories.some(
    (category) => filterIntegrations(groupedIntegrations[category]).length > 0
  )

  // Get filter label
  const getFilterLabel = () => {
    switch (filter) {
      case 'connected': return 'Connected'
      case 'disconnected': return 'Disconnected'
      default: return 'All'
    }
  }

  const headerContent = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">CLI Tools</h1>
        {INTEGRATIONS.length > 0 && (
          <Badge variant="secondary" className="text-xs font-normal">
            {connectedIntegrations.length}/{INTEGRATIONS.length}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Filter Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 h-8 px-2 text-xs">
              <Plug className="h-3.5 w-3.5" />
              {getFilterLabel()}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setFilter('all')}>All</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilter('connected')}>Connected</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilter('disconnected')}>Disconnected</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button className="gap-2 h-8 px-2 text-xs" onClick={() => setFilter('disconnected')}>
          <Plus className="h-3.5 w-3.5" />
          Add Integration
        </Button>
      </div>
    </div>
  )

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'CLI Tools' }]}
      header={headerContent}
    >
      {/* Loading state */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !hasFilteredIntegrations ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">
            {filter === 'connected'
              ? 'No integrations connected yet.'
              : filter === 'disconnected'
                ? 'All integrations are connected!'
                : 'No integrations available.'}
          </p>
        </div>
      ) : (
        /* Category sections */
        <div className="space-y-8">
          {categories.map((category) => {
            const categoryIntegrations = filterIntegrations(groupedIntegrations[category])
            if (categoryIntegrations.length === 0) return null

            return (
              <div key={category}>
                {/* Category header */}
                <div className="mb-4">
                  <h2 className="text-lg font-semibold">{CATEGORY_INFO[category].label}</h2>
                  <p className="text-sm text-muted-foreground">
                    {CATEGORY_INFO[category].description}
                  </p>
                </div>

                {/* Integration cards grid */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {categoryIntegrations.map((integration) => {
                    const connected = getConnectedIntegration(integration.id)
                    const isConnected = !!connected
                    const isConnecting = connectingProvider === integration.id

                    return (
                      <div
                        key={integration.id}
                        className="rounded-lg border bg-card flex flex-col"
                      >
                        {/* Top: icon, name, description */}
                        <div className="flex items-start gap-3 p-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                            <IntegrationIcon provider={integration.id} size="lg" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-medium text-sm">{integration.name}</h3>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {integration.description}
                            </p>
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="border-t" />

                        {/* Bottom: buttons and toggle */}
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => handleConnectClick(integration)}
                            >
                              Details
                            </Button>
                            {isConnected && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs text-destructive hover:text-destructive"
                                onClick={() => {
                                  if (connected) disconnect(connected._id)
                                }}
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                          <Switch
                            checked={isConnected}
                            disabled={isConnecting || integration.isComingSoon}
                            onCheckedChange={(checked) => handleToggle(integration, checked)}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {/* Empty placeholder cards to fill the row */}
                  {Array.from({
                    length: (3 - (categoryIntegrations.length % 3)) % 3,
                  }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="rounded-lg border border-dashed bg-muted/20 p-4 hidden lg:block"
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Connect dialog */}
      <IntegrationConnectDialog
        integration={selectedIntegration}
        open={isConnectDialogOpen}
        onOpenChange={handleDialogClose}
        onConnect={handleConnect}
        onStartOAuth={handleStartOAuth}
        isConnecting={!!connectingProvider}
        error={connectError || undefined}
      />
    </DashboardLayout>
  )
}
