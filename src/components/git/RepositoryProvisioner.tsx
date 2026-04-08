import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConvex } from 'convex/react'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type {
  RepositoryDescriptor,
  RepositoryOwnerDescriptor,
} from '@shared/electronApiTypes'
import {
  invalidateProviderRepositoryManagementCache,
  listConnectedRepositories,
  listConnectedRepositoryOwners,
} from '@/lib/git/providerRepositoryManagement'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, RefreshCw } from 'lucide-react'

type RepositoryProvider = 'github'
type RepositoryOwnerWithProvider = RepositoryOwnerDescriptor & { provider: RepositoryProvider }

interface RepositoryProvisionerProps {
  provider: RepositoryProvider
  organizationId?: Id<'organizations'> | null
  integrationConnected: boolean
  setupMode: 'personal' | 'organization'
  selectedRepoUrl?: string
  suggestedRepoName?: string
  visibility?: string
  onRepositorySelected: (repository: RepositoryDescriptor) => void
  compactTable?: boolean
}

function getPreferredOwner(
  owners: RepositoryOwnerDescriptor[],
  setupMode: 'personal' | 'organization'
): RepositoryOwnerDescriptor | undefined {
  if (setupMode === 'organization') {
    return owners.find((owner) => owner.kind !== 'user') ?? owners[0]
  }

  return owners.find((owner) => owner.kind === 'user') ?? owners[0]
}

export function RepositoryProvisioner({
  provider,
  organizationId,
  integrationConnected,
  setupMode,
  selectedRepoUrl,
  suggestedRepoName: _suggestedRepoName,
  visibility: _visibility,
  onRepositorySelected,
  compactTable = false,
}: RepositoryProvisionerProps) {
  const convex = useConvex()
  const { convexUserId } = useAuth()
  const [owners, setOwners] = useState<RepositoryOwnerWithProvider[]>([])
  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [repositories, setRepositories] = useState<RepositoryDescriptor[]>([])
  const [isLoadingOwners, setIsLoadingOwners] = useState(false)
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedOwner = useMemo(
    () => owners.find((owner) => owner.id === selectedOwnerId) ?? null,
    [owners, selectedOwnerId]
  )

  const loadOwners = useCallback(async (bypassCache = false) => {
    if (!organizationId || !convexUserId || !integrationConnected) {
      setOwners([])
      setSelectedOwnerId('')
      return
    }

    setIsLoadingOwners(true)
    setError(null)
    try {
      const loadedOwners = await listConnectedRepositoryOwners({
        convex,
        organizationId,
        userId: convexUserId,
        provider,
        bypassCache,
      })

      const nextOwners = loadedOwners.map((owner) => ({
        ...owner,
        provider,
      }))

      setOwners(nextOwners)

      const retainedOwner =
        nextOwners.find((owner) => owner.id === selectedOwnerId) ?? null
      const nextSelectedOwner = retainedOwner ?? getPreferredOwner(nextOwners, setupMode) ?? null
      setSelectedOwnerId(nextSelectedOwner?.id ?? '')

      if (nextSelectedOwner) {
        try {
          await convex.mutation(api.sourceControl.updateConnectionSelection, {
            organizationId,
            userId: convexUserId,
            provider,
            namespaceId: nextSelectedOwner.id,
            namespaceName: nextSelectedOwner.displayName,
            namespaceLogin: nextSelectedOwner.login,
            namespaceType:
              nextSelectedOwner.kind === 'group'
                ? 'group'
                : nextSelectedOwner.kind === 'organization'
                  ? 'organization'
                  : 'user',
            installationId: nextSelectedOwner.installationId,
            installationTargetType: nextSelectedOwner.installationTargetType,
            installationTargetLogin: nextSelectedOwner.installationTargetLogin,
            installationTargetName: nextSelectedOwner.installationTargetName,
            authStatus:
              provider === 'github' && !nextSelectedOwner.installationId
                ? 'missing_setup'
                : 'active',
            lastError:
              provider === 'github' && !nextSelectedOwner.installationId
                ? 'Select a GitHub App installation for this namespace before using provider-native repo automation.'
                : undefined,
          })
        } catch (mutationError) {
          console.warn(
            '[RepositoryProvisioner] Failed to refresh namespace selection:',
            mutationError
          )
        }
      }
    } catch (loadError) {
      setOwners([])
      setSelectedOwnerId('')
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load repository owners.'
      )
    } finally {
      setIsLoadingOwners(false)
    }
  }, [
    convex,
    convexUserId,
    integrationConnected,
    organizationId,
    provider,
    selectedOwnerId,
    setupMode,
  ])

  const loadRepositories = useCallback(async (bypassCache = false) => {
    if (!organizationId || !convexUserId || !integrationConnected || !selectedOwner) {
      setRepositories([])
      return
    }

    setIsLoadingRepositories(true)
    setError(null)
    try {
      const nextRepositories = await listConnectedRepositories({
        convex,
        organizationId,
        userId: convexUserId,
        provider,
        ownerId: selectedOwner.id,
        ownerLogin: selectedOwner.login,
        ownerKind: selectedOwner.kind,
        search: '',
        bypassCache,
      })
      setRepositories(nextRepositories)
    } catch (loadError) {
      setRepositories([])
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load repositories.'
      )
    } finally {
      setIsLoadingRepositories(false)
    }
  }, [
    convex,
    convexUserId,
    integrationConnected,
    organizationId,
    provider,
    selectedOwner,
  ])

  useEffect(() => {
    void loadOwners()
  }, [loadOwners])

  useEffect(() => {
    void loadRepositories()
  }, [loadRepositories])

  const handleOwnerChange = useCallback(async (ownerId: string) => {
    setSelectedOwnerId(ownerId)

    if (!organizationId || !convexUserId) {
      return
    }

    const owner = owners.find((entry) => entry.id === ownerId)
    if (!owner) {
      return
    }

    try {
      await convex.mutation(api.sourceControl.updateConnectionSelection, {
        organizationId,
        userId: convexUserId,
        provider,
        namespaceId: owner.id,
        namespaceName: owner.displayName,
        namespaceLogin: owner.login,
        namespaceType:
          owner.kind === 'group'
            ? 'group'
            : owner.kind === 'organization'
              ? 'organization'
              : 'user',
        installationId: owner.installationId,
        installationTargetType: owner.installationTargetType,
        installationTargetLogin: owner.installationTargetLogin,
        installationTargetName: owner.installationTargetName,
        authStatus:
          provider === 'github' && !owner.installationId
            ? 'missing_setup'
            : 'active',
        lastError:
          provider === 'github' && !owner.installationId
            ? 'Select a GitHub App installation for this namespace before using provider-native repo automation.'
            : undefined,
      })
    } catch (mutationError) {
      console.warn('[RepositoryProvisioner] Failed to persist namespace selection:', mutationError)
    }
  }, [convex, convexUserId, organizationId, owners, provider])

  if (!integrationConnected) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-secondary/30 px-4 py-3 text-xs text-muted-foreground">
        Connect GitHub in Source Control to browse repositories from the app.
      </div>
    )
  }

  if (compactTable) {
    return (
      <>
        <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
          <div className="flex flex-col gap-0.5">
            <Label className="text-xs font-medium text-foreground">Owner</Label>
            <p className="text-[11px] text-muted-foreground">GitHub organization or user</p>
          </div>
          <select
            value={selectedOwnerId}
            onChange={(e) => {
              void handleOwnerChange(e.target.value)
            }}
            disabled={isLoadingOwners || owners.length === 0}
            className="h-7 w-[160px] max-w-full rounded-md border border-border/50 bg-transparent px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring/50"
          >
            <option value="" disabled>Select owner</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.displayName} ({owner.login})
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
          <div className="flex flex-col gap-0.5">
            <Label className="text-xs font-medium text-foreground">Repository</Label>
            <p className="text-[11px] text-muted-foreground">The repository to connect</p>
          </div>
          <select
            value={selectedRepoUrl ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              const selectedRepository =
                repositories.find((repository) => repository.url === value) ?? null
              if (selectedRepository) {
                onRepositorySelected(selectedRepository)
              }
            }}
            disabled={isLoadingRepositories || repositories.length === 0}
            className="h-7 w-[160px] max-w-full rounded-md border border-border/50 bg-transparent px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring/50"
          >
            <option value="" disabled>
              {isLoadingRepositories
                ? 'Loading...'
                : repositories.length > 0
                  ? 'Select repository'
                  : 'No repositories found'}
            </option>
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.url}>
                {repository.fullName}
              </option>
            ))}
          </select>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-muted/15 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Connected GitHub repository</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-full px-3 text-xs"
          onClick={() => {
            void invalidateProviderRepositoryManagementCache({ provider }).then(() =>
              loadOwners(true)
            )
          }}
          disabled={isLoadingOwners || isLoadingRepositories}
        >
          {isLoadingOwners || isLoadingRepositories ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60">
        <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center border-b border-border/60 bg-background/80 px-3 py-2">
          <Label className="text-xs text-muted-foreground">Owner</Label>
          <Select
            value={selectedOwnerId}
            onValueChange={(value) => {
              void handleOwnerChange(value)
            }}
            disabled={isLoadingOwners || owners.length === 0}
          >
            <SelectTrigger className="rounded-xl bg-background">
              <SelectValue placeholder="Select owner" />
            </SelectTrigger>
            <SelectContent>
              {owners.map((owner) => (
                <SelectItem key={owner.id} value={owner.id}>
                  {owner.displayName} ({owner.login})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center bg-background/80 px-3 py-2">
          <Label className="text-xs text-muted-foreground">Repository</Label>
          <Select
            value={selectedRepoUrl ?? ''}
            onValueChange={(value) => {
              const selectedRepository =
                repositories.find((repository) => repository.url === value) ?? null
              if (selectedRepository) {
                onRepositorySelected(selectedRepository)
              }
            }}
            disabled={isLoadingRepositories || repositories.length === 0}
          >
            <SelectTrigger className="rounded-xl bg-background">
              <SelectValue
                placeholder={
                  isLoadingRepositories
                    ? 'Loading repositories...'
                    : repositories.length > 0
                      ? 'Select repository'
                      : 'No repositories found'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {repositories.map((repository) => (
                <SelectItem key={repository.id} value={repository.url}>
                  {repository.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedRepoUrl ? (
        <p className="text-xs text-muted-foreground">
          Connected to <span className="font-mono">{selectedRepoUrl}</span>
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  )
}
