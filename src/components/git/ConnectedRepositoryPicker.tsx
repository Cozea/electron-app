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
import { settingsNativeSelectClass } from '@/components/settings/SettingsChrome'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TablePaginationControls } from '@/components/ui/table-pagination-controls'
import { cn } from '@/lib/utils'
import { LockClosedIcon as Lock } from "@heroicons/react/24/outline"

type RepositoryProvider = 'github'

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
  organizationId?: Id<'organizations'> | null
  integrationConnected: boolean
  selectedRepoUrl?: string
  selectedBranch?: string
  repositorySearchValue?: string
  refreshNonce?: number
  onRemoteRepositoriesLoadingChange?: (isLoading: boolean) => void
  onRepositorySelected: (repository: RepositoryDescriptor) => void
  onRepositoryBranchSelected?: (repository: RepositoryDescriptor, branch: string) => void
  /** Called when the user clears the row checkbox (single-select UX). */
  onRepositorySelectionCleared?: () => void
  /** When `none`, table pagination is not rendered here (e.g. host renders it in a dialog footer). */
  paginationSlot?: 'below-table' | 'none'
  /** Called when `paginationSlot` is `none` so the host can render pagination elsewhere. */
  onPaginationStateChange?: (state: ConnectedRepositoryPickerPaginationState | null) => void
}

const REMOTE_REPOSITORY_PAGE_SIZE = 50
const REPOSITORY_TABLE_PAGE_SIZE = 5

export interface ConnectedRepositoryPickerPaginationState {
  totalCount: number
  currentPage: number
  pageSize: number
  isNextDisabled: boolean
  onPageChange: (page: number) => void
  onNextClick: () => void
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

export function ConnectedRepositoryPicker({
  provider,
  organizationId,
  integrationConnected,
  selectedRepoUrl,
  selectedBranch,
  repositorySearchValue,
  refreshNonce,
  onRemoteRepositoriesLoadingChange,
  onRepositorySelected,
  onRepositoryBranchSelected,
  onRepositorySelectionCleared,
  paginationSlot = 'below-table',
  onPaginationStateChange,
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
  const pendingRepositoryTablePageRef = useRef<number | null>(null)

  const [repositoryTablePage, setRepositoryTablePage] = useState(1)

  const repositorySearch = repositorySearchValue ?? ''
  const availableProviders = useMemo(() => [provider], [provider])

  const remoteRepositories = useMemo(() => {
    const combined = availableProviders.flatMap(
      (providerOption) => repositoryPagesByProvider[providerOption]?.items ?? []
    )

    combined.sort((left, right) => {
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
        return `GitHub: ${message}`
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
    setRepositoryTablePage(1)
  }, [repositorySearch, refreshNonce])

  useEffect(() => {
    const pending = pendingRepositoryTablePageRef.current
    if (pending === null) {
      return
    }
    if (isRemoteRepositoryLoading) {
      return
    }
    const tableTotalPages = Math.max(
      1,
      Math.ceil(remoteRepositories.length / REPOSITORY_TABLE_PAGE_SIZE),
    )
    if (pending <= tableTotalPages) {
      setRepositoryTablePage(pending)
      pendingRepositoryTablePageRef.current = null
      return
    }
    setRepositoryTablePage(tableTotalPages)
    pendingRepositoryTablePageRef.current = null
  }, [isRemoteRepositoryLoading, remoteRepositories.length])

  useEffect(() => {
    if (pendingRepositoryTablePageRef.current !== null) {
      return
    }
    if (remoteRepositories.length === 0) {
      return
    }
    const tableTotalPages = Math.max(
      1,
      Math.ceil(remoteRepositories.length / REPOSITORY_TABLE_PAGE_SIZE),
    )
    setRepositoryTablePage((page) => (page > tableTotalPages ? tableTotalPages : page))
  }, [remoteRepositories.length])

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

    if (repository.provider !== 'github') {
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

  const repositoryTableTotalPages = useMemo(
    () => Math.max(1, Math.ceil(remoteRepositories.length / REPOSITORY_TABLE_PAGE_SIZE)),
    [remoteRepositories.length],
  )

  const paginatedRepositories = useMemo(() => {
    const start = (repositoryTablePage - 1) * REPOSITORY_TABLE_PAGE_SIZE
    return remoteRepositories.slice(start, start + REPOSITORY_TABLE_PAGE_SIZE)
  }, [remoteRepositories, repositoryTablePage])

  const handleRepositoryTableNext = useCallback(() => {
    if (repositoryTablePage < repositoryTableTotalPages) {
      setRepositoryTablePage((page) => page + 1)
      return
    }
    if (hasRemoteRepositoryNextPage && !isRemoteRepositoryLoading) {
      pendingRepositoryTablePageRef.current = repositoryTablePage + 1
      void loadNextRemoteRepositories()
    }
  }, [
    hasRemoteRepositoryNextPage,
    isRemoteRepositoryLoading,
    loadNextRemoteRepositories,
    repositoryTablePage,
    repositoryTableTotalPages,
  ])

  useEffect(() => {
    if (!onPaginationStateChange || paginationSlot !== 'none') {
      return
    }
    if (!integrationConnected) {
      onPaginationStateChange(null)
      return
    }
    onPaginationStateChange({
      totalCount: remoteRepositories.length,
      currentPage: repositoryTablePage,
      pageSize: REPOSITORY_TABLE_PAGE_SIZE,
      isNextDisabled:
        isRemoteRepositoryLoading ||
        (repositoryTablePage >= repositoryTableTotalPages && !hasRemoteRepositoryNextPage),
      onPageChange: setRepositoryTablePage,
      onNextClick: handleRepositoryTableNext,
    })
  }, [
    handleRepositoryTableNext,
    hasRemoteRepositoryNextPage,
    integrationConnected,
    isRemoteRepositoryLoading,
    onPaginationStateChange,
    paginationSlot,
    remoteRepositories.length,
    repositoryTablePage,
    repositoryTableTotalPages,
  ])

  if (!integrationConnected) {
    return (
        <div className="rounded-xl border border-dashed border-border/60 bg-secondary/30 px-4 py-3 text-xs text-muted-foreground">
        Connect GitHub in Git Providers to browse repositories from the app.
      </div>
    )
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="relative flex w-full min-w-0 flex-col">
        <div className="w-full min-w-0 overflow-hidden rounded-[14px] bg-muted">
          <div className="app-scrollbar max-h-[min(60vh,420px)] w-full min-w-0 overflow-auto">
            <Table className="w-full min-w-0 [&_th]:px-3 [&_th]:font-normal [&_th]:text-muted-foreground [&_td]:px-3 sm:[&_th]:px-4 sm:[&_td]:px-4">
              <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead className="min-w-0">Repository</TableHead>
                  <TableHead className="min-w-[8rem] w-[38%]">Branch</TableHead>
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
                paginatedRepositories.map((repository) => {
                  const isSelected = selectedRepoUrl === repository.url
                  const branches = branchOptionsByRepository[repository.url] ?? []
                  const isBranchLoading = branchLoadingByRepository[repository.url] === true
                  const isBranchSelectDisabled = isBranchLoading && branches.length === 0
                  const computedBranch = isSelected
                    ? selectedBranch || repository.defaultBranch || branches[0]?.name || 'main'
                    : '__none__'
                  const branchMissingFromList =
                    isSelected &&
                    !isBranchSelectDisabled &&
                    branches.length > 0 &&
                    !branches.some((b) => b.name === computedBranch)
                  const showRepoMeta = Boolean(repository.language)

                  return (
                    <TableRow key={repository.url}>
                      <TableCell
                        className="w-12"
                        onClick={(event) => {
                          event.stopPropagation()
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            if (checked === true) {
                              handleRepositoryRowSelect(repository)
                              return
                            }
                            if (checked === false) {
                              onRepositorySelectionCleared?.()
                            }
                          }}
                          aria-label={`Select ${repository.name}`}
                        />
                      </TableCell>
                      <TableCell className="overflow-hidden">
                        <div className="flex min-w-0 flex-col">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-normal text-foreground">{repository.name}</span>
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
                            {showRepoMeta ? (
                              <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <span className="h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                                <span>{repository.language}</span>
                              </div>
                            ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="overflow-hidden" onClick={(event) => event.stopPropagation()}>
                        <select
                          aria-label={`Branch for ${repository.name}`}
                          disabled={isBranchSelectDisabled}
                          value={
                            isBranchSelectDisabled
                              ? '__loading__'
                              : !isSelected
                                ? '__none__'
                                : computedBranch
                          }
                          onFocus={() => {
                            void loadBranchesForRepository(repository)
                          }}
                          onChange={(event) => {
                            const next = event.target.value
                            if (next === '__none__' || next === '__loading__') {
                              return
                            }
                            onRepositorySelected(repository)
                            onRepositoryBranchSelected?.(repository, next)
                          }}
                          className={cn(
                            settingsNativeSelectClass,
                            'w-full min-w-0 max-w-full text-foreground',
                          )}
                        >
                          {isBranchSelectDisabled ? (
                            <option value="__loading__">Loading...</option>
                          ) : (
                            <>
                              {!isSelected ? (
                                <option value="__none__">Choose branch</option>
                              ) : null}
                              {branchMissingFromList ? (
                                <option value={computedBranch}>{computedBranch}</option>
                              ) : null}
                              {branches.map((branch) => (
                                <option key={branch.name} value={branch.name}>
                                  {branch.name}
                                  {branch.isDefault ? ' (default)' : ''}
                                </option>
                              ))}
                            </>
                          )}
                        </select>
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
              </TableBody>
            </Table>
          </div>
        </div>
        {paginationSlot === 'below-table' ? (
          <TablePaginationControls
            className="mt-2 w-full min-w-0 shrink-0 px-1"
            currentPage={repositoryTablePage}
            totalCount={remoteRepositories.length}
            pageSize={REPOSITORY_TABLE_PAGE_SIZE}
            onPageChange={setRepositoryTablePage}
            onNextClick={handleRepositoryTableNext}
            isNextDisabled={
              isRemoteRepositoryLoading ||
              (repositoryTablePage >= repositoryTableTotalPages && !hasRemoteRepositoryNextPage)
            }
          />
        ) : null}
      </div>

      {remoteRepositoryError ? (
        <p className="text-xs text-destructive">{remoteRepositoryError}</p>
      ) : null}
    </div>
  )
}
