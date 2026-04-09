/**
 * Integrations Page
 *
 * Allows users to connect and manage external service integrations
 * for their workspace. Agents can use these integrations to build
 * production-grade applications.
 */

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IntegrationConnectDialog } from '@/components/integrations'
import { IntegrationIcon } from '@/components/integrations/IntegrationIcon'
import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'
import { useScopedIntegrationsData } from '@/hooks/useScopedIntegrationsData'
import {
  getIntegrationsGroupedByCategory,
  CATEGORY_INFO,
} from '@/lib/integrations/registry'
import type {
  IntegrationDefinition,
  IntegrationCategory,
  IntegrationCredentials,
} from '@/lib/integrations/types'
import { PlusIcon as Plus, PuzzlePieceIcon as Plug } from "@heroicons/react/24/outline"

type FilterType = 'all' | 'connected' | 'disconnected'

const VISIBLE_INTEGRATION_CATEGORIES: IntegrationCategory[] = (
  Object.keys(CATEGORY_INFO) as IntegrationCategory[]
).filter((category) => category !== 'version_control')

interface IntegrationsProps {
  surface?: 'page' | 'drawer'
  route?: string
}

export function Integrations({ surface = 'page', route }: IntegrationsProps) {
  const {
    settingsPage,
    integrations: connectedIntegrations,
    connect,
    disconnect,
    startOAuth,
    connectingProvider,
    connectError,
    clearConnectError,
  } = useScopedIntegrationsData({ route })

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

  const categories = VISIBLE_INTEGRATION_CATEGORIES

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

  const integrationControls = (
    <div className="flex items-center gap-2">
      {/* Filter Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2 h-7 px-2 text-xs rounded-full">
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

      <Button className="gap-2 h-7 px-2 text-xs rounded-full" onClick={() => setFilter('disconnected')}>
        <Plus className="h-3.5 w-3.5" />
        Add Integration
      </Button>
    </div>
  )

  const content = (
    <div
      className={
        surface === 'drawer'
          ? 'mx-auto w-full max-w-6xl space-y-8 px-6 py-6'
          : 'max-w-6xl space-y-8 px-6 pt-6 pb-8'
      }
    >
      {integrationControls}
        {!hasFilteredIntegrations ? (
          <div className="rounded-2xl bg-secondary/60 px-4 py-10 text-center text-muted-foreground">
            {filter === 'connected'
              ? 'No integrations connected yet.'
              : filter === 'disconnected'
                ? 'All integrations are connected!'
                : 'No integrations available.'}
          </div>
        ) : (
          categories.map((category) => {
            const categoryIntegrations = filterIntegrations(groupedIntegrations[category])
            if (categoryIntegrations.length === 0) return null

            return (
              <div key={category}>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold">{CATEGORY_INFO[category].label}</h2>
                  <p className="text-sm text-muted-foreground">
                    {CATEGORY_INFO[category].description}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {categoryIntegrations.map((integration) => {
                    const connected = getConnectedIntegration(integration.id)
                    const isConnected = !!connected
                    const isConnecting = connectingProvider === integration.id

                    return (
                      <div
                        key={integration.id}
                        className="rounded-2xl bg-secondary/80 dark:bg-secondary/40 flex flex-col"
                      >
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

                        <div className="h-px bg-transparent" />

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
                  {Array.from({
                    length: (3 - (categoryIntegrations.length % 3)) % 3,
                  }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="rounded-2xl bg-secondary/30 dark:bg-secondary/15 p-4 hidden lg:block"
                    />
                  ))}
                </div>
              </div>
            )
          })
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
    </div>
  )

  if (surface === 'drawer') {
    return settingsPage.isWorkspaceAccessDenied
      ? (
        <WorkspaceAccessNotice
          title="CLI tools access required"
          description="You do not have permission to view workspace CLI tools and integrations."
        />
      )
      : content
  }

  return settingsPage.isWorkspaceAccessDenied ? (
    <WorkspaceAccessNotice
      title="CLI tools access required"
      description="You do not have permission to view workspace CLI tools and integrations."
    />
  ) : (
    content
  )
}
