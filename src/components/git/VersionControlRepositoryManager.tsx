import type { Id } from '../../../convex/_generated/dataModel'
import type { RepositoryDescriptor } from '@shared/electronApiTypes'
import { ConnectedRepositoryPicker } from '@/components/git/ConnectedRepositoryPicker'
import { RepositoryProvisioner } from '@/components/git/RepositoryProvisioner'

type RepositoryProvider = 'github' | 'gitlab'

interface VersionControlRepositoryManagerProps {
  provider: RepositoryProvider
  providers?: RepositoryProvider[]
  organizationId?: Id<'organizations'> | null
  integrationConnected: boolean
  setupMode: 'personal' | 'organization'
  selectedRepoUrl?: string
  selectedBranch?: string
  suggestedRepoName?: string
  visibility?: string
  allowCreateRepository?: boolean
  repositorySearchValue?: string
  refreshNonce?: number
  onRemoteRepositoriesLoadingChange?: (isLoading: boolean) => void
  onRepositorySelected: (repository: RepositoryDescriptor) => void
  onRepositoryBranchSelected?: (repository: RepositoryDescriptor, branch: string) => void
}

export function VersionControlRepositoryManager({
  allowCreateRepository = true,
  ...props
}: VersionControlRepositoryManagerProps) {
  if (allowCreateRepository) {
    return (
      <RepositoryProvisioner
        provider={props.provider}
        organizationId={props.organizationId}
        integrationConnected={props.integrationConnected}
        setupMode={props.setupMode}
        selectedRepoUrl={props.selectedRepoUrl}
        suggestedRepoName={props.suggestedRepoName}
        visibility={props.visibility}
        onRepositorySelected={props.onRepositorySelected}
      />
    )
  }

  return (
    <ConnectedRepositoryPicker
      provider={props.provider}
      providers={props.providers}
      organizationId={props.organizationId}
      integrationConnected={props.integrationConnected}
      selectedRepoUrl={props.selectedRepoUrl}
      selectedBranch={props.selectedBranch}
      repositorySearchValue={props.repositorySearchValue}
      refreshNonce={props.refreshNonce}
      onRemoteRepositoriesLoadingChange={props.onRemoteRepositoriesLoadingChange}
      onRepositorySelected={props.onRepositorySelected}
      onRepositoryBranchSelected={props.onRepositoryBranchSelected}
    />
  )
}
