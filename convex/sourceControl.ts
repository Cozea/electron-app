import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import { decrypt, encrypt } from "./lib/encryption"
import {
  canAccessProjectByWorkspaceOrMembership,
  canEditProjectByWorkspaceOrMembership,
  getWorkspaceProjectAccess,
} from "./lib/workspaceProjectAccess"
import {
  getDefaultVersionControlSetupMode,
  normalizeVersionControlProvider,
  type VersionControlProvider,
  type VersionControlSetupMode,
} from "../shared/versionControl"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
const DEFAULT_GITHUB_HOST = "https://github.com"
const DEFAULT_GITLAB_HOST = "https://gitlab.com"
const GITLAB_REFRESH_SKEW_MS = 60_000

type ReadCtx = Pick<QueryCtx | MutationCtx, "db">
type SourceControlProvider = "github" | "gitlab"
type SourceControlNamespaceType = "user" | "organization" | "group"
type SourceControlInstallationTargetType = "user" | "organization"
type SourceControlConnectionScope = "user" | "workspace"
type ProjectSyncPolicy = "auto" | "manual"
type ProjectWorkingCopyMode = "managed" | "attached"
type WorkspaceProviderSessionPurpose =
  | "setup"
  | "repository_management"
  | "repository_access"
  | "git"

interface GitHubInstallationSummary {
  installationId?: string
  installationTargetLogin?: string
  installationTargetName?: string
  installationTargetType?: SourceControlInstallationTargetType
}

interface StoredSourceControlCredentials {
  accessToken: string
  refreshToken?: string
  tokenExpiresAt?: number
  tokenType?: string
  scopes?: string[]
  externalAccountId?: string
  externalAccountName?: string
  externalAccountLogin?: string
}

interface ResolvedWorkspaceProviderSession {
  provider: SourceControlProvider
  providerHost: string
  accessToken: string
  tokenExpiresAt?: number
  authStrategy: "oauth" | "github_app_installation"
  setupMode: VersionControlSetupMode
  namespaceId?: string
  namespaceLogin?: string
  namespaceName?: string
  namespaceType?: SourceControlNamespaceType
  installationId?: string
  installationTargetLogin?: string
  installationTargetName?: string
  installationTargetType?: SourceControlInstallationTargetType
}

interface ProjectBindingResult {
  _id?: Id<"projectRepositoryBindings">
  _creationTime?: number
  projectId: Id<"projects">
  organizationId: Id<"organizations">
  workspaceConnectionId?: Id<"workspaceSourceControlConnections">
  provider: string
  setupMode: VersionControlSetupMode
  syncPolicy: ProjectSyncPolicy
  workingCopyMode: ProjectWorkingCopyMode
  repoUrl?: string
  activeCollabBranch: string
  defaultBranch: string
  ownerId?: string
  ownerLogin?: string
  ownerName?: string
  ownerType?: SourceControlNamespaceType
  repoId?: string
  repoName?: string
  repoFullName?: string
  visibility?: string
  providerHost?: string
  repoAccessPolicy: "on_first_open"
  createdAt: number
  updatedAt: number
}

interface ProjectGitCredentialContextResult {
  binding: ProjectBindingResult
  connection: Doc<"workspaceSourceControlConnections"> | null
}

interface ProjectGitCredentialPayloadResult {
  binding: ProjectBindingResult
  providerSession: ResolvedWorkspaceProviderSession | null
}

interface WorkspaceSourceControlPermission {
  canView: boolean
  canManage: boolean
  defaultSetupMode: VersionControlSetupMode
}

interface ResolvedSourceControlScope {
  connectionScope: SourceControlConnectionScope
  defaultSetupMode: VersionControlSetupMode
  isPersonalWorkspace: boolean
  organization: Doc<"organizations">
}

interface ProjectSourceControlLike {
  provider?: string
  repoUrl?: string | null
  activeCollabBranch?: string | null
  defaultBranch?: string | null
  visibility?: string
  syncPolicy?: ProjectSyncPolicy
  workingCopyMode?: ProjectWorkingCopyMode
  setupMode?: VersionControlSetupMode
}

interface ProjectGitRepositoryLike {
  provider?: string
  url?: string
  defaultBranch?: string | null
}

interface ProjectBindingBuildArgs {
  projectId: Id<"projects">
  organizationId: Id<"organizations">
  sourceControl?: ProjectSourceControlLike | null
  gitRepository?: ProjectGitRepositoryLike | null
  defaultSetupMode: VersionControlSetupMode
  now: number
  workspaceConnectionId?: Id<"workspaceSourceControlConnections">
  repoId?: string
  ownerId?: string
  ownerLogin?: string
  ownerName?: string
  ownerType?: SourceControlNamespaceType
  providerHost?: string
}

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeSourceControlProvider(
  value: string | null | undefined
): VersionControlProvider | undefined {
  return normalizeVersionControlProvider(value)
}

function normalizeAutomatedProvider(
  value: string | null | undefined
): SourceControlProvider | undefined {
  const normalized = normalizeSourceControlProvider(value)
  return normalized === "github" || normalized === "gitlab"
    ? normalized
    : undefined
}

function normalizeProjectWorkingCopyMode(
  value: ProjectWorkingCopyMode | undefined
): ProjectWorkingCopyMode {
  return value === "attached" ? "attached" : "managed"
}

function normalizeProjectSyncPolicy(
  value: ProjectSyncPolicy | undefined
): ProjectSyncPolicy {
  return value === "manual" ? "manual" : "auto"
}

function normalizeProviderHost(
  provider: SourceControlProvider,
  providerHost?: string | null
): string {
  if (providerHost?.trim()) {
    return providerHost.trim().replace(/\/+$/, "")
  }

  return provider === "gitlab" ? DEFAULT_GITLAB_HOST : DEFAULT_GITHUB_HOST
}

function resolveGitHubApiBase(providerHost: string): string {
  return providerHost === DEFAULT_GITHUB_HOST
    ? "https://api.github.com"
    : `${providerHost}/api/v3`
}

function normalizeNamespaceType(
  value: string | null | undefined
): SourceControlNamespaceType | undefined {
  return value === "user" || value === "organization" || value === "group"
    ? value
    : undefined
}

function normalizeInstallationTargetType(
  value: string | null | undefined
): SourceControlInstallationTargetType | undefined {
  return value === "user" || value === "organization" ? value : undefined
}

function normalizeSetupMode(
  setupMode: string | null | undefined,
  defaultSetupMode: VersionControlSetupMode
): VersionControlSetupMode {
  return setupMode === "organization" || setupMode === "personal"
    ? setupMode
    : defaultSetupMode
}

function deriveOwnerType(
  provider: VersionControlProvider,
  setupMode: VersionControlSetupMode
): SourceControlNamespaceType | undefined {
  if (provider === "github") {
    return setupMode === "organization" ? "organization" : "user"
  }

  if (provider === "gitlab") {
    return setupMode === "organization" ? "group" : "user"
  }

  return undefined
}

async function resolveSourceControlScope(
  ctx: ReadCtx,
  organizationId: Id<"organizations">
): Promise<ResolvedSourceControlScope> {
  const organization = await ctx.db.get(organizationId)
  if (!organization) {
    throw new ConvexError("Organization not found")
  }

  const isPersonalWorkspace = organization.workosId.startsWith("personal:")

  return {
    organization,
    isPersonalWorkspace,
    connectionScope: isPersonalWorkspace ? "user" : "workspace",
    defaultSetupMode: getDefaultVersionControlSetupMode(isPersonalWorkspace),
  }
}

function normalizeRepositoryUrl(repoUrl: string): string {
  return repoUrl.trim().replace(/\/+$/, "")
}

function stripDotGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value
}

function parseRepositoryPathFromUrl(repoUrl: string): string | null {
  const normalized = normalizeRepositoryUrl(repoUrl)

  const sshMatch = normalized.match(/^(?:git@|ssh:\/\/git@)[^:/]+[:/](.+?)(?:\.git)?$/i)
  if (sshMatch) {
    return stripDotGitSuffix(sshMatch[1])
  }

  try {
    const url = new URL(normalized)
    const segments = stripDotGitSuffix(url.pathname).split("/").filter(Boolean)
    if (segments.length < 2) {
      return null
    }
    return segments.join("/")
  } catch {
    return null
  }
}

function parseRepositoryOwnerAndName(repoUrl: string): {
  ownerLogin?: string
  repoName?: string
  repoFullName?: string
} {
  const repositoryPath = parseRepositoryPathFromUrl(repoUrl)
  if (!repositoryPath) {
    return {}
  }

  const segments = repositoryPath.split("/").filter(Boolean)
  if (segments.length < 2) {
    return {}
  }

  return {
    ownerLogin: segments.slice(0, -1).join("/"),
    repoName: segments[segments.length - 1],
    repoFullName: segments.join("/"),
  }
}

function summarizeConnection(
  connection: Doc<"workspaceSourceControlConnections">
) {
  return {
    _id: connection._id,
    organizationId: connection.organizationId,
    scopeType: connection.scopeType,
    userId: connection.userId,
    provider: connection.provider,
    authType: connection.authType,
    authStatus: connection.authStatus,
    setupMode: connection.setupMode,
    providerHost: connection.providerHost,
    externalAccountId: connection.externalAccountId,
    externalAccountName: connection.externalAccountName,
    externalAccountLogin: connection.externalAccountLogin,
    oauthScopes: connection.oauthScopes,
    tokenExpiresAt: connection.tokenExpiresAt,
    namespaceId: connection.namespaceId,
    namespaceName: connection.namespaceName,
    namespaceLogin: connection.namespaceLogin,
    namespaceType: connection.namespaceType,
    installationId: connection.installationId,
    installationTargetType: connection.installationTargetType,
    installationTargetLogin: connection.installationTargetLogin,
    installationTargetName: connection.installationTargetName,
    lastVerifiedAt: connection.lastVerifiedAt,
    lastError: connection.lastError,
    connectedBy: connection.connectedBy,
    connectedAt: connection.connectedAt,
    updatedAt: connection.updatedAt,
  }
}

function summarizeProjectBinding(binding: Doc<"projectRepositoryBindings">) {
  const activeCollabBranch =
    binding.activeCollabBranch?.trim() || binding.defaultBranch?.trim() || "main"

  return {
    _id: binding._id,
    projectId: binding.projectId,
    organizationId: binding.organizationId,
    workspaceConnectionId: binding.workspaceConnectionId,
    provider: binding.provider,
    setupMode: binding.setupMode,
    syncPolicy: binding.syncPolicy,
    workingCopyMode: binding.workingCopyMode,
    repoUrl: binding.repoUrl,
    activeCollabBranch,
    defaultBranch: binding.defaultBranch,
    ownerId: binding.ownerId,
    ownerLogin: binding.ownerLogin,
    ownerName: binding.ownerName,
    ownerType: binding.ownerType,
    repoId: binding.repoId,
    repoName: binding.repoName,
    repoFullName: binding.repoFullName,
    visibility: binding.visibility,
    providerHost: binding.providerHost,
    repoAccessPolicy: binding.repoAccessPolicy,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  }
}

async function resolveWorkspaceSourceControlPermission(
  ctx: ReadCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">
): Promise<WorkspaceSourceControlPermission> {
  const workspaceAccess = await getWorkspaceProjectAccess(ctx, organizationId, userId)
  const defaultSetupMode = getDefaultVersionControlSetupMode(
    Boolean(workspaceAccess.organization?.workosId.startsWith("personal:"))
  )

  if (workspaceAccess.isPersonalOwner) {
    return {
      canView: true,
      canManage: true,
      defaultSetupMode,
    }
  }

  const permissions = workspaceAccess.access?.permissions ?? []

  return {
    canView:
      permissions.includes("settings:view") ||
      permissions.includes("projects:view") ||
      permissions.includes("projects:create") ||
      permissions.includes("projects:import"),
    canManage:
      permissions.includes("settings:update") ||
      permissions.includes("integrations:connect") ||
      permissions.includes("org:update"),
    defaultSetupMode,
  }
}

async function requireWorkspaceSourceControlPermission(
  ctx: ReadCtx,
  args: {
    organizationId: Id<"organizations">
    userId: Id<"users">
    mode: "view" | "manage"
  }
): Promise<WorkspaceSourceControlPermission> {
  const permission = await resolveWorkspaceSourceControlPermission(
    ctx,
    args.organizationId,
    args.userId
  )

  if (args.mode === "manage" ? !permission.canManage : !permission.canView) {
    throw new ConvexError("Unauthorized to manage source control for this workspace")
  }

  return permission
}

export async function findWorkspaceConnectionByProvider(
  ctx: ReadCtx,
  organizationId: Id<"organizations">,
  provider: SourceControlProvider,
  userId?: Id<"users">
): Promise<Doc<"workspaceSourceControlConnections"> | null> {
  const scope = await resolveSourceControlScope(ctx, organizationId)

  if (scope.connectionScope === "user") {
    if (!userId) {
      return null
    }

    return await ctx.db
      .query("workspaceSourceControlConnections")
      .withIndex("by_scope_user_provider", (q) =>
        q
          .eq("scopeType", "user")
          .eq("userId", userId)
          .eq("provider", provider)
      )
      .first()
  }

  return await ctx.db
    .query("workspaceSourceControlConnections")
    .withIndex("by_scope_organization_provider", (q) =>
      q
        .eq("scopeType", "workspace")
        .eq("organizationId", organizationId)
        .eq("provider", provider)
    )
    .first()
}

async function decodeConnectionCredentials(
  connection: Doc<"workspaceSourceControlConnections">
): Promise<StoredSourceControlCredentials> {
  const decrypted = await decrypt(connection.encryptedCredentials)
  return JSON.parse(decrypted) as StoredSourceControlCredentials
}

async function persistConnectionCredentials(args: {
  ctx: MutationCtx
  connection: Doc<"workspaceSourceControlConnections">
  credentials: StoredSourceControlCredentials
  tokenExpiresAt?: number
  authStatus?: Doc<"workspaceSourceControlConnections">["authStatus"]
  lastError?: string
}) {
  await args.ctx.db.patch(args.connection._id, {
    encryptedCredentials: await encrypt(JSON.stringify(args.credentials)),
    tokenExpiresAt: args.tokenExpiresAt ?? args.credentials.tokenExpiresAt,
    authStatus: args.authStatus ?? args.connection.authStatus,
    lastError: args.lastError,
    updatedAt: Date.now(),
    lastVerifiedAt: Date.now(),
  })
}

async function persistConnectionCredentialsById(args: {
  ctx: MutationCtx
  connectionId: Id<"workspaceSourceControlConnections">
  credentials: StoredSourceControlCredentials
  tokenExpiresAt?: number
  authStatus?: Doc<"workspaceSourceControlConnections">["authStatus"]
  lastError?: string
}) {
  const connection = await args.ctx.db.get(args.connectionId)
  if (!connection) {
    throw new ConvexError("Source control connection not found")
  }

  await persistConnectionCredentials({
    ctx: args.ctx,
    connection,
    credentials: args.credentials,
    tokenExpiresAt: args.tokenExpiresAt,
    authStatus: args.authStatus,
    lastError: args.lastError,
  })
}

function encodeBase64Url(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input
  let binary = ""
  for (const value of bytes) {
    binary += String.fromCharCode(value)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function pemToBytes(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, "\n")
  const isPkcs1 = normalized.includes("BEGIN RSA PRIVATE KEY")
  const base64 = normalized
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return isPkcs1 ? wrapPkcs1RsaPrivateKeyAsPkcs8(bytes) : bytes
}

function encodeDerLength(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length])
  }

  const bytes: number[] = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining >>= 8
  }

  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function encodeDerSequence(content: Uint8Array): Uint8Array {
  return new Uint8Array([0x30, ...encodeDerLength(content.length), ...content])
}

function encodeDerOctetString(content: Uint8Array): Uint8Array {
  return new Uint8Array([0x04, ...encodeDerLength(content.length), ...content])
}

function concatDerBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function wrapPkcs1RsaPrivateKeyAsPkcs8(pkcs1Bytes: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00])
  const rsaEncryptionAlgorithmIdentifier = new Uint8Array([
    0x30, 0x0d,
    0x06, 0x09,
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ])
  const privateKey = encodeDerOctetString(pkcs1Bytes)

  return encodeDerSequence(
    concatDerBytes([version, rsaEncryptionAlgorithmIdentifier, privateKey])
  )
}

async function createGitHubAppJwt(): Promise<string> {
  const appId = trimToUndefined(process.env.GITHUB_SOURCE_CONTROL_APP_ID)
  const privateKeyPem = trimToUndefined(process.env.GITHUB_SOURCE_CONTROL_APP_PRIVATE_KEY)

  if (!appId || !privateKeyPem) {
    throw new ConvexError(
      "GitHub source control app is not configured. Set GITHUB_SOURCE_CONTROL_APP_ID and GITHUB_SOURCE_CONTROL_APP_PRIVATE_KEY."
    )
  }

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem).buffer as ArrayBuffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  )

  const now = Math.floor(Date.now() / 1000)
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = encodeBase64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    })
  )
  const unsignedToken = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  )

  return `${unsignedToken}.${encodeBase64Url(new Uint8Array(signature))}`
}

async function mintGitHubInstallationAccessToken(
  installationId: string
): Promise<{ accessToken: string; tokenExpiresAt?: number }> {
  const jwt = await createGitHubAppJwt()
  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )

  const payload = (await response.json()) as {
    token?: string
    expires_at?: string
    message?: string
  }

  if (!response.ok || !payload.token) {
    throw new ConvexError(
      payload.message || "Failed to mint a GitHub App installation token."
    )
  }

  return {
    accessToken: payload.token,
    tokenExpiresAt: payload.expires_at
      ? Date.parse(payload.expires_at)
      : undefined,
  }
}

async function resolveGitHubAppInstallationForOwner(args: {
  providerHost?: string
  ownerLogin: string
  ownerType: "user" | "organization"
}): Promise<GitHubInstallationSummary | null> {
  const jwt = await createGitHubAppJwt()
  const providerHost = normalizeProviderHost("github", args.providerHost)
  const apiBase = resolveGitHubApiBase(providerHost)
  const path =
    args.ownerType === "organization"
      ? `/orgs/${encodeURIComponent(args.ownerLogin)}/installation`
      : `/users/${encodeURIComponent(args.ownerLogin)}/installation`

  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })

  if (response.status === 404) {
    return null
  }

  const payload = (await response.json()) as {
    id?: number | string
    message?: string
    account?: {
      login?: string
      name?: string
      type?: string
    }
  }

  if (!response.ok) {
    throw new ConvexError(
      payload.message || "Failed to verify GitHub App installation."
    )
  }

  const installationId =
    typeof payload.id === "number" || typeof payload.id === "string"
      ? String(payload.id)
      : undefined

  return {
    installationId,
    installationTargetLogin: trimToUndefined(payload.account?.login),
    installationTargetName:
      trimToUndefined(payload.account?.name) ??
      trimToUndefined(payload.account?.login),
    installationTargetType:
      payload.account?.type === "Organization"
        ? "organization"
        : payload.account?.type === "User"
          ? "user"
          : undefined,
  }
}

async function refreshGitLabAccessToken(args: {
  connection: Doc<"workspaceSourceControlConnections">
  refreshToken: string
  providerHost?: string
}): Promise<{
  credentials: StoredSourceControlCredentials
  tokenExpiresAt?: number
}> {
  const clientId = trimToUndefined(process.env.GITLAB_SOURCE_CONTROL_CLIENT_ID)
  const clientSecret = trimToUndefined(process.env.GITLAB_SOURCE_CONTROL_CLIENT_SECRET)

  if (!clientId || !clientSecret) {
    throw new ConvexError(
      "GitLab source control OAuth is not configured. Set GITLAB_SOURCE_CONTROL_CLIENT_ID and GITLAB_SOURCE_CONTROL_CLIENT_SECRET."
    )
  }

  const providerHost = normalizeProviderHost("gitlab", args.providerHost)
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const response = await fetch(`${providerHost}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  })

  const payload = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  if (!response.ok || !payload.access_token) {
    throw new ConvexError(
      payload.error_description || payload.error || "Failed to refresh the GitLab OAuth token."
    )
  }

  const tokenExpiresAt = payload.expires_in
    ? Date.now() + payload.expires_in * 1000
    : undefined

  return {
    credentials: {
      ...(await decodeConnectionCredentials(args.connection)),
      accessToken: payload.access_token,
      refreshToken: trimToUndefined(payload.refresh_token) ?? args.refreshToken,
      tokenExpiresAt,
    },
    tokenExpiresAt,
  }
}

async function resolveWorkspaceProviderSession(args: {
  connection: Doc<"workspaceSourceControlConnections">
  purpose: WorkspaceProviderSessionPurpose
  persistRefreshedCredentials?: (args: {
    connectionId: Id<"workspaceSourceControlConnections">
    credentials: StoredSourceControlCredentials
    tokenExpiresAt?: number
  }) => Promise<void>
}): Promise<ResolvedWorkspaceProviderSession> {
  const providerHost = normalizeProviderHost(
    args.connection.provider,
    args.connection.providerHost
  )

  if (args.connection.provider === "github") {
    if (
      args.connection.installationId &&
      (args.purpose === "git" ||
        args.purpose === "repository_management" ||
        args.purpose === "repository_access")
    ) {
      const minted = await mintGitHubInstallationAccessToken(
        args.connection.installationId
      )
      return {
        provider: "github",
        providerHost,
        accessToken: minted.accessToken,
        tokenExpiresAt: minted.tokenExpiresAt,
        authStrategy: "github_app_installation",
        setupMode: args.connection.setupMode,
        namespaceId: args.connection.namespaceId,
        namespaceLogin: args.connection.namespaceLogin,
        namespaceName: args.connection.namespaceName,
        namespaceType: args.connection.namespaceType,
        installationId: args.connection.installationId,
        installationTargetLogin: args.connection.installationTargetLogin,
        installationTargetName: args.connection.installationTargetName,
        installationTargetType: args.connection.installationTargetType,
      }
    }

    const credentials = await decodeConnectionCredentials(args.connection)
    if (!trimToUndefined(credentials.accessToken)) {
      throw new ConvexError("GitHub source control needs to be reconnected.")
    }

    return {
      provider: "github",
      providerHost,
      accessToken: credentials.accessToken,
      tokenExpiresAt: credentials.tokenExpiresAt,
      authStrategy: "oauth",
      setupMode: args.connection.setupMode,
      namespaceId: args.connection.namespaceId,
      namespaceLogin: args.connection.namespaceLogin,
      namespaceName: args.connection.namespaceName,
      namespaceType: args.connection.namespaceType,
      installationId: args.connection.installationId,
      installationTargetLogin: args.connection.installationTargetLogin,
      installationTargetName: args.connection.installationTargetName,
      installationTargetType: args.connection.installationTargetType,
    }
  }

  const credentials = await decodeConnectionCredentials(args.connection)
  const tokenExpiresAt = credentials.tokenExpiresAt
  const shouldRefresh =
    typeof tokenExpiresAt === "number" &&
    tokenExpiresAt - Date.now() <= GITLAB_REFRESH_SKEW_MS

  if (shouldRefresh) {
    const refreshToken = trimToUndefined(credentials.refreshToken)
    if (!refreshToken) {
      throw new ConvexError("GitLab source control needs to be reconnected.")
    }

    const refreshed = await refreshGitLabAccessToken({
      connection: args.connection,
      refreshToken,
      providerHost,
    })
    if (args.persistRefreshedCredentials) {
      await args.persistRefreshedCredentials({
        connectionId: args.connection._id,
        credentials: refreshed.credentials,
        tokenExpiresAt: refreshed.tokenExpiresAt,
      })
    }

    return {
      provider: "gitlab",
      providerHost,
      accessToken: refreshed.credentials.accessToken,
      tokenExpiresAt: refreshed.tokenExpiresAt,
      authStrategy: "oauth",
      setupMode: args.connection.setupMode,
      namespaceId: args.connection.namespaceId,
      namespaceLogin: args.connection.namespaceLogin,
      namespaceName: args.connection.namespaceName,
      namespaceType: args.connection.namespaceType,
    }
  }

  if (!trimToUndefined(credentials.accessToken)) {
    throw new ConvexError("GitLab source control needs to be reconnected.")
  }

  return {
    provider: "gitlab",
    providerHost,
    accessToken: credentials.accessToken,
    tokenExpiresAt: credentials.tokenExpiresAt,
    authStrategy: "oauth",
    setupMode: args.connection.setupMode,
    namespaceId: args.connection.namespaceId,
    namespaceLogin: args.connection.namespaceLogin,
    namespaceName: args.connection.namespaceName,
    namespaceType: args.connection.namespaceType,
  }
}

export function buildProjectRepositoryBindingRecord(
  args: ProjectBindingBuildArgs
) {
  const provider =
    normalizeSourceControlProvider(args.sourceControl?.provider) ??
    normalizeSourceControlProvider(args.gitRepository?.provider)

  if (!provider) {
    return null
  }

  const setupMode = normalizeSetupMode(
    args.sourceControl?.setupMode,
    args.defaultSetupMode
  )
  const syncPolicy = normalizeProjectSyncPolicy(args.sourceControl?.syncPolicy)
  const workingCopyMode = normalizeProjectWorkingCopyMode(
    args.sourceControl?.workingCopyMode
  )
  const repoUrl =
    provider === "local"
      ? undefined
      : trimToUndefined(
          args.sourceControl?.repoUrl ?? args.gitRepository?.url ?? undefined
        )
  const activeCollabBranch =
    trimToUndefined(
      args.sourceControl?.activeCollabBranch ??
        args.sourceControl?.defaultBranch ??
        args.gitRepository?.defaultBranch ??
        undefined
    ) || "main"
  const defaultBranch =
    trimToUndefined(
      args.gitRepository?.defaultBranch ??
        args.sourceControl?.defaultBranch ??
        args.sourceControl?.activeCollabBranch ??
        undefined
    ) || "main"
  const repositoryMetadata = repoUrl ? parseRepositoryOwnerAndName(repoUrl) : {}
  const ownerType =
    args.ownerType ?? deriveOwnerType(provider, setupMode)

  return {
    projectId: args.projectId,
    organizationId: args.organizationId,
    workspaceConnectionId:
      setupMode === "organization" ? args.workspaceConnectionId : undefined,
    provider,
    setupMode,
    syncPolicy,
    workingCopyMode,
    repoUrl,
    activeCollabBranch,
    defaultBranch,
    ownerId: trimToUndefined(args.ownerId),
    ownerLogin:
      trimToUndefined(args.ownerLogin) ??
      trimToUndefined(repositoryMetadata.ownerLogin),
    ownerName: trimToUndefined(args.ownerName),
    ownerType,
    repoId: trimToUndefined(args.repoId),
    repoName: trimToUndefined(repositoryMetadata.repoName),
    repoFullName: trimToUndefined(repositoryMetadata.repoFullName),
    visibility: trimToUndefined(args.sourceControl?.visibility),
    providerHost:
      provider === "github" || provider === "gitlab"
        ? normalizeProviderHost(provider, args.providerHost)
        : undefined,
    repoAccessPolicy: "on_first_open" as const,
    createdAt: args.now,
    updatedAt: args.now,
  }
}

export async function upsertProjectRepositoryBindingDocument(args: {
  ctx: MutationCtx
  binding: ReturnType<typeof buildProjectRepositoryBindingRecord>
}) {
  const binding = args.binding
  if (!binding) {
    return null
  }

  const existing = await args.ctx.db
    .query("projectRepositoryBindings")
    .withIndex("by_project", (q) => q.eq("projectId", binding.projectId))
    .first()

  if (existing) {
    await args.ctx.db.patch(existing._id, {
      ...binding,
      createdAt: existing.createdAt,
      updatedAt: binding.updatedAt,
    })
    return existing._id
  }

  return await args.ctx.db.insert("projectRepositoryBindings", binding)
}

async function loadProjectGitCredentialContext(
  ctx: ReadCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<ProjectGitCredentialContextResult | null> {
  const canAccess = await canAccessProjectByWorkspaceOrMembership(
    ctx,
    projectId,
    userId
  )
  if (!canAccess) {
    throw new ConvexError("Unauthorized to access project source control")
  }

  const project = await ctx.db.get(projectId)
  if (!project) {
    throw new ConvexError("Project not found")
  }

  const organization = await ctx.db.get(project.organizationId)
  if (!organization) {
    throw new ConvexError("Organization not found")
  }

  const defaultSetupMode = getDefaultVersionControlSetupMode(
    organization.workosId.startsWith("personal:")
  )
  const existingBinding = await ctx.db
    .query("projectRepositoryBindings")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first()

  const synthesizedBinding = buildProjectRepositoryBindingRecord({
    projectId: project._id,
    organizationId: project.organizationId,
    sourceControl: project.sourceControl ?? undefined,
    gitRepository: project.gitRepository ?? undefined,
    defaultSetupMode,
    now: Date.now(),
  })

  if (!existingBinding && !synthesizedBinding) {
    return null
  }

  const binding = existingBinding
    ? summarizeProjectBinding(existingBinding)
    : synthesizedBinding

  if (!binding) {
    return null
  }

  const automatedProvider = normalizeAutomatedProvider(binding.provider)
  if (!automatedProvider) {
    return {
      binding,
      connection: null,
    }
  }

  const connection = await findWorkspaceConnectionByProvider(
    ctx,
    project.organizationId,
    automatedProvider,
    userId
  )
  if (!connection) {
    return {
      binding,
      connection: null,
    }
  }

  return {
    binding,
    connection,
  }
}

export const listConnections = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceSourceControlPermission(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      mode: "view",
    })

    const scope = await resolveSourceControlScope(ctx, args.organizationId)
    const rows =
      scope.connectionScope === "user"
        ? await ctx.db
            .query("workspaceSourceControlConnections")
            .withIndex("by_scope_user", (q) =>
              q.eq("scopeType", "user").eq("userId", args.userId)
            )
            .collect()
        : await ctx.db
            .query("workspaceSourceControlConnections")
            .withIndex("by_scope_organization", (q) =>
              q.eq("scopeType", "workspace").eq("organizationId", args.organizationId)
            )
            .collect()

    return rows
      .sort((left, right) => left.provider.localeCompare(right.provider))
      .map(summarizeConnection)
  },
})

export const getByProvider = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    provider: v.union(v.literal("github"), v.literal("gitlab")),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceSourceControlPermission(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      mode: "view",
    })

    const connection = await findWorkspaceConnectionByProvider(
      ctx,
      args.organizationId,
      args.provider,
      args.userId
    )

    return connection ? summarizeConnection(connection) : null
  },
})

export const connectOAuth = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    provider: v.union(v.literal("github"), v.literal("gitlab")),
    setupMode: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
    providerHost: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    oauthScopes: v.optional(v.array(v.string())),
    externalAccountId: v.optional(v.string()),
    externalAccountName: v.optional(v.string()),
    externalAccountLogin: v.optional(v.string()),
    namespaceId: v.optional(v.string()),
    namespaceName: v.optional(v.string()),
    namespaceLogin: v.optional(v.string()),
    namespaceType: v.optional(
      v.union(v.literal("user"), v.literal("organization"), v.literal("group"))
    ),
    installationId: v.optional(v.string()),
    installationTargetType: v.optional(
      v.union(v.literal("user"), v.literal("organization"))
    ),
    installationTargetLogin: v.optional(v.string()),
    installationTargetName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceSourceControlPermission(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      mode: "manage",
    })
    const scope = await resolveSourceControlScope(ctx, args.organizationId)
    const now = Date.now()
    const setupMode = scope.defaultSetupMode
    const existing = await findWorkspaceConnectionByProvider(
      ctx,
      args.organizationId,
      args.provider,
      args.userId
    )
    const encryptedCredentials = await encrypt(
      JSON.stringify({
        accessToken: args.accessToken,
        refreshToken: trimToUndefined(args.refreshToken),
        tokenExpiresAt: args.tokenExpiresAt,
        scopes: args.oauthScopes,
        externalAccountId: trimToUndefined(args.externalAccountId),
        externalAccountName: trimToUndefined(args.externalAccountName),
        externalAccountLogin: trimToUndefined(args.externalAccountLogin),
      } satisfies StoredSourceControlCredentials)
    )

    const payload = {
      organizationId: args.organizationId,
      scopeType: scope.connectionScope,
      userId: scope.connectionScope === "user" ? args.userId : undefined,
      provider: args.provider,
      authType: "oauth" as const,
      authStatus: "active" as const,
      setupMode,
      providerHost: trimToUndefined(args.providerHost),
      externalAccountId: trimToUndefined(args.externalAccountId),
      externalAccountName: trimToUndefined(args.externalAccountName),
      externalAccountLogin: trimToUndefined(args.externalAccountLogin),
      oauthScopes: args.oauthScopes,
      tokenExpiresAt: args.tokenExpiresAt,
      encryptedCredentials,
      namespaceId: trimToUndefined(args.namespaceId),
      namespaceName: trimToUndefined(args.namespaceName),
      namespaceLogin: trimToUndefined(args.namespaceLogin),
      namespaceType: normalizeNamespaceType(args.namespaceType),
      installationId: trimToUndefined(args.installationId),
      installationTargetType: normalizeInstallationTargetType(
        args.installationTargetType
      ),
      installationTargetLogin: trimToUndefined(args.installationTargetLogin),
      installationTargetName: trimToUndefined(args.installationTargetName),
      lastVerifiedAt: now,
      lastError: undefined,
      connectedBy: args.userId,
      connectedAt: existing?.connectedAt ?? now,
      updatedAt: now,
    }

    if (existing) {
      await ctx.db.patch(existing._id, payload)
      return existing._id
    }

    return await ctx.db.insert("workspaceSourceControlConnections", payload)
  },
})

export const disconnect = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    provider: v.union(v.literal("github"), v.literal("gitlab")),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceSourceControlPermission(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      mode: "manage",
    })

    const connection = await findWorkspaceConnectionByProvider(
      ctx,
      args.organizationId,
      args.provider,
      args.userId
    )
    if (!connection) {
      return null
    }

    await ctx.db.delete(connection._id)

    if (connection.scopeType === "workspace") {
      const affectedBindings = await ctx.db
        .query("projectRepositoryBindings")
        .withIndex("by_workspace_connection", (q) =>
          q.eq("workspaceConnectionId", connection._id)
        )
        .collect()

      for (const binding of affectedBindings) {
        await ctx.db.patch(binding._id, {
          workspaceConnectionId: undefined,
          updatedAt: Date.now(),
        })
      }
    }

    return connection._id
  },
})

export const updateConnectionSelection = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    provider: v.union(v.literal("github"), v.literal("gitlab")),
    setupMode: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
    providerHost: v.optional(v.string()),
    namespaceId: v.optional(v.string()),
    namespaceName: v.optional(v.string()),
    namespaceLogin: v.optional(v.string()),
    namespaceType: v.optional(
      v.union(v.literal("user"), v.literal("organization"), v.literal("group"))
    ),
    installationId: v.optional(v.string()),
    installationTargetType: v.optional(
      v.union(v.literal("user"), v.literal("organization"))
    ),
    installationTargetLogin: v.optional(v.string()),
    installationTargetName: v.optional(v.string()),
    authStatus: v.optional(
      v.union(
        v.literal("active"),
        v.literal("needs_reauth"),
        v.literal("revoked"),
        v.literal("missing_setup"),
        v.literal("error")
      )
    ),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceSourceControlPermission(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      mode: "manage",
    })
    const scope = await resolveSourceControlScope(ctx, args.organizationId)

    const connection = await findWorkspaceConnectionByProvider(
      ctx,
      args.organizationId,
      args.provider,
      args.userId
    )
    if (!connection) {
      throw new ConvexError("Source control connection not found for this provider")
    }

    await ctx.db.patch(connection._id, {
      setupMode: scope.defaultSetupMode,
      providerHost: trimToUndefined(args.providerHost) ?? connection.providerHost,
      namespaceId: trimToUndefined(args.namespaceId),
      namespaceName: trimToUndefined(args.namespaceName),
      namespaceLogin: trimToUndefined(args.namespaceLogin),
      namespaceType: normalizeNamespaceType(args.namespaceType),
      installationId: trimToUndefined(args.installationId),
      installationTargetType: normalizeInstallationTargetType(
        args.installationTargetType
      ),
      installationTargetLogin: trimToUndefined(args.installationTargetLogin),
      installationTargetName: trimToUndefined(args.installationTargetName),
      authStatus: args.authStatus ?? connection.authStatus,
      lastError: trimToUndefined(args.lastError),
      updatedAt: Date.now(),
    })

    return connection._id
  },
})

export const getProjectBinding = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canAccess) {
      return null
    }

    const binding = await ctx.db
      .query("projectRepositoryBindings")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()

    return binding ? summarizeProjectBinding(binding) : null
  },
})

export const getProjectProviderContext = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canAccess) {
      return null
    }

    const project = await ctx.db.get(args.projectId)
    if (!project) {
      return null
    }

    const scope = await resolveSourceControlScope(ctx, project.organizationId)
    const existingBinding = await ctx.db
      .query("projectRepositoryBindings")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()

    const binding =
      existingBinding
        ? summarizeProjectBinding(existingBinding)
        : buildProjectRepositoryBindingRecord({
            projectId: project._id,
            organizationId: project.organizationId,
            sourceControl: project.sourceControl ?? undefined,
            gitRepository: project.gitRepository ?? undefined,
            defaultSetupMode: scope.defaultSetupMode,
            now: Date.now(),
          })

    const automatedProvider = normalizeAutomatedProvider(binding?.provider)
    const connection =
      automatedProvider
        ? await findWorkspaceConnectionByProvider(
            ctx,
            project.organizationId,
            automatedProvider,
            args.userId
          )
        : null

    return {
      binding,
      connection: connection ? summarizeConnection(connection) : null,
      settingsScope: scope.connectionScope,
      isPersonalWorkspace: scope.isPersonalWorkspace,
    }
  },
})

export const upsertProjectBinding = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    provider: v.union(
      v.literal("github"),
      v.literal("gitlab"),
      v.literal("bitbucket"),
      v.literal("local")
    ),
    repoUrl: v.optional(v.string()),
    activeCollabBranch: v.optional(v.string()),
    defaultBranch: v.optional(v.string()),
    visibility: v.optional(v.string()),
    syncPolicy: v.optional(v.union(v.literal("auto"), v.literal("manual"))),
    workingCopyMode: v.optional(
      v.union(v.literal("managed"), v.literal("attached"))
    ),
    setupMode: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
    repoId: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    ownerType: v.optional(
      v.union(v.literal("user"), v.literal("organization"), v.literal("group"))
    ),
    providerHost: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const canEdit = await canEditProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canEdit) {
      throw new ConvexError("Unauthorized to update project source control")
    }

    const project = await ctx.db.get(args.projectId)
    if (!project) {
      throw new ConvexError("Project not found")
    }

    const defaultSetupMode = getDefaultVersionControlSetupMode(
      Boolean((await ctx.db.get(project.organizationId))?.workosId.startsWith("personal:"))
    )
    const provider = normalizeSourceControlProvider(args.provider)
    if (!provider) {
      throw new ConvexError("Unsupported repository provider")
    }

    const connection =
      provider === "github" || provider === "gitlab"
        ? await findWorkspaceConnectionByProvider(
            ctx,
            project.organizationId,
            provider,
            args.userId
          )
        : null
    const scopedWorkspaceConnectionId =
      connection?.scopeType === "workspace" ? connection._id : undefined
    const now = Date.now()
    const sourceControl = {
      ...(project.sourceControl ?? {}),
      provider,
      repoUrl: trimToUndefined(args.repoUrl),
      activeCollabBranch:
        trimToUndefined(args.activeCollabBranch) ??
        trimToUndefined(args.defaultBranch) ??
        trimToUndefined(project.sourceControl?.activeCollabBranch) ??
        trimToUndefined(project.sourceControl?.defaultBranch) ??
        project.gitRepository?.defaultBranch ??
        "main",
      defaultBranch:
        trimToUndefined(args.defaultBranch) ??
        trimToUndefined(args.activeCollabBranch) ??
        trimToUndefined(project.sourceControl?.defaultBranch) ??
        trimToUndefined(project.sourceControl?.activeCollabBranch) ??
        project.gitRepository?.defaultBranch ??
        "main",
      visibility: trimToUndefined(args.visibility),
      syncPolicy: normalizeProjectSyncPolicy(args.syncPolicy),
      workingCopyMode: normalizeProjectWorkingCopyMode(args.workingCopyMode),
      setupMode: normalizeSetupMode(args.setupMode, defaultSetupMode),
    }

    await upsertProjectRepositoryBindingDocument({
      ctx,
      binding: buildProjectRepositoryBindingRecord({
        projectId: project._id,
        organizationId: project.organizationId,
        sourceControl,
        gitRepository: project.gitRepository ?? undefined,
        defaultSetupMode,
        workspaceConnectionId: scopedWorkspaceConnectionId,
        repoId: trimToUndefined(args.repoId),
        ownerId: trimToUndefined(args.ownerId),
        ownerLogin:
          trimToUndefined(parseRepositoryOwnerAndName(args.repoUrl ?? "").ownerLogin) ??
          connection?.namespaceLogin,
        ownerName: trimToUndefined(args.ownerName),
        ownerType: normalizeNamespaceType(args.ownerType),
        providerHost: trimToUndefined(args.providerHost) ?? connection?.providerHost,
        now,
      }),
    })

    await ctx.db.patch(project._id, {
      sourceControl,
      gitRepository:
        provider === "local" || !sourceControl.repoUrl
          ? undefined
          : {
              provider,
              owner:
                parseRepositoryOwnerAndName(sourceControl.repoUrl).ownerLogin ?? "",
              name:
                parseRepositoryOwnerAndName(sourceControl.repoUrl).repoName ?? "",
              url: normalizeRepositoryUrl(sourceControl.repoUrl),
              defaultBranch:
                project.gitRepository?.defaultBranch ??
                sourceControl.defaultBranch ??
                sourceControl.activeCollabBranch ??
                "main",
            },
      updatedAt: now,
    })

    return project._id
  },
})

export const getWorkspaceProviderSessionConnection = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    provider: v.union(v.literal("github"), v.literal("gitlab")),
  },
  handler: async (
    ctx,
    args
  ): Promise<Doc<"workspaceSourceControlConnections"> | null> => {
    await requireWorkspaceSourceControlPermission(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      mode: "view",
    })

    return await findWorkspaceConnectionByProvider(
      ctx,
      args.organizationId,
      args.provider,
      args.userId
    )
  },
})

export const persistRefreshedConnectionCredentialsInternal = internalMutation({
  args: {
    connectionId: v.id("workspaceSourceControlConnections"),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    tokenType: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    externalAccountId: v.optional(v.string()),
    externalAccountName: v.optional(v.string()),
    externalAccountLogin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await persistConnectionCredentialsById({
      ctx,
      connectionId: args.connectionId,
      credentials: {
        accessToken: args.accessToken,
        refreshToken: trimToUndefined(args.refreshToken),
        tokenExpiresAt: args.tokenExpiresAt,
        tokenType: trimToUndefined(args.tokenType),
        scopes: args.scopes,
        externalAccountId: trimToUndefined(args.externalAccountId),
        externalAccountName: trimToUndefined(args.externalAccountName),
        externalAccountLogin: trimToUndefined(args.externalAccountLogin),
      },
      tokenExpiresAt: args.tokenExpiresAt,
      authStatus: "active",
    })

    return args.connectionId
  },
})

export const issueWorkspaceProviderSession = action({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    provider: v.union(v.literal("github"), v.literal("gitlab")),
    purpose: v.union(
      v.literal("setup"),
      v.literal("repository_management"),
      v.literal("repository_access"),
      v.literal("git")
    ),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<ResolvedWorkspaceProviderSession | null> => {
    const connection = (await ctx.runQuery(
      internal.sourceControl.getWorkspaceProviderSessionConnection,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        provider: args.provider,
      }
    )) as Doc<"workspaceSourceControlConnections"> | null
    if (!connection) {
      return null
    }

    return await resolveWorkspaceProviderSession({
      connection,
      purpose: args.purpose,
      persistRefreshedCredentials: async (refreshArgs) => {
        await ctx.runMutation(
          internal.sourceControl.persistRefreshedConnectionCredentialsInternal,
          {
            connectionId: refreshArgs.connectionId,
            accessToken: refreshArgs.credentials.accessToken,
            refreshToken: refreshArgs.credentials.refreshToken,
            tokenExpiresAt: refreshArgs.tokenExpiresAt,
            tokenType: refreshArgs.credentials.tokenType,
            scopes: refreshArgs.credentials.scopes,
            externalAccountId: refreshArgs.credentials.externalAccountId,
            externalAccountName: refreshArgs.credentials.externalAccountName,
            externalAccountLogin: refreshArgs.credentials.externalAccountLogin,
          }
        )
      },
    })
  },
})

export const verifyWorkspaceSourceControlViewAccess = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceSourceControlPermission(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      mode: "view",
    })

    return true
  },
})

export const getProjectGitCredentialContext = internalQuery({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (
    ctx,
    args
  ): Promise<ProjectGitCredentialContextResult | null> => {
    return await loadProjectGitCredentialContext(ctx, args.projectId, args.userId)
  },
})

export const resolveGitHubInstallationsForOwners = action({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    providerHost: v.optional(v.string()),
    owners: v.array(
      v.object({
        id: v.string(),
        login: v.string(),
        kind: v.union(v.literal("user"), v.literal("organization")),
      })
    ),
  },
  handler: async (ctx: ActionCtx, args) => {
    await ctx.runQuery(internal.sourceControl.verifyWorkspaceSourceControlViewAccess, {
      organizationId: args.organizationId,
      userId: args.userId,
    })

    const results = await Promise.all(
      args.owners.map(async (owner) => {
        const installation = await resolveGitHubAppInstallationForOwner({
          providerHost: args.providerHost,
          ownerLogin: owner.login,
          ownerType: owner.kind,
        })

        return {
          ownerId: owner.id,
          ownerLogin: owner.login,
          installationId: installation?.installationId,
          installationTargetType: installation?.installationTargetType,
          installationTargetLogin: installation?.installationTargetLogin,
          installationTargetName: installation?.installationTargetName,
        }
      })
    )

    return results
  },
})

export const issueProjectGitCredentials = action({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<ProjectGitCredentialPayloadResult | null> => {
    const credentialContext = (await ctx.runQuery(
      internal.sourceControl.getProjectGitCredentialContext,
      {
        projectId: args.projectId,
        userId: args.userId,
      }
    )) as ProjectGitCredentialContextResult | null

    if (!credentialContext) {
      return null
    }

    if (!credentialContext.connection) {
      return {
        binding: credentialContext.binding,
        providerSession: null,
      }
    }

    return {
      binding: credentialContext.binding,
      providerSession: await resolveWorkspaceProviderSession({
        connection: credentialContext.connection,
        purpose: "git",
        persistRefreshedCredentials: async (refreshArgs) => {
          await ctx.runMutation(
            internal.sourceControl.persistRefreshedConnectionCredentialsInternal,
            {
              connectionId: refreshArgs.connectionId,
              accessToken: refreshArgs.credentials.accessToken,
              refreshToken: refreshArgs.credentials.refreshToken,
              tokenExpiresAt: refreshArgs.tokenExpiresAt,
              tokenType: refreshArgs.credentials.tokenType,
              scopes: refreshArgs.credentials.scopes,
              externalAccountId: refreshArgs.credentials.externalAccountId,
              externalAccountName: refreshArgs.credentials.externalAccountName,
              externalAccountLogin: refreshArgs.credentials.externalAccountLogin,
            }
          )
        },
      }),
    }
  },
})

export const issueProjectGitCredentialsForServer = action({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    serverSecret: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<ProjectGitCredentialPayloadResult | null> => {
    assertGatewaySecret(args.serverSecret)
    const credentialContext = (await ctx.runQuery(
      internal.sourceControl.getProjectGitCredentialContext,
      {
        projectId: args.projectId,
        userId: args.userId,
      }
    )) as ProjectGitCredentialContextResult | null

    if (!credentialContext) {
      return null
    }

    if (!credentialContext.connection) {
      return {
        binding: credentialContext.binding,
        providerSession: null,
      }
    }

    return {
      binding: credentialContext.binding,
      providerSession: await resolveWorkspaceProviderSession({
        connection: credentialContext.connection,
        purpose: "git",
        persistRefreshedCredentials: async (refreshArgs) => {
          await ctx.runMutation(
            internal.sourceControl.persistRefreshedConnectionCredentialsInternal,
            {
              connectionId: refreshArgs.connectionId,
              accessToken: refreshArgs.credentials.accessToken,
              refreshToken: refreshArgs.credentials.refreshToken,
              tokenExpiresAt: refreshArgs.tokenExpiresAt,
              tokenType: refreshArgs.credentials.tokenType,
              scopes: refreshArgs.credentials.scopes,
              externalAccountId: refreshArgs.credentials.externalAccountId,
              externalAccountName: refreshArgs.credentials.externalAccountName,
              externalAccountLogin: refreshArgs.credentials.externalAccountLogin,
            }
          )
        },
      }),
    }
  },
})
