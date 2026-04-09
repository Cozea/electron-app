/**
 * Integration Card Component
 *
 * Displays an integration in a card format, either as a connected
 * integration or as an available integration to connect.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IntegrationIcon } from './IntegrationIcon'
import {
  IntegrationStatusBadge,
  IntegrationComingSoonBadge,
  IntegrationBetaBadge,
} from './IntegrationStatusBadge'
import { ArrowPathIcon as RefreshCw, ArrowTopRightOnSquareIcon as ExternalLink, Cog6ToothIcon as Settings, TrashIcon as Trash2 } from "@heroicons/react/24/outline"
import { cn } from '@/lib/utils'
import type { IntegrationDefinition, ConnectedIntegration } from '@/lib/integrations/types'

interface IntegrationCardProps {
  integration: IntegrationDefinition
  connected?: ConnectedIntegration
  onConnect?: () => void
  onDisconnect?: () => void
  onSettings?: () => void
  onReauth?: () => void
  isConnecting?: boolean
  disabled?: boolean
}

export function IntegrationCard({
  integration,
  connected,
  onConnect,
  onDisconnect,
  onSettings,
  onReauth,
  isConnecting,
  disabled,
}: IntegrationCardProps) {
  const isConnected = !!connected
  const isComingSoon = integration.isComingSoon
  const needsReauth = connected?.status === 'needs_reauth'

  return (
    <Card
      className={cn(
        'relative transition-all',
        isConnected && 'border-primary/50 bg-primary/5',
        isComingSoon && 'opacity-60',
        disabled && 'opacity-50 pointer-events-none'
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50">
              <IntegrationIcon provider={integration.id} size="lg" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {integration.name}
                {integration.isBeta && <IntegrationBetaBadge size="sm" />}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {integration.category.replace('_', ' ')}
              </CardDescription>
            </div>
          </div>

          {/* Status badges */}
          <div className="flex items-center gap-2">
            {isComingSoon && <IntegrationComingSoonBadge size="sm" />}
            {isConnected && connected && <IntegrationStatusBadge status={connected.status} size="sm" />}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{integration.description}</p>

        {/* Connected account info */}
        {isConnected && connected?.externalAccountName && (
          <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
            <span>Connected as</span>
            <span className="font-medium text-foreground">{connected.externalAccountName}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              {needsReauth ? (
                <Button size="sm" variant="default" onClick={onReauth} className="flex-1">
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Reconnect
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={onSettings} className="flex-1">
                  <Settings className="h-4 w-4 mr-1" />
                  Settings
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onDisconnect}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : isComingSoon ? (
            <Button size="sm" variant="outline" disabled className="flex-1">
              Coming Soon
            </Button>
          ) : (
            <Button
              size="sm"
              variant="default"
              onClick={onConnect}
              disabled={isConnecting || disabled}
              className="flex-1"
            >
              {isConnecting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          )}

          {/* External link to docs */}
          <Button size="sm" variant="ghost" asChild>
            <a href={integration.docsUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
