import { RepositoryProvisioner } from '@/components/git/RepositoryProvisioner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { ProjectRepoAccessStatus } from '@/lib/git/projectRepoAccess'
import {

  supportsVersionControlAutomation,
  type VersionControlSetupMode,
} from '@shared/versionControl'
import type { Doc } from '../../../../../convex/_generated/dataModel'

import { Switch } from '@/components/ui/switch'

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __AlertCircleHugeIcon } from '@hugeicons/core-free-icons'

type VersionControlProviderOption = 'github' | 'local'

export interface ProjectSettingsSourceControlPanelProps {
  project: Doc<'projects'>
  repoAccessStatus: ProjectRepoAccessStatus
  repoIntegration: {
    authStatus?: string | null
    setupMode?: VersionControlSetupMode | null
  } | null
  provider: VersionControlProviderOption
  onProviderChange: (next: VersionControlProviderOption) => void
  onRepoUrlChange: (value: string) => void
  defaultBranch: string
  onDefaultBranchChange: (value: string) => void
  setupMode: VersionControlSetupMode
  normalizedRepoUrl: string
  saveError: string | null
  onOpenWorkspaceSourceControlSettings: () => void
}

export function ProjectSettingsSourceControlPanel({
  project,
  repoAccessStatus,
  repoIntegration,
  provider,
  onProviderChange,
  onRepoUrlChange,
  defaultBranch,
  onDefaultBranchChange,
  setupMode,
  normalizedRepoUrl,
  saveError,
  onOpenWorkspaceSourceControlSettings,
}: ProjectSettingsSourceControlPanelProps) {
  const showConnectCta =
    repoAccessStatus.state === 'integration_missing' ||
    repoAccessStatus.state === 'integration_mismatch'

  return (
    <div className="mx-auto max-w-5xl">
      {showConnectCta ? (
        <div className="mb-8 flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <HugeiconsIcon icon={__AlertCircleHugeIcon} className="size-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium leading-snug">{repoAccessStatus.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {repoAccessStatus.description}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0 self-start sm:self-center"
            onClick={onOpenWorkspaceSourceControlSettings}
          >
            {repoAccessStatus.state === 'integration_mismatch'
              ? 'Fix in workspace settings'
              : 'Connect in workspace settings'}
          </Button>
        </div>
      ) : null}

      <div className="min-w-0 space-y-8">
        <section>
          <h3 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
            Repository Tools
          </h3>
          <div className="flex flex-col overflow-hidden rounded-[14px] bg-muted">
            <div className="flex min-h-[44px] items-center justify-between gap-4 px-4 py-2">
              <div className="flex flex-col gap-0.5 pr-4">
                <Label htmlFor="sc-provider" className="text-xs font-medium text-foreground">GitHub Repository Tools</Label>
                <p className="text-[11px] text-muted-foreground">Optional. Attach a repository if you want manual GitHub workflows inside Cozea.</p>
              </div>
              <Switch
                id="sc-provider"
                checked={provider === 'github'}
                onCheckedChange={(checked) => {
                  onProviderChange(checked ? 'github' : 'local')
                }}
              />
            </div>
            {supportsVersionControlAutomation(provider) && project.organizationId ? (
              <RepositoryProvisioner
                provider={provider}
                organizationId={project.organizationId}
                integrationConnected={Boolean(repoIntegration)}
                setupMode={setupMode}
                selectedRepoUrl={normalizedRepoUrl}
                compactTable
                onRepositorySelected={(repository) => {
                  onRepoUrlChange(repository.url)
                  onDefaultBranchChange(repository.defaultBranch || 'main')
                }}
              />
            ) : null}
            {provider === 'github' && normalizedRepoUrl ? (
              <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs font-medium text-foreground">Default Branch</Label>
                  <p className="text-[11px] text-muted-foreground">Used as the shared branch when this repository is attached.</p>
                </div>
                <span className="text-[11px] text-muted-foreground">{defaultBranch}</span>
              </div>
            ) : null}
            <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
              <div className="flex flex-col gap-0.5">
                <Label className="text-xs font-medium text-foreground">Current Mode</Label>
                <p className="text-[11px] text-muted-foreground">
                  {provider === 'github'
                    ? 'Cozea will keep collaboration separate from your manual git work.'
                    : 'This project is using Cozea-native collaboration only.'}
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {provider === 'github' ? 'GitHub attached' : 'Cozea only'}
              </span>
            </div>
          </div>
        </section>

        {saveError ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {saveError}
          </p>
        ) : null}
      </div>
    </div>
  )
}

