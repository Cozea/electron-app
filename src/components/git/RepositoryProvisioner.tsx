import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConvex } from 'convex/react'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type {
  RepositoryDescriptor,
  RepositoryOwnerDescriptor,
} from '@shared/electronApiTypes'
import {
  createConnectedRepository,
  invalidateProviderRepositoryManagementCache,
  listConnectedRepositories,
  listConnectedRepositoryOwners,
} from '@/lib/git/providerRepositoryManagement'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
type RepositoryOwnerKind = 'user' | 'organization' | 'group'
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
  suggestedRepoName,
  visibility,
  onRepositorySelected,
}: RepositoryProvisionerProps) {
  const convex = useConvex()
  const { convexUserId } = useAuth()
  const [owners, setOwners] = useState<RepositoryOwnerWithProvider[]>([])
  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [repositories, setRepositories] = useState<RepositoryDescriptor[]>([])
  const [repositorySearch, setRepositorySearch] = useState('')
  const [newRepositoryName, setNewRepositoryName] = useState(suggestedRepoName ?? '')
  const [isLoadingOwners, setIsLoadingOwners] = useState(false)
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false)
  const [isCreatingRepository, setIsCreatingRepository] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNewRepositoryName((current) => current || suggestedRepoName || '')
  }, [suggestedRepoName])

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
        search: repositorySearch,
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
    repositorySearch,
    selectedOwner,
  ])

  useEffect(() => {
    void loadOwners()
  }, [loadOwners])

  useEffect(() => {
    void loadRepositories()
  }, [loadRepositories])

  const handleCreateRepository = useCallback(async () => {
    if (!organizationId || !convexUserId || !selectedOwner || !newRepositoryName.trim()) {
      return
    }

    setIsCreatingRepository(true)
    setError(null)
    try {
      const createdRepository = await createConnectedRepository({
        convex,
        organizationId,
        userId: convexUserId,
        provider,
        ownerId: selectedOwner.id,
        ownerLogin: selectedOwner.login,
        ownerKind: selectedOwner.kind as RepositoryOwnerKind,
        name: newRepositoryName.trim(),
        private: visibility !== 'public',
      })

      setRepositories((current) => {
        const next = [createdRepository, ...current.filter((repo) => repo.id !== createdRepository.id)]
        return next.sort((left, right) => left.fullName.localeCompare(right.fullName))
      })
      onRepositorySelected(createdRepository)
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Failed to create repository.'
      )
    } finally {
      setIsCreatingRepository(false)
    }
  }, [
    convex,
    convexUserId,
    newRepositoryName,
    onRepositorySelected,
    organizationId,
    provider,
    selectedOwner,
    visibility,
  ])

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

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-secondary/30 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">
            Connected GitHub repositories
          </p>
          <p className="text-xs text-muted-foreground">
            Pick an existing remote or create a new one for this project.
          </p>
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

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Owner</Label>
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

        <div className="space-y-2">
          <Label>Search</Label>
          <Input
            value={repositorySearch}
            onChange={(event) => {
              setRepositorySearch(event.target.value)
            }}
            placeholder="Search repositories"
            className="rounded-xl bg-background"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Repository</Label>
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

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <Label>Create New Repository</Label>
          <Input
            value={newRepositoryName}
            onChange={(event) => {
              setNewRepositoryName(event.target.value)
            }}
            placeholder="Repository name"
            className="rounded-xl bg-background"
          />
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            className="w-full rounded-xl md:w-auto"
            onClick={() => {
              void handleCreateRepository()
            }}
            disabled={!selectedOwner || !newRepositoryName.trim() || isCreatingRepository}
          >
            {isCreatingRepository ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Create Repo
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  )
}
