/**
 * Integration Connect Dialog
 *
 * Dialog for connecting a new integration. Handles both API key
 * and OAuth based authentication flows.
 */

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { IntegrationIcon } from './IntegrationIcon'
import { ApiKeyForm } from './ApiKeyForm'
import { ServiceAccountForm } from './ServiceAccountForm'
import { Logo } from '@/components/Logo'
import { ArrowPathIcon as Loader2, ArrowTopRightOnSquareIcon as ExternalLink, ExclamationCircleIcon as AlertCircle } from "@heroicons/react/24/outline"
import type { IntegrationDefinition, IntegrationCredentials } from '@/lib/integrations/types'

interface IntegrationConnectDialogProps {
  integration: IntegrationDefinition | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnect: (credentials: IntegrationCredentials) => Promise<void>
  onStartOAuth?: () => Promise<void>
  oauthHint?: {
    title: string
    description: string
  }
  isConnecting?: boolean
  error?: string
}

export function IntegrationConnectDialog({
  integration,
  open,
  onOpenChange,
  onConnect,
  onStartOAuth,
  oauthHint,
  isConnecting,
  error,
}: IntegrationConnectDialogProps) {
  const [showCredentialsForm, setShowCredentialsForm] = useState(false)

  if (!integration) return null

  const handleCancel = () => {
    setShowCredentialsForm(false)
    onOpenChange(false)
  }

  const handleOAuthClick = async () => {
    if (onStartOAuth) {
      await onStartOAuth()
    }
  }

  const handleConnectClick = () => {
    if (integration.authType === 'oauth') {
      handleOAuthClick()
    } else {
      setShowCredentialsForm(true)
    }
  }

  // Reset form state when dialog closes
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setShowCredentialsForm(false)
    }
    onOpenChange(open)
  }

  // Show credentials form for API key / service account
  if (showCredentialsForm && integration.authType !== 'oauth') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
                <IntegrationIcon provider={integration.id} size="lg" />
              </div>
              <div>
                <DialogTitle>Connect {integration.name}</DialogTitle>
                <DialogDescription className="text-xs">
                  Enter your API credentials
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="mt-4">
            {integration.authType === 'api_key' && integration.apiKeyConfig && (
              <ApiKeyForm
                integration={integration}
                onSubmit={onConnect}
                onCancel={handleCancel}
                isSubmitting={isConnecting}
                error={error}
              />
            )}

            {integration.authType === 'service_account' && (
              <ServiceAccountForm
                integration={integration}
                onSubmit={onConnect}
                onCancel={handleCancel}
                isSubmitting={isConnecting}
                error={error}
              />
            )}
          </div>

          {integration.setupGuideUrl && (
            <div className="mt-4 pt-4 border-t">
              <a
                href={integration.setupGuideUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                Need help? View the setup guide
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    )
  }

  // Main connection prompt with logo visualization
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="sr-only">
          <DialogTitle>Connect {integration.name}</DialogTitle>
          <DialogDescription>Connect {integration.name} to Cozea</DialogDescription>
        </DialogHeader>

        {/* Logo connection visualization */}
        <div className="flex items-center justify-center gap-4 py-8">
          {/* Cozea logo */}
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 shadow-sm">
            <Logo size={36} />
          </div>

          {/* Connection line */}
          <div className="flex items-center gap-1">
            <div className="w-8 h-0.5 bg-border rounded-full" />
            <div className="w-2 h-2 rounded-full bg-border" />
            <div className="w-8 h-0.5 bg-border rounded-full" />
          </div>

          {/* Integration logo */}
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 shadow-sm">
            <IntegrationIcon provider={integration.id} size="xl" />
          </div>
        </div>

        {/* Title and description */}
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Connect {integration.name}</h2>
          <p className="text-sm text-muted-foreground px-4">
            {integration.authType === 'oauth'
              ? `Allow Cozea to access your ${integration.name} account to enable seamless integration.`
              : `Connect your ${integration.name} account to Cozea to enable seamless integration.`}
          </p>
        </div>

        {integration.authType === 'oauth' && oauthHint ? (
          <div className="rounded-xl border border-border/60 bg-secondary/40 px-4 py-3">
            <p className="text-sm font-medium">{oauthHint.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{oauthHint.description}</p>
          </div>
        ) : null}

        {/* Error message */}
        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2 mt-6">
          <Button
            size="lg"
            onClick={handleConnectClick}
            disabled={isConnecting || integration.isComingSoon}
            className="w-full"
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : integration.authType === 'oauth' ? (
              `Connect to ${integration.name}`
            ) : (
              `Connect ${integration.name}`
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={handleCancel}
            disabled={isConnecting}
            className="w-full text-muted-foreground"
          >
            Not now
          </Button>
        </div>

        {/* Help link */}
        {integration.setupGuideUrl && (
          <div className="mt-4 pt-4 text-center">
            <a
              href={integration.setupGuideUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Need help? View the setup guide
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
