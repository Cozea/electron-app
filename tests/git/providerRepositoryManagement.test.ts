import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  invalidateProviderRepositoryManagementCache,
  listConnectedRepositoriesPage,
} from '../../src/lib/git/providerRepositoryManagement'

function buildRepository(args: { id: string; name: string; owner: string }) {
  return {
    id: args.id,
    name: args.name,
    fullName: `${args.owner}/${args.name}`,
    ownerLogin: args.owner,
    defaultBranch: 'main',
    private: true,
    url: `https://github.com/${args.owner}/${args.name}`,
    provider: 'github' as const,
  }
}

describe('providerRepositoryManagement', () => {
  const sourceControlApi = {
    listRepositoriesPage: vi.fn(),
    invalidateProviderCache: vi.fn().mockResolvedValue({ success: true }),
  }

  const convex = {
    query: vi.fn().mockResolvedValue({ providerHost: 'https://github.com' }),
    action: vi.fn().mockResolvedValue({
      accessToken: 'github-token',
      providerHost: 'https://github.com',
      authStrategy: 'oauth',
    }),
  }

  beforeEach(async () => {
    vi.restoreAllMocks()
    sourceControlApi.listRepositoriesPage.mockReset()
    sourceControlApi.invalidateProviderCache.mockClear()
    convex.query.mockClear()
    convex.action.mockClear()
    Object.assign(globalThis, {
      window: {
        electronAPI: {
          sourceControl: sourceControlApi,
        },
      },
    })

    await invalidateProviderRepositoryManagementCache()
  })

  it('loads a single GitHub page without multi-provider fan-out', async () => {
    sourceControlApi.listRepositoriesPage.mockResolvedValue({
      items: [
        buildRepository({ id: 'gh-1', name: 'alpha', owner: 'me' }),
        buildRepository({ id: 'gh-2', name: 'beta', owner: 'me' }),
      ],
      hasNextPage: false,
    })

    const result = await listConnectedRepositoriesPage({
      convex: convex as never,
      organizationId: 'org_1' as never,
      userId: 'user_1' as never,
      provider: 'github',
      page: 1,
      pageSize: 3,
    })

    expect(result.items.map((item) => item.id)).toEqual(['gh-1', 'gh-2'])
    expect(result.hasNextPage).toBe(false)
    expect(sourceControlApi.listRepositoriesPage).toHaveBeenCalledTimes(1)
    expect(sourceControlApi.listRepositoriesPage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'github',
        accessToken: 'github-token',
        page: 1,
        pageSize: 3,
      })
    )
  })

  it('reuses cached provider sessions until invalidated', async () => {
    sourceControlApi.listRepositoriesPage.mockResolvedValue({
      items: [buildRepository({ id: 'gh-1', name: 'alpha', owner: 'me' })],
      hasNextPage: false,
    })

    await listConnectedRepositoriesPage({
      convex: convex as never,
      organizationId: 'org_1' as never,
      userId: 'user_1' as never,
      provider: 'github',
      page: 1,
      pageSize: 10,
    })

    await listConnectedRepositoriesPage({
      convex: convex as never,
      organizationId: 'org_1' as never,
      userId: 'user_1' as never,
      provider: 'github',
      page: 1,
      pageSize: 10,
    })

    expect(convex.action).toHaveBeenCalledTimes(1)

    await invalidateProviderRepositoryManagementCache({ provider: 'github' })

    await listConnectedRepositoriesPage({
      convex: convex as never,
      organizationId: 'org_1' as never,
      userId: 'user_1' as never,
      provider: 'github',
      page: 1,
      pageSize: 10,
    })

    expect(convex.action).toHaveBeenCalledTimes(2)
    expect(sourceControlApi.invalidateProviderCache).toHaveBeenCalledWith({
      provider: 'github',
    })
  })

  it('surfaces GitHub page failures directly', async () => {
    sourceControlApi.listRepositoriesPage.mockRejectedValue(
      new Error('GitHub install missing')
    )

    await expect(
      listConnectedRepositoriesPage({
        convex: convex as never,
        organizationId: 'org_1' as never,
        userId: 'user_1' as never,
        provider: 'github',
        page: 1,
        pageSize: 10,
      })
    ).rejects.toThrow('GitHub install missing')
  })
})
