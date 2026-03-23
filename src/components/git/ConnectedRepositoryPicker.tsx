import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConvex } from 'convex/react'

import type { Id } from '../../../convex/_generated/dataModel'
import type {
  RepositoryBranchDescriptor,
  RepositoryDescriptor,
} from '@shared/electronApiTypes'
import {
  invalidateProviderRepositoryManagementCache,
  listConnectedRepositoriesPage,
  listConnectedRepositoryBranches,
} from '@/lib/git/providerRepositoryManagement'
import { useAuth } from '@/contexts/AuthContext'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { IntegrationIcon } from '@/components/integrations/IntegrationIcon'
import { Lock, Star } from 'lucide-react'

type RepositoryProvider = 'github' | 'gitlab'

interface RepositoryPageLoadState {
  items: RepositoryDescriptor[]
  nextPage: number | null
  hasNextPage: boolean
  initialized: boolean
  isLoading: boolean
  error: string | null
}

interface ConnectedRepositoryPickerProps {
  provider: RepositoryProvider
  providers?: RepositoryProvider[]
  organizationId?: Id<'organizations'> | null
  integrationConnected: boolean
  selectedRepoUrl?: string
  selectedBranch?: string
  repositorySearchValue?: string
  refreshNonce?: number
  onRemoteRepositoriesLoadingChange?: (isLoading: boolean) => void
  onRepositorySelected: (repository: RepositoryDescriptor) => void
  onRepositoryBranchSelected?: (repository: RepositoryDescriptor, branch: string) => void
}

const REMOTE_REPOSITORY_PAGE_SIZE = 50

function getOwnerAvatarFallback(ownerLogin: string): string {
  const segment = ownerLogin.split('/').filter(Boolean).pop() ?? ownerLogin
  return segment.slice(0, 2).toUpperCase()
}

function createRepositoryPageState(): RepositoryPageLoadState {
  return {
    items: [],
    nextPage: 1,
    hasNextPage: true,
    initialized: false,
    isLoading: false,
    error: null,
  }
}

function buildRepositoryPageStateMap(
  providers: RepositoryProvider[]
): Partial<Record<RepositoryProvider, RepositoryPageLoadState>> {
  return Object.fromEntries(
    providers.map((provider) => [provider, createRepositoryPageState()])
  ) as Partial<Record<RepositoryProvider, RepositoryPageLoadState>>
}

function formatRepositoryLastCommit(timestamp?: string): string {
  if (!timestamp) {
    return 'Unavailable'
  }

  const parsedDate = new Date(timestamp)
  if (Number.isNaN(parsedDate.getTime())) {
    return 'Unavailable'
  }

  const now = Date.now()
  const diffMs = Math.max(0, now - parsedDate.getTime())
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  const year = 365 * day

  if (diffMs < minute) return 'Just now'
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`
  if (diffMs < week) return `${Math.floor(diffMs / day)}d ago`
  if (diffMs < month) return `${Math.floor(diffMs / week)}w ago`
  if (diffMs < year) return `${Math.floor(diffMs / month)}mo ago`
  return `${Math.floor(diffMs / year)}y ago`
}

export function ConnectedRepositoryPicker({
  provider,
  providers,
  organizationId,
  integrationConnected,
  selectedRepoUrl,
  selectedBranch,
  repositorySearchValue,
  refreshNonce,
  onRemoteRepositoriesLoadingChange,
  onRepositorySelected,
  onRepositoryBranchSelected,
}: ConnectedRepositoryPickerProps) {
  const convex = useConvex()
  const { convexUserId } = useAuth()
  const [repositoryPagesByProvider, setRepositoryPagesByProvider] = useState<
    Partial<Record<RepositoryProvider, RepositoryPageLoadState>>
  >({})
  const [branchOptionsByRepository, setBranchOptionsByRepository] = useState<
    Record<string, RepositoryBranchDescriptor[]>
  >({})
  const [branchLoadingByRepository, setBranchLoadingByRepository] = useState<
    Record<string, boolean>
  >({})
  const [branchStatusByRepository, setBranchStatusByRepository] = useState<
    Record<string, 'loaded' | 'fallback'>
  >({})
  const lastHandledRefreshNonceRef = useRef<number | undefined>(refreshNonce)
  const remoteRepositoryLoadGenerationRef = useRef(0)
  const remoteRepositoryNextPageLockRef = useRef(false)

  const repositorySearch = repositorySearchValue ?? ''
  const availableProviders = useMemo(() => {
    if (providers && providers.length > 0) {
      return providers
    }
    return [provider]
  }, [provider, providers])

  const remoteRepositories = useMemo(() => {
    const combined = availableProviders.flatMap(
      (providerOption) => repositoryPagesByProvider[providerOption]?.items ?? []
    )

    combined.sort((left, right) => {
      if (left.provider !== right.provider) {
        return left.provider === 'github' ? -1 : 1
      }
      return left.fullName.localeCompare(right.fullName)
    })

    return combined
  }, [availableProviders, repositoryPagesByProvider])

  const isRemoteRepositoryLoading = useMemo(
    () =>
      availableProviders.some(
        (providerOption) => repositoryPagesByProvider[providerOption]?.isLoading === true
      ),
    [availableProviders, repositoryPagesByProvider]
  )

  const remoteRepositoryError = useMemo(() => {
    const messages = availableProviders
      .map((providerOption) => {
        const message = repositoryPagesByProvider[providerOption]?.error
        if (!message) return null
        return `${providerOption === 'github' ? 'GitHub' : 'GitLab'}: ${message}`
      })
      .filter((value): value is string => Boolean(value))

    return messages.length > 0 ? messages.join(' ') : null
  }, [availableProviders, repositoryPagesByProvider])

  const hasRemoteRepositoryResults = remoteRepositories.length > 0
  const hasRemoteRepositoryNextPage = useMemo(
    () =>
      availableProviders.some((providerOption) => {
        const state = repositoryPagesByProvider[providerOption]
        return Boolean(state?.hasNextPage && state.nextPage)
      }),
    [availableProviders, repositoryPagesByProvider]
  )

  useEffect(() => {
    onRemoteRepositoriesLoadingChange?.(isRemoteRepositoryLoading)
  }, [isRemoteRepositoryLoading, onRemoteRepositoriesLoadingChange])

  const loadRemoteRepositoriesPage = useCallback(async (args: {
    providerOption: RepositoryProvider
    page: number
    bypassCache?: boolean
    replace?: boolean
    generation: number
  }) => {
    if (!organizationId || !convexUserId || !integrationConnected) {
      return
    }

    const { providerOption, page, bypassCache = false, replace = false, generation } = args

    setRepositoryPagesByProvider((current) => ({
      ...current,
      [providerOption]: {
        ...(current[providerOption] ?? createRepositoryPageState()),
        isLoading: true,
        error: null,
      },
    }))

    try {
      const result = await listConnectedRepositoriesPage({
        convex,
        organizationId,
        userId: convexUserId,
        provider: providerOption,
        search: repositorySearch,
        page,
        pageSize: REMOTE_REPOSITORY_PAGE_SIZE,
        bypassCache,
      })

      if (generation !== remoteRepositoryLoadGenerationRef.current) {
        return
      }

      setRepositoryPagesByProvider((current) => {
        const previous = current[providerOption] ?? createRepositoryPageState()
        const items = replace
          ? result.items
          : [
              ...previous.items,
              ...result.items.filter(
                (candidate) =>
                  !previous.items.some((existing) => existing.id === candidate.id)
              ),
            ]

        return {
          ...current,
          [providerOption]: {
            items,
            nextPage: result.hasNextPage ? result.nextPage ?? page + 1 : null,
            hasNextPage: result.hasNextPage,
            initialized: true,
            isLoading: false,
            error: null,
          },
        }
      })
    } catch (loadError) {
      if (generation !== remoteRepositoryLoadGenerationRef.current) {
        return
      }

      setRepositoryPagesByProvider((current) => ({
        ...current,
        [providerOption]: {
          ...(current[providerOption] ?? createRepositoryPageState()),
          items: replace ? [] : current[providerOption]?.items ?? [],
          nextPage: null,
          hasNextPage: false,
          initialized: true,
          isLoading: false,
          error:
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load repositories.',
        },
      }))
    }
  }, [
    convex,
    convexUserId,
    integrationConnected,
    organizationId,
    repositorySearch,
  ])

  const resetAndLoadRemoteRepositories = useCallback((bypassCache = false) => {
    const generation = remoteRepositoryLoadGenerationRef.current + 1
    remoteRepositoryLoadGenerationRef.current = generation
    remoteRepositoryNextPageLockRef.current = false
    setRepositoryPagesByProvider(buildRepositoryPageStateMap(availableProviders))

    for (const providerOption of availableProviders) {
      void loadRemoteRepositoriesPage({
        providerOption,
        page: 1,
        bypassCache,
        replace: true,
        generation,
      })
    }
  }, [availableProviders, loadRemoteRepositoriesPage])

  const loadNextRemoteRepositories = useCallback(async () => {
    if (remoteRepositoryNextPageLockRef.current) {
      return
    }

    const pendingProviders = availableProviders
      .map((providerOption) => ({
        providerOption,
        state: repositoryPagesByProvider[providerOption],
      }))
      .filter(
        (entry): entry is {
          providerOption: RepositoryProvider
          state: RepositoryPageLoadState
        } =>
          Boolean(
            entry.state?.initialized &&
              entry.state.hasNextPage &&
              entry.state.nextPage &&
              !entry.state.isLoading
          )
      )

    if (pendingProviders.length === 0) {
      return
    }

    remoteRepositoryNextPageLockRef.current = true
    const generation = remoteRepositoryLoadGenerationRef.current

    try {
      await Promise.all(
        pendingProviders.map((entry) =>
          loadRemoteRepositoriesPage({
            providerOption: entry.providerOption,
            page: entry.state.nextPage ?? 1,
            generation,
          })
        )
      )
    } finally {
      remoteRepositoryNextPageLockRef.current = false
    }
  }, [availableProviders, loadRemoteRepositoriesPage, repositoryPagesByProvider])

  useEffect(() => {
    resetAndLoadRemoteRepositories()
  }, [resetAndLoadRemoteRepositories])

  useEffect(() => {
    if (refreshNonce === undefined || refreshNonce === lastHandledRefreshNonceRef.current) {
      return
    }

    lastHandledRefreshNonceRef.current = refreshNonce
    void invalidateProviderRepositoryManagementCache().then(() =>
      resetAndLoadRemoteRepositories(true)
    )
  }, [refreshNonce, resetAndLoadRemoteRepositories])

  const loadBranchesForRepository = useCallback(async (repository: RepositoryDescriptor) => {
    if (!organizationId || !convexUserId) {
      return
    }

    if (branchLoadingByRepository[repository.url]) {
      return
    }

    if (branchStatusByRepository[repository.url] === 'loaded') {
      return
    }

    setBranchLoadingByRepository((current) => ({
      ...current,
      [repository.url]: true,
    }))

    try {
      const branches = await listConnectedRepositoryBranches({
        convex,
        organizationId,
        userId: convexUserId,
        provider: repository.provider,
        repositoryId: repository.id,
        repositoryFullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
      })

      setBranchOptionsByRepository((current) => ({
        ...current,
        [repository.url]:
          branches.length > 0
            ? branches
            : [{
                name: repository.defaultBranch || 'main',
                isDefault: true,
              }],
      }))
      setBranchStatusByRepository((current) => ({
        ...current,
        [repository.url]: branches.length > 0 ? 'loaded' : 'fallback',
      }))
    } catch (branchError) {
      console.warn(
        '[ConnectedRepositoryPicker] Failed to load repository branches:',
        branchError
      )
      setBranchOptionsByRepository((current) => ({
        ...current,
        [repository.url]: [{
          name: repository.defaultBranch || 'main',
          isDefault: true,
        }],
      }))
      setBranchStatusByRepository((current) => ({
        ...current,
        [repository.url]: 'fallback',
      }))
    } finally {
      setBranchLoadingByRepository((current) => ({
        ...current,
        [repository.url]: false,
      }))
    }
  }, [
    branchLoadingByRepository,
    branchStatusByRepository,
    convex,
    convexUserId,
    organizationId,
  ])

  const handleRepositoryRowSelect = useCallback((repository: RepositoryDescriptor) => {
    onRepositorySelected(repository)
    void loadBranchesForRepository(repository)

    if (onRepositoryBranchSelected) {
      onRepositoryBranchSelected(
        repository,
        selectedRepoUrl === repository.url
          ? selectedBranch || repository.defaultBranch || 'main'
          : repository.defaultBranch || 'main'
      )
    }
  }, [
    loadBranchesForRepository,
    onRepositoryBranchSelected,
    onRepositorySelected,
    selectedBranch,
    selectedRepoUrl,
  ])

  if (!integrationConnected) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-secondary/30 px-4 py-3 text-xs text-muted-foreground">
        Connect {provider === 'github' ? 'GitHub' : 'GitLab'} in Source Control to browse repositories from the app.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="relative min-h-0 flex-1 w-full">
        <div
          className="app-scrollbar h-full overflow-y-auto"
          onScroll={(event) => {
            const target = event.currentTarget
            const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
            if (remaining < 320) {
              void loadNextRemoteRepositories()
            }
          }}
        >
          <div className="h-[80px] shrink-0" />
          <table className="w-full caption-bottom text-sm [&_th]:px-4 [&_td]:px-4">
            <TableHeader>
              <TableRow className="bg-background hover:bg-transparent border-b-0">
                <TableHead className="w-[460px] bg-background">Repository</TableHead>
                <TableHead className="bg-background">Provider</TableHead>
                <TableHead className="w-[180px] bg-background">Branch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
              {!hasRemoteRepositoryResults && isRemoteRepositoryLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                    Loading repositories...
                  </TableCell>
                </TableRow>
              ) : remoteRepositories.length > 0 ? (
                remoteRepositories.map((repository) => {
                  const isSelected = selectedRepoUrl === repository.url
                  const branches = branchOptionsByRepository[repository.url] ?? []
                  const branchValue = isSelected
                    ? selectedBranch || repository.defaultBranch || branches[0]?.name || 'main'
                    : undefined
                  const isBranchLoading = branchLoadingByRepository[repository.url] === true
                  const lastCommit = formatRepositoryLastCommit(repository.lastActivityAt)

                  return (
                    <TableRow
                      key={repository.url}
                      className={
                        isSelected
                          ? 'cursor-pointer bg-primary/5 hover:bg-primary/10'
                          : 'cursor-pointer hover:bg-muted/40'
                      }
                      onClick={() => {
                        handleRepositoryRowSelect(repository)
                      }}
                    >
                      <TableCell className="font-medium">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="h-8 w-8 shrink-0 rounded-xl">
                            <AvatarImage
                              src={repository.ownerAvatarUrl}
                              alt={repository.ownerLogin}
                            />
                            <AvatarFallback className="rounded-xl text-[11px] font-medium">
                              {getOwnerAvatarFallback(repository.ownerLogin)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex min-w-0 flex-col">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-semibold">{repository.name}</span>
                              {repository.private ? (
                                <Lock className="h-3 w-3 text-muted-foreground" />
                              ) : null}
                            </div>
                            {repository.description ? (
                              <span
                                className="line-clamp-1 text-xs text-muted-foreground mt-0.5"
                                title={repository.description}
                              >
                                {repository.description}
                              </span>
                            ) : null}
                            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1.5 font-medium">
                              {repository.language ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="h-2 w-2 rounded-full bg-primary/60" />
                                  <span>{repository.language}</span>
                                </div>
                              ) : null}
                              {typeof repository.starsCount === 'number' && repository.starsCount >= 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <Star className="h-3.5 w-3.5 opacity-70" />
                                  <span>
                                    {Intl.NumberFormat('en-US', {
                                      notation: 'compact',
                                      maximumFractionDigits: 1,
                                    }).format(repository.starsCount)}
                                  </span>
                                </div>
                              ) : null}
                              <div className="flex items-center gap-1.5">
                                <span>{lastCommit}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5 text-sm">
                          <IntegrationIcon
                            provider={repository.provider}
                            size="lg"
                            className="h-5 w-5 text-muted-foreground"
                          />
                          {repository.provider === 'gitlab' ? 'GitLab' : 'GitHub'}
                        </div>
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Select
                          value={branchValue}
                          onOpenChange={(open) => {
                            if (open) {
                              void loadBranchesForRepository(repository)
                            }
                          }}
                          onValueChange={(branch) => {
                            onRepositorySelected(repository)
                            onRepositoryBranchSelected?.(repository, branch)
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="h-8 w-[150px] rounded-lg bg-muted/60"
                          >
                            <SelectValue
                              placeholder={
                                isBranchLoading
                                  ? 'Loading...'
                                  : isSelected
                                    ? 'Select branch'
                                    : 'Choose branch'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent align="end">
                            {branches.map((branch) => (
                              <SelectItem key={branch.name} value={branch.name}>
                                {branch.name}
                                {branch.isDefault ? ' (default)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                    {repositorySearch.trim().length > 0
                      ? 'No repositories match your search.'
                      : 'No repositories are available yet.'}
                  </TableCell>
                </TableRow>
              )}
              {hasRemoteRepositoryResults && isRemoteRepositoryLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-12 text-center text-muted-foreground">
                    Loading more repositories...
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </table>
        </div>
      </div>

      {remoteRepositoryError ? (
        <p className="text-xs text-destructive">{remoteRepositoryError}</p>
      ) : hasRemoteRepositoryResults && !hasRemoteRepositoryNextPage ? (
        <p className="text-xs text-muted-foreground">All available repositories are loaded.</p>
      ) : null}
    </div>
  )
}
