import { resolveRepositoryAccessToken } from './gitAuth'

type RepositoryProvider = 'github' | 'gitlab'
type GitHubAuthStrategy = 'oauth' | 'github_app_installation'

export interface RepositoryOwnerDescriptor {
  id: string
  login: string
  displayName: string
  kind: 'user' | 'organization' | 'group'
}

export interface RepositoryDescriptor {
  id: string
  name: string
  fullName: string
  ownerLogin: string
  ownerId?: string
  defaultBranch?: string
  private: boolean
  url: string
  provider: RepositoryProvider
  lastActivityAt?: string
  sizeBytes?: number
  starsCount?: number
  description?: string
  language?: string
}

export interface RepositoryBranchDescriptor {
  name: string
  isDefault: boolean
}

export interface ListRepositoryOwnersOptions {
  provider: RepositoryProvider
  accessToken?: string
  encryptedCredentials?: string
  keyId?: string
  providerHost?: string
}

export interface ListRepositoriesOptions extends ListRepositoryOwnersOptions {
  authStrategy?: GitHubAuthStrategy
  ownerId?: string
  ownerLogin?: string
  ownerKind?: 'user' | 'organization' | 'group'
  search?: string
}

export interface CreateRepositoryOptions extends ListRepositoryOwnersOptions {
  authStrategy?: GitHubAuthStrategy
  ownerId?: string
  ownerLogin?: string
  ownerKind?: 'user' | 'organization' | 'group'
  name: string
  private: boolean
}

export interface ListRepositoryBranchesOptions extends ListRepositoryOwnersOptions {
  authStrategy?: GitHubAuthStrategy
  repositoryId?: string
  repositoryFullName: string
  defaultBranch?: string
}

function normalizeProviderHost(provider: RepositoryProvider, providerHost?: string): string {
  if (providerHost?.trim()) {
    return providerHost.trim().replace(/\/+$/, '')
  }
  return provider === 'gitlab' ? 'https://gitlab.com' : 'https://github.com'
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return await response.json()
  }

  const text = await response.text()
  return text ? { message: text } : null
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!payload) return fallback
  if (typeof payload === 'string') return payload

  if (typeof payload === 'object') {
    const candidate = payload as Record<string, unknown>
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message
    }
    if (typeof candidate.error === 'string' && candidate.error.trim()) {
      return candidate.error
    }
    if (Array.isArray(candidate.message) && candidate.message.length > 0) {
      return String(candidate.message[0])
    }
  }

  return fallback
}

function resolveAccessTokenOrThrow(options: {
  provider: RepositoryProvider
  accessToken?: string
  encryptedCredentials?: string
  keyId?: string
}): string {
  const tokenResult = resolveRepositoryAccessToken({
    provider: options.provider,
    accessToken: options.accessToken,
    encryptedCredentials: options.encryptedCredentials,
    keyId: options.keyId,
  })

  if (!tokenResult.accessToken) {
    throw new Error(
      tokenResult.error || 'No provider token is available for repository management.'
    )
  }

  return tokenResult.accessToken
}

async function githubRequest(args: {
  accessToken: string
  path: string
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  providerHost?: string
}): Promise<unknown> {
  const apiBase = normalizeProviderHost('github', args.providerHost).replace(
    'https://github.com',
    'https://api.github.com'
  )
  const response = await fetch(`${apiBase}${args.path}`, {
    method: args.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${args.accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(args.body ? { 'Content-Type': 'application/json' } : undefined),
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  })

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'GitHub repository request failed.'))
  }

  return payload
}

async function gitlabRequest(args: {
  accessToken: string
  path: string
  method?: 'GET' | 'POST'
  body?: URLSearchParams
  providerHost?: string
}): Promise<unknown> {
  const apiBase = `${normalizeProviderHost('gitlab', args.providerHost)}/api/v4`
  const response = await fetch(`${apiBase}${args.path}`, {
    method: args.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      ...(args.body
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : undefined),
    },
    body: args.body?.toString(),
  })

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'GitLab repository request failed.'))
  }

  return payload
}

function matchesRepositorySearch(
  repository: RepositoryDescriptor,
  search: string | undefined
): boolean {
  const normalizedSearch = search?.trim().toLowerCase()
  if (!normalizedSearch) {
    return true
  }

  return (
    repository.name.toLowerCase().includes(normalizedSearch) ||
    repository.fullName.toLowerCase().includes(normalizedSearch)
  )
}

async function listGitHubOwners(
  options: ListRepositoryOwnersOptions
): Promise<RepositoryOwnerDescriptor[]> {
  const accessToken = resolveAccessTokenOrThrow(options)
  const [userPayload, orgsPayload] = await Promise.all([
    githubRequest({
      accessToken,
      path: '/user',
      providerHost: options.providerHost,
    }),
    githubRequest({
      accessToken,
      path: '/user/orgs?per_page=100',
      providerHost: options.providerHost,
    }),
  ])

  const owners: RepositoryOwnerDescriptor[] = []

  if (userPayload && typeof userPayload === 'object') {
    const user = userPayload as Record<string, unknown>
    if (typeof user.login === 'string' && typeof user.id === 'number') {
      owners.push({
        id: String(user.id),
        login: user.login,
        displayName:
          (typeof user.name === 'string' && user.name.trim()) || user.login,
        kind: 'user',
      })
    }
  }

  if (Array.isArray(orgsPayload)) {
    for (const entry of orgsPayload) {
      if (!entry || typeof entry !== 'object') continue
      const org = entry as Record<string, unknown>
      if (typeof org.login !== 'string' || typeof org.id !== 'number') continue
      owners.push({
        id: String(org.id),
        login: org.login,
        displayName:
          (typeof org.login === 'string' && org.login.trim()) || 'Organization',
        kind: 'organization',
      })
    }
  }

  return owners
}

async function listGitHubRepositories(
  options: ListRepositoriesOptions
): Promise<RepositoryDescriptor[]> {
  const accessToken = resolveAccessTokenOrThrow(options)
  const useInstallationToken = options.authStrategy === 'github_app_installation'

  if (useInstallationToken) {
    const payload = await githubRequest({
      accessToken,
      path: '/installation/repositories?per_page=100',
      providerHost: options.providerHost,
    })

    const repositories = (
      payload &&
      typeof payload === 'object' &&
      Array.isArray((payload as { repositories?: unknown[] }).repositories)
        ? (payload as { repositories: unknown[] }).repositories
        : []
    )

    return repositories
      .flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const repo = entry as Record<string, unknown>
        const owner = repo.owner as Record<string, unknown> | undefined
        if (
          typeof repo.id !== 'number' ||
          typeof repo.name !== 'string' ||
          typeof repo.full_name !== 'string' ||
          typeof repo.html_url !== 'string' ||
          typeof owner?.login !== 'string'
        ) {
          return []
        }

        if (
          options.ownerLogin &&
          owner.login.toLowerCase() !== options.ownerLogin.toLowerCase()
        ) {
          return []
        }

        const descriptor: RepositoryDescriptor = {
          id: String(repo.id),
          name: repo.name,
          fullName: repo.full_name,
          ownerLogin: owner.login,
          ownerId: typeof owner.id === 'number' ? String(owner.id) : undefined,
          defaultBranch:
            typeof repo.default_branch === 'string' ? repo.default_branch : undefined,
          private: repo.private === true,
          url: repo.html_url,
          provider: 'github',
          lastActivityAt: typeof repo.updated_at === 'string' ? repo.updated_at : undefined,
          sizeBytes: typeof repo.size === 'number' ? repo.size * 1024 : undefined,
          starsCount: typeof repo.stargazers_count === 'number' ? repo.stargazers_count : undefined,
          description: typeof repo.description === 'string' ? repo.description : undefined,
          language: typeof repo.language === 'string' ? repo.language : undefined,
        }

        return matchesRepositorySearch(descriptor, options.search) ? [descriptor] : []
      })
      .sort((left, right) => left.fullName.localeCompare(right.fullName))
  }

  const owners = await listGitHubOwners(options)
  const selectedOwner =
    owners.find((owner) => owner.id === options.ownerId) ??
    owners.find((owner) => owner.login === options.ownerLogin) ??
    owners[0]

  if (!selectedOwner) {
    return []
  }

  const payload = await githubRequest({
    accessToken,
    path:
      selectedOwner.kind === 'organization'
        ? `/orgs/${encodeURIComponent(selectedOwner.login)}/repos?per_page=100&type=all&sort=updated`
        : '/user/repos?per_page=100&affiliation=owner&sort=updated',
    providerHost: options.providerHost,
  })

  if (!Array.isArray(payload)) {
    return []
  }

  return payload
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const repo = entry as Record<string, unknown>
      const owner = repo.owner as Record<string, unknown> | undefined
      if (
        typeof repo.id !== 'number' ||
        typeof repo.name !== 'string' ||
        typeof repo.full_name !== 'string' ||
        typeof repo.html_url !== 'string' ||
        typeof owner?.login !== 'string'
      ) {
        return []
      }

      const descriptor: RepositoryDescriptor = {
        id: String(repo.id),
        name: repo.name,
        fullName: repo.full_name,
        ownerLogin: owner.login,
        ownerId: typeof owner.id === 'number' ? String(owner.id) : undefined,
        defaultBranch:
          typeof repo.default_branch === 'string' ? repo.default_branch : undefined,
        private: repo.private === true,
        url: repo.html_url,
        provider: 'github',
        lastActivityAt: typeof repo.updated_at === 'string' ? repo.updated_at : undefined,
        sizeBytes: typeof repo.size === 'number' ? repo.size * 1024 : undefined,
        starsCount: typeof repo.stargazers_count === 'number' ? repo.stargazers_count : undefined,
        description: typeof repo.description === 'string' ? repo.description : undefined,
        language: typeof repo.language === 'string' ? repo.language : undefined,
      }

      return matchesRepositorySearch(descriptor, options.search) ? [descriptor] : []
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
}

async function createGitHubRepository(
  options: CreateRepositoryOptions
): Promise<RepositoryDescriptor> {
  const accessToken = resolveAccessTokenOrThrow(options)
  const owners = await listGitHubOwners(options)
  const selectedOwner =
    owners.find((owner) => owner.id === options.ownerId) ??
    owners.find((owner) => owner.login === options.ownerLogin) ??
    owners[0]

  if (!selectedOwner) {
    throw new Error('No GitHub owner is available for repository creation.')
  }

  const payload = await githubRequest({
    accessToken,
    path:
      selectedOwner.kind === 'organization'
        ? `/orgs/${encodeURIComponent(selectedOwner.login)}/repos`
        : '/user/repos',
    method: 'POST',
    body: {
      name: options.name.trim(),
      private: options.private,
      auto_init: false,
    },
    providerHost: options.providerHost,
  })

  if (!payload || typeof payload !== 'object') {
    throw new Error('Failed to create GitHub repository.')
  }

  const repo = payload as Record<string, unknown>
  const owner = repo.owner as Record<string, unknown> | undefined
  if (
    typeof repo.id !== 'number' ||
    typeof repo.name !== 'string' ||
    typeof repo.full_name !== 'string' ||
    typeof repo.html_url !== 'string' ||
    typeof owner?.login !== 'string'
  ) {
    throw new Error('GitHub returned an incomplete repository response.')
  }

  return {
    id: String(repo.id),
    name: repo.name,
    fullName: repo.full_name,
    ownerLogin: owner.login,
    ownerId: typeof owner.id === 'number' ? String(owner.id) : undefined,
    defaultBranch:
      typeof repo.default_branch === 'string' ? repo.default_branch : 'main',
    private: repo.private === true,
    url: repo.html_url,
    provider: 'github',
    lastActivityAt: typeof repo.updated_at === 'string' ? repo.updated_at : undefined,
    sizeBytes: typeof repo.size === 'number' ? repo.size * 1024 : undefined,
    starsCount: typeof repo.stargazers_count === 'number' ? repo.stargazers_count : undefined,
    description: typeof repo.description === 'string' ? repo.description : undefined,
    language: typeof repo.language === 'string' ? repo.language : undefined,
  }
}

function buildGitHubRepositoryPath(fullName: string): string {
  return fullName
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

async function listGitHubBranches(
  options: ListRepositoryBranchesOptions
): Promise<RepositoryBranchDescriptor[]> {
  const accessToken = resolveAccessTokenOrThrow(options)
  const repositoryPath = buildGitHubRepositoryPath(options.repositoryFullName)
  const payload = await githubRequest({
    accessToken,
    path: `/repos/${repositoryPath}/branches?per_page=100`,
    providerHost: options.providerHost,
  })

  if (!Array.isArray(payload)) {
    return []
  }

  return payload.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const branch = entry as Record<string, unknown>
    if (typeof branch.name !== 'string') {
      return []
    }

    return [{
      name: branch.name,
      isDefault: branch.name === options.defaultBranch,
    }]
  })
}

async function listGitLabOwners(
  options: ListRepositoryOwnersOptions
): Promise<RepositoryOwnerDescriptor[]> {
  const accessToken = resolveAccessTokenOrThrow(options)
  const [userPayload, groupsPayload] = await Promise.all([
    gitlabRequest({
      accessToken,
      path: '/user',
      providerHost: options.providerHost,
    }),
    gitlabRequest({
      accessToken,
      path: '/groups?min_access_level=30&per_page=100&all_available=false&order_by=name',
      providerHost: options.providerHost,
    }),
  ])

  const owners: RepositoryOwnerDescriptor[] = []
  if (userPayload && typeof userPayload === 'object') {
    const user = userPayload as Record<string, unknown>
    if (typeof user.id === 'number' && typeof user.username === 'string') {
      owners.push({
        id: String(user.id),
        login: user.username,
        displayName:
          (typeof user.name === 'string' && user.name.trim()) || user.username,
        kind: 'user',
      })
    }
  }

  if (Array.isArray(groupsPayload)) {
    for (const entry of groupsPayload) {
      if (!entry || typeof entry !== 'object') continue
      const group = entry as Record<string, unknown>
      if (typeof group.id !== 'number' || typeof group.full_path !== 'string') continue
      owners.push({
        id: String(group.id),
        login: group.full_path,
        displayName:
          (typeof group.full_name === 'string' && group.full_name.trim()) ||
          group.full_path,
        kind: 'group',
      })
    }
  }

  return owners
}

async function listGitLabRepositories(
  options: ListRepositoriesOptions
): Promise<RepositoryDescriptor[]> {
  const accessToken = resolveAccessTokenOrThrow(options)
  const owners = await listGitLabOwners(options)
  const selectedOwner =
    owners.find((owner) => owner.id === options.ownerId) ??
    owners.find((owner) => owner.login === options.ownerLogin) ??
    owners[0]

  if (!selectedOwner) {
    return []
  }

  const payload = await gitlabRequest({
    accessToken,
    path:
      selectedOwner.kind === 'group'
        ? `/groups/${encodeURIComponent(selectedOwner.id)}/projects?include_subgroups=true&per_page=100&order_by=path`
        : '/projects?owned=true&per_page=100&order_by=path',
    providerHost: options.providerHost,
  })

  if (!Array.isArray(payload)) {
    return []
  }

  return payload
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const repo = entry as Record<string, unknown>
      if (
        typeof repo.id !== 'number' ||
        typeof repo.name !== 'string' ||
        typeof repo.path_with_namespace !== 'string' ||
        typeof repo.web_url !== 'string'
      ) {
        return []
      }

      const namespaceSegments = repo.path_with_namespace.split('/')
      const ownerLogin =
        namespaceSegments.length > 1
          ? namespaceSegments.slice(0, -1).join('/')
          : namespaceSegments[0] || ''
      const descriptor: RepositoryDescriptor = {
        id: String(repo.id),
        name: repo.name,
        fullName: repo.path_with_namespace,
        ownerLogin,
        ownerId: selectedOwner.id,
        defaultBranch:
          typeof repo.default_branch === 'string' ? repo.default_branch : undefined,
        private: repo.visibility !== 'public',
        url: repo.web_url,
        provider: 'gitlab',
        description: typeof repo.description === 'string' ? repo.description : undefined,
        lastActivityAt: typeof repo.last_activity_at === 'string' ? repo.last_activity_at : undefined,
        starsCount: typeof repo.star_count === 'number' ? repo.star_count : undefined,
      }

      if (selectedOwner.kind === 'user' && ownerLogin !== selectedOwner.login) {
        return []
      }

      return matchesRepositorySearch(descriptor, options.search) ? [descriptor] : []
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
}

async function createGitLabRepository(
  options: CreateRepositoryOptions
): Promise<RepositoryDescriptor> {
  const accessToken = resolveAccessTokenOrThrow(options)
  const owners = await listGitLabOwners(options)
  const selectedOwner =
    owners.find((owner) => owner.id === options.ownerId) ??
    owners.find((owner) => owner.login === options.ownerLogin) ??
    owners[0]

  if (!selectedOwner) {
    throw new Error('No GitLab namespace is available for repository creation.')
  }

  const body = new URLSearchParams({
    name: options.name.trim(),
    visibility: options.private ? 'private' : 'public',
  })

  if (selectedOwner.kind === 'group') {
    body.set('namespace_id', selectedOwner.id)
  }

  const payload = await gitlabRequest({
    accessToken,
    path: '/projects',
    method: 'POST',
    body,
    providerHost: options.providerHost,
  })

  if (!payload || typeof payload !== 'object') {
    throw new Error('Failed to create GitLab repository.')
  }

  const repo = payload as Record<string, unknown>
  if (
    typeof repo.id !== 'number' ||
    typeof repo.name !== 'string' ||
    typeof repo.path_with_namespace !== 'string' ||
    typeof repo.web_url !== 'string'
  ) {
    throw new Error('GitLab returned an incomplete repository response.')
  }

  const namespaceSegments = repo.path_with_namespace.split('/')
  const ownerLogin =
    namespaceSegments.length > 1
      ? namespaceSegments.slice(0, -1).join('/')
      : namespaceSegments[0] || selectedOwner.login

  return {
    id: String(repo.id),
    name: repo.name,
    fullName: repo.path_with_namespace,
    ownerLogin,
    ownerId: selectedOwner.id,
    defaultBranch:
      typeof repo.default_branch === 'string' ? repo.default_branch : 'main',
    private: repo.visibility !== 'public',
    url: repo.web_url,
    provider: 'gitlab',
    description: typeof repo.description === 'string' ? repo.description : undefined,
    lastActivityAt: typeof repo.last_activity_at === 'string' ? repo.last_activity_at : undefined,
    starsCount: typeof repo.star_count === 'number' ? repo.star_count : undefined,
  }
}

async function listGitLabBranches(
  options: ListRepositoryBranchesOptions
): Promise<RepositoryBranchDescriptor[]> {
  const accessToken = resolveAccessTokenOrThrow(options)
  const projectIdentifier = options.repositoryId?.trim()
    ? encodeURIComponent(options.repositoryId.trim())
    : encodeURIComponent(options.repositoryFullName)

  const payload = await gitlabRequest({
    accessToken,
    path: `/projects/${projectIdentifier}/repository/branches?per_page=100`,
    providerHost: options.providerHost,
  })

  if (!Array.isArray(payload)) {
    return []
  }

  return payload.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const branch = entry as Record<string, unknown>
    if (typeof branch.name !== 'string') {
      return []
    }

    return [{
      name: branch.name,
      isDefault: branch.default === true,
    }]
  })
}

export async function listRepositoryOwners(
  options: ListRepositoryOwnersOptions
): Promise<RepositoryOwnerDescriptor[]> {
  return options.provider === 'github'
    ? await listGitHubOwners(options)
    : await listGitLabOwners(options)
}

export async function listRepositories(
  options: ListRepositoriesOptions
): Promise<RepositoryDescriptor[]> {
  return options.provider === 'github'
    ? await listGitHubRepositories(options)
    : await listGitLabRepositories(options)
}

export async function listRepositoryBranches(
  options: ListRepositoryBranchesOptions
): Promise<RepositoryBranchDescriptor[]> {
  const branches = options.provider === 'github'
    ? await listGitHubBranches(options)
    : await listGitLabBranches(options)

  return branches.sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })
}

export async function createRepository(
  options: CreateRepositoryOptions
): Promise<RepositoryDescriptor> {
  return options.provider === 'github'
    ? await createGitHubRepository(options)
    : await createGitLabRepository(options)
}
