

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __AlertCircleHugeIcon, CheckmarkCircle02Icon as __CheckCircleHugeIcon, EyeIcon as __EyeHugeIcon, SquareArrowDownRightIcon as __ExternalLinkHugeIcon, ViewOffSlashIcon as __EyeOffHugeIcon } from '@hugeicons/core-free-icons'

/**
 * API Key Form Component
 *
 * Form for entering API key credentials when connecting an integration.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { IntegrationDefinition, IntegrationCredentials } from '@/lib/integrations/types'

interface ApiKeyFormProps {
  integration: IntegrationDefinition
  onSubmit: (credentials: IntegrationCredentials) => Promise<void>
  onCancel: () => void
  isSubmitting?: boolean
  error?: string
}

export function ApiKeyForm({
  integration,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: ApiKeyFormProps) {
  const fields = integration.apiKeyConfig?.fields ?? []
  const [values, setValues] = useState<Record<string, string>>({})
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')

  const handleChange = (fieldName: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldName]: value }))
    // Reset test status when values change
    if (testStatus !== 'idle') setTestStatus('idle')
  }

  const toggleShowSecret = (fieldName: string) => {
    setShowSecrets((prev) => ({ ...prev, [fieldName]: !prev[fieldName] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(values)
  }

  const isValid = fields.every((field) => {
    if (field.required) {
      return values[field.name]?.trim()
    }
    return true
  })

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map((field) => (
        <div key={field.name} className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={field.name} className="flex items-center gap-1">
              {field.label}
              {field.required && <span className="text-destructive">*</span>}
            </Label>
            {field.helpUrl && (
              <a
                href={field.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                How to get this
                <HugeiconsIcon icon={__ExternalLinkHugeIcon} className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="relative">
            <Input
              id={field.name}
              type={field.secret && !showSecrets[field.name] ? 'password' : 'text'}
              placeholder={field.placeholder}
              value={values[field.name] || ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              className={field.secret ? 'pr-10 font-mono text-sm' : 'font-mono text-sm'}
              autoComplete="off"
              spellCheck={false}
            />
            {field.secret && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => toggleShowSecret(field.name)}
              >
                {showSecrets[field.name] ? (
                  <HugeiconsIcon icon={__EyeOffHugeIcon} className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <HugeiconsIcon icon={__EyeHugeIcon} className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            )}
          </div>

          {field.helpText && (
            <p className="text-xs text-muted-foreground">{field.helpText}</p>
          )}
        </div>
      ))}

      {/* Error message */}
      {error && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Test connection status */}
      {testStatus === 'success' && (
        <Alert>
          <HugeiconsIcon icon={__CheckCircleHugeIcon} className="h-4 w-4 text-green-500" />
          <AlertDescription>Connection verified successfully!</AlertDescription>
        </Alert>
      )}

      {/* Action buttons */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={!isValid || isSubmitting}>
          {isSubmitting ? (
            <>
              <div className="loader mr-2" />
              Connecting...
            </>
          ) : (
            'Connect'
          )}
        </Button>
      </div>
    </form>
  )
}
