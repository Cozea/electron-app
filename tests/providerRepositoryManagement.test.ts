import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  invalidateProviderRepositoryManagementCache,
  listConnectedRepositoriesPage,
} from '../src/lib/git/providerRepositoryManagement'

type RepositoryProvider = 'github' | 'gitlab'

function buildRepository(args: {
  id: string
  name: string
  owner: string
  provider: RepositoryProvider
}): {
  id: string
  name: string
  fullName: string
  ownerLogin: string
  defaultBranch: string
  private: boolean
  url: string
  provider: RepositoryProvider
} {
  return {
    id: args.id,
    name: args.name,
    fullName: `${args.owner}/${args.name}`,
    ownerLogin: args.owner,
    defaultBranch: 'main',
    private: true,
    url: `https://${args.provider}.example.com/${args.owner}/${args.name}`,
    provider: args.provider,
  }
}

describe('providerRepositoryManagement', () => {
  const sourceControlApi = {
    listRepositoriesPage: vi.fn(),
    invalidateProviderCache: vi.fn().mockResolvedValue({ success: true }),
  }

  const convex = {
    query: vi.fn().mockResolvedValue({ providerHost: 'https://github.com' }),
    action: vi.fn().mockImplementation(async (_ref, args: { provider: RepositoryProvider }) => {
      return {
        accessToken: `${args.provider}-token`,
        providerHost: args.provider === 'gitlab' ? 'https://gitlab.com' : 'https://github.com',
        authStrategy: args.provider === 'github' ? 'oauth' : undefined,
      }
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

  it('combines provider pages without per-owner fan-out and preserves provider order', async () => {
    sourceControlApi.listRepositoriesPage.mockImplementation(
      async (args: { provider: RepositoryProvider }) => {
        if (args.provider === 'github') {
          return {
            items: [
              buildRepository({
                id: 'gh-1',
                name: 'alpha',
                owner: 'me',
                provider: 'github',
              }),
              buildRepository({
                id: 'gh-2',
                name: 'beta',
                owner: 'me',
                provider: 'github',
              }),
            ],
            hasNextPage: false,
          }
        }

        return {
          items: [
            buildRepository({
              id: 'gl-1',
              name: 'gamma',
              owner: 'team',
              provider: 'gitlab',
            }),
            buildRepository({
              id: 'gl-2',
              name: 'delta',
              owner: 'team',
              provider: 'gitlab',
            }),
          ],
          hasNextPage: false,
        }
      }
    )

    const result = await listConnectedRepositoriesPage({
      convex: convex as never,
      organizationId: 'org_1' as never,
      userId: 'user_1' as never,
      providers: ['github', 'gitlab'],
      page: 1,
      pageSize: 3,
    })

    expect(result.items.map((item) => item.id)).toEqual(['gh-1', 'gh-2', 'gl-1'])
    expect(result.hasNextPage).toBe(true)
    expect(sourceControlApi.listRepositoriesPage).toHaveBeenCalledTimes(2)
  })

  it('reuses cached provider sessions until invalidated', async () => {
    sourceControlApi.listRepositoriesPage.mockResolvedValue({
      items: [
        buildRepository({
          id: 'gh-1',
          name: 'alpha',
          owner: 'me',
          provider: 'github',
        }),
      ],
      hasNextPage: false,
    })

    await listConnectedRepositoriesPage({
      convex: convex as never,
      organizationId: 'org_1' as never,
      userId: 'user_1' as never,
      providers: ['github'],
      page: 1,
      pageSize: 10,
    })

    await listConnectedRepositoriesPage({
      convex: convex as never,
      organizationId: 'org_1' as never,
      userId: 'user_1' as never,
      providers: ['github'],
      page: 1,
      pageSize: 10,
    })

    expect(convex.action).toHaveBeenCalledTimes(1)

    await invalidateProviderRepositoryManagementCache({ provider: 'github' })

    await listConnectedRepositoriesPage({
      convex: convex as never,
      organizationId: 'org_1' as never,
      userId: 'user_1' as never,
      providers: ['github'],
      page: 1,
      pageSize: 10,
    })

    expect(convex.action).toHaveBeenCalledTimes(2)
    expect(sourceControlApi.invalidateProviderCache).toHaveBeenCalledWith({
      provider: 'github',
    })
  })

  it('returns partial results when one provider fails', async () => {
    sourceControlApi.listRepositoriesPage.mockImplementation(
      async (args: { provider: RepositoryProvider }) => {
        if (args.provider === 'github') {
          throw new Error('GitHub install missing')
        }

        return {
          items: [
            buildRepository({
              id: 'gl-1',
              name: 'gamma',
              owner: 'team',
              provider: 'gitlab',
            }),
          ],
          hasNextPage: false,
        }
      }
    )

    const result = await listConnectedRepositoriesPage({
      convex: convex as never,
      organizationId: 'org_1' as never,
      userId: 'user_1' as never,
      providers: ['github', 'gitlab'],
      page: 1,
      pageSize: 10,
    })

    expect(result.items.map((item) => item.id)).toEqual(['gl-1'])
    expect(result.errorByProvider).toEqual({
      github: 'GitHub install missing',
    })
  })
})
