

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __AlertCircleHugeIcon, ArrowMoveUpLeftIcon as __FileUpHugeIcon, Refresh01Icon as __Loader2HugeIcon } from '@hugeicons/core-free-icons'

/**
 * Service Account Form Component
 *
 * Form for connecting integrations that require a service account JSON file
 * (e.g. Firebase Admin / Google Cloud).
 */

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { IntegrationCredentials, IntegrationDefinition } from '@/lib/integrations/types'

interface ServiceAccountFormProps {
  integration: IntegrationDefinition
  onSubmit: (credentials: IntegrationCredentials) => Promise<void>
  onCancel: () => void
  isSubmitting?: boolean
  error?: string
}

interface ParsedServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
}

function parseServiceAccountJson(content: string): ParsedServiceAccount {
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    throw new Error('Invalid JSON file')
  }

  const obj = json as Record<string, unknown>
  const projectId =
    (typeof obj.project_id === 'string' && obj.project_id) ||
    (typeof obj.projectId === 'string' && obj.projectId) ||
    ''
  const clientEmail =
    (typeof obj.client_email === 'string' && obj.client_email) ||
    (typeof obj.clientEmail === 'string' && obj.clientEmail) ||
    ''
  const privateKey =
    (typeof obj.private_key === 'string' && obj.private_key) ||
    (typeof obj.privateKey === 'string' && obj.privateKey) ||
    ''

  if (!projectId) throw new Error('Missing project_id in service account JSON')
  if (!clientEmail) throw new Error('Missing client_email in service account JSON')
  if (!privateKey) throw new Error('Missing private_key in service account JSON')

  return { projectId, clientEmail, privateKey }
}

export function ServiceAccountForm({
  integration,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: ServiceAccountFormProps) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [projectId, setProjectId] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const requiredProjectId = integration.serviceAccountConfig?.fields?.some(
    (f) => f.name === 'projectId' && f.required
  )

  const handleFile = async (file: File | null) => {
    setLocalError(null)
    setFileName(null)
    setClientEmail('')
    setPrivateKey('')

    if (!file) return
    setFileName(file.name)

    try {
      const text = await file.text()
      const parsed = parseServiceAccountJson(text)
      setClientEmail(parsed.clientEmail)
      setPrivateKey(parsed.privateKey)
      if (!projectId.trim()) setProjectId(parsed.projectId)
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to read service account JSON')
    }
  }

  const isValid = useMemo(() => {
    if (requiredProjectId && !projectId.trim()) return false
    return !!projectId.trim() && !!clientEmail.trim() && !!privateKey.trim()
  }, [clientEmail, privateKey, projectId, requiredProjectId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    await onSubmit({
      projectId: projectId.trim(),
      clientEmail: clientEmail.trim(),
      privateKey,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="service-account-project-id" className="flex items-center gap-1">
          Project ID
          {requiredProjectId && <span className="text-destructive">*</span>}
        </Label>
        <Input
          id="service-account-project-id"
          placeholder="my-firebase-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="font-mono text-sm"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          This should match the <span className="font-mono">project_id</span> inside your service account JSON.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="service-account-json" className="flex items-center gap-1">
            Service account JSON <span className="text-destructive">*</span>
          </Label>
        </div>
        <Input
          id="service-account-json"
          type="file"
          accept={integration.serviceAccountConfig?.fileUpload?.accept || '.json'}
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <HugeiconsIcon icon={__FileUpHugeIcon} className="h-3.5 w-3.5" />
          <span className="truncate">
            {fileName ? `Loaded ${fileName}` : 'Upload a service account JSON file'}
          </span>
        </div>

        {clientEmail ? (
          <div className="text-xs text-muted-foreground">
            Client email: <span className="font-mono">{clientEmail}</span>
          </div>
        ) : null}
      </div>

      {/* Error message */}
      {(localError || error) && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-4 w-4" />
          <AlertDescription>{localError || error}</AlertDescription>
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
              <HugeiconsIcon icon={__Loader2HugeIcon} className="h-4 w-4 mr-2 animate-spin" />
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

