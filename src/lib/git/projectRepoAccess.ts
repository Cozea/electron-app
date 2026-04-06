import type { ProjectGitRuntimeProjectLike } from '@/lib/git/projectGitRuntime'
import {
  getDefaultVersionControlSetupMode,
  getVersionControlSetupLabel,
  normalizeVersionControlProvider,
  supportsVersionControlAutomation,
  type VersionControlSetupMode,
} from '@shared/versionControl'

export type ProjectRepoAccessProvider = 'github' | 'gitlab' | 'bitbucket' | 'local'
export type ProjectRepoAccessState =
  | 'not_configured'
  | 'attached_checkout'
  | 'integration_missing'
  | 'integration_mismatch'
  | 'provider_ready'
  | 'external_provider'

export interface ProjectRepoAccessStatus {
  provider?: ProjectRepoAccessProvider
  repoUrl?: string
  state: ProjectRepoAccessState
  integrationConnected: boolean
  supportsProviderAutomation: boolean
  requiredSetupMode?: VersionControlSetupMode
  integrationSetupMode?: VersionControlSetupMode
  title: string
  description: string
}

export function normalizeProjectRepoAccessProvider(
  value: string | null | undefined
): ProjectRepoAccessProvider | undefined {
  const normalized = normalizeVersionControlProvider(value)
  return normalized as ProjectRepoAccessProvider | undefined
}

export function resolveProjectRepoAccessStatus(args: {
  project: ProjectGitRuntimeProjectLike | null | undefined
  sourceControlConnection?: {
    authStatus?: string | null
    setupMode?: VersionControlSetupMode | null
  } | null
  isPersonalWorkspace?: boolean
}): ProjectRepoAccessStatus {
  const provider =
    normalizeProjectRepoAccessProvider(args.project?.gitRepository?.provider) ??
    normalizeProjectRepoAccessProvider(args.project?.sourceControl?.provider)
  const repoUrl =
    args.project?.gitRepository?.url?.trim() ||
    args.project?.sourceControl?.repoUrl?.trim() ||
    undefined
  const integrationConnected = Boolean(args.sourceControlConnection)
  const supportsProviderAutomation = supportsVersionControlAutomation(provider)
  const isAttachedCheckout = args.project?.sourceControl?.workingCopyMode === 'attached'
  const sourceControlOwnerLabel = args.isPersonalWorkspace
    ? 'your account source control'
    : 'workspace source control'
  const sourceControlOwnerDescription = args.isPersonalWorkspace
    ? 'your account'
    : 'this workspace'

  if (!provider) {
    return {
      state: 'not_configured',
      integrationConnected: false,
      supportsProviderAutomation: false,
      title: 'No remote repository configured',
      description: 'Project sharing is available, but this project is not yet linked to a provider-managed remote.',
    }
  }

  if (provider === 'local' || isAttachedCheckout) {
    return {
      provider,
      repoUrl,
      state: 'attached_checkout',
      integrationConnected: false,
      supportsProviderAutomation: false,
      title: 'Attached checkout',
      description: 'This project uses an existing local checkout. Project access can be managed here, but each collaborator still needs access to the same upstream git remote.',
    }
  }

  const requiredSetupMode =
    args.project?.sourceControl?.setupMode ??
    getDefaultVersionControlSetupMode(Boolean(args.isPersonalWorkspace))

  if (!supportsProviderAutomation) {
    return {
      provider,
      repoUrl,
      state: 'external_provider',
      integrationConnected: false,
      supportsProviderAutomation: false,
      requiredSetupMode,
      title: 'Provider access is external',
      description: 'This repository is hosted on a provider that the app does not automate yet, so repo-level access still has to be handled outside the app.',
    }
  }

  const setupLabel = getVersionControlSetupLabel({
    provider,
    setupMode: requiredSetupMode,
  })

  if (!integrationConnected) {
    return {
      provider,
      repoUrl,
      state: 'integration_missing',
      integrationConnected: false,
      supportsProviderAutomation: true,
      requiredSetupMode,
      title: `Connect ${provider === 'github' ? 'GitHub' : 'GitLab'} source control`,
      description: `This project expects ${setupLabel.toLowerCase()}. Until ${sourceControlOwnerLabel} is configured, repo-level access still has to be granted in the provider.`,
    }
  }

  if (args.sourceControlConnection?.setupMode !== requiredSetupMode) {
    return {
      provider,
      repoUrl,
      state: 'integration_mismatch',
      integrationConnected: true,
      supportsProviderAutomation: true,
      requiredSetupMode,
      integrationSetupMode: args.sourceControlConnection?.setupMode ?? undefined,
      title: `${provider === 'github' ? 'GitHub' : 'GitLab'} setup mismatch`,
      description: `This project expects ${setupLabel.toLowerCase()}, but ${sourceControlOwnerDescription} is configured for a different ownership mode.`,
    }
  }

  if (args.sourceControlConnection?.authStatus && args.sourceControlConnection.authStatus !== 'active') {
    return {
      provider,
      repoUrl,
      state: 'integration_mismatch',
      integrationConnected: true,
      supportsProviderAutomation: true,
      requiredSetupMode,
      integrationSetupMode: args.sourceControlConnection.setupMode ?? undefined,
      title: `${provider === 'github' ? 'GitHub' : 'GitLab'} source control needs attention`,
      description:
        args.sourceControlConnection.authStatus === 'missing_setup'
          ? 'Finish selecting the provider namespace and installation before repo automation can run.'
          : `Reconnect ${sourceControlOwnerDescription} source-control account before repo automation can run.`,
    }
  }

  return {
    provider,
    repoUrl,
    state: 'provider_ready',
    integrationConnected: true,
    supportsProviderAutomation: true,
    requiredSetupMode,
    integrationSetupMode: args.sourceControlConnection?.setupMode ?? undefined,
    title: `${provider === 'github' ? 'GitHub' : 'GitLab'} source control ready`,
    description: `Cozea already has ${setupLabel.toLowerCase()} for ${sourceControlOwnerDescription}, so this project is eligible for provider-native repo automation from the app.`,
  }
}

export function resolveProjectIntegrationProvider(
  project: ProjectGitRuntimeProjectLike | null | undefined
): 'github' | undefined {
  const provider =
    normalizeProjectRepoAccessProvider(project?.gitRepository?.provider) ??
    normalizeProjectRepoAccessProvider(project?.sourceControl?.provider)
  return provider === 'github' ? provider : undefined
}
