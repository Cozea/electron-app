import type {
  VersionControlAuthStatus,
  VersionControlProvider,
  VersionControlSetupMode,
} from '@shared/versionControl'

type AutomatedSourceControlProvider = Extract<VersionControlProvider, 'github' | 'gitlab'>

export interface WorkspaceSourceControlConnectionLike {
  provider: AutomatedSourceControlProvider
  authStatus?: VersionControlAuthStatus | null
  setupMode?: VersionControlSetupMode | null
  namespaceId?: string | null
  namespaceLogin?: string | null
  installationId?: string | null
}

export type WorkspaceSourceControlBlockingReason =
  | 'missing_connection'
  | 'wrong_setup_mode'
  | 'needs_reauth'
  | 'missing_namespace'
  | 'missing_installation'
  | 'unknown'

export interface WorkspaceSourceControlReadiness {
  isReady: boolean
  readyConnection: WorkspaceSourceControlConnectionLike | null
  blockingReason: WorkspaceSourceControlBlockingReason | null
  blockingConnection: WorkspaceSourceControlConnectionLike | null
}

export function isWorkspaceSourceControlConnectionReady(
  connection: WorkspaceSourceControlConnectionLike,
  expectedSetupMode: VersionControlSetupMode
): boolean {
  if (connection.setupMode !== expectedSetupMode) {
    return false
  }

  if (connection.authStatus !== 'active') {
    return false
  }

  if (!connection.namespaceId || !connection.namespaceLogin) {
    return false
  }

  if (connection.provider === 'github' && !connection.installationId) {
    return false
  }

  return true
}

function getBlockingReason(
  connection: WorkspaceSourceControlConnectionLike,
  expectedSetupMode: VersionControlSetupMode
): WorkspaceSourceControlBlockingReason {
  if (connection.setupMode !== expectedSetupMode) {
    return 'wrong_setup_mode'
  }

  if (
    connection.authStatus === 'needs_reauth' ||
    connection.authStatus === 'revoked' ||
    connection.authStatus === 'error' ||
    connection.authStatus === 'missing_setup'
  ) {
    return 'needs_reauth'
  }

  if (!connection.namespaceId || !connection.namespaceLogin) {
    return 'missing_namespace'
  }

  if (connection.provider === 'github' && !connection.installationId) {
    return 'missing_installation'
  }

  return 'unknown'
}

export function getWorkspaceSourceControlReadiness(input: {
  connections: WorkspaceSourceControlConnectionLike[]
  expectedSetupMode: VersionControlSetupMode
}): WorkspaceSourceControlReadiness {
  const { connections, expectedSetupMode } = input

  const readyConnection =
    connections.find((connection) =>
      isWorkspaceSourceControlConnectionReady(connection, expectedSetupMode)
    ) ?? null

  if (readyConnection) {
    return {
      isReady: true,
      readyConnection,
      blockingReason: null,
      blockingConnection: null,
    }
  }

  const matchingConnections = connections.filter(
    (connection) => connection.setupMode === expectedSetupMode
  )

  if (connections.length === 0) {
    return {
      isReady: false,
      readyConnection: null,
      blockingReason: 'missing_connection',
      blockingConnection: null,
    }
  }

  if (matchingConnections.length === 0) {
    return {
      isReady: false,
      readyConnection: null,
      blockingReason: 'wrong_setup_mode',
      blockingConnection: connections[0] ?? null,
    }
  }

  const blockingConnection = matchingConnections[0] ?? null

  return {
    isReady: false,
    readyConnection: null,
    blockingReason: blockingConnection
      ? getBlockingReason(blockingConnection, expectedSetupMode)
      : 'unknown',
    blockingConnection,
  }
}
